// Shared "add N follows to the tower" pipeline — used by both the dashboard's
// test-follow button (server/routes/dashboardTower.js) and the real TikTok
// poller (server/services/followerMonitor.js) once it detects a
// follower_count increase, so both paths get identical tiering, combo, and
// milestone behavior instead of two copies of the same loop.
const config = require('../config');
const settingsStore = require('./settingsStore');
const towerStore = require('./towerStore');
const towerSettingsStore = require('./towerSettingsStore');
const hub = require('../websocket/hub');

// Stagger multi-block broadcasts so a burst of follows reads as a cascade of
// blocks landing one after another, not a single instant pile.
const BROADCAST_STAGGER_MS = 220;

/**
 * @param {number} count how many new followers/blocks to add
 * @param {object} opts
 * @param {string|null} opts.username only applied when count === 1
 * @param {string|null} opts.kindOverride only applied when count === 1; otherwise automatic tiering
 * @param {boolean} opts.isTest true for dashboard test-follows (gated behind
 *   allowTestOnLiveOverlay/demoMode before touching the public overlay);
 *   false for real TikTok follows, which always reach the live overlay.
 */
async function addFollowersAndBroadcast(count, { username = null, kindOverride = null, isTest = true } = {}) {
  const towerSettings = await towerSettingsStore.getSettings();
  const milestones = Array.isArray(towerSettings.milestones) ? towerSettings.milestones : [];

  const events = [];
  let state = await towerStore.getState();
  for (let i = 0; i < count; i++) {
    const prevCount = state.followerCount;
    const nextCount = prevCount + 1;
    const autoKind = towerStore.tierForCount(nextCount);
    const blockKind = count === 1 && kindOverride ? kindOverride : autoKind;

    state = await towerStore.addBlock({
      kind: blockKind,
      username: count === 1 ? username : null,
    });

    const combo = towerStore.registerFollowForCombo();
    const milestone = milestones.find((m) => m > prevCount && m <= nextCount) || null;

    events.push({
      block: state.blocks[state.blocks.length - 1],
      followerCount: state.followerCount,
      combo,
      milestone,
    });
  }

  const settings = await settingsStore.getSettings();
  const liveAllowed = isTest ? config.demoMode || settings.allowTestOnLiveOverlay : true;

  events.forEach((event, i) => {
    setTimeout(() => {
      const message = {
        type: 'tower:block_added',
        block: event.block,
        followerCount: event.followerCount,
        combo: event.combo,
        milestone: event.milestone,
      };
      hub.broadcast('tower-preview', message);
      if (liveAllowed) hub.broadcast('tower', message);
    }, i * BROADCAST_STAGGER_MS);
  });

  return { followerCount: state.followerCount, blockCount: state.blocks.length };
}

module.exports = { addFollowersAndBroadcast };
