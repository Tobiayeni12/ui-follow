// The "be right back" screen for breaks (food, bathroom, stretch) during a long
// stream. A break is just { endsAt, message }: everything shown on screen is
// derived from that end time and the server's clock, so it survives overlay
// refreshes and server restarts without anything having to "keep running".
// It stays up past zero until the streamer ends it — they may be a minute late.
const storage = require('./storage');
const { InputError } = require('./inputError');

const STATE_KEY = 'gta6_break';
const SETTINGS_KEY = 'gta6_break_settings';
const MAX_MINUTES = 180;
const PALETTES = ['sunset', 'vice', 'night', 'gold', 'mono'];
const COVERS = ['full', 'card'];

const DEFAULT_STATE = { active: false, startedAt: null, endsAt: null, message: '' };
const DEFAULT_SETTINGS = {
  title: 'Be right back', // the big heading (blank = none)
  cover: 'full', // 'full' hides the scene behind a backdrop; 'card' floats over it
  palette: 'sunset',
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

function normalizeState(stored) {
  const s = { ...DEFAULT_STATE, ...(stored && typeof stored === 'object' ? stored : {}) };
  if (!s.active || !Number.isFinite(s.endsAt)) return { ...DEFAULT_STATE };
  return { active: true, startedAt: Number.isFinite(s.startedAt) ? s.startedAt : null, endsAt: s.endsAt, message: text(s.message, 80) };
}

const getState = async () => normalizeState(await storage.get(STATE_KEY, null));

function minutesToMs(minutes) {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m < 1 || m > MAX_MINUTES) {
    throw new InputError(`A break must be between 1 and ${MAX_MINUTES} minutes.`);
  }
  return Math.round(m * 60 * 1000);
}

/** Start a break (replaces one already running). */
function start({ minutes, message }) {
  return serial(async () => {
    const now = Date.now();
    const next = { active: true, startedAt: now, endsAt: now + minutesToMs(minutes), message: text(message, 80) };
    await storage.set(STATE_KEY, next);
    return next;
  });
}

/** Add (or, if negative, take off) minutes. The total left can't exceed the cap or drop below 1 s. */
function extend(minutes) {
  return serial(async () => {
    const current = await getState();
    if (!current.active) throw new InputError('There is no break running.');
    const delta = Math.round(Number(minutes) * 60 * 1000);
    if (!Number.isFinite(delta) || delta === 0) throw new InputError('Choose how many minutes to add.');
    const now = Date.now();
    const base = Math.max(current.endsAt, now); // already past zero: count from now
    const endsAt = Math.min(base + delta, now + MAX_MINUTES * 60 * 1000);
    const next = { ...current, endsAt: Math.max(endsAt, now + 1000) };
    await storage.set(STATE_KEY, next);
    return next;
  });
}

function setMessage(message) {
  return serial(async () => {
    const current = await getState();
    if (!current.active) throw new InputError('There is no break running.');
    const next = { ...current, message: text(message, 80) };
    await storage.set(STATE_KEY, next);
    return next;
  });
}

function end() {
  return serial(async () => {
    await storage.set(STATE_KEY, { ...DEFAULT_STATE });
    return { ...DEFAULT_STATE };
  });
}

function sanitizeSettings(partial) {
  const p = partial && typeof partial === 'object' ? partial : {};
  const clean = {};
  if (typeof p.title === 'string') clean.title = text(p.title, 30);
  if (PALETTES.includes(p.palette)) clean.palette = p.palette;
  if (COVERS.includes(p.cover)) clean.cover = p.cover;
  const size = clampInt(p.size, 50, 200);
  if (p.size !== undefined && size !== undefined) clean.size = size;
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

module.exports = { DEFAULT_SETTINGS, MAX_MINUTES, getState, start, extend, setMessage, end, getSettings, updateSettings };
