// Saved chat polls (so an hour's-worth can be prepared before the stream and
// fired with one click) and the poll overlay's look/behaviour settings. The
// live poll itself is in-memory — see gta6Poll.js.
const crypto = require('crypto');
const storage = require('./storage');
const { InputError } = require('./inputError');

const SAVED_KEY = 'gta6_polls';
const SETTINGS_KEY = 'gta6_poll_settings';
const MAX_SAVED = 40;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;
const PALETTES = ['sunset', 'vice', 'night', 'gold', 'mono'];
const ALIGNS = ['left', 'center', 'right'];

const DEFAULT_SETTINGS = {
  seconds: 60, // default voting time; 0 = stays open until closed by hand
  resultSeconds: 15, // how long the result stays up
  palette: 'sunset',
  align: 'center',
  size: 100,
};

let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

const text = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const clampInt = (v, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};

/** Voting time: 0 (until closed) or 10–600 seconds. */
function sanitizeSeconds(v, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return n <= 0 ? 0 : Math.min(600, Math.max(10, n));
}

/** Validate a poll typed into the dashboard. */
function buildPoll({ question, options, seconds }, fallbackSeconds) {
  const q = text(question, 120);
  if (!q) throw new InputError('Type the poll question first.');
  const list = (Array.isArray(options) ? options : []).map((o) => text(o, 40)).filter(Boolean);
  if (list.length < MIN_OPTIONS) throw new InputError(`A poll needs at least ${MIN_OPTIONS} options.`);
  if (list.length > MAX_OPTIONS) throw new InputError(`A poll can have at most ${MAX_OPTIONS} options.`);
  return { question: q, options: list, seconds: sanitizeSeconds(seconds, fallbackSeconds) };
}

// ------------------------------------------------------------- settings

function sanitizeSettings(partial) {
  const p = partial && typeof partial === 'object' ? partial : {};
  const clean = {};
  if (PALETTES.includes(p.palette)) clean.palette = p.palette;
  if (ALIGNS.includes(p.align)) clean.align = p.align;
  if (p.seconds !== undefined) clean.seconds = sanitizeSeconds(p.seconds, undefined);
  for (const [key, [min, max]] of Object.entries({ resultSeconds: [3, 60], size: [50, 200] })) {
    const n = clampInt(p[key], min, max);
    if (p[key] !== undefined && n !== undefined) clean[key] = n;
  }
  if (clean.seconds === undefined) delete clean.seconds;
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

// ---------------------------------------------------------- saved polls

async function listSaved() {
  const list = await storage.get(SAVED_KEY, []);
  return Array.isArray(list) ? list : [];
}

function savePoll(input) {
  return serial(async () => {
    const list = await listSaved();
    if (list.length >= MAX_SAVED) throw new InputError(`You can save up to ${MAX_SAVED} polls.`);
    const settings = await getSettings();
    const poll = { id: crypto.randomUUID(), ...buildPoll(input, settings.seconds) };
    await storage.set(SAVED_KEY, [...list, poll]);
    return poll;
  });
}

function deleteSaved(id) {
  return serial(async () => {
    const list = await listSaved();
    await storage.set(SAVED_KEY, list.filter((p) => p.id !== id));
  });
}

module.exports = {
  DEFAULT_SETTINGS,
  PALETTES,
  MAX_OPTIONS,
  buildPoll,
  getSettings,
  updateSettings,
  listSaved,
  savePoll,
  deleteSaved,
};
