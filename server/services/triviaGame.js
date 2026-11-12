// The live trivia round: one question at a time, started by the streamer from
// the dashboard, won by the FIRST chat message that matches an answer.
//
// States:  idle → active → solved | expired → idle
//   active   a question is up and the clock is running
//   solved   someone got it (winner + answer shown for a few seconds)
//   expired  time ran out, or the streamer hit "Reveal" (answer shown)
//
// Kept in memory on purpose: a restart simply drops back to idle instead of
// leaving a stale question on stream. Questions, points and settings are
// persisted (triviaStore.js).
//
// Anything sent to the overlay's public WebSocket channel is readable by
// anyone who opens that socket, so the answer is NEVER included until the
// round has ended. The dashboard gets the answers through its own
// authenticated API (adminState below).
const hub = require('../websocket/hub');
const store = require('./triviaStore');
const configStore = require('./tiktokLiveConfigStore');
const { isCorrect, cleanText } = require('./triviaLogic');

const CHANNELS = ['trivia', 'trivia-preview'];

let seq = 0; // round ids
let rev = 0; // snapshot order, so an overlay can drop a stale one
let round = { status: 'idle', id: 0 };
let expireTimer = null;
let idleTimer = null;

// start / reveal / clear run one at a time (they await storage); chat
// matching is deliberately NOT queued behind them — it must claim the win
// synchronously so two correct messages can never both win.
let lock = Promise.resolve();
function exclusive(fn) {
  const run = lock.then(fn);
  lock = run.catch(() => {});
  return run;
}

function clearTimers() {
  clearTimeout(expireTimer);
  clearTimeout(idleTimer);
  expireTimer = null;
  idleTimer = null;
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
  }, seconds * 1000);
}

function logError(err) {
  console.error('[trivia] publish failed:', err.message);
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

/** Dashboard-only view: the same round plus what the answer is. */
function adminRound() {
  return {
    ...publicRound(),
    questionId: round.question ? round.question.id : null,
    answers: round.question ? round.question.answers : [],
    answer: round.answer || null,
    serverTime: Date.now(),
  };
}

// ------------------------------------------------------------- controls

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

/** Put a question on screen: the given one, or the next unasked. Replaces any round in progress. */
function start({ id } = {}) {
  return exclusive(async () => {
    const [questions, settings, host] = await Promise.all([
      store.listQuestions(),
      store.getSettings(),
      configStore.getUsername(),
    ]);
    let question;
    if (id) {
      question = questions.find((q) => q.id === id);
      if (!question) throw new store.TriviaInputError('That question no longer exists.');
    } else {
      question = pickNext(questions, settings);
    }
    await store.markAsked(question.id);

    clearTimers();
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
      opts: { typoTolerance: settings.typoTolerance, ignoreHost: settings.ignoreHost, resultSeconds: settings.resultSeconds },
    };
    round = thisRound;
    expireTimer = setTimeout(() => expire(thisRound), timeLimitMs);
    await publish();
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

/** Take everything off screen right now. */
function clear() {
  return exclusive(async () => {
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

module.exports = { start, reveal, clear, handleChat, publish, snapshot, adminRound };
