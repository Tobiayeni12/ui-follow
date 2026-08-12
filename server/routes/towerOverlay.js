const express = require('express');
const fs = require('fs');
const path = require('path');
const towerStore = require('../services/towerStore');
const towerSettingsStore = require('../services/towerSettingsStore');

const router = express.Router();
const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'public', 'tower', 'index.html');

router.get('/tower', async (req, res) => {
  const [state, settings] = await Promise.all([towerStore.getState(), towerSettingsStore.getSettings()]);
  const preview = req.query.preview === '1';

  const initialState = {
    blocks: state.blocks,
    followerCount: state.followerCount,
    settings,
    channel: preview ? 'tower-preview' : 'tower',
  };

  let html;
  try {
    html = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  } catch (err) {
    return res.status(500).send('Tower overlay template missing.');
  }

  html = html.replace(
    '"__INITIAL_STATE_JSON__"',
    JSON.stringify(initialState).replace(/</g, '\\u003c')
  );

  res.set('Cache-Control', 'no-store');
  res.type('html').send(html);
});

module.exports = router;
