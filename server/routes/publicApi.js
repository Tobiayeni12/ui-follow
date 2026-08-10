// Public, read-only API. Never returns tokens or secrets.
const express = require('express');
const config = require('../config');
const tokenStore = require('../services/tokenStore');
const followerStore = require('../services/followerStore');
const settingsStore = require('../services/settingsStore');
const monitor = require('../services/followerMonitor');

const router = express.Router();

router.get('/status', async (req, res) => {
  const tokens = await tokenStore.getTokens();
  res.json({
    demoMode: config.demoMode,
    tiktokConnected: !!tokens,
    monitor: monitor.getStatus(),
  });
});

router.get('/followers', async (req, res) => {
  const [state, settings] = await Promise.all([followerStore.getState(), settingsStore.getSettings()]);
  const goal = settings.followerGoal;
  const percent = goal > 0 ? Math.min(100, (state.count / goal) * 100) : 0;
  res.json({
    count: state.count,
    goal,
    percent: Math.round(percent * 10) / 10,
    updatedAt: state.updatedAt,
  });
});

module.exports = router;
