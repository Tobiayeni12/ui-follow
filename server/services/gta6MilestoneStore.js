// Milestone banners ("HOUR 12 — HALFWAY") for the stream timer: a list of
// moments, the look/behaviour of the banner, and which milestones have already
// been announced (so a restart or an OBS refresh never repeats one).
const crypto = require('crypto');
const storage = require('./storage');
const { InputError } = require('./inputError');

const LIST_KEY = 'gta6_milestones';
const SETTINGS_KEY = 'gta6_banner_settings';
const FIRED_KEY = 'gta6_milestones_fired';
const MAX_MILESTONES = 60;
const MAX_MIN = 999 * 60;
const PALETTES = ['sunset', 'vice', 'night', 'gold', 'mono'];
const POSITIONS = ['top', 'center', 'bottom'];

const DEFAULT_SETTINGS = {
  seconds: 8, // how long each banner stays up
  announceBlocks: true, // also announce each schedule block when it starts
  palette: 'sunset',
  position: 'center',
  size: 100,
};

// The usual shape of a 24-hour stream.
const PRESETS = [
  { atMin: 6 * 60, title: 'Quarter of the way', subtitle: '6 hours down, 18 to go' },
  { atMin: 12 * 60, title: 'Halfway there', subtitle: '12 hours down, 12 to go' },
  { atMin: 18 * 60, title: 'The home stretch', subtitle: 'Only 6 hours left' },
  { atMin: 23 * 60, title: 'Final hour', subtitle: 'One hour to go. Stay with me.' },
  { atMin: 24 * 60, title: 'We did it', subtitle: '24 hours. Thank you for staying.' },
];

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
  if (POSITIONS.includes(p.position)) clean.position = p.position;
  if (typeof p.announceBlocks === 'boolean') clean.announceBlocks = p.announceBlocks;
  for (const [key, [min, max]] of Object.entries({ seconds: [3, 30], size: [50, 200] })) {
    const n = clampInt(p[key], min, max);
    if (p[key] !== undefined && n !== undefined) clean[key] = n;
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

// ------------------------------------------------------------ milestones

const byTime = (a, b) => a.atMin - b.atMin;

async function listMilestones() {
  const list = await storage.get(LIST_KEY, []);
  return (Array.isArray(list) ? list : []).slice().sort(byTime);
}

function build({ atMin, title, subtitle }) {
  const at = Math.round(Number(atMin));
  if (!Number.isFinite(at) || at < 0 || at > MAX_MIN) {
    throw new InputError('Time must be between 0 and 999 hours into the stream.');
  }
  const cleanTitle = text(title, 40);
  if (!cleanTitle) throw new InputError('Give the banner a title.');
  return { atMin: at, title: cleanTitle, subtitle: text(subtitle, 70) };
}

function addMilestone(input) {
  return serial(async () => {
    const list = await listMilestones();
    if (list.length >= MAX_MILESTONES) throw new InputError(`You can have up to ${MAX_MILESTONES} milestones.`);
    const m = { id: crypto.randomUUID(), ...build(input) };
    await storage.set(LIST_KEY, [...list, m].sort(byTime));
    return m;
  });
}

/** Add the standard 24-hour set, skipping any time that already has a milestone. */
function addPresets() {
  return serial(async () => {
    const list = await listMilestones();
    const taken = new Set(list.map((m) => m.atMin));
    const added = PRESETS.filter((p) => !taken.has(p.atMin)).map((p) => ({ id: crypto.randomUUID(), ...p }));
    if (added.length) await storage.set(LIST_KEY, [...list, ...added].sort(byTime));
    return added.length;
  });
}

function updateMilestone(id, patch) {
  return serial(async () => {
    const list = await listMilestones();
    const current = list.find((m) => m.id === id);
    if (!current) throw new InputError('That milestone no longer exists.');
    const sent = Object.fromEntries(Object.entries(patch || {}).filter(([, v]) => v !== undefined));
    const next = list.map((m) => (m.id === id ? { id, ...build({ ...current, ...sent }) } : m));
    await storage.set(LIST_KEY, next.sort(byTime));
  });
}

function deleteMilestone(id) {
  return serial(async () => {
    const list = await listMilestones();
    await storage.set(LIST_KEY, list.filter((m) => m.id !== id));
  });
}

// ------------------------------------------------------------ fired ids

async function getFired() {
  const ids = await storage.get(FIRED_KEY, []);
  return Array.isArray(ids) ? ids : [];
}

const setFired = (ids) => storage.set(FIRED_KEY, ids);

module.exports = {
  DEFAULT_SETTINGS,
  PALETTES,
  getSettings,
  updateSettings,
  listMilestones,
  addMilestone,
  addPresets,
  updateMilestone,
  deleteMilestone,
  getFired,
  setFired,
};
