import { ReconnectingSocket } from '/overlay/wsClient.js';
import { fitToViewport } from '/gta6/digits.js';

// "Now / up next" for the stream schedule. The schedule's clock is the stream
// timer's clock (elapsed time), derived from the timer state + the server's
// clock exactly like /gta6/timer — so it pauses when the timer pauses, shifts
// when you nudge the timer, and survives refreshes and restarts.

const raw = window.__INITIAL_STATE__;
const initial = raw && typeof raw === 'object' ? raw : {};

const stage = document.getElementById('stage');
const widget = document.getElementById('schWidget');
const clockEl = document.getElementById('schClock');
const nowEl = document.getElementById('schNow');
const kickerEl = document.getElementById('schKicker');
const titleEl = document.getElementById('schTitle');
const noteEl = document.getElementById('schNote');
const progEl = document.getElementById('schProg');
const fillEl = document.getElementById('schFill');
const leftEl = document.getElementById('schLeft');
const pctEl = document.getElementById('schPct');
const loneEl = document.getElementById('schLone');
const nextEl = document.getElementById('schNext');
const listEl = document.getElementById('schList');
const hintEl = document.getElementById('schHint');

const MIN = 60 * 1000;
const isPreview = !!initial.preview;

let blocks = Array.isArray(initial.blocks) ? initial.blocks : [];
let settings = { ...(initial.settings || {}) };
let timer = initial.timer || { mode: 'countdown', durationMs: 24 * 3600 * 1000, elapsedMs: 0, startedAt: null, status: 'idle' };
let offset = (initial.serverTime || Date.now()) - Date.now(); // server clock − this clock

const pad = (n) => String(n).padStart(2, '0');
const hms = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};
const hmsClock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};
const hm = (min) => `${Math.floor(min / 60)}:${pad(min % 60)}`;

function elapsedAt(s, now) {
  const running = s.status === 'running' && Number.isFinite(s.startedAt);
  const total = s.elapsedMs + (running ? Math.max(0, now - s.startedAt) : 0);
  return s.mode === 'countdown' ? Math.min(total, s.durationMs) : total;
}

function fit() {
  fitToViewport(widget);
}

function applySettings() {
  stage.dataset.palette = settings.palette || 'sunset';
  stage.dataset.align = settings.align || 'left';
  stage.style.setProperty('--sch-scale', String((settings.size || 100) / 100));
}

// What the overlay shows depends on the clock only through these few things,
// so the DOM is rebuilt only when they change (not every tick).
let lastKey = '';
const rowEls = new Map();

function setText(el, value) {
  if (el.textContent !== value) el.textContent = value;
}

