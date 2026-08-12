// Protected dashboard API for the Tobz Tower overlay. Test-follow events
// never contact TikTok — they push synthetic blocks through the same
// tower/tower-preview WebSocket channels a real follow uses (see
// followerMonitor.js, which calls the same towerEvents.addFollowersAndBroadcast
// on a real follower_count increase). Reuses the main settingsStore's
// allowTestOnLiveOverlay flag (same safety gate the main counter's test
// buttons respect) so test blocks don't pollute the public overlay once a
// real TikTok account is connected.
const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const config = require('../config');
const settingsStore = require('../services/settingsStore');
const towerStore = require('../services/towerStore');
const towerSettingsStore = require('../services/towerSettingsStore');
const towerEvents = require('../services/towerEvents');
const hub = require('../websocket/hub');

const router = express.Router();
router.use(requireAuth);
router.use(express.json());

const VALID_KINDS = ['normal', 'special', 'rare', 'legendary'];

router.get('/dashboard/tower', async (req, res) => {
  const [state, towerSettings, settings] = await Promise.all([
    towerStore.getState(),
    towerSettingsStore.getSettings(),
    settingsStore.getSettings(),
  ]);
  res.json({
    followerCount: state.followerCount,
    blockCount: state.blocks.length,
    settings: towerSettings,
    allowTestOnLiveOverlay: !!settings.allowTestOnLiveOverlay,
  });
});

router.post('/dashboard/tower/settings', async (req, res) => {
  const settings = await towerSettingsStore.updateSettings(req.body || {});
  const message = { type: 'tower:settings', settings };
  hub.broadcast('tower', message);
  hub.broadcast('tower-preview', message);
  res.json(settings);
});

// Previews the level-up banner without touching real tower state — lets you
// check how it looks without actually growing the tower up to that count.
router.post('/dashboard/tower/milestone-preview', async (req, res) => {
  const towerSettings = await towerSettingsStore.getSettings();
  const milestones = Array.isArray(towerSettings.milestones) ? towerSettings.milestones : [];
  const state = await towerStore.getState();
  const value = milestones.find((m) => m > state.followerCount) || milestones[milestones.length - 1] || 0;

  const message = { type: 'tower:milestone_preview', value };
  hub.broadcast('tower-preview', message);
  const settings = await settingsStore.getSettings();
  if (config.demoMode || settings.allowTestOnLiveOverlay) hub.broadcast('tower', message);

  res.json({ ok: true, value });
});

router.post('/dashboard/tower/reset', async (req, res) => {
  await towerStore.reset();
  const message = { type: 'tower:reset' };
  hub.broadcast('tower-preview', message);
  const settings = await settingsStore.getSettings();
  if (config.demoMode || settings.allowTestOnLiveOverlay) hub.broadcast('tower', message);
  res.json({ ok: true });
});

router.post('/dashboard/tower/test-follow', async (req, res) => {
  const rawUsername = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const username = rawUsername.slice(0, 40) || null;
  const count = Math.max(1, Math.min(100, parseInt(req.body?.count, 10) || 1));
  const kind = VALID_KINDS.includes(req.body?.kind) ? req.body.kind : null;

  const result = await towerEvents.addFollowersAndBroadcast(count, {
    username,
    kindOverride: kind,
    isTest: true,
  });

  res.json({ ok: true, ...result });
});

module.exports = router;
