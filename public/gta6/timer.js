import { ReconnectingSocket } from '/overlay/wsClient.js';
import { renderDigits, fitToViewport } from '/gta6/digits.js';

// The server owns the timer. All this page does is show
//   time = f(state, server clock)
// where state is { mode, durationMs, elapsedMs, startedAt, status, label }
// (see server/services/gta6TimerLogic.js). Because the time is *derived*
// from an absolute start timestamp rather than counted tick by tick, an OBS
// refresh, a hidden/throttled browser source, a dropped WebSocket or a
// server redeploy can never make it drift or reset — the next render is
// simply correct again.

const raw = window.__INITIAL_STATE__;
const initial = raw && typeof raw === 'object' ? raw : {};

const widget = document.getElementById('timerWidget');
const labelWrap = document.getElementById('timerLabelWrap');
const labelEl = document.getElementById('timerLabel');
const digitsEl = document.getElementById('timerDigits');
const bar = document.getElementById('timerBar');
const barFill = document.getElementById('timerBarFill');
const pillEl = document.getElementById('timerPill');

let state = initial.state || {
  mode: 'countdown', durationMs: 24 * 3600 * 1000, elapsedMs: 0, startedAt: null, status: 'idle', label: '',
};
// server clock minus this machine's clock — streaming PCs are often a few
// seconds off, and the timer must show *server* time, not local time.
let offset = (initial.serverTime || Date.now()) - Date.now();

function elapsedAt(s, now) {
  const running = s.status === 'running' && Number.isFinite(s.startedAt);
  const total = s.elapsedMs + (running ? Math.max(0, now - s.startedAt) : 0);
  return s.mode === 'countdown' ? Math.min(total, s.durationMs) : total;
}

const pad = (n) => String(n).padStart(2, '0');
function formatHMS(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`; // hours aren't capped, so 30+ hour count-ups just work
}

function fit() {
  fitToViewport(widget);
}

function render() {
  const now = Date.now() + offset;
  const elapsed = elapsedAt(state, now);
  const isCountdown = state.mode === 'countdown';

  let seconds;
  let finished = false;
  if (isCountdown) {
    const remaining = Math.max(0, state.durationMs - elapsed);
    seconds = Math.ceil(remaining / 1000); // shows 00:00:00 only once time is truly up
    finished = remaining <= 0;
  } else {
    seconds = Math.floor(elapsed / 1000);
  }

  if (renderDigits(digitsEl, formatHMS(seconds), { animate: state.status === 'running' })) fit();

  if (labelEl.textContent !== state.label) {
    labelEl.textContent = state.label;
    labelWrap.hidden = !state.label;
    fit();
  }

  // progress through the countdown: empty at the start, full when time is up
  bar.hidden = !isCountdown;
  if (isCountdown) {
    const pct = state.durationMs > 0 ? Math.min(100, (elapsed / state.durationMs) * 100) : 100;
    barFill.style.setProperty('--rest', `${(100 - pct).toFixed(3)}%`);
  }

  let pill = '';
  if (finished) pill = "Time's up";
  else if (state.status === 'paused') pill = 'Paused';
  const pillText = pill || ' '; // keep the line's height when empty so nothing shifts when it appears
  if (pillEl.textContent !== pillText) pillEl.textContent = pillText;
  pillEl.classList.toggle('show', Boolean(pill));
  pillEl.classList.toggle('alert', finished);
  document.body.classList.toggle('finished', finished);
}

// Re-read the authoritative state and measure the clock offset, assuming the
// server stamped its time about halfway through the request.
async function resync() {
  try {
    const sent = Date.now();
    const res = await fetch('/api/gta6/timer', { cache: 'no-store' });
    const received = Date.now();
    if (!res.ok) return;
    const data = await res.json();
    offset = data.serverTime - (sent + (received - sent) / 2);
    state = data.state;
    render();
  } catch {
    // offline for a moment — keep showing the last known state, which keeps counting correctly
  }
}

render();
fit();
window.addEventListener('resize', fit);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit); // web font changes digit widths
setInterval(render, 250);
resync();
setInterval(resync, 30000); // catches clock drift and any message a dropped socket might have missed

new ReconnectingSocket({
  channel: initial.channel || 'gta6-timer',
  onOpen: resync,
  onMessage(msg) {
    if (msg && msg.type === 'gta6:timer' && msg.state) {
      state = msg.state;
      render();
    }
  },
});
