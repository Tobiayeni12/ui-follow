// The live trivia round: one question at a time, won by the FIRST chat
// message that matches an answer. The streamer either asks questions one by
// one from the dashboard, or starts the PLAYLIST, which runs through the
// ticked questions by itself until it ends or the streamer stops it.
//
// States:  idle → active → solved | expired → idle
//   active   a question is up and the clock is running
//   solved   someone got it (winner + answer shown for a few seconds)
//   expired  time ran out, or the streamer hit "Reveal" (answer shown)
//
// Playlist: question → result → short pause → next question … At the end it
// either loops or stops (and shows the leaderboard for a moment). Whether it
// loops is read when you press Start. It runs on
// the server, so it keeps going whether or not the dashboard is open.
//
// Kept in memory on purpose: a restart simply drops back to idle (and the
// playlist stops) instead of leaving a stale question on stream. Questions,
// points and settings are persisted (triviaStore.js).
//
// Anything sent to the overlay's public WebSocket channel is readable by
// anyone who opens that socket, so the answer is NEVER included until the
// round has ended. The dashboard gets the answers through its own
// authenticated API (adminRound below).
const hub = require('../websocket/hub');
const store = require('./triviaStore');
const configStore = require('./tiktokLiveConfigStore');
const { isCorrect, cleanText } = require('./triviaLogic');

const CHANNELS = ['trivia', 'trivia-preview'];
const FINALE_MS = 15000; // leaderboard-only screen when a playlist finishes

let seq = 0; // round ids
let rev = 0; // snapshot order, so an overlay can drop a stale one
let round = { status: 'idle', id: 0 };
let expireTimer = null;
let idleTimer = null;

// Playlist run. `queue` holds question ids; `pos` is how many have been started.
let auto = { active: false };
let finale = false;
let finaleTimer = null;

// start / reveal / clear / playlist steps run one at a time (they await
// storage); chat matching is deliberately NOT queued behind them — it must
// claim the win synchronously so two correct messages can never both win.
let lock = Promise.resolve();
function exclusive(fn) {
  const run = lock.then(fn);
  lock = run.catch(() => {});
  return run;
}

function logError(err) {
  console.error('[trivia] background step failed:', err.message);
}

function clearTimers() {
  clearTimeout(expireTimer);
  clearTimeout(idleTimer);
  expireTimer = null;
  idleTimer = null;
}

function clearFinale() {
  finale = false;
  clearTimeout(finaleTimer);
  finaleTimer = null;
}

function startFinale() {
  clearFinale();
  finale = true;
  finaleTimer = setTimeout(() => {
    finale = false;
    publish().catch(logError);
  }, FINALE_MS);
}

function toIdle() {
  clearTimers();
  round = { status: 'idle', id: seq };
}

function scheduleIdle(roundRef, seconds) {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (round !== roundRef) return;
    toIdle();
    publish().catch(logError);
    afterRound(roundRef);
  }, seconds * 1000);
}

// ------------------------------------------------------------ snapshots

function publicRound() {
  const ended = round.status === 'solved' || round.status === 'expired';
  return {
    status: round.status,
    id: round.id,
    question: round.question ? { text: round.question.text, points: round.question.points } : null,
    startedAt: round.startedAt || null,
    endsAt: round.endsAt || null,
    timeLimitMs: round.timeLimitMs || null,
    winner: round.winner || null, // { name, points, key } — a TikTok name/handle, public by nature
    answer: ended ? round.answer : null,
  };
}

/** What the overlay (and anyone on its socket) may see. */
async function snapshot() {
  const [settings, board] = await Promise.all([store.getSettings(), store.getLeaderboard(10)]);
  // round + rev are read together, after the awaits, so a later rev is always
  // the fresher state
  return {
    rev: ++rev,
    serverTime: Date.now(),
    round: publicRound(),
    finale, // a playlist just ended: show the leaderboard for a moment
    leaderboard: board.slice(0, settings.leaderboardSize).map((e, i) => ({
      rank: i + 1,
      key: e.uniqueId,
      name: e.name,
      points: e.points,
      wins: e.wins,
    })),
    settings: {
      palette: settings.palette,
      align: settings.align,
      size: settings.size,
      idleView: settings.idleView,
      showLeaderboard: settings.showLeaderboard,
      leaderboardSize: settings.leaderboardSize,
    },
  };
}

