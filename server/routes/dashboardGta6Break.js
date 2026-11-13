// Protected dashboard API for the "be right back" screen. Starting a break
// goes straight to the live overlay — the dashboard preview is just another
// listener on the same channel.
const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const store = require('../services/gta6BreakStore');
const { InputError } = require('../services/inputError');
const hub = require('../websocket/hub');

const router = express.Router();
router.use(requireAuth);
router.use(express.json());

// Express 4 doesn't catch rejected promises from async handlers. Input
// problems are the dashboard's to show (400); anything else is logged as a 500.
const wrap = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((err) => {
    if (err instanceof InputError) return res.status(400).json({ error: err.message });
    console.error('[gta6] break request failed:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'internal error' });
  });
};

async function snapshot() {
  const [state, settings] = await Promise.all([store.getState(), store.getSettings()]);
  return { state, settings, serverTime: Date.now() };
}

async function publish() {
  const snap = await snapshot();
  const message = { type: 'gta6:break', ...snap };
  hub.broadcast('gta6-break', message);
  hub.broadcast('gta6-break-preview', message);
  return snap;
}

router.get('/dashboard/gta6/break', wrap(async (req, res) => {
  res.json({ ...(await snapshot()), defaults: store.DEFAULT_SETTINGS, maxMinutes: store.MAX_MINUTES });
}));

router.post('/dashboard/gta6/break/start', wrap(async (req, res) => {
  const b = req.body || {};
  await store.start({ minutes: b.minutes, message: b.message });
  res.json(await publish());
}));

router.post('/dashboard/gta6/break/extend', wrap(async (req, res) => {
  await store.extend(req.body && req.body.minutes);
  res.json(await publish());
}));

router.post('/dashboard/gta6/break/message', wrap(async (req, res) => {
  await store.setMessage(req.body && req.body.message);
  res.json(await publish());
}));

router.post('/dashboard/gta6/break/end', wrap(async (req, res) => {
  await store.end();
  res.json(await publish());
}));

router.post('/dashboard/gta6/break/settings', wrap(async (req, res) => {
  await store.updateSettings(req.body || {});
  res.json(await publish());
}));

module.exports = router;
