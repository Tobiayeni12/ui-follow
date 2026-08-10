// Tracks the last known follower count (real or demo) so we can detect
// changes across polling ticks and across server restarts.
const storage = require('./storage');
const config = require('../config');

const KEY = 'follower_state';

async function getState() {
  const stored = await storage.get(KEY, null);
  if (stored) return stored;
  const initial = {
    count: config.demoMode ? config.demoStartCount : 0,
    updatedAt: Date.now(),
    source: config.demoMode ? 'demo' : 'init',
  };
  await storage.set(KEY, initial);
  return initial;
}

async function setCount(count, source) {
  const state = { count, updatedAt: Date.now(), source };
  await storage.set(KEY, state);
  return state;
}

module.exports = { getState, setCount };
