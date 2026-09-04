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

// Growth is now denominated directly in TikTok Coins, so 1 level = exactly
// baseThreshold coins' worth of gifts (see DEFAULTS below) — no separate
// abstract point scale. Only gifts I could actually verify a real coin
// price for are listed; everything else falls through to the diamond-based
// fallback (also 1:1 with coins now — see fallbackDivisor), which is more
// accurate than a guessed number for gifts whose price I couldn't confirm.
// Verified against public coin-price listings, Sept 2026:
//   https://www.tiktok.com/discover/tiktok-gift-value-chart
//   https://leemjaz.com/tiktok-gifts-list-prices-2026/
// TikTok's gift catalog and prices change over time and vary by region —
// re-check and edit via the dashboard's "Gift → growth values" field if
// something looks off for your account.
const DEFAULT_GIFT_GROWTH_VALUES = {
  Rose: 1,
  GG: 1,
  'Finger Heart': 5,
  Perfume: 20,
  Galaxy: 1000,
  Universe: 44999,
  'TikTok Universe': 44999,
};

const DEFAULTS = {
  position: 'bottom-right', // bottom-left | bottom-right | top-left | top-right
  scale: 1, // 0.6 - 1.6
  baseThreshold: 1000, // coins needed to complete each level
  levelScaling: 1, // 1 = every level costs the same (flat 1000 coins); >1 makes later levels cost more
  stageThresholds: DEFAULT_STAGE_THRESHOLDS,
  giftGrowthValues: DEFAULT_GIFT_GROWTH_VALUES,
  // For a gift with no entry in giftGrowthValues but a known coin/diamond
  // cost, fallback growth = clamp(round(diamondCount / fallbackDivisor), 1,
  // fallbackMax) — divisor 1 means "count its real coin cost directly."
  fallbackDivisor: 1,
  fallbackMax: 100000,
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

// One-time self-heal, run at server boot (see index.js). A dashboard action
// that set baseThreshold without also resetting an already-stored
// levelScaling (e.g. an old 1.15) left level 2+ costing more than
// baseThreshold, since the curve was still compounding on top of it — the
// opposite of the flat "every level costs the same" the coins-per-level
// feature is meant to guarantee. Corrects levelScaling back to 1 whenever
// it isn't already, without touching anything else (currentGrowth,
// giftGrowthValues, etc. are all left exactly as stored). No-op — and no
// write — on a fresh install or a site where this was never a problem.
async function healLevelScaling() {
  const settings = await getSettings();
  if (settings.levelScaling === 1) return null;
  const before = settings.levelScaling;
  const next = await updateSettings({ levelScaling: 1 });
  return { before, after: next.levelScaling };
}

/** Which of the 6 stages (0-5) a given level falls into. */
function stageForLevel(level, stageThresholds = DEFAULT_STAGE_THRESHOLDS) {
  let stage = 0;
  for (let i = 0; i < stageThresholds.length; i++) {
    if (level >= stageThresholds[i]) stage = i;
  }
  return stage;
}

module.exports = { getSettings, updateSettings, stageForLevel, healLevelScaling, DEFAULTS, DEFAULT_GIFT_GROWTH_VALUES };
