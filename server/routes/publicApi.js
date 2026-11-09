// Public, read-only API. Never returns tokens or secrets.
const express = require('express');
const config = require('../config');
const tokenStore = require('../services/tokenStore');
const storage = require('../services/storage');
const followerStore = require('../services/followerStore');
const settingsStore = require('../services/settingsStore');
const monitor = require('../services/followerMonitor');
const gta6TimerStore = require('../services/gta6TimerStore');

const router = express.Router();

// The GTA 6 timer overlay re-reads this to correct for clock differences
// between the streaming PC and the server (and to catch up if it ever
// misses a WebSocket message), so it carries the server's own clock.
router.get('/gta6/timer', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ state: await gta6TimerStore.getState(), serverTime: Date.now() });
  } catch (err) {
    console.error('[gta6] timer read failed:', err.message);
    res.status(500).json({ error: 'internal error' });
  }
});

router.get('/status', async (req, res) => {
  const tokens = await tokenStore.getTokens();
  res.json({
    demoMode: config.demoMode,
    tiktokConnected: !!tokens,
    monitor: monitor.getStatus(),
    // Where saved data (TikTok connection, goal, timer, tree...) actually
    // lives right now. "file" while databaseConfigured is true means the
    // database couldn't be reached at boot and the server is running on a
    // throwaway local file that is wiped on every restart/redeploy.
    // Booleans only — never the connection string or the error text.
    storage: {
      backend: storage.usingPostgres() ? 'postgres' : 'file',
      databaseConfigured: Boolean(config.databaseUrl),
    },
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