function render() {
  const elapsed = elapsedAt(timer, Date.now() + offset);
  const total = blocks.length;
  stage.classList.toggle('is-off', total === 0 && !isPreview);
  hintEl.hidden = !(total === 0 && isPreview);
  nowEl.hidden = nextEl.hidden = total === 0;
  clockEl.hidden = settings.showClock === false || total === 0;
  setText(clockEl, hmsClock(elapsed));
  if (!total) return;

  const endMs = timer.mode === 'countdown' ? timer.durationMs : null;
  const finished = endMs !== null && timer.status !== 'idle' && elapsed >= endMs;
  let idx = -1;
  blocks.forEach((b, i) => {
    if (b.startMin * MIN <= elapsed) idx = i;
  });

  const upcomingCount = settings.upcoming || 3;
  const upcoming = finished ? [] : blocks.slice(idx + 1, idx + 1 + upcomingCount);
  const current = idx >= 0 && !finished ? blocks[idx] : null;
  const headline = finished
    ? { kicker: 'Complete', title: "That's a wrap", note: '' }
    : current
      ? { kicker: 'Now', title: current.title, note: current.note }
      : { kicker: 'Coming up', title: blocks[0].title, note: blocks[0].note };

  // structural change → swap text with a short fade and rebuild the list
  const key = JSON.stringify([headline, upcoming.map((b) => b.id), settings.showProgress, finished]);
  if (key !== lastKey) {
    const first = lastKey === '';
    const apply = () => {
      kickerEl.textContent = headline.kicker;
      titleEl.textContent = headline.title;
      noteEl.textContent = headline.note;
      noteEl.hidden = !headline.note;
      titleEl.classList.remove('swap');
      noteEl.classList.remove('swap');
      renderList(upcoming, first);
      fit();
    };
    lastKey = key;
    if (first) apply();
    else {
      titleEl.classList.add('swap');
      noteEl.classList.add('swap');
      setTimeout(apply, 200);
    }
  }
  nextEl.hidden = upcoming.length === 0;

  // progress through the current block, and countdowns
  const nextStart = idx + 1 < total ? blocks[idx + 1].startMin * MIN : null;
  const blockEnd = nextStart !== null ? nextStart : endMs;
  const showProg = settings.showProgress !== false && current && blockEnd !== null && blockEnd > current.startMin * MIN;
  progEl.hidden = !showProg;
  loneEl.hidden = true;
  if (showProg) {
    const start = current.startMin * MIN;
    const pct = Math.min(100, Math.max(0, ((elapsed - start) / (blockEnd - start)) * 100));
    fillEl.style.setProperty('--rest', `${(100 - pct).toFixed(2)}%`);
    setText(leftEl, `Ends in ${hms(blockEnd - elapsed)}`);
    setText(pctEl, `${Math.floor(pct)}%`);
  } else if (!current && !finished) {
    loneEl.hidden = false;
    setText(loneEl, `Starts in ${hms(blocks[0].startMin * MIN - elapsed)}`);
  }

  // "in 1:23:10" on the first upcoming row
  const inEl = listEl.querySelector('.sch-row-in');
  if (inEl && upcoming[0]) setText(inEl, `in ${hms(upcoming[0].startMin * MIN - elapsed)}`);
}

function renderList(upcoming, first) {
  const seen = new Set();
  upcoming.forEach((b, i) => {
    seen.add(b.id);
    let row = rowEls.get(b.id);
    if (!row) {
      row = document.createElement('li');
      row.className = 'sch-row';
      row.innerHTML = '<span class="sch-row-time"></span><span class="sch-row-title"></span>';
      rowEls.set(b.id, row);
      if (!first) row.classList.add('enter');
    }
    row.querySelector('.sch-row-time').textContent = hm(b.startMin);
    row.querySelector('.sch-row-title').textContent = b.title;
    row.querySelector('.sch-row-in')?.remove();
    if (i === 0) {
      const inEl = document.createElement('span');
      inEl.className = 'sch-row-in';
      row.appendChild(inEl);
    }
    if (listEl.children[i] !== row) listEl.insertBefore(row, listEl.children[i] || null);
  });
  for (const [id, row] of rowEls) {
    if (!seen.has(id)) {
      row.remove();
      rowEls.delete(id);
    }
  }
}

applySettings();
render();
setInterval(render, 250);
window.addEventListener('resize', fit);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);

function setTimer(state, serverTime) {
  timer = state;
  if (Number.isFinite(serverTime)) offset = serverTime - Date.now();
  render();
}

// After any socket drop, re-read both so a missed update can't leave the
// schedule stale or the clock wrong.
async function resync() {
  try {
    const [s, t] = await Promise.all([
      fetch('/api/gta6/schedule', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/gta6/timer', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
    ]);
    if (s) {
      blocks = s.blocks || blocks;
      settings = { ...settings, ...(s.settings || {}) };
      applySettings();
    }
    if (t && t.state) setTimer(t.state, t.serverTime);
    else render();
  } catch {
    // keep what we have
  }
}

new ReconnectingSocket({
  channel: initial.channel || 'gta6-schedule',
  onOpen: resync,
  onMessage(msg) {
    if (!msg || msg.type !== 'gta6:schedule') return;
    blocks = msg.blocks || [];
    settings = { ...settings, ...(msg.settings || {}) };
    applySettings();
    render();
  },
});

// the timer has its own channel (no preview variant) — listen for its changes
new ReconnectingSocket({
  channel: 'gta6-timer',
  onMessage(msg) {
    if (msg && msg.type === 'gta6:timer' && msg.state) setTimer(msg.state, msg.serverTime);
  },
});
