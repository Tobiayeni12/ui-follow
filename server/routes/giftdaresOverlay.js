const express = require('express');
const fs = require('fs');
const path = require('path');
const giftdaresSettingsStore = require('../services/giftdaresSettingsStore');

const router = express.Router();
const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'public', 'giftdares', 'index.html');

router.get('/giftdares', async (req, res) => {
  const settings = await giftdaresSettingsStore.getSettings();

  const initialState = { settings, channel: 'giftdares' };

  let html;
  try {
    html = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  } catch (err) {
    return res.status(500).send('Gift dares overlay template missing.');
  }

  html = html.replace(
    '"__INITIAL_STATE_JSON__"',
    JSON.stringify(initialState).replace(/</g, '\\u003c')
  );

  res.set('Cache-Control', 'no-store');
  res.type('html').send(html);
});

module.exports = router;
