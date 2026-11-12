// Protected dashboard API for the GTA 6 section. These are the real timer
// controls (not "test" buttons), so every change goes straight to the live
// 'gta6-timer' channel — the dashboard's embedded preview is just another
// listener on that same channel, not a separate sandbox.
const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const timerStore = require('../services/gta6TimerStore');
const { MAX_MS, MIN_COUNTDOWN_MS } = require('../services/gta6TimerLogic');
const objectivesStore = require('../services/gta6ObjectivesStore');
const objectivesSettingsStore = require('../services/gta6ObjectivesSettingsStore');
const hub = require('../websocket/hub');

const router = express.Router();
router.use(requireAuth);
router.use(express.json());

// Express 4 doesn't catch rejected promises from async handlers; without
// this a storage hiccup would be an unhandled rejection that takes the whole
// server (and every overlay) down mid-stream.
const wrap = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[gta6] request failed:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'internal error' });
  });
};

function publish(res, state) {
  const message = { type: 'gta6:timer', state, serverTime: Date.now() };
  hub.broadcast('gta6-timer', message);
  res.json({ ok: true, state, serverTime: message.serverTime });
}

const toInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

router.get('/dashboard/gta6/timer', wrap(async (req, res) => {
  res.json({ state: await timerStore.getState(), serverTime: Date.now() });
}));

router.post('/dashboard/gta6/timer/start', wrap(async (req, res) => {
  publish(res, await timerStore.start());
}));

router.post('/dashboard/gta6/timer/pause', wrap(async (req, res) => {
  publish(res, await timerStore.pause());
}));

router.post('/dashboard/gta6/timer/reset', wrap(async (req, res) => {
  publish(res, await timerStore.reset());
}));

router.post('/dashboard/gta6/timer/set', wrap(async (req, res) => {
  const mode = req.body?.mode === 'countup' ? 'countup' : 'countdown';
  const valueMs =
    (toInt(req.body?.hours) * 3600 + toInt(req.body?.minutes) * 60 + toInt(req.body?.seconds)) * 1000;
  if (valueMs > MAX_MS) return res.status(400).json({ error: 'That is longer than 999 hours.' });
  if (mode === 'countdown' && valueMs < MIN_COUNTDOWN_MS) {
    return res.status(400).json({ error: 'A countdown needs at least 1 second.' });
  }
  publish(res, await timerStore.set({ mode, valueMs }));
}));

router.post('/dashboard/gta6/timer/adjust', wrap(async (req, res) => {
  const deltaMs = parseInt(req.body?.deltaMs, 10);
  if (!Number.isFinite(deltaMs) || Math.abs(deltaMs) > 48 * 3600 * 1000) {
    return res.status(400).json({ error: 'deltaMs must be a number within ±48 hours.' });
  }
  publish(res, await timerStore.adjust(deltaMs));
}));

router.post('/dashboard/gta6/timer/label', wrap(async (req, res) => {
  publish(res, await timerStore.setLabel(req.body?.label));
}));

// ---------------------------------------------------------- objectives list
// The GTA 6 objectives overlay has its own checklist (separate from
// /objectives). The dashboard preview iframe listens on the '-preview'
// channel, the real browser source on the plain one; both get every change.

function broadcastObjectives(objectives) {
  const message = { type: 'gta6:objectives', data: { objectives } };
  hub.broadcast('gta6-objectives', message);
  hub.broadcast('gta6-objectives-preview', message);
}

function broadcastObjectivesSettings(settings) {
  const message = { type: 'gta6:objectives_settings', data: settings };
  hub.broadcast('gta6-objectives', message);
  hub.broadcast('gta6-objectives-preview', message);
}

// Store errors here are all user-facing validation messages (empty text,
// too many items, unknown id), so they go back as a 400 with the message.
const objectivesAction = (run) => wrap(async (req, res) => {
  try {
    const objectives = await run(req);
    broadcastObjectives(objectives);
    res.json({ objectives });
  } catch (err) {
    if (res.headersSent) throw err;
    res.status(400).json({ error: err.message });
  }
});

router.get('/dashboard/gta6/objectives', wrap(async (req, res) => {
  const [objectives, settings] = await Promise.all([
    objectivesStore.getObjectives(),
    objectivesSettingsStore.getSettings(),
  ]);
  res.json({ objectives, settings, defaults: objectivesSettingsStore.DEFAULTS });
}));

router.post('/dashboard/gta6/objectives/settings', wrap(async (req, res) => {
  const settings = await objectivesSettingsStore.updateSettings(req.body || {});
  broadcastObjectivesSettings(settings);
  res.json(settings);
}));

router.post('/dashboard/gta6/objectives', objectivesAction((req) => objectivesStore.addObjective(req.body?.text)));

router.post('/dashboard/gta6/objectives/reorder', objectivesAction((req) => {
  const orderedIds = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds : [];
  return objectivesStore.reorderObjectives(orderedIds);
}));

router.patch('/dashboard/gta6/objectives/:id', objectivesAction((req) => {
  const { text, done } = req.body || {};
  return objectivesStore.updateObjective(req.params.id, { text, done });
}));

router.delete('/dashboard/gta6/objectives/:id', objectivesAction((req) => objectivesStore.deleteObjective(req.params.id)));

module.exports = router;
