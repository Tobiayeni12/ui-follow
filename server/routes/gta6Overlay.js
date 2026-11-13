// Public browser-source pages for the GTA 6 section:
//   /gta6/timer      — the stream timer (own 'gta6-timer' channel)
//   /gta6/followers  — a GTA 6-styled follower count. Same data feed as
//                      /overlay (same 'live'/'preview' channels, same
//                      follower store and goal), just a different skin, so
//                      the original 3D overlay is untouched.
//   /gta6/schedule   — "now / up next" for the stream schedule, on the timer's clock.
//   /gta6/banner     — milestone banners ("HOUR 12 — HALFWAY") that pop up when
//                      the timer reaches them; fired by the server.
//   /gta6/break      — "be right back" screen with a break countdown; transparent
//                      until a break is started from the dashboard.
//   /gta6/poll       — chat poll: viewers vote by typing an option's number.
//   /gta6/objectives — a GTA 6-styled objectives checklist (own list and
//                      look settings, 'gta6-objectives' channel).
const express = require('express');
const fs = require('fs');
const path = require('path');
const followerStore = require('../services/followerStore');
const settingsStore = require('../services/settingsStore');
const timerStore = require('../services/gta6TimerStore');
const objectivesStore = require('../services/gta6ObjectivesStore');
const objectivesSettingsStore = require('../services/gta6ObjectivesSettingsStore');
const scheduleStore = require('../services/gta6ScheduleStore');
const milestoneStore = require('../services/gta6MilestoneStore');
const breakStore = require('../services/gta6BreakStore');
const pollGame = require('../services/gta6Poll');

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

router.get('/gta6/objectives', wrap(async (req, res) => {
  const [objectives, settings] = await Promise.all([
    objectivesStore.getObjectives(),
    objectivesSettingsStore.getSettings(),
  ]);
  sendPage(res, 'objectives.html', {
    objectives,
    settings,
    preview: req.query.preview === '1',
    channel: req.query.preview === '1' ? 'gta6-objectives-preview' : 'gta6-objectives',
  });
}));

router.get('/gta6/schedule', wrap(async (req, res) => {
  const preview = req.query.preview === '1';
  const [blocks, settings, timer] = await Promise.all([
    scheduleStore.listBlocks(),
    scheduleStore.getSettings(),
    timerStore.getState(),
  ]);
  sendPage(res, 'schedule.html', {
    blocks,
    settings,
    timer,
    serverTime: Date.now(),
    preview,
    channel: preview ? 'gta6-schedule-preview' : 'gta6-schedule',
  });
}));

router.get('/gta6/banner', wrap(async (req, res) => {
  const preview = req.query.preview === '1';
  sendPage(res, 'banner.html', {
    settings: await milestoneStore.getSettings(),
    preview,
    channel: preview ? 'gta6-banner-preview' : 'gta6-banner',
  });
}));

router.get('/gta6/break', wrap(async (req, res) => {
  const preview = req.query.preview === '1';
  const [state, settings] = await Promise.all([breakStore.getState(), breakStore.getSettings()]);
  sendPage(res, 'break.html', {
    state,
    settings,
    serverTime: Date.now(),
    preview,
    channel: preview ? 'gta6-break-preview' : 'gta6-break',
  });
}));

router.get('/gta6/poll', wrap(async (req, res) => {
  const preview = req.query.preview === '1';
  sendPage(res, 'poll.html', {
    snapshot: await pollGame.snapshot(),
    preview,
    channel: preview ? 'gta6-poll-preview' : 'gta6-poll',
  });
}));

module.exports = router;
