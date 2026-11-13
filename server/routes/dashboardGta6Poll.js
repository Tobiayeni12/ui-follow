// Protected dashboard API for chat polls: start / close / clear the live poll,
// manage saved polls, settings, and a fake-vote box for rehearsing.
// Starting a poll goes straight to the live overlay — the dashboard preview is
// just another listener on the same channel.
const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const store = require('../services/gta6PollStore');
const poll = require('../services/gta6Poll');
const { InputError } = require('../services/inputError');

const router = express.Router();
router.use(requireAuth);
router.use(express.json());

// Express 4 doesn't catch rejected promises from async handlers. Input
// problems are the dashboard's to show (400); anything else is logged as a 500.
const wrap = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((err) => {
    if (err instanceof InputError) return res.status(400).json({ error: err.message });
    console.error('[gta6] poll request failed:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'internal error' });
  });
};

const str = (v, max = 200) => String(v == null ? '' : v).slice(0, max);

router.get('/dashboard/gta6/poll', wrap(async (req, res) => {
  const [snap, saved, settings] = await Promise.all([poll.snapshot(), store.listSaved(), store.getSettings()]);
  res.json({ ...snap, saved, settings, defaults: store.DEFAULT_SETTINGS, maxOptions: store.MAX_OPTIONS });
}));

router.post('/dashboard/gta6/poll/start', wrap(async (req, res) => {
  const b = req.body || {};
  res.json({ poll: await poll.start({ question: b.question, options: b.options, seconds: b.seconds }) });
}));

router.post('/dashboard/gta6/poll/close', wrap(async (req, res) => {
  res.json({ poll: await poll.close() });
}));

router.post('/dashboard/gta6/poll/clear', wrap(async (req, res) => {
  res.json({ poll: await poll.clear() });
}));

router.post('/dashboard/gta6/poll/saved', wrap(async (req, res) => {
  const b = req.body || {};
  await store.savePoll({ question: b.question, options: b.options, seconds: b.seconds });
  res.json({ saved: await store.listSaved() });
}));

router.delete('/dashboard/gta6/poll/saved/:id', wrap(async (req, res) => {
  await store.deleteSaved(req.params.id);
  res.json({ saved: await store.listSaved() });
}));

router.post('/dashboard/gta6/poll/settings', wrap(async (req, res) => {
  const settings = await store.updateSettings(req.body || {});
  await poll.publish(); // the overlay's look follows
  res.json(settings);
}));

// Plays a vote into the poll exactly as a real chat message would, so the
// whole thing can be rehearsed off-stream.
router.post('/dashboard/gta6/poll/test-vote', wrap(async (req, res) => {
  const b = req.body || {};
  const username = str(b.username, 40).trim().replace(/^@/, '') || 'testviewer';
  const counted = poll.handleChat({ uniqueId: username, comment: str(b.text, 100) }, { isTest: true });
  res.json({ counted });
}));

module.exports = router;
