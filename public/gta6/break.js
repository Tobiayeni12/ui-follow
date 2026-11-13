import { ReconnectingSocket } from '/overlay/wsClient.js';
import { renderDigits, fitToViewport } from '/gta6/digits.js';

// "Be right back": shows a break countdown while the streamer is away. The
// countdown is derived from the break's end time and the server's clock, so
// refreshing the source or a server restart can't change it. It stays up past
// zero until the streamer ends the break (they may be a minute late).

const raw = window.__INITIAL_STATE__;
const initial = raw && typeof raw === 'object' ? raw : {};

const stage = document.getElementById('stage');
const widget = document.getElementById('brkWidget');
const titleRow = document.getElementById('brkTitleRow');
const titleEl = document.getElementById('brkTitle');
const digitsEl = document.getElementById('brkDigits');
const messageEl = document.getElementById('brkMessage');
const subEl = document.getElementById('brkSub');
const hintEl = document.getElementById('brkHint');

const isPreview = !!initial.preview;
let state = initial.state || { active: false };
let settings = { ...(initial.settings || {}) };
let offset = (initial.serverTime || Date.now()) - Date.now(); // server clock − this clock

const pad = (n) => String(n).padStart(2, '0');
function format(ms) {
  const s = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

function fit() {
  fitToViewport(widget);
}

function applySettings() {
  stage.dataset.palette = settings.palette || 'sunset';
  stage.dataset.cover = settings.cover || 'full';
  stage.style.setProperty('--brk-scale', String((settings.size || 100) / 100));
  const title = settings.title || '';
  titleEl.textContent = title;
  titleRow.hidden = !title;
}

function render() {
  const active = !!state.active;
  stage.classList.toggle('is-off', !active);
  stage.classList.toggle('preview', isPreview);
  hintEl.hidden = !(isPreview && !active);
  if (!active) return;
  const remaining = state.endsAt - (Date.now() + offset);
  const over = remaining <= 0;
  if (renderDigits(digitsEl, format(remaining))) fit();
  widget.classList.toggle('over', over);
  if (messageEl.textContent !== (state.message || '')) {
    messageEl.textContent = state.message || '';
    fit();
  }
  const sub = over ? 'Any second now…' : '';
  if (subEl.textContent !== sub) subEl.textContent = sub;
}

function setState(next, serverTime) {
  state = next;
  if (Number.isFinite(serverTime)) offset = serverTime - Date.now();
  render();
}

applySettings();
render();
setInterval(render, 250);
window.addEventListener('resize', fit);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);

// after a socket drop, re-read the real state
async function resync() {
  try {
    const res = await fetch('/api/gta6/break', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    settings = { ...settings, ...(data.settings || {}) };
    applySettings();
    setState(data.state, data.serverTime);
  } catch {
    // keep what we have
  }
}

new ReconnectingSocket({
  channel: initial.channel || 'gta6-break',
  onOpen: resync,
  onMessage(msg) {
    if (!msg || msg.type !== 'gta6:break') return;
    settings = { ...settings, ...(msg.settings || {}) };
    applySettings();
    setState(msg.state, msg.serverTime);
  },
});
