// The live chat poll: viewers vote by typing an option's number (1–6) in the
// TikTok LIVE chat. One vote per person — voting again changes their vote.
//
//   idle → open → closed → idle
//
// Kept in memory on purpose (a restart drops back to idle instead of leaving a
// stale poll up). Counts are public by nature (the overlay draws them live);
// who voted for what never leaves this module.
const hub = require('../websocket/hub');
const store = require('./gta6PollStore');
const configStore = require('./tiktokLiveConfigStore');
const { InputError } = require('./inputError');

const CHANNELS = ['gta6-poll', 'gta6-poll-preview'];
const FLUSH_MS = 300; // at most ~3 broadcasts a second, however fast votes arrive

let seq = 0;
let rev = 0;
let poll = { status: 'idle', id: 0 };
let votes = new Map(); // voter key -> option index
let closeTimer = null;
let hideTimer = null;
let flushTimer = null;

let lock = Promise.resolve();
function exclusive(fn) {
  const run = lock.then(fn);
  lock = run.catch(() => {});
  return run;
}

function clearTimers() {
  clearTimeout(closeTimer);
  clearTimeout(hideTimer);
  clearTimeout(flushTimer);
  closeTimer = hideTimer = flushTimer = null;
}

const logError = (err) => console.error('[gta6] poll broadcast failed:', err.message);

// ------------------------------------------------------------ snapshots

function winnersOf(counts) {
  const top = Math.max(...counts);
  return top > 0 ? counts.map((c, i) => (c === top ? i : -1)).filter((i) => i >= 0) : [];
}

function publicPoll() {
  if (poll.status === 'idle') return { status: 'idle', id: poll.id };
  const total = poll.counts.reduce((a, b) => a + b, 0);
  return {
    status: poll.status,
    id: poll.id,
    question: poll.question,
    options: poll.options.map((text, i) => ({
      text,
      votes: poll.counts[i],
      pct: total ? Math.round((poll.counts[i] / total) * 1000) / 10 : 0,
    })),
    total,
    endsAt: poll.endsAt, // null = open until closed by hand
    durationMs: poll.durationMs,
    winners: poll.status === 'closed' ? winnersOf(poll.counts) : [],
  };
}

async function snapshot() {
  const settings = await store.getSettings();
  return {
    rev: ++rev,
    serverTime: Date.now(),
    poll: publicPoll(),
    settings: { palette: settings.palette, align: settings.align, size: settings.size },
  };
}

async function publish() {
  const snap = await snapshot();
  const message = { type: 'gta6:poll', ...snap };
  for (const channel of CHANNELS) hub.broadcast(channel, message);
  return snap;
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    publish().catch(logError);
  }, FLUSH_MS);
}

// ------------------------------------------------------------- controls

/** Put a poll up. Replaces any poll already showing. */
function start({ question, options, seconds }) {
  return exclusive(async () => {
    const settings = await store.getSettings();
    const built = store.buildPoll({ question, options, seconds }, settings.seconds);
    clearTimers();
    const now = Date.now();
    const durationMs = built.seconds * 1000;
    const thisPoll = {
      status: 'open',
      id: ++seq,
      question: built.question,
      options: built.options,
      counts: built.options.map(() => 0),
      startedAt: now,
      endsAt: durationMs ? now + durationMs : null,
      durationMs: durationMs || null,
      resultSeconds: settings.resultSeconds,
      host: ((await configStore.getUsername()) || '').toLowerCase(),
    };
    votes = new Map();
    poll = thisPoll;
    if (durationMs) closeTimer = setTimeout(() => closeRef(thisPoll), durationMs);
    await publish();
    return publicPoll();
  });
}

function closeRef(ref) {
  if (poll !== ref || poll.status !== 'open') return null;
  clearTimers();
  poll.status = 'closed';
  hideTimer = setTimeout(() => {
    if (poll !== ref) return;
    poll = { status: 'idle', id: ref.id };
    votes = new Map();
    publish().catch(logError);
  }, poll.resultSeconds * 1000);
  return publish().catch(logError);
}

/** End voting now and show the result. */
function close() {
  return exclusive(async () => {
    if (poll.status !== 'open') throw new InputError('There is no poll open.');
    await closeRef(poll);
    return publicPoll();
  });
}

/** Take the poll off screen right now. */
function clear() {
  return exclusive(async () => {
    clearTimers();
    poll = { status: 'idle', id: poll.id };
    votes = new Map();
    await publish();
    return publicPoll();
  });
}

// ------------------------------------------------------------------ chat

// "1", "#2", "3!", "vote 4" — a number on its own, optionally with a little decoration.
const VOTE = /^(?:vote\s*)?#?\s*([1-6])\s*[.!)]*$/i;

/** Feed every chat message through here. Cheap when no poll is open. */
function handleChat({ uniqueId, comment } = {}, { isTest = false } = {}) {
  if (poll.status !== 'open') return false;
  if (poll.endsAt && Date.now() >= poll.endsAt) return false;
  const match = VOTE.exec(String(comment == null ? '' : comment).trim());
  if (!match) return false;
  const index = Number(match[1]) - 1;
  if (index >= poll.options.length) return false;
  const key = String(uniqueId == null ? '' : uniqueId).trim().toLowerCase().slice(0, 40);
  if (!key) return false;
  if (!isTest && poll.host && key === poll.host) return false; // the streamer doesn't vote in their own poll

  const previous = votes.get(key);
  if (previous === index) return false;
  if (previous !== undefined) poll.counts[previous] -= 1; // changed their mind
  votes.set(key, index);
  poll.counts[index] += 1;
  scheduleFlush();
  return true;
}

module.exports = { start, close, clear, handleChat, snapshot, publish };
