// Persists the GTA 6 stream timer through the same generic storage layer
// (Postgres in production, JSON file locally) as everything else, so it
// survives refreshes, redeploys and restarts — nothing here ever resets the
// timer on its own. All transitions are pure functions in gta6TimerLogic.js.
const storage = require('./storage');
const logic = require('./gta6TimerLogic');

const KEY = 'gta6_timer';

async function getState() {
  return logic.normalize(await storage.get(KEY, null));
}

// Mutations are read-modify-write; serialize them so two quick clicks (a
// double-tapped Start, say) can never interleave and clobber each other.
let chain = Promise.resolve();
function mutate(reducer) {
  const run = chain.then(async () => {
    const current = await getState();
    const next = reducer(current, Date.now());
    await storage.set(KEY, next);
    return next;
  });
  chain = run.catch(() => {}); // keep the queue alive if one mutation fails
  return run;
}

module.exports = {
  getState,
  start: () => mutate((s, now) => logic.start(s, now)),
  pause: () => mutate((s, now) => logic.pause(s, now)),
  reset: () => mutate((s) => logic.reset(s)),
  set: (opts) => mutate((s) => logic.set(s, opts)),
  adjust: (deltaMs) => mutate((s, now) => logic.adjust(s, deltaMs, now)),
  setLabel: (label) => mutate((s) => logic.setLabel(s, label)),
};
