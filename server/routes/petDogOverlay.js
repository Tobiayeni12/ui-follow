// Same growth state/settings as the tree overlay (treeOverlay.js) — this
// route just serves a different visual template for it. Deliberately reuses
// treeStore/treeSettingsStore directly rather than a parallel store, so
// there is exactly one growth state that both overlays render, per the
// user's "keep the same growth functions" instruction — a gift grows both
// at once, always in sync, never two competing counters.
const express = require('express');
const fs = require('fs');
const path = require('path');
const treeStore = require('../services/treeStore');
const treeSettingsStore = require('../services/treeSettingsStore');

const router = express.Router();
const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'public', 'pet-dog', 'index.html');

router.get('/pet-dog', async (req, res) => {
  const [state, settings] = await Promise.all([treeStore.getState(), treeSettingsStore.getSettings()]);
  const preview = req.query.preview === '1';

  const threshold = treeStore.thresholdForLevel(state.currentLevel, {
    baseThreshold: settings.baseThreshold,
    levelScaling: settings.levelScaling,
  });
  const stageNum = treeSettingsStore.stageForLevel(state.currentLevel, settings.stageThresholds);

  const initialState = {
    state: { ...state, thresholdForCurrentLevel: threshold, stage: stageNum },
    settings,
    channel: preview ? 'tree-preview' : 'tree',
  };

  let html;
  try {
    html = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  } catch (err) {
    return res.status(500).send('Pet Dog overlay template missing.');
  }

  html = html.replace(
    '"__INITIAL_STATE_JSON__"',
    JSON.stringify(initialState).replace(/</g, '\\u003c')
  );

  res.set('Cache-Control', 'no-store');
  res.type('html').send(html);
});

module.exports = router;
