// Persists the Community Tree's growth state. Kept separate from
// treeSettingsStore.js (the gift-value mapping and level curve) the same
// way towerStore.js/towerSettingsStore.js split block data from appearance
// settings — state that grows forever vs. config you tune from the
// dashboard.
const storage = require('./storage');

const KEY = 'tree_state';

const DEFAULTS = {
  currentLevel: 1,
  currentGrowth: 0, // progress within the current level, 0..thresholdForLevel(currentLevel)
  totalLifetimeGrowth: 0, // never decreases — a pure lifetime stat
};

async function getState() {
  const stored = await storage.get(KEY, null);
  return { ...DEFAULTS, ...(stored || {}) };
}

async function setState(partial) {
  const current = await getState();
  const next = { ...current, ...partial };
  await storage.set(KEY, next);
  return next;
}

/**
 * Growth requirement for a given level, gradually increasing so higher
 * levels take more to fill — level 1 needs `baseThreshold`, each level
 * after multiplies by `levelScaling`.
 */
function thresholdForLevel(level, { baseThreshold, levelScaling }) {
  return Math.round(baseThreshold * Math.pow(levelScaling, Math.max(0, level - 1)));
}

/**
 * Adds growth, rolling over into as many level-ups as the amount covers
 * (a single huge gift could complete more than one level). Returns the new
 * state plus a list of levels gained, so the caller can broadcast one
 * "level up" event per level crossed (and detect stage changes) without
 * re-deriving any of this logic itself.
 */
async function addGrowthAmount(amount, curveSettings) {
  const state = await getState();
  let level = state.currentLevel;
  let growth = state.currentGrowth + amount;
  const levelsGained = [];

  let threshold = thresholdForLevel(level, curveSettings);
  while (growth >= threshold) {
    growth -= threshold;
    level += 1;
    levelsGained.push(level);
    threshold = thresholdForLevel(level, curveSettings);
  }

  const next = await setState({
    currentLevel: level,
    currentGrowth: growth,
    totalLifetimeGrowth: state.totalLifetimeGrowth + amount,
  });
  return { state: next, levelsGained, thresholdForCurrentLevel: threshold };
}

/** Dashboard "EVOLVE TREE" test button — forces exactly one level-up. */
async function forceEvolve(curveSettings) {
  const state = await getState();
  const threshold = thresholdForLevel(state.currentLevel, curveSettings);
  const remaining = Math.max(1, threshold - state.currentGrowth);
  return addGrowthAmount(remaining, curveSettings);
}

async function reset() {
  return setState({ ...DEFAULTS });
}

module.exports = { getState, setState, addGrowthAmount, forceEvolve, thresholdForLevel, reset, DEFAULTS };
