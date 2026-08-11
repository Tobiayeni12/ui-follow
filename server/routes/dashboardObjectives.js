// Protected CRUD API for the "Current Objectives" checklist. Only the
// dashboard can add/edit/check off/delete/reorder objectives — the public
// /objectives overlay is read-only and just reflects whatever is broadcast
// here.
const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const objectivesStore = require('../services/objectivesStore');
const objectivesSettingsStore = require('../services/objectivesSettingsStore');
const hub = require('../websocket/hub');

const router = express.Router();
router.use(requireAuth);
router.use(express.json());

function broadcastObjectives(objectives) {
  const message = { type: 'objectives_update', data: { objectives } };
  hub.broadcast('objectives', message);
  hub.broadcast('objectives-preview', message);
}

function broadcastObjectivesSettings(settings) {
  const message = { type: 'objectives_settings_update', data: settings };
  hub.broadcast('objectives', message);
  hub.broadcast('objectives-preview', message);
}

router.get('/dashboard/objectives', async (req, res) => {
  const [objectives, settings] = await Promise.all([
    objectivesStore.getObjectives(),
    objectivesSettingsStore.getSettings(),
  ]);
  res.json({ objectives, settings });
});

router.post('/dashboard/objectives/settings', async (req, res) => {
  const settings = await objectivesSettingsStore.updateSettings(req.body || {});
  broadcastObjectivesSettings(settings);
  res.json(settings);
});

router.post('/dashboard/objectives', async (req, res) => {
  try {
    const objectives = await objectivesStore.addObjective(req.body?.text);
    broadcastObjectives(objectives);
    res.json({ objectives });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/dashboard/objectives/:id', async (req, res) => {
  try {
    const { text, done } = req.body || {};
    const objectives = await objectivesStore.updateObjective(req.params.id, { text, done });
    broadcastObjectives(objectives);
    res.json({ objectives });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/dashboard/objectives/:id', async (req, res) => {
  const objectives = await objectivesStore.deleteObjective(req.params.id);
  broadcastObjectives(objectives);
  res.json({ objectives });
});

router.post('/dashboard/objectives/reorder', async (req, res) => {
  const orderedIds = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds : [];
  const objectives = await objectivesStore.reorderObjectives(orderedIds);
  broadcastObjectives(objectives);
  res.json({ objectives });
});

module.exports = router;
