// Protected dashboard API for the Community Tree. Every test action here
// calls the exact same treeEvents.addGrowth()/growthForGift() that a real
// TikFinity gift event will call later — no parallel "test" logic, per the
// project spec.
const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const treeStore = require('../services/treeStore');
const treeSettingsStore = require('../services/treeSettingsStore');
const treeEvents = require('../services/treeEvents');
const hub = require('../websocket/hub');

const router = express.Router();
router.use(requireAuth);
router.use(express.json());

router.get('/dashboard/tree', async (req, res) => {
  const [state, settings] = await Promise.all([treeStore.getState(), treeSettingsStore.getSettings()]);
  const threshold = treeStore.thresholdForLevel(state.currentLevel, {
    baseThreshold: settings.baseThreshold,
    levelScaling: settings.levelScaling,
  });
  const stage = treeSettingsStore.stageForLevel(state.currentLevel, settings.stageThresholds);
  res.json({ state: { ...state, thresholdForCurrentLevel: threshold, stage }, settings });
});

router.post('/dashboard/tree/settings', async (req, res) => {
  const settings = await treeSettingsStore.updateSettings(req.body || {});
  hub.broadcast('tree', { type: 'tree:settings', settings });
  hub.broadcast('tree-preview', { type: 'tree:settings', settings });
  res.json(settings);
});

// TEST +1 / +5 / +25 / +100
router.post('/dashboard/tree/test-growth', async (req, res) => {
  const amount = Math.max(1, Math.min(500, parseInt(req.body?.amount, 10) || 1));
  const message = await treeEvents.addGrowth(amount, 'test', null, { isTest: true });
  res.json({ ok: true, message });
});

// Simulated gift — exercises the identical path a real TikFinity gift will
// use (growthForGift() -> addGrowth()), just with a fake username/gift.
router.post('/dashboard/tree/simulate-gift', async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim().slice(0, 40) || 'testviewer' : 'testviewer';
  const giftName = typeof req.body?.giftName === 'string' ? req.body.giftName.trim().slice(0, 60) : null;
  const diamondCount = req.body?.diamondCount;

  const amount = await treeEvents.growthForGift(giftName, diamondCount);
  const message = await treeEvents.addGrowth(amount, 'gift', username, { isTest: true, giftName });
  res.json({ ok: true, amount, message });
});

router.post('/dashboard/tree/evolve', async (req, res) => {
  const settings = await treeSettingsStore.getSettings();
  const curve = { baseThreshold: settings.baseThreshold, levelScaling: settings.levelScaling };
  const prevState = await treeStore.getState();
  const prevStage = treeSettingsStore.stageForLevel(prevState.currentLevel, settings.stageThresholds);

  const { state, thresholdForCurrentLevel } = await treeStore.forceEvolve(curve);
  const newStage = treeSettingsStore.stageForLevel(state.currentLevel, settings.stageThresholds);

  const message = {
    type: 'tree:growth',
    amount: 0,
    source: 'test',
    username: null,
    giftName: null,
    state: {
      currentLevel: state.currentLevel,
      currentGrowth: state.currentGrowth,
      thresholdForCurrentLevel,
      totalLifetimeGrowth: state.totalLifetimeGrowth,
      stage: newStage,
    },
    leveledUp: true,
    levelsGained: 1,
    stageChanged: newStage !== prevStage,
  };
  hub.broadcast('tree-preview', message);
  hub.broadcast('tree', message);
  res.json({ ok: true, message });
});

router.post('/dashboard/tree/reset', async (req, res) => {
  await treeStore.reset();
  const message = { type: 'tree:reset' };
  hub.broadcast('tree-preview', message);
  hub.broadcast('tree', message);
  res.json({ ok: true });
});

module.exports = router;
