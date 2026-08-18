// Appearance settings for the Gift Dares ticker overlay — currently just
// playback speed, but kept as its own small store (mirrors
// towerSettingsStore.js) so more knobs can be added later without
// reshaping anything.
const storage = require('./storage');

const KEY = 'giftdares_settings';

const DEFAULTS = {
  speed: 1, // 0.5 - 2.5 multiplier; 1x = the original 34s loop
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
  if (partial.speed !== undefined) {
    const n = parseFloat(partial.speed);
    if (Number.isFinite(n)) clean.speed = Math.min(2.5, Math.max(0.5, n));
  }
  return clean;
}

module.exports = { getSettings, updateSettings, DEFAULTS };
