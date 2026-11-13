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
const scheduleStore = require('../services/gta6ScheduleStore');
const milestoneStore = require('../services/gta6MilestoneStore');
const milestones = require('../services/gta6Milestones');
const { InputError } = require('../services/inputError');
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

// `silent`: the change was a jump of the clock (set / nudge / reset), so
// milestones it passes are marked done without a banner. Start/resume are not.
function publish(res, state, { silent = true } = {}) {
  const message = { type: 'gta6:timer', state, serverTime: Date.now() };
  hub.broadcast('gta6-timer', message);
  milestones.timerChanged({ silent }).catch(() => {}); // logged inside; never blocks the response
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
  publish(res, await timerStore.start(), { silent: false });
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

// -------------------------------------------------------------- schedule
// The /gta6/schedule overlay shows what's on now and what's next, keyed to the
// stream timer's clock. Blocks are { id, startMin, title, note }.

const toMinutes = (b) => {
  // dashboard sends hours + minutes; accept a plain startMin too
  if (b && b.startMin !== undefined) return b.startMin;
  if (b && (b.hours !== undefined || b.minutes !== undefined)) {
    return (Number(b.hours) || 0) * 60 + (Number(b.minutes) || 0);
  }
  return undefined;
};

async function broadcastSchedule() {
  const [blocks, settings] = await Promise.all([scheduleStore.listBlocks(), scheduleStore.getSettings()]);
  const message = { type: 'gta6:schedule', blocks, settings };
  hub.broadcast('gta6-schedule', message);
  hub.broadcast('gta6-schedule-preview', message);
  milestones.listsChanged().catch(() => {}); // block starts may be announced as banners
  return { blocks, settings };
}

// Input problems are the dashboard's to show (400); anything else is a 500.
const scheduleWrap = (fn) => wrap(async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof InputError && !res.headersSent) return res.status(400).json({ error: err.message });
    throw err;
  }
});

router.get('/dashboard/gta6/schedule', scheduleWrap(async (req, res) => {
  res.json({
    blocks: await scheduleStore.listBlocks(),
    settings: await scheduleStore.getSettings(),
    defaults: scheduleStore.DEFAULT_SETTINGS,
  });
}));

router.post('/dashboard/gta6/schedule/blocks', scheduleWrap(async (req, res) => {
  const b = req.body || {};
  await scheduleStore.addBlock({ startMin: toMinutes(b), title: b.title, note: b.note });
  res.json(await broadcastSchedule());
}));

router.patch('/dashboard/gta6/schedule/blocks/:id', scheduleWrap(async (req, res) => {
  const b = req.body || {};
  await scheduleStore.updateBlock(req.params.id, { startMin: toMinutes(b), title: b.title, note: b.note });
  res.json(await broadcastSchedule());
}));

router.delete('/dashboard/gta6/schedule/blocks/:id', scheduleWrap(async (req, res) => {
  await scheduleStore.deleteBlock(req.params.id);
  res.json(await broadcastSchedule());
}));

router.post('/dashboard/gta6/schedule/settings', scheduleWrap(async (req, res) => {
  await scheduleStore.updateSettings(req.body || {});
  res.json(await broadcastSchedule());
}));

// ------------------------------------------------------------ milestones
// Banners fired by the server when the timer reaches them (see
// services/gta6Milestones.js). Milestones are { id, atMin, title, subtitle }.

async function broadcastBannerSettings() {
  const settings = await milestoneStore.getSettings();
  const message = { type: 'gta6:banner_settings', settings };
  hub.broadcast('gta6-banner', message);
  hub.broadcast('gta6-banner-preview', message);
  milestones.listsChanged().catch(() => {});
  return settings;
}

const milestoneState = async () => ({
  milestones: await milestoneStore.listMilestones(),
  settings: await milestoneStore.getSettings(),
});

router.get('/dashboard/gta6/milestones', scheduleWrap(async (req, res) => {
  res.json({ ...(await milestoneState()), defaults: milestoneStore.DEFAULT_SETTINGS });
}));

router.post('/dashboard/gta6/milestones', scheduleWrap(async (req, res) => {
  const b = req.body || {};
  await milestoneStore.addMilestone({ atMin: toMinutes(b), title: b.title, subtitle: b.subtitle });
  milestones.listsChanged().catch(() => {});
  res.json(await milestoneState());
}));

router.post('/dashboard/gta6/milestones/presets', scheduleWrap(async (req, res) => {
  const added = await milestoneStore.addPresets();
  milestones.listsChanged().catch(() => {});
  res.json({ added, ...(await milestoneState()) });
}));

router.post('/dashboard/gta6/milestones/settings', scheduleWrap(async (req, res) => {
  await milestoneStore.updateSettings(req.body || {});
  await broadcastBannerSettings();
  res.json(await milestoneState());
}));

// show the look on the overlay without touching what's been announced
router.post('/dashboard/gta6/milestones/test', scheduleWrap(async (req, res) => {
  await milestones.fireSample();
  res.json({ ok: true });
}));

router.post('/dashboard/gta6/milestones/:id/fire', scheduleWrap(async (req, res) => {
  const banner = await milestones.fireNow(req.params.id);
  if (!banner) throw new InputError('That milestone no longer exists.');
  res.json({ ok: true });
}));

router.patch('/dashboard/gta6/milestones/:id', scheduleWrap(async (req, res) => {
  const b = req.body || {};
  await milestoneStore.updateMilestone(req.params.id, { atMin: toMinutes(b), title: b.title, subtitle: b.subtitle });
  milestones.listsChanged().catch(() => {});
  res.json(await milestoneState());
}));

router.delete('/dashboard/gta6/milestones/:id', scheduleWrap(async (req, res) => {
  await milestoneStore.deleteMilestone(req.params.id);
  milestones.listsChanged().catch(() => {});
  res.json(await milestoneState());
}));

module.exports = router;
