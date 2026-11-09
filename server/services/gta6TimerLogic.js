// Pure timer state transitions for the GTA 6 stream timer — no I/O, no
// Date.now(), every function takes `now` explicitly so the behaviour can be
// tested with fake timestamps. Persistence/locking lives in gta6TimerStore.js.
//
// The state is deliberately *wall-clock based*, not tick based: a running
// timer stores the epoch-ms moment its current segment started, and anyone
// (server, overlay, dashboard) derives the current time from that. That is
// what lets a 24-hour countdown survive an OBS browser-source refresh, a
// dashboard reload and a server restart/redeploy without drifting or
// resetting — nothing has to be "kept running" anywhere.
//
//   state = {
//     mode:       'countdown' | 'countup',
//     durationMs: countdown length (countdown only; 0 for countup),
//     elapsedMs:  time banked from earlier running segments,
//     startedAt:  epoch ms the current running segment began, else null,
//     status:     'idle' | 'running' | 'paused',
//     label:      text shown above the digits,
//   }

const HOUR = 3600 * 1000;
const MAX_MS = 999 * HOUR; // overlay shows hours in as many digits as needed; this is just a sanity cap
const MIN_COUNTDOWN_MS = 1000;

const DEFAULTS = {
  mode: 'countdown',
  durationMs: 24 * HOUR, // sized for the 24-hour stream this was built for
  elapsedMs: 0,
  startedAt: null,
  status: 'idle',
  label: '24 HOUR STREAM',
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Tolerant read of whatever is in storage — never trust it blindly. */
function normalize(stored) {
  const s = { ...DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {}) };
  s.mode = s.mode === 'countup' ? 'countup' : 'countdown';
  s.durationMs = Number.isFinite(s.durationMs) ? clamp(Math.round(s.durationMs), 0, MAX_MS) : DEFAULTS.durationMs;
  s.elapsedMs = Number.isFinite(s.elapsedMs) ? clamp(Math.round(s.elapsedMs), 0, MAX_MS) : 0;
  s.label = sanitizeLabel(s.label);
  if (!['idle', 'running', 'paused'].includes(s.status)) s.status = 'idle';
  if (s.status === 'running' && !Number.isFinite(s.startedAt)) {
    // A "running" timer with no start time can't be resumed accurately —
    // park it rather than guess.
    s.status = 'paused';
  }
  if (s.status !== 'running') s.startedAt = null;
  return s;
}

function sanitizeLabel(label) {
  return String(label ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

/** Total time counted so far at `now`. Countdowns never exceed their length. */
function elapsedAt(state, now) {
  const running = state.status === 'running' && Number.isFinite(state.startedAt);
  const raw = state.elapsedMs + (running ? Math.max(0, now - state.startedAt) : 0);
  return state.mode === 'countdown' ? Math.min(raw, state.durationMs) : raw;
}

function remainingAt(state, now) {
  return state.mode === 'countdown' ? Math.max(0, state.durationMs - elapsedAt(state, now)) : null;
}

function isFinished(state, now) {
  return state.mode === 'countdown' && remainingAt(state, now) <= 0;
}

/** Bank the running segment up to `now` so a change can be applied cleanly. */
function rebase(state, now) {
  return {
    ...state,
    elapsedMs: elapsedAt(state, now),
    startedAt: state.status === 'running' ? now : null,
  };
}

function start(state, now) {
  if (state.status === 'running') return state;
  if (isFinished(state, now)) return state; // nothing left to count — needs a reset or extra time first
  return { ...state, status: 'running', startedAt: now };
}

function pause(state, now) {
  if (state.status !== 'running') return state;
  return { ...rebase(state, now), status: 'paused', startedAt: null };
}

function reset(state) {
  return { ...state, status: 'idle', startedAt: null, elapsedMs: 0 };
}

/**
 * "Set the clock": countdown → this is how long it counts down from;
 * count-up → this is the value it starts counting up from. Either way the
 * timer goes back to idle (not started) — callers confirm first if a timer
 * is mid-run.
 */
function set(state, { mode, valueMs, label }) {
  const nextMode = mode === 'countup' ? 'countup' : 'countdown';
  const value = clamp(Math.round(Number(valueMs) || 0), 0, MAX_MS);
  return {
    ...state,
    mode: nextMode,
    durationMs: nextMode === 'countdown' ? Math.max(value, MIN_COUNTDOWN_MS) : 0,
    elapsedMs: nextMode === 'countup' ? value : 0,
    startedAt: null,
    status: 'idle',
    label: label === undefined ? state.label : sanitizeLabel(label),
  };
}

/**
 * Nudge the clock by `deltaMs` (positive adds, negative removes) without
 * stopping it. Countdown: changes the time *remaining* (a finished
 * countdown given more time starts counting again). Count-up: shifts the
 * elapsed value, never below 0.
 */
function adjust(state, deltaMs, now) {
  const delta = Math.round(Number(deltaMs) || 0);
  const s = rebase(state, now);
  if (s.mode === 'countdown') {
    const floor = Math.max(s.elapsedMs, MIN_COUNTDOWN_MS);
    return { ...s, durationMs: clamp(s.durationMs + delta, floor, MAX_MS) };
  }
  return { ...s, elapsedMs: clamp(s.elapsedMs + delta, 0, MAX_MS) };
}

function setLabel(state, label) {
  return { ...state, label: sanitizeLabel(label) };
}

module.exports = {
  HOUR,
  MAX_MS,
  MIN_COUNTDOWN_MS,
  DEFAULTS,
  normalize,
  sanitizeLabel,
  elapsedAt,
  remainingAt,
  isFinished,
  start,
  pause,
  reset,
  set,
  adjust,
  setLabel,
};
