// Community Tree configuration: where it sits on screen, the growth curve,
// which visual "stage" each level range maps to, and the gift → growth
// mapping. All dashboard-editable so gift values never need a code change.
const storage = require('./storage');

const KEY = 'tree_settings';

// Levels at which each of the 6 stages begins — e.g. levels 1 is Seed,
// levels 2-3 are Sprout, ... level 16+ is the fully-evolved stage. Six
// entries, one per stage (0-5), the same order as STAGE_NAMES in
// public/tree/tree.js.
const DEFAULT_STAGE_THRESHOLDS = [1, 2, 4, 7, 11, 16];

// Seeded with a few of TikTok's actual common gifts plus the same five
// gifts already used on the Gift Dares ticker (public/giftdares) — so a
// gift you've already set a dare for lands at a sensible, size-matched
// growth value here too. Values follow the tier scale from the original
// spec (rose=1, small=2, medium=5, large=15, very large=50).
const DEFAULT_GIFT_GROWTH_VALUES = {
  Rose: 1,
  'Finger Heart': 1,
  TikTok: 2,
  GG: 2,
  Perfume: 5,
  'Gem Gun': 5,
  'Sports Car': 7,
  Galaxy: 15,
  'Meteor Shower': 15,
  'Leon the Kitten': 25,
  Universe: 50,
  'TikTok Universe': 50,
};

const DEFAULTS = {
  position: 'bottom-right', // bottom-left | bottom-right | top-left | top-right
  scale: 1, // 0.6 - 1.6
  baseThreshold: 100, // growth needed to complete level 1
  levelScaling: 1.15, // multiplier applied per level after that
  stageThresholds: DEFAULT_STAGE_THRESHOLDS,
  giftGrowthValues: DEFAULT_GIFT_GROWTH_VALUES,
  // For a gift with no entry in giftGrowthValues but a known diamond cost,
  // fallback growth = clamp(round(diamondCount / fallbackDivisor), 1, fallbackMax).
  fallbackDivisor: 150,
  fallbackMax: 50,
};

async function getSettings() {
  const stored = await storage.get(KEY, null);
  const merged = { ...DEFAULTS, ...(stored || {}) };
  // Deep-merge the gift map specifically, so a partial customization
  // doesn't lose the built-in defaults for gifts the user never touched.
  merged.giftGrowthValues = { ...DEFAULT_GIFT_GROWTH_VALUES, ...(stored?.giftGrowthValues || {}) };
  return merged;
}

async function updateSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...sanitize(partial, current) };
  await storage.set(KEY, next);
  return next;
}

function sanitize(partial, current) {
  const clean = {};
  if (['bottom-left', 'bottom-right', 'top-left', 'top-right'].includes(partial.position)) {
    clean.position = partial.position;
  }
  if (partial.scale !== undefined) {
    const n = parseFloat(partial.scale);
    if (Number.isFinite(n)) clean.scale = Math.min(1.6, Math.max(0.6, n));
  }
  if (partial.baseThreshold !== undefined) {
    const n = parseInt(partial.baseThreshold, 10);
    if (Number.isFinite(n) && n > 0) clean.baseThreshold = n;
  }
  if (partial.levelScaling !== undefined) {
    const n = parseFloat(partial.levelScaling);
    if (Number.isFinite(n) && n >= 1) clean.levelScaling = n;
  }
  if (Array.isArray(partial.stageThresholds) && partial.stageThresholds.length === 6) {
    const nums = partial.stageThresholds.map((n) => parseInt(n, 10));
    if (nums.every((n) => Number.isFinite(n) && n > 0)) clean.stageThresholds = nums;
  }
  if (partial.giftGrowthValues && typeof partial.giftGrowthValues === 'object') {
    const cleanMap = {};
    for (const [name, value] of Object.entries(partial.giftGrowthValues)) {
      const n = parseFloat(value);
      const trimmedName = String(name).trim();
      if (trimmedName && Number.isFinite(n) && n > 0) cleanMap[trimmedName] = n;
    }
    if (Object.keys(cleanMap).length) clean.giftGrowthValues = { ...current.giftGrowthValues, ...cleanMap };
  }
  if (partial.fallbackDivisor !== undefined) {
    const n = parseFloat(partial.fallbackDivisor);
    if (Number.isFinite(n) && n > 0) clean.fallbackDivisor = n;
  }
  if (partial.fallbackMax !== undefined) {
    const n = parseFloat(partial.fallbackMax);
    if (Number.isFinite(n) && n > 0) clean.fallbackMax = n;
  }
  return clean;
}

/** Which of the 6 stages (0-5) a given level falls into. */
function stageForLevel(level, stageThresholds = DEFAULT_STAGE_THRESHOLDS) {
  let stage = 0;
  for (let i = 0; i < stageThresholds.length; i++) {
    if (level >= stageThresholds[i]) stage = i;
  }
  return stage;
}

module.exports = { getSettings, updateSettings, stageForLevel, DEFAULTS, DEFAULT_GIFT_GROWTH_VALUES };
