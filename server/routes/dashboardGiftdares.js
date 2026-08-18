// Protected dashboard API for the Gift Dares ticker's one setting (speed).
// No test/live split needed here — unlike follower test data, an
// appearance setting like playback speed is safe to apply everywhere at
// once, so it broadcasts straight to the single "giftdares" channel shared
// by the public overlay and the dashboard's own preview iframe.
const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const giftdaresSettingsStore = require('../services/giftdaresSettingsStore');
const hub = require('../websocket/hub');

const router = express.Router();
router.use(requireAuth);
router.use(express.json());

router.get('/dashboard/giftdares', async (req, res) => {
  const settings = await giftdaresSettingsStore.getSettings();
  res.json({ settings });
});

router.post('/dashboard/giftdares/settings', async (req, res) => {
  const settings = await giftdaresSettingsStore.updateSettings(req.body || {});
  hub.broadcast('giftdares', { type: 'giftdares:settings', settings });
  res.json(settings);
});

module.exports = router;
