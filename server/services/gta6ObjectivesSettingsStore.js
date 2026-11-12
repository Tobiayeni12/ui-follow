// Look-and-feel settings for the /gta6/objectives overlay. Kept apart from
// the checklist itself (gta6ObjectivesStore.js): the "what" and the "how it
// looks" change independently.
const storage = require('./storage');

const KEY = 'gta6_objectives_settings';

const PALETTES = ['sunset', 'vice', 'night', 'gold', 'mono'];
const ALIGNS = ['left', 'center', 'right'];

const DEFAULTS = {
  title: 'Objectives', // small header above the list; blank hides it
  palette: 'sunset',
  align: 'left', // where the panel sits inside the browser source
  size: 100, // % — overall scale
  maxVisible: 6, // rows shown under the current objective
  bgOpacity: 40, // % — panel backdrop (0 = no panel)
  showCompleted: true,
  showProgress: true, // "2 / 7 complete" bar
};

const clampInt = (v, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};

function sanitize(partial) {
  const p = partial && typeof partial === 'object' ? partial : {};
  const clean = {};
  if (typeof p.title === 'string') clean.title = p.title.trim().slice(0, 30);
  if (PALETTES.includes(p.palette)) clean.palette = p.palette;
  if (ALIGNS.includes(p.align)) clean.align = p.align;
  if (typeof p.showCompleted === 'boolean') clean.showCompleted = p.showCompleted;
  if (typeof p.showProgress === 'boolean') clean.showProgress = p.showProgress;
  const numeric = { size: [50, 200], maxVisible: [1, 12], bgOpacity: [0, 90] };
  for (const [key, [min, max]] of Object.entries(numeric)) {
    const n = clampInt(p[key], min, max);
    if (p[key] !== undefined && n !== undefined) clean[key] = n;
  }
  return clean;
}

async function getSettings() {
  const stored = await storage.get(KEY, null);
  return { ...DEFAULTS, ...sanitize(stored) };
}

async function updateSettings(partial) {
  const next = { ...(await getSettings()), ...sanitize(partial) };
  await storage.set(KEY, next);
  return next;
}

module.exports = { getSettings, updateSettings, DEFAULTS, PALETTES, ALIGNS };
