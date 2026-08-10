const express = require('express');
const fs = require('fs');
const path = require('path');
const followerStore = require('../services/followerStore');
const settingsStore = require('../services/settingsStore');

const router = express.Router();
const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'public', 'overlay', 'index.html');

router.get('/overlay', async (req, res) => {
  const [state, settings] = await Promise.all([followerStore.getState(), settingsStore.getSettings()]);
  const preview = req.query.preview === '1';

  const initialState = {
    count: state.count,
    goal: settings.followerGoal,
    particlesEnabled: settings.particlesEnabled,
    animationSpeed: settings.animationSpeed,
    rotationIntensity: settings.rotationIntensity,
    counterScale: settings.counterScale,
    channel: preview ? 'preview' : 'live',
  };

  let html;
  try {
    html = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  } catch (err) {
    return res.status(500).send('Overlay template missing.');
  }

  html = html.replace(
    '"__INITIAL_STATE_JSON__"',
    JSON.stringify(initialState).replace(/</g, '\\u003c')
  );

  res.set('Cache-Control', 'no-store');
  res.type('html').send(html);
});

module.exports = router;
