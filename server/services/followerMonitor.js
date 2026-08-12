// Background poller: periodically asks TikTok for the current
// follower_count and diffs it against the last known value. Increases are
// broadcast as celebratory "follower_update" events; any other change
// (including decreases/unfollows) is broadcast as a quiet "count_sync" so
// the number on screen stays accurate without triggering a celebration.
//
// Never runs while DEMO_MODE=true — in demo mode the dashboard's test
// buttons drive the exact same broadcast pipeline instead.
const config = require('../config');
const tiktok = require('./tiktok');
const tokenStore = require('./tokenStore');
const followerStore = require('./followerStore');
const settingsStore = require('./settingsStore');
const towerEvents = require('./towerEvents');
const hub = require('../websocket/hub');

let timer = null;
let running = false;
let status = {
  active: false,
  lastPolledAt: null,
  lastSuccessAt: null,
  lastError: null,
  intervalMs: config.pollIntervalMs,
};

async function pollOnce() {
  status.lastPolledAt = Date.now();
  try {
    const accessToken = await tiktok.ensureValidAccessToken();
    const newCount = await tiktok.getFollowerCount(accessToken);
    status.lastSuccessAt = Date.now();
    status.lastError = null;

    const state = await followerStore.getState();
    if (newCount === state.count) return;

    await followerStore.setCount(newCount, 'tiktok');
    const settings = await settingsStore.getSettings();
    const payload = {
      previousCount: state.count,
      newCount,
      delta: newCount - state.count,
      source: 'tiktok',
      goal: settings.followerGoal,
    };

    if (newCount > state.count) {
      hub.broadcast('live', { type: 'follower_update', data: payload });
      hub.broadcast('preview', { type: 'follower_update', data: payload });
      // TikTok's API only exposes the aggregate follower_count, never
      // individual follow events/usernames — so a poll that catches
      // multiple new followers at once spawns that many anonymous blocks.
      towerEvents
        .addFollowersAndBroadcast(newCount - state.count, { isTest: false })
        .catch((err) => console.error('[followerMonitor] tower update failed:', err.message));
    } else {
      // Decrease — keep the display accurate without celebrating it.
      hub.broadcast('live', { type: 'count_sync', data: payload });
      hub.broadcast('preview', { type: 'count_sync', data: payload });
    }
  } catch (err) {
    status.lastError = err.message;
    console.error('[followerMonitor] poll failed:', err.message);
  }
}

function scheduleNext() {
  if (!running) return;
  timer = setTimeout(async () => {
    await pollOnce();
    scheduleNext();
  }, status.intervalMs);
}

async function start() {
  if (config.demoMode) {
    console.log('[followerMonitor] DEMO_MODE is on — TikTok polling disabled.');
    return;
  }
  const tokens = await tokenStore.getTokens();
  if (!tokens) {
    console.log('[followerMonitor] No TikTok connection yet — waiting for /auth/tiktok.');
    return;
  }
  if (running) return;
  running = true;
  status.active = true;
  console.log(`[followerMonitor] Starting poll loop every ${status.intervalMs}ms`);
  pollOnce().then(scheduleNext);
}

function stop() {
  running = false;
  status.active = false;
  if (timer) clearTimeout(timer);
  timer = null;
}

function getStatus() {
  return { ...status, demoMode: config.demoMode };
}

module.exports = { start, stop, getStatus, pollOnce };