async function publish() {
  const snap = await snapshot();
  const message = { type: 'trivia:snapshot', ...snap };
  for (const channel of CHANNELS) hub.broadcast(channel, message);
  return snap;
}

function autoInfo() {
  if (!auto.active) return { active: false };
  return {
    active: true,
    position: auto.pos, // questions started so far this pass
    total: auto.queue.length,
    stopAfter: auto.stopAfter,
    nextAt: auto.nextAt, // set while waiting out the pause between questions
  };
}

/** Dashboard-only view: the same round plus what the answer is. */
function adminRound() {
  return {
    ...publicRound(),
    questionId: round.question ? round.question.id : null,
    answers: round.question ? round.question.answers : [],
    answer: round.answer || null,
    auto: autoInfo(),
    serverTime: Date.now(),
  };
}

// ------------------------------------------------------------- one round

/** Put a question on screen (call inside exclusive()). */
async function begin(question, settings) {
  const host = await configStore.getUsername();
  await store.markAsked(question.id);

  clearTimers();
  clearFinale();
  const now = Date.now();
  const timeLimitMs = settings.timeLimitSec * 1000;
  const thisRound = {
    status: 'active',
    id: ++seq,
    question,
    startedAt: now,
    endsAt: now + timeLimitMs,
    timeLimitMs,
    winner: null,
    answer: null,
    host: host ? host.toLowerCase() : '',
    opts: {
      typoTolerance: settings.typoTolerance,
      ignoreHost: settings.ignoreHost,
      resultSeconds: settings.resultSeconds,
      gapSeconds: settings.gapSeconds,
    },
  };
  round = thisRound;
  expireTimer = setTimeout(() => expire(thisRound), timeLimitMs);
  await publish();
}

function pickNext(questions, settings) {
  const pool = questions.filter((q) => !q.askedAt);
  if (!pool.length) {
    throw new store.TriviaInputError(
      questions.length
        ? 'Every question has been asked already — use "Reset asked" to start over.'
        : 'Add a question first.'
    );
  }
  return settings.order === 'random' ? pool[Math.floor(Math.random() * pool.length)] : pool[0];
}

/** Ask one question: the given one, or the next unasked. Replaces any round in progress. */
function start({ id } = {}) {
  return exclusive(async () => {
    if (auto.active) throw new store.TriviaInputError('The playlist is running — press Stop first.');
    const [questions, settings] = await Promise.all([store.listQuestions(), store.getSettings()]);
    let question;
    if (id) {
      question = questions.find((q) => q.id === id);
      if (!question) throw new store.TriviaInputError('That question no longer exists.');
    } else {
      question = pickNext(questions, settings);
    }
    await begin(question, settings);
    return adminRound();
  });
}

/** Time's up (or the streamer revealed it). Returns the broadcast, or null if the round already moved on. */
function expire(roundRef) {
  if (round !== roundRef || round.status !== 'active') return null;
  clearTimeout(expireTimer);
  round.status = 'expired';
  round.answer = round.question.answers[0];
  scheduleIdle(round, round.opts.resultSeconds);
  return publish().catch(logError);
}

/** Streamer ends the question early and shows the answer. */
function reveal() {
  return exclusive(async () => {
    if (round.status !== 'active') throw new store.TriviaInputError('There is no question running.');
    await expire(round);
    return adminRound();
  });
}

/** Take everything off screen right now (and stop the playlist, if one is running). */
function clear() {
  return exclusive(async () => {
    haltPlaylist();
    clearFinale();
    toIdle();
    await publish();
    return adminRound();
  });
}

// -------------------------------------------------------------- playlist

