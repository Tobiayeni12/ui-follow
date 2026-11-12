// Persistence for the trivia game: the question bank, the leaderboard, and
// the look/behaviour settings. (The live round itself is in-memory — see
// triviaGame.js — so a restart never leaves a question stuck on screen.)
const crypto = require('crypto');
const storage = require('./storage');
const { sanitizeAnswers, sanitizePoints, cleanText, MAX_QUESTION_LENGTH } = require('./triviaLogic');

const QUESTIONS_KEY = 'trivia_questions';
const BOARD_KEY = 'trivia_leaderboard';
const SETTINGS_KEY = 'trivia_settings';

const MAX_QUESTIONS = 300;
const MAX_BOARD_ENTRIES = 2000;

// Every read-modify-write goes through one queue, so two chat messages or
// dashboard clicks landing together can't overwrite each other's change.
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

/** A validation problem the dashboard should show as-is (HTTP 400). */
class TriviaInputError extends Error {}

// ------------------------------------------------------------- settings

const PALETTES = ['sunset', 'vice', 'night', 'gold', 'mono'];
const ALIGNS = ['left', 'center', 'right'];

const DEFAULT_SETTINGS = {
  timeLimitSec: 30, // time to answer each question
  defaultPoints: 10, // points for new questions that don't set their own
  resultSeconds: 8, // how long the winner / answer stays up
  order: 'sequential', // "Ask next" picks in list order, or 'random'
  typoTolerance: true, // accept one-letter slips in longer answers
  ignoreHost: true, // the streamer's own chat messages can't win
  idleView: 'hidden', // between questions: 'hidden' or 'leaderboard'
  showLeaderboard: true, // show the leaderboard under the question
  leaderboardSize: 5,
  palette: 'sunset',
  align: 'center',
  size: 100,
};

const clampInt = (v, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};

function sanitizeSettings(partial) {
  const p = partial && typeof partial === 'object' ? partial : {};
  const clean = {};
  const ranges = {
    timeLimitSec: [5, 600],
    defaultPoints: [1, 1000],
    resultSeconds: [3, 30],
    leaderboardSize: [1, 10],
    size: [50, 200],
  };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const n = clampInt(p[key], min, max);
    if (p[key] !== undefined && n !== undefined) clean[key] = n;
  }
  if (['sequential', 'random'].includes(p.order)) clean.order = p.order;
  if (['hidden', 'leaderboard'].includes(p.idleView)) clean.idleView = p.idleView;
  if (PALETTES.includes(p.palette)) clean.palette = p.palette;
  if (ALIGNS.includes(p.align)) clean.align = p.align;
  for (const key of ['typoTolerance', 'ignoreHost', 'showLeaderboard']) {
    if (typeof p[key] === 'boolean') clean[key] = p[key];
  }
  return clean;
}

async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...sanitizeSettings(await storage.get(SETTINGS_KEY, null)) };
}

function updateSettings(partial) {
  return serial(async () => {
    const next = { ...(await getSettings()), ...sanitizeSettings(partial) };
    await storage.set(SETTINGS_KEY, next);
    return next;
  });
}

// ------------------------------------------------------------ questions

async function listQuestions() {
  const list = await storage.get(QUESTIONS_KEY, []);
  return Array.isArray(list) ? list : [];
}

async function buildQuestion({ text, answers, points }) {
  const cleanQuestion = cleanText(text, MAX_QUESTION_LENGTH);
  if (!cleanQuestion) throw new TriviaInputError('Type the question first.');
  const cleanAnswers = sanitizeAnswers(answers);
  if (!cleanAnswers.length) throw new TriviaInputError('Add at least one correct answer.');
  const fallback = (await getSettings()).defaultPoints;
  return { text: cleanQuestion, answers: cleanAnswers, points: sanitizePoints(points, fallback) };
}

function addQuestion(input) {
  return serial(async () => {
    const list = await listQuestions();
    if (list.length >= MAX_QUESTIONS) throw new TriviaInputError(`You can keep up to ${MAX_QUESTIONS} questions.`);
    const q = { id: crypto.randomUUID(), ...(await buildQuestion(input)), askedAt: null };
    await storage.set(QUESTIONS_KEY, [...list, q]);
    return q;
  });
}

