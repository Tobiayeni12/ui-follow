// Protected dashboard API for the Tobz Tower overlay. Test-follow events
// never contact TikTok — they push synthetic blocks through the same
// tower/tower-preview WebSocket channels a real follow will use once Phase 7
// wires up followerMonitor. Reuses the main settingsStore's
// allowTestOnLiveOverlay flag (same safety gate the main counter's test
// buttons respect) so test blocks don't pollute the public overlay once a
// real TikTok account is connected.
const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const config = require('../config');
const settingsStore = require('../services/settingsStore');
const towerStore = require('../services/towerStore');
const towerSettingsStore = require('../services/towerSettingsStore');
const hub = require('../websocket/hub');

const router = express.Router();
router.use(requireAuth);
router.use(express.json());

const VALID_KINDS = ['normal', 'special', 'rare', 'legendary'];
// Stagger multi-block broadcasts so a "simulate 10 follows" burst reads as a
// cascade of blocks landing one after another, not a single instant pile.
const BROADCAST_STAGGER_MS = 220;

router.post('/dashboard/tower/test-follow', async (req, res) => {
  const rawUsername = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const username = rawUsername.slice(0, 40) || null;
  const count = Math.max(1, Math.min(100, parseInt(req.body?.count, 10) || 1));
  const kind = VALID_KINDS.includes(req.body?.kind) ? req.body.kind : 'normal';

  const towerSettings = await towerSettingsStore.getSettings();
  const milestones = Array.isArray(towerSettings.milestones) ? towerSettings.milestones : [];

  const events = [];
  let state = await towerStore.getState();
  for (let i = 0; i < count; i++) {
    const prevCount = state.followerCount;
    const nextCount = prevCount + 1;
    // A manual kind override or username only makes sense on a
    // single-follow test; batch simulations use automatic tiering and stay
    // anonymous, so you can still preview a rare/legendary block by
    // simulating a big enough batch to cross one.
    const autoKind = towerStore.tierForCount(nextCount);
    const blockKind = count === 1 && kind !== 'normal' ? kind : autoKind;

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
  const liveAllowed = config.demoMode || settings.allowTestOnLiveOverlay;

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

  res.json({ ok: true, followerCount: state.followerCount, blockCount: state.blocks.length });
});

module.exports = router;
