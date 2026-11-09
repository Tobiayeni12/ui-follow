// Public browser-source pages for the GTA 6 section:
//   /gta6/timer      — the stream timer (own 'gta6-timer' channel)
//   /gta6/followers  — a GTA 6-styled follower count. Same data feed as
//                      /overlay (same 'live'/'preview' channels, same
//                      follower store and goal), just a different skin, so
//                      the original 3D overlay is untouched.
const express = require('express');
const fs = require('fs');
const path = require('path');
const followerStore = require('../services/followerStore');
const settingsStore = require('../services/settingsStore');
const timerStore = require('../services/gta6TimerStore');

const router = express.Router();
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public', 'gta6');

function sendPage(res, file, initialState) {
  let html;
  try {
    html = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
  } catch (err) {
    return res.status(500).send('GTA 6 overlay template missing.');
  }
  html = html.replace('"__INITIAL_STATE_JSON__"', JSON.stringify(initialState).replace(/</g, '\\u003c'));
  res.set('Cache-Control', 'no-store');
  res.type('html').send(html);
}

const wrap = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[gta6] page failed:', err.message);
    if (!res.headersSent) res.status(500).send('Overlay error — try refreshing.');
  });
};

router.get('/gta6/timer', wrap(async (req, res) => {
  sendPage(res, 'timer.html', {
    state: await timerStore.getState(),
    serverTime: Date.now(),
    channel: 'gta6-timer',
  });
}));

router.get('/gta6/followers', wrap(async (req, res) => {
  const [state, settings] = await Promise.all([followerStore.getState(), settingsStore.getSettings()]);
  sendPage(res, 'followers.html', {
    count: state.count,
    goal: settings.followerGoal,
    channel: req.query.preview === '1' ? 'preview' : 'live',
  });
}));

module.exports = router;
