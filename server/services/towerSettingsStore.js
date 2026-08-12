// Appearance/behavior settings for the TOBZ TOWER overlay — separate from
// the tower's actual block data (towerStore.js), same split as
// objectivesStore.js / objectivesSettingsStore.js.
const storage = require('./storage');

const KEY = 'tower_settings';

const DEFAULTS = {
  layout: 'horizontal', // 'horizontal' (1920x1080) | 'vertical' (1080x1920)
  position: 'bottom-right', // bottom-left | bottom-right | bottom-center
  scale: 1, // 0.5 - 2
  animationSpeed: 1, // 0.5 - 2
  particlesEnabled: true,
  soundsEnabled: false, // off by default — no bundled audio, see README
  usernamesEnabled: true,
  followerGoal: 8500, // legacy single goal, superseded by `milestones` once Phase 5 lands
  milestones: [8500, 9000, 10000, 15000, 20000],
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
  if (partial.layout === 'horizontal' || partial.layout === 'vertical') clean.layout = partial.layout;
  if (['bottom-left', 'bottom-right', 'bottom-center'].includes(partial.position)) {
    clean.position = partial.position;
  }
  if (partial.scale !== undefined) {
    const n = parseFloat(partial.scale);
    if (Number.isFinite(n)) clean.scale = Math.min(2, Math.max(0.5, n));
  }
  if (partial.animationSpeed !== undefined) {
    const n = parseFloat(partial.animationSpeed);
    if (Number.isFinite(n)) clean.animationSpeed = Math.min(2, Math.max(0.5, n));
  }
  if (partial.particlesEnabled !== undefined) clean.particlesEnabled = !!partial.particlesEnabled;
  if (partial.soundsEnabled !== undefined) clean.soundsEnabled = !!partial.soundsEnabled;
  if (partial.usernamesEnabled !== undefined) clean.usernamesEnabled = !!partial.usernamesEnabled;
  if (partial.followerGoal !== undefined) {
    const n = parseInt(partial.followerGoal, 10);
    if (Number.isFinite(n) && n > 0) clean.followerGoal = n;
  }
  if (Array.isArray(partial.milestones)) {
    const nums = partial.milestones
      .map((m) => parseInt(m, 10))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
    if (nums.length) clean.milestones = nums;
  }
  return clean;
}

module.exports = { getSettings, updateSettings, DEFAULTS };
