// Persists user-adjustable overlay settings (goal, particles, animation
// speed, rotation intensity, counter scale). Safe to expose publicly.
const storage = require('./storage');
const config = require('../config');

const KEY = 'overlay_settings';

// Generic CSS-safe font families for the HTML text labels (title + goal).
// All are common system fonts — nothing is fetched from the network.
const CSS_FONT_KEYS = ['arial-black', 'arial', 'georgia', 'courier', 'impact', 'verdana', 'trebuchet', 'comic'];

// Typeface fonts bundled with three.js itself (served from our own
// /vendor/three static route) for the 3D follower count geometry.
const THREE_FONT_KEYS = [
  'helvetiker-bold',
  'helvetiker-regular',
  'optimer-bold',
  'optimer-regular',
  'gentilis-bold',
  'gentilis-regular',
  'droid-sans-bold',
  'droid-serif-bold',
  'droid-sans-mono-regular',
];

// Must match public/overlay/themes.js keys.
const THEME_KEYS = ['classic', 'spiderman', 'inferno', 'cyberpunk'];

const DEFAULTS = {
  followerGoal: config.followerGoal,
  particlesEnabled: true,
  animationSpeed: 1, // multiplier, 0.5x - 2x
  rotationIntensity: 1, // multiplier, 0 - 2
  counterScale: 1, // "counter" font size multiplier, 0.4x - 2.5x
  counterFont: 'helvetiker-bold',
  titleFontScale: 1, // "FOLLOWERS" label size multiplier, 0.5x - 3x
  titleFont: 'arial-black',
  goalFontScale: 1, // "Goal: X" label size multiplier, 0.5x - 3x
  goalFont: 'arial-black',
  theme: 'classic',
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
    if (Number.isFinite(n)) clean.counterScale = Math.min(2.5, Math.max(0.4, n));
  }
  if (partial.counterFont !== undefined && THREE_FONT_KEYS.includes(partial.counterFont)) {
    clean.counterFont = partial.counterFont;
  }
  if (partial.titleFontScale !== undefined) {
    const n = parseFloat(partial.titleFontScale);
    if (Number.isFinite(n)) clean.titleFontScale = Math.min(3, Math.max(0.5, n));
  }
  if (partial.titleFont !== undefined && CSS_FONT_KEYS.includes(partial.titleFont)) {
    clean.titleFont = partial.titleFont;
  }
  if (partial.goalFontScale !== undefined) {
    const n = parseFloat(partial.goalFontScale);
    if (Number.isFinite(n)) clean.goalFontScale = Math.min(3, Math.max(0.5, n));
  }
  if (partial.goalFont !== undefined && CSS_FONT_KEYS.includes(partial.goalFont)) {
    clean.goalFont = partial.goalFont;
  }
  if (partial.theme !== undefined && THEME_KEYS.includes(partial.theme)) {
    clean.theme = partial.theme;
  }
  if (partial.allowTestOnLiveOverlay !== undefined) {
    clean.allowTestOnLiveOverlay = !!partial.allowTestOnLiveOverlay;
  }
  return clean;
}

module.exports = { getSettings, updateSettings, DEFAULTS, CSS_FONT_KEYS, THREE_FONT_KEYS, THEME_KEYS };
