// Public browser-source page for the trivia game: GET /trivia
// (?preview=1 is the dashboard's embedded copy; both are listeners on the
// same game, so a question started from the dashboard shows on both.)
const express = require('express');
const fs = require('fs');
const path = require('path');
const triviaGame = require('../services/triviaGame');

const router = express.Router();
const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'public', 'trivia', 'index.html');

router.get('/trivia', async (req, res) => {
  try {
    const preview = req.query.preview === '1';
    const html = fs
      .readFileSync(TEMPLATE_PATH, 'utf8')
      .replace(
        '"__INITIAL_STATE_JSON__"',
        JSON.stringify({
          snapshot: await triviaGame.snapshot(),
          preview,
          channel: preview ? 'trivia-preview' : 'trivia',
        }).replace(/</g, '\\u003c')
      );
    res.set('Cache-Control', 'no-store');
    res.type('html').send(html);
  } catch (err) {
    console.error('[trivia] page failed:', err.message);
    if (!res.headersSent) res.status(500).send('Overlay error — try refreshing.');
  }
});

module.exports = router;
