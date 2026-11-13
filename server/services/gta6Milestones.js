// Fires milestone banners (and, optionally, "block starts" announcements from
// the schedule) when the stream timer's clock reaches them.
//
// This runs on the SERVER, not in the overlay page: a browser source can be
// refreshed, hidden, or opened twice, and none of that may repeat or skip a
// banner. The server works out when the timer will next reach a milestone,
// sleeps until then, announces it over the 'gta6-banner' channel, and records
// that it did (persisted, so a restart/redeploy doesn't repeat it either).
//
// Rules:
//  - Only a RUNNING timer crosses milestones. Pausing stops them.
//  - If the streamer jumps the clock (Set, +/- nudges, Reset), whatever that
//    jump passes is marked done silently — no pile of banners — and anything
//    the clock moves back before is armed again.
//  - Starting the timer announces a milestone at 0:00 (the opening block).
//  - After a restart, a milestone missed by under 2 minutes is still
//    announced; anything older is skipped quietly.
const hub = require('../websocket/hub');
const timerStore = require('./gta6TimerStore');
const timerLogic = require('./gta6TimerLogic');
const milestoneStore = require('./gta6MilestoneStore');
const scheduleStore = require('./gta6ScheduleStore');

const CHANNELS = ['gta6-banner', 'gta6-banner-preview'];
const MINUTE = 60 * 1000;
const LATE_MS = 2 * MINUTE;
const MAX_SLEEP_MS = 6 * 3600 * 1000; // wake up now and then rather than trust one huge timeout

let sleepTimer = null;
let queue = Promise.resolve();

/** "6 HOURS IN", "1 HOUR IN", "6H 30M IN". */
function kickerFor(atMin) {
  if (atMin === 0) return "WE'RE LIVE";
  const h = Math.floor(atMin / 60);
  const m = atMin % 60;
  if (!m) return `${h} ${h === 1 ? 'HOUR' : 'HOURS'} IN`;
  return h ? `${h}H ${m}M IN` : `${m} MIN IN`;
}

function milestoneBanner(m) {
  return { id: m.id, kind: 'milestone', atMin: m.atMin, kicker: kickerFor(m.atMin), title: m.title, subtitle: m.subtitle || '' };
}

function blockBanner(b) {
  return { id: `block:${b.id}`, kind: 'block', atMin: b.startMin, kicker: 'NOW', title: b.title, subtitle: b.note || '' };
}

/** Everything that can fire right now: milestones plus (if on) schedule block starts, in time order. */
async function allBanners() {
  const [milestones, settings, blocks] = await Promise.all([
    milestoneStore.listMilestones(),
    milestoneStore.getSettings(),
    scheduleStore.listBlocks(),
  ]);
  const items = milestones.map(milestoneBanner);
  if (settings.announceBlocks) items.push(...blocks.map(blockBanner));
  // milestones before block announcements at the same moment
  return items.sort((a, b) => a.atMin - b.atMin || (a.kind === 'milestone' ? -1 : 1));
}

async function send(banner) {
  const settings = await milestoneStore.getSettings();
  const message = { type: 'gta6:banner', banner, seconds: settings.seconds, serverTime: Date.now() };
  for (const channel of CHANNELS) hub.broadcast(channel, message);
}

async function evaluateNow(silent) {
  clearTimeout(sleepTimer);
  sleepTimer = null;

  const [state, items, firedIds] = await Promise.all([timerStore.getState(), allBanners(), milestoneStore.getFired()]);
  const elapsed = timerLogic.elapsedAt(state, Date.now());
  const running = state.status === 'running';
  // a stopped clock only counts what it has strictly passed; a running one also counts "right now"
  const crossed = (b) => (running ? b.atMin * MINUTE <= elapsed : b.atMin * MINUTE < elapsed);

  const wasFired = new Set(firedIds);
  const nowFired = new Set();
  const due = [];
  for (const b of items) {
    if (!crossed(b)) continue;
    nowFired.add(b.id);
    if (!wasFired.has(b.id) && !silent && running && elapsed - b.atMin * MINUTE <= LATE_MS) due.push(b);
  }
  if (nowFired.size !== wasFired.size || [...nowFired].some((id) => !wasFired.has(id))) {
    await milestoneStore.setFired([...nowFired]);
  }
  for (const b of due) await send(b);

  // wake up when the clock reaches the next one (a countdown never reaches past its own end)
  if (running) {
    const next = items
      .filter((b) => !crossed(b) && !(state.mode === 'countdown' && b.atMin * MINUTE > state.durationMs))
      .map((b) => b.atMin * MINUTE)[0];
    if (next !== undefined) {
      const delay = Math.min(Math.max(0, next - elapsed) + 25, MAX_SLEEP_MS);
      sleepTimer = setTimeout(() => evaluate(false).catch(() => {}), delay); // errors are logged by evaluate()
    }
  }
}

function evaluate(silent) {
  const run = queue.then(() => evaluateNow(silent));
  queue = run.catch((err) => console.error('[gta6] milestone check failed:', err.message));
  return run;
}

/** Call after any timer change. `silent` for jumps (set/nudge/reset); not for start/resume. */
function timerChanged({ silent }) {
  return evaluate(silent);
}

/** Call after the milestone list, schedule or banner settings change. */
function listsChanged() {
  return evaluate(true);
}

/** On server boot: pick up where the stored timer is. */
function init() {
  return evaluate(false);
}

/** Show a banner now without touching the "already announced" record (dashboard test button). */
async function fireNow(id) {
  const items = await allBanners();
  const banner = items.find((b) => b.id === id);
  if (!banner) return null;
  await send(banner);
  return banner;
}

/** A generic sample banner, for checking the look. */
function fireSample() {
  return send({ id: 'sample', kind: 'milestone', atMin: 12 * 60, kicker: '12 HOURS IN', title: 'Halfway there', subtitle: '12 hours down, 12 to go' });
}

module.exports = { init, timerChanged, listsChanged, fireNow, fireSample, kickerFor };
