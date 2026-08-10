const express = require('express');
const fs = require('fs');
const path = require('path');
const objectivesStore = require('../services/objectivesStore');

const router = express.Router();
const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'public', 'objectives', 'index.html');

router.get('/objectives', async (req, res) => {
  const objectives = await objectivesStore.getObjectives();
  const preview = req.query.preview === '1';

  const initialState = {
    objectives,
    channel: preview ? 'objectives-preview' : 'objectives',
  };

  let html;
  try {
    html = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  } catch (err) {
    return res.status(500).send('Objectives overlay template missing.');
  }

  html = html.replace(
    '"__INITIAL_STATE_JSON__"',
    JSON.stringify(initialState).replace(/</g, '\\u003c')
  );

  res.set('Cache-Control', 'no-store');
  res.type('html').send(html);
});

module.exports = router;
