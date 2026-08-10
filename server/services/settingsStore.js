// Persists user-adjustable overlay settings (goal, particles, animation
// speed, rotation intensity, counter scale). Safe to expose publicly.
const storage = require('./storage');
const config = require('../config');

const KEY = 'overlay_settings';

const DEFAULTS = {
  followerGoal: config.followerGoal,
  particlesEnabled: true,
  animationSpeed: 1, // multiplier, 0.5x - 2x
  rotationIntensity: 1, // multiplier, 0 - 2
  counterScale: 1, // multiplier, 0.6 - 1.6
  allowTestOnLiveOverlay: config.allowTestOnLiveOverlay,
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
  if (partial.followerGoal !== undefined) {
    const n = parseInt(partial.followerGoal, 10);
    if (Number.isFinite(n) && n > 0) clean.followerGoal = n;
  }
  if (partial.particlesEnabled !== undefined) {
    clean.particlesEnabled = !!partial.particlesEnabled;
  }
  if (partial.animationSpeed !== undefined) {
    const n = parseFloat(partial.animationSpeed);
    if (Number.isFinite(n)) clean.animationSpeed = Math.min(2, Math.max(0.5, n));
  }
  if (partial.rotationIntensity !== undefined) {
    const n = parseFloat(partial.rotationIntensity);
    if (Number.isFinite(n)) clean.rotationIntensity = Math.min(2, Math.max(0, n));
  }
  if (partial.counterScale !== undefined) {
    const n = parseFloat(partial.counterScale);
    if (Number.isFinite(n)) clean.counterScale = Math.min(1.6, Math.max(0.6, n));
  }
  if (partial.allowTestOnLiveOverlay !== undefined) {
    clean.allowTestOnLiveOverlay = !!partial.allowTestOnLiveOverlay;
  }
  return clean;
}

module.exports = { getSettings, updateSettings, DEFAULTS };
