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

// A burst larger than this (a big test simulation, or a poll that catches up
// after being offline for a while) animates only the most recent blocks —
// the rest land instantly via one "tower:bulk_added" message instead of
// hundreds of individually staggered ones. Keeps a 500-follower catch-up
// from taking two minutes to animate or hammering storage with hundreds of
// writes.
const MAX_ANIMATED_TAIL = 50;

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

  const startState = await towerStore.getState();
  const startCount = startState.followerCount;

  const items = [];
  const meta = [];
  for (let i = 0; i < count; i++) {
    const prevCount = startCount + i;
    const nextCount = prevCount + 1;
    const autoKind = towerStore.tierForCount(nextCount);
    items.push({
      kind: count === 1 && kindOverride ? kindOverride : autoKind,
      username: count === 1 ? username : null,
    });
    meta.push({
      followerCount: nextCount,
      combo: towerStore.registerFollowForCombo(),
      milestone: milestones.find((m) => m > prevCount && m <= nextCount) || null,
    });
  }

  const finalState = await towerStore.addBlocks(items);
  const newBlocks = finalState.blocks.slice(-count);

  const settings = await settingsStore.getSettings();
  const liveAllowed = isTest ? config.demoMode || settings.allowTestOnLiveOverlay : true;
  const channels = liveAllowed ? ['tower-preview', 'tower'] : ['tower-preview'];

  const animatedStart = Math.max(0, count - MAX_ANIMATED_TAIL);

  if (animatedStart > 0) {
    const bulkBlocks = newBlocks.slice(0, animatedStart);
    const bulkMilestone = meta.slice(0, animatedStart).reduce((last, m) => m.milestone ?? last, null);
    const bulkMessage = {
      type: 'tower:bulk_added',
      blocks: bulkBlocks,
      addedCount: bulkBlocks.length,
      followerCount: meta[animatedStart - 1].followerCount,
      milestone: bulkMilestone,
    };
    channels.forEach((channel) => hub.broadcast(channel, bulkMessage));
  }

  for (let i = animatedStart; i < count; i++) {
    const delay = (i - animatedStart) * BROADCAST_STAGGER_MS;
    const block = newBlocks[i];
    const { followerCount, combo, milestone } = meta[i];
    setTimeout(() => {
      const message = { type: 'tower:block_added', block, followerCount, combo, milestone };
      channels.forEach((channel) => hub.broadcast(channel, message));
    }, delay);
  }

  return { followerCount: finalState.followerCount, blockCount: finalState.blocks.length };
}

module.exports = { addFollowersAndBroadcast };
