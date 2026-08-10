// Protected dashboard API. Requires an authenticated session (see
// middleware/requireAuth.js). Test-control endpoints never contact TikTok —
// they only push synthetic values through the same WebSocket pipeline real
// updates use, so the 3D animation system can be built/tested independently.
const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const config = require('../config');
const settingsStore = require('../services/settingsStore');
const followerStore = require('../services/followerStore');
const tokenStore = require('../services/tokenStore');
const hub = require('../websocket/hub');
const monitor = require('../services/followerMonitor');

const router = express.Router();
router.use(requireAuth);
router.use(express.json());

async function broadcastFollowerUpdate(previousCount, newCount, source) {
  await followerStore.setCount(newCount, source);
  const settings = await settingsStore.getSettings();
  const message = {
    type: 'follower_update',
    data: { previousCount, newCount, delta: newCount - previousCount, source, goal: settings.followerGoal },
  };

  // Test-driven updates always go to the dashboard's own preview channel.
  hub.broadcast('preview', message);

  // They only reach the public, live overlay when explicitly allowed, or
  // when there is no real TikTok data feed to protect (DEMO_MODE).
  if (config.demoMode || settings.allowTestOnLiveOverlay) {
    hub.broadcast('live', message);
  }
}

router.get('/dashboard/state', async (req, res) => {
  const [state, settings, tokens] = await Promise.all([
    followerStore.getState(),
    settingsStore.getSettings(),
    tokenStore.getTokens(),
  ]);
  res.json({
    demoMode: config.demoMode,
    count: state.count,
    settings,
    tiktokConnected: !!tokens,
    monitor: monitor.getStatus(),
  });
});

router.post('/dashboard/settings', async (req, res) => {
  const updated = await settingsStore.updateSettings(req.body || {});
  hub.broadcast('all', { type: 'settings_update', data: updated });
  res.json(updated);
});

router.post('/dashboard/test/increment', async (req, res) => {
  const amount = Math.max(1, Math.min(500, parseInt(req.body?.amount, 10) || 1));
  const state = await followerStore.getState();
  const newCount = state.count + amount;
  await broadcastFollowerUpdate(state.count, newCount, 'test');
  res.json({ ok: true, count: newCount });
});

router.post('/dashboard/test/set', async (req, res) => {
  const target = parseInt(req.body?.count, 10);
  if (!Number.isFinite(target) || target < 0) {
    return res.status(400).json({ error: 'count must be a non-negative integer' });
  }
  const state = await followerStore.getState();
  await broadcastFollowerUpdate(state.count, target, 'test');
  res.json({ ok: true, count: target });
});

router.post('/dashboard/test/reset', async (req, res) => {
  const state = await followerStore.getState();
  const resetTo = config.demoStartCount;
  await broadcastFollowerUpdate(state.count, resetTo, 'test');
  res.json({ ok: true, count: resetTo });
});

router.post('/dashboard/tiktok/disconnect', async (req, res) => {
  await tokenStore.clearTokens();
  monitor.stop();
  res.json({ ok: true });
});

module.exports = router;