function shuffle(ids) {
  const a = ids.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildQueue(questions, settings) {
  const ids = questions.filter((q) => q.inPlaylist).map((q) => q.id);
  return settings.order === 'random' ? shuffle(ids) : ids;
}

function haltPlaylist() {
  clearTimeout(auto.timer);
  auto = { active: false };
}

/** The playlist ran out of questions: stop, and show the leaderboard for a moment. */
async function finishPlaylist() {
  haltPlaylist();
  startFinale();
  await publish();
}

/** Start the next question of the playlist, or finish it (call inside exclusive()). */
async function playNext() {
  clearTimeout(auto.timer);
  auto.nextAt = null;
  for (;;) {
    if (!auto.active) return;
    const [questions, settings] = await Promise.all([store.listQuestions(), store.getSettings()]);
    if (!auto.active) return; // stopped while loading

    if (auto.pos >= auto.queue.length) {
      const again = auto.loop ? buildQueue(questions, settings) : [];
      if (!again.length) {
        await finishPlaylist();
        return;
      }
      auto.queue = again;
      auto.pos = 0;
    }
    const id = auto.queue[auto.pos];
    auto.pos += 1;
    const question = questions.find((q) => q.id === id);
    if (!question) continue; // deleted since the playlist started — skip it
    await begin(question, settings);
    return;
  }
}

/** A round's result has just cleared: continue the playlist, or stop if asked to. */
function afterRound(roundRef) {
  if (!auto.active) return;
  if (auto.stopAfter) {
    haltPlaylist();
    return;
  }
  if (auto.pos >= auto.queue.length && !auto.loop) {
    // that was the last one and it isn't set to loop: no point waiting out a pause
    finishPlaylist().catch(logError);
    return;
  }
  const gapMs = roundRef.opts.gapSeconds * 1000;
  auto.nextAt = Date.now() + gapMs;
  auto.timer = setTimeout(() => {
    exclusive(() => (auto.active ? playNext() : null)).catch(logError);
  }, gapMs);
}

/** Run through the ticked questions, in order (or shuffled), until the end or Stop. */
function startPlaylist() {
  return exclusive(async () => {
    if (auto.active) throw new store.TriviaInputError('The playlist is already running.');
    const [questions, settings] = await Promise.all([store.listQuestions(), store.getSettings()]);
    const queue = buildQueue(questions, settings);
    if (!queue.length) {
      throw new store.TriviaInputError(
        questions.length ? 'Tick at least one question for the playlist.' : 'Add a question first.'
      );
    }
    clearTimers();
    clearFinale();
    auto = { active: true, queue, pos: 0, stopAfter: false, nextAt: null, timer: null, loop: settings.playlistLoop };
    await playNext();
    return adminRound();
  });
}

/**
 * Stop the playlist. Normally right now (the screen clears); with
 * `afterCurrent` the question on screen is allowed to finish first.
 */
function stopPlaylist({ afterCurrent = false } = {}) {
  return exclusive(async () => {
    if (!auto.active) throw new store.TriviaInputError('The playlist is not running.');
    if (afterCurrent && round.status !== 'idle') {
      auto.stopAfter = true;
      return adminRound();
    }
    haltPlaylist();
    toIdle();
    await publish();
    return adminRound();
  });
}

// ------------------------------------------------------------------ chat

/**
 * Feed every chat message through here. Cheap when no question is running.
 * The first message that matches wins; the win is claimed synchronously (before
 * any await) so a second correct message in the same instant is ignored.
 * `isTest` is for the dashboard's fake-chat box (it may play as the host).
 */
function handleChat({ uniqueId, nickname, comment } = {}, { isTest = false } = {}) {
  const current = round;
  if (current.status !== 'active') return null;
  if (Date.now() >= current.endsAt) return null;

  const id = cleanText(uniqueId, 40);
  const text = String(comment == null ? '' : comment).slice(0, 300);
  if (!id || !text) return null;
  if (!isTest && current.opts.ignoreHost && current.host && id.toLowerCase() === current.host) return null;
  if (!isCorrect(text, current.question.answers, { typoTolerance: current.opts.typoTolerance })) return null;

  // claim the win
  const name = cleanText(nickname, 40) || id;
  const points = current.question.points;
  clearTimeout(expireTimer);
  current.status = 'solved';
  current.winner = { name, points, key: id.toLowerCase() };
  current.answer = current.question.answers[0];
  scheduleIdle(current, current.opts.resultSeconds);
  return award(current, id, name, points);
}

async function award(roundRef, uniqueId, name, points) {
  try {
    await store.addPoints(uniqueId, name, points);
  } catch (err) {
    // The win still shows on screen; only the saved total is affected.
    console.error('[trivia] could not save points:', err.message);
  }
  // a new question may have replaced this round while points were saving —
  // its own snapshot already carries the updated board
  if (round !== roundRef) return null;
  console.log(`[trivia] @${uniqueId} won "${roundRef.question.text}" (+${points})`);
  return publish().catch(logError);
}

module.exports = {
  start,
  reveal,
  clear,
  startPlaylist,
  stopPlaylist,
  handleChat,
  publish,
  snapshot,
  adminRound,
};
