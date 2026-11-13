// The stream schedule shown on /gta6/schedule: a list of blocks, each starting
// a set time into the stream ("6:00 — GTA Online with chat"). A block runs
// until the next one starts; the last runs to the end of the stream. Times are
// offsets on the stream timer's clock (so pausing the timer pauses the
// schedule), stored as whole minutes.
const crypto = require('crypto');
const storage = require('./storage');
const { InputError } = require('./inputError');

const BLOCKS_KEY = 'gta6_schedule';
const SETTINGS_KEY = 'gta6_schedule_settings';
const MAX_BLOCKS = 60;
const MAX_MIN = 999 * 60; // same 999-hour cap as the timer
const PALETTES = ['sunset', 'vice', 'night', 'gold', 'mono'];
const ALIGNS = ['left', 'center', 'right'];

const DEFAULT_SETTINGS = {
  palette: 'sunset',
  align: 'left',
  size: 100,
  upcoming: 3, // how many "up next" blocks to list under the current one
  showProgress: true, // progress bar through the current block
  showClock: true, // stream time in the header
};

let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

const clampInt = (v, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};
const text = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

// ------------------------------------------------------------- settings

function sanitizeSettings(partial) {
  const p = partial && typeof partial === 'object' ? partial : {};
  const clean = {};
  if (PALETTES.includes(p.palette)) clean.palette = p.palette;
  if (ALIGNS.includes(p.align)) clean.align = p.align;
  for (const [key, [min, max]] of Object.entries({ size: [50, 200], upcoming: [1, 6] })) {
    const n = clampInt(p[key], min, max);
    if (p[key] !== undefined && n !== undefined) clean[key] = n;
  }
  for (const key of ['showProgress', 'showClock']) {
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

// --------------------------------------------------------------- blocks

const byTime = (a, b) => a.startMin - b.startMin;

async function listBlocks() {
  const list = await storage.get(BLOCKS_KEY, []);
  return (Array.isArray(list) ? list : []).slice().sort(byTime);
}

function build({ startMin, title, note }) {
  const at = Math.round(Number(startMin));
  if (!Number.isFinite(at) || at < 0 || at > MAX_MIN) {
    throw new InputError('Start time must be between 0 and 999 hours into the stream.');
  }
  const cleanTitle = text(title, 50);
  if (!cleanTitle) throw new InputError('Give this block a title.');
  return { startMin: at, title: cleanTitle, note: text(note, 80) };
}

function addBlock(input) {
  return serial(async () => {
    const list = await listBlocks();
    if (list.length >= MAX_BLOCKS) throw new InputError(`A schedule can have up to ${MAX_BLOCKS} blocks.`);
    const block = { id: crypto.randomUUID(), ...build(input) };
    await storage.set(BLOCKS_KEY, [...list, block].sort(byTime));
    return block;
  });
}

function updateBlock(id, patch) {
  return serial(async () => {
    const list = await listBlocks();
    const current = list.find((b) => b.id === id);
    if (!current) throw new InputError('That block no longer exists.');
    const sent = Object.fromEntries(Object.entries(patch || {}).filter(([, v]) => v !== undefined));
    const next = list.map((b) => (b.id === id ? { id, ...build({ ...current, ...sent }) } : b));
    await storage.set(BLOCKS_KEY, next.sort(byTime));
  });
}

function deleteBlock(id) {
  return serial(async () => {
    const list = await listBlocks();
    await storage.set(BLOCKS_KEY, list.filter((b) => b.id !== id));
  });
}

module.exports = {
  DEFAULT_SETTINGS,
  PALETTES,
  MAX_MIN,
  getSettings,
  updateSettings,
  listBlocks,
  addBlock,
  updateBlock,
  deleteBlock,
};