/** Add many at once (the paste-a-list import); stops quietly at the cap. */
function addQuestions(inputs) {
  return serial(async () => {
    const list = await listQuestions();
    const room = Math.max(0, MAX_QUESTIONS - list.length);
    const added = [];
    for (const input of inputs.slice(0, room)) {
      added.push({ id: crypto.randomUUID(), ...(await buildQuestion(input)), askedAt: null });
    }
    if (added.length) await storage.set(QUESTIONS_KEY, [...list, ...added]);
    return { added: added.length, dropped: inputs.length - added.length };
  });
}

function updateQuestion(id, patch) {
  return serial(async () => {
    const list = await listQuestions();
    const index = list.findIndex((q) => q.id === id);
    if (index === -1) throw new TriviaInputError('That question no longer exists.');
    const merged = await buildQuestion({ ...list[index], ...patch });
    const next = list.slice();
    next[index] = { ...list[index], ...merged };
    await storage.set(QUESTIONS_KEY, next);
    return next[index];
  });
}

function deleteQuestion(id) {
  return serial(async () => {
    const list = await listQuestions();
    await storage.set(QUESTIONS_KEY, list.filter((q) => q.id !== id));
  });
}

function markAsked(id) {
  return serial(async () => {
    const list = await listQuestions();
    await storage.set(QUESTIONS_KEY, list.map((q) => (q.id === id ? { ...q, askedAt: Date.now() } : q)));
  });
}

function resetAsked() {
  return serial(async () => {
    const list = await listQuestions();
    await storage.set(QUESTIONS_KEY, list.map((q) => ({ ...q, askedAt: null })));
  });
}

// ---------------------------------------------------------- leaderboard
// Stored as { [uniqueId]: { uniqueId, name, points, wins, lastWinAt } }.

async function readBoard() {
  const board = await storage.get(BOARD_KEY, {});
  return board && typeof board === 'object' && !Array.isArray(board) ? board : {};
}

function rank(entries) {
  // most points first; then more wins; then whoever got there first
  return entries.sort((a, b) => b.points - a.points || b.wins - a.wins || a.lastWinAt - b.lastWinAt);
}

async function getLeaderboard(limit = 10) {
  return rank(Object.values(await readBoard())).slice(0, limit);
}

function addPoints(uniqueId, name, points) {
  return serial(async () => {
    const board = await readBoard();
    const key = String(uniqueId).toLowerCase().slice(0, 40);
    const prev = board[key] || { uniqueId: key, name: '', points: 0, wins: 0, lastWinAt: 0 };
    board[key] = {
      uniqueId: key,
      name: cleanText(name || uniqueId, 40) || key,
      points: prev.points + points,
      wins: prev.wins + 1,
      lastWinAt: Date.now(),
    };
    const keys = Object.keys(board);
    if (keys.length > MAX_BOARD_ENTRIES) {
      // keep the top of the board; drop the tail
      const keep = new Set(rank(Object.values(board)).slice(0, MAX_BOARD_ENTRIES).map((e) => e.uniqueId));
      for (const k of keys) if (!keep.has(k)) delete board[k];
    }
    await storage.set(BOARD_KEY, board);
    return board[key];
  });
}

function removeFromLeaderboard(uniqueId) {
  return serial(async () => {
    const board = await readBoard();
    delete board[String(uniqueId).toLowerCase()];
    await storage.set(BOARD_KEY, board);
  });
}

function resetLeaderboard() {
  return serial(() => storage.set(BOARD_KEY, {}));
}

module.exports = {
  TriviaInputError,
  DEFAULT_SETTINGS,
  PALETTES,
  getSettings,
  updateSettings,
  listQuestions,
  addQuestion,
  addQuestions,
  updateQuestion,
  deleteQuestion,
  markAsked,
  resetAsked,
  getLeaderboard,
  addPoints,
  removeFromLeaderboard,
  resetLeaderboard,
};
