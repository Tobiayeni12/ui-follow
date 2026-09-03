const express = require('express');
const fs = require('fs');
const path = require('path');
const treeStore = require('../services/treeStore');
const treeSettingsStore = require('../services/treeSettingsStore');

const router = express.Router();
const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'public', 'tree', 'index.html');

router.get('/tree', async (req, res) => {
  const [state, settings] = await Promise.all([treeStore.getState(), treeSettingsStore.getSettings()]);
  const preview = req.query.preview === '1';

  const threshold = treeStore.thresholdForLevel(state.currentLevel, {
    baseThreshold: settings.baseThreshold,
    levelScaling: settings.levelScaling,
  });
  const stage = treeSettingsStore.stageForLevel(state.currentLevel, settings.stageThresholds);

  const initialState = {
    state: { ...state, thresholdForCurrentLevel: threshold, stage },
    settings,
    channel: preview ? 'tree-preview' : 'tree',
  };

  let html;
  try {
    html = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  } catch (err) {
    return res.status(500).send('Community Tree overlay template missing.');
  }

  html = html.replace(
    '"__INITIAL_STATE_JSON__"',
    JSON.stringify(initialState).replace(/</g, '\\u003c')
  );

  res.set('Cache-Control', 'no-store');
  res.type('html').send(html);
});

module.exports = router;
