import { ReconnectingSocket } from '/overlay/wsClient.js';
import { fitToViewport } from '/gta6/digits.js';

// Draws a banner when the server says a milestone was reached. Nothing here
// decides WHEN — the server does (see server/services/gta6Milestones.js), so
// refreshing or duplicating this browser source can't repeat or skip one.
// If banners arrive close together they queue and play one after another.

const raw = window.__INITIAL_STATE__;
const initial = raw && typeof raw === 'object' ? raw : {};

const stage = document.getElementById('stage');
const bnr = document.getElementById('bnr');
const kickerEl = document.getElementById('bnrKicker');
const titleEl = document.getElementById('bnrTitle');
const subEl = document.getElementById('bnrSub');
const hintEl = document.getElementById('bnrHint');

const isPreview = !!initial.preview;
const MAX_QUEUE = 5;
const queue = [];
let showing = false;

// Shrink (never grow) the banner to fit the browser source. It's measured at
// full size each time, otherwise the shrunken size would be measured instead.
function refit() {
  bnr.style.removeProperty('--fit');
  fitToViewport(bnr);
}

function applySettings(s) {
  stage.dataset.palette = s.palette || 'sunset';
  stage.dataset.position = s.position || 'center';
  stage.style.setProperty('--bnr-scale', String((s.size || 100) / 100));
}
applySettings(initial.settings || {});
hintEl.hidden = !isPreview;

function play({ banner, seconds }) {
  showing = true;
  hintEl.hidden = true;
  kickerEl.textContent = banner.kicker || '';
  titleEl.textContent = banner.title || '';
  subEl.textContent = banner.subtitle || '';
  bnr.hidden = false;
  bnr.classList.remove('out');
  bnr.classList.add('in');
  refit();
  setTimeout(() => {
    bnr.classList.remove('in');
    bnr.classList.add('out');
    setTimeout(() => {
      bnr.hidden = true;
      bnr.classList.remove('out');
      showing = false;
      if (queue.length) play(queue.shift());
      else hintEl.hidden = !isPreview;
    }, 600);
  }, Math.max(3, seconds || 8) * 1000);
}

function enqueue(message) {
  if (!message || !message.banner) return;
  if (showing) {
    if (queue.length < MAX_QUEUE) queue.push(message);
  } else {
    play(message);
  }
}

window.addEventListener('resize', () => !bnr.hidden && refit());
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => !bnr.hidden && refit());

// look settings can change while connected; re-read them after a drop
async function resync() {
  try {
    const res = await fetch('/api/gta6/banner', { cache: 'no-store' });
    if (res.ok) applySettings((await res.json()).settings || {});
  } catch {
    // keep what we have
  }
}

new ReconnectingSocket({
  channel: initial.channel || 'gta6-banner',
  onOpen: resync,
  onMessage(msg) {
    if (!msg) return;
    if (msg.type === 'gta6:banner') enqueue(msg);
    else if (msg.type === 'gta6:banner_settings') applySettings(msg.settings || {});
  },
});
