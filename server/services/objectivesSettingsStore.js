// Persists appearance (color) settings for the /objectives overlay — kept
// separate from objectivesStore.js (which holds the actual checklist) so
// the "what" and the "how it looks" don't get tangled together.
const storage = require('./storage');

const KEY = 'objectives_appearance';
const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

const DEFAULTS = {
  bgColor: '#0c0c0c', // box fill
  borderColor: '#f4f4f4', // box border + unchecked checkbox outline
  labelColor: '#ffe066', // "CURRENT OBJECTIVE" header
  currentTextColor: '#f6f6f2', // the featured current-objective text
  itemTextColor: '#f4f4f4', // checklist row text (not done)
  doneTextColor: '#8a8a86', // checklist row text (done / struck through)
  accentColor: '#ffe066', // checked checkbox fill + particle burst tint
};

async function getSettings() {
  const stored = await storage.get(KEY, null);
  return { ...DEFAULTS, ...(stored || {}) };
}

async function updateSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...sanitize(partial) };
  await storage.set(KEY, next);
  return next;
}

function sanitize(partial) {
  const clean = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (partial[key] !== undefined && HEX_COLOR.test(partial[key])) {
      clean[key] = partial[key];
    }
  }
  return clean;
}

module.exports = { getSettings, updateSettings, DEFAULTS };
