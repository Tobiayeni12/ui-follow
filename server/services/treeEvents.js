// The Community Tree's growth engine — every interaction that should grow
// the tree (test buttons today; gifts, and eventually likes/follows/shares,
// via TikFinity later) funnels through addGrowth(). Nothing else is allowed
// to touch treeStore directly, so there is exactly one code path for "the
// tree grew," regardless of source — matching the same shape as
// towerEvents.addFollowersAndBroadcast for the follower counter.
const config = require('../config');
const settingsStore = require('../services/settingsStore');
const treeStore = require('./treeStore');
const treeSettingsStore = require('./treeSettingsStore');
const hub = require('../websocket/hub');

// Hard ceiling on a single addGrowth() call so a bad input (or a future
// integration bug) can't instantly max out many levels at once.
const MAX_SINGLE_GROWTH = 500;

/**
 * @param {number} amount growth to add — already resolved to a number by
 *   the caller (see growthForGift() below for turning a gift into this)
 * @param {string} source free-form origin tag: 'gift' | 'test' | 'like' |
 *   'follow' | 'share' | ... — purely informational/for the on-screen toast
 *   and future interaction types (Phase 9), never branched on here
 * @param {string|null} username who caused it, for the on-screen toast
 * @param {object} opts
 * @param {boolean} opts.isTest true for dashboard test actions (gated
 *   behind allowTestOnLiveOverlay/demoMode before touching the public
 *   overlay, same convention as every other feature); false for real events
 * @param {string|null} opts.giftName shown in the toast alongside the emoji
 */
async function addGrowth(amount, source, username, opts = {}) {
  const { isTest = true, giftName = null } = opts;

  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  const clamped = Math.min(MAX_SINGLE_GROWTH, Math.round(n));

  const settings = await treeSettingsStore.getSettings();
  const curve = { baseThreshold: settings.baseThreshold, levelScaling: settings.levelScaling };
  const prevState = await treeStore.getState();
  const prevStage = treeSettingsStore.stageForLevel(prevState.currentLevel, settings.stageThresholds);

  const { state, levelsGained, thresholdForCurrentLevel } = await treeStore.addGrowthAmount(clamped, curve);
  const newStage = treeSettingsStore.stageForLevel(state.currentLevel, settings.stageThresholds);

  const mainSettings = await settingsStore.getSettings();
  const liveAllowed = isTest ? config.demoMode || mainSettings.allowTestOnLiveOverlay : true;
  const channels = liveAllowed ? ['tree-preview', 'tree'] : ['tree-preview'];

  const message = {
    type: 'tree:growth',
    amount: clamped,
    source,
    username,
    giftName,
    state: {
      currentLevel: state.currentLevel,
      currentGrowth: state.currentGrowth,
      thresholdForCurrentLevel,
      totalLifetimeGrowth: state.totalLifetimeGrowth,
      stage: newStage,
    },
    leveledUp: levelsGained.length > 0,
    levelsGained: levelsGained.length,
    stageChanged: newStage !== prevStage,
  };
  channels.forEach((channel) => hub.broadcast(channel, message));

  return message;
}

/**
 * Turns a gift into a growth amount using the dashboard-configurable
 * mapping, with a diamond-based fallback for anything not explicitly
 * mapped. Shared by the test panel's "simulate gift" and (later) the real
 * TikFinity gift handler — one place decides what a gift is worth.
 */
async function growthForGift(giftName, diamondCount) {
  const settings = await treeSettingsStore.getSettings();
  const mapped = giftName ? settings.giftGrowthValues[giftName] : undefined;
  if (mapped !== undefined) return mapped;

  const diamonds = Number(diamondCount);
  if (Number.isFinite(diamonds) && diamonds > 0) {
    const fallback = Math.round(diamonds / settings.fallbackDivisor);
    return Math.min(settings.fallbackMax, Math.max(1, fallback));
  }
  return 1; // unknown gift, no diamond info — smallest sensible growth rather than 0
}

module.exports = { addGrowth, growthForGift, MAX_SINGLE_GROWTH };
