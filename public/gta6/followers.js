import { ReconnectingSocket } from '/overlay/wsClient.js';
import { renderDigits, fitToViewport } from '/gta6/digits.js';

// A second skin for the same follower feed the original /overlay uses: same
// store, same goal, same 'live'/'preview' WebSocket channels and message
// types — nothing about how followers are counted lives here, this page only
// draws them.

const raw = window.__INITIAL_STATE__;
const initial = raw && typeof raw === 'object' ? raw : {};

const widget = document.getElementById('followersWidget');
const glow = document.getElementById('followersGlow');
const countEl = document.getElementById('followersCount');
const gainsEl = document.getElementById('followersGains');
const goalFill = document.getElementById('goalFill');
const goalText = document.getElementById('goalText');
const goalPct = document.getElementById('goalPct');

const fmt = (n) => Math.round(n).toLocaleString('en-US');

let shown = Number(initial.count) || 0; // what's on screen right now (mid-tween it's fractional)
let goal = Number(initial.goal) || 0;
let raf = 0;

function fit() {
  fitToViewport(widget);
}

function drawGoal() {
  const pct = goal > 0 ? Math.min(100, (shown / goal) * 100) : 0;
  goalFill.style.setProperty('--rest', `${(100 - pct).toFixed(3)}%`);
  const reached = goal > 0 && Math.round(shown) >= goal;
  goalText.textContent = reached ? 'Goal reached' : `Goal ${fmt(goal)}`;
  goalPct.textContent = `${Math.floor(pct)}%`;
  widget.classList.toggle('reached', reached);
}

function drawCount() {
  if (renderDigits(countEl, fmt(shown))) fit();
  drawGoal();
}

/** Roll the number up (or down) to `next`; bigger jumps take a little longer. */
function tweenTo(next) {
  const from = shown;
  cancelAnimationFrame(raf);
  if (from === next) return;
  const duration = Math.min(1600, Math.max(650, Math.abs(next - from) * 40));
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    shown = p < 1 ? from + (next - from) * eased : next;
    drawCount();
    if (p < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}

function restart(el, cls) {
  el.classList.remove(cls);
  // eslint-disable-next-line no-unused-expressions
  el.offsetWidth; // restart the animation if it's mid-run
  el.classList.add(cls);
}

function celebrate(delta) {
  restart(countEl, 'pop');
  restart(glow, 'pop');

  const el = document.createElement('div');
  el.className = 'g6-gain';
  el.textContent = `+${fmt(delta)}`;
  gainsEl.appendChild(el);
  // self-cleaning, with a timer as a backstop in case the animation never
  // fires (e.g. a throttled/hidden browser source)
  const remove = () => el.remove();
  el.addEventListener('animationend', remove, { once: true });
  setTimeout(remove, 2500);
}

drawCount();
fit();
window.addEventListener('resize', fit);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);

// After any socket drop, re-read the real number so a missed update can't
// leave the overlay stuck on a stale count.
async function resync() {
  try {
    const res = await fetch('/api/followers', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (Number.isFinite(data.goal) && data.goal > 0) goal = data.goal;
    if (Number.isFinite(data.count)) tweenTo(data.count);
    drawGoal();
  } catch {
    // keep showing the last known count
  }
}

new ReconnectingSocket({
  channel: initial.channel || 'live',
  onOpen: resync,
  onMessage(msg) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'follower_update': {
        const d = msg.data || {};
        if (Number.isFinite(d.goal) && d.goal > 0) goal = d.goal;
        if (Number.isFinite(d.newCount)) tweenTo(d.newCount);
        if (d.delta > 0) celebrate(d.delta);
        break;
      }
      case 'count_sync': {
        // quiet correction (e.g. an unfollow) — update the number, no fanfare
        const d = msg.data || {};
        if (Number.isFinite(d.goal) && d.goal > 0) goal = d.goal;
        if (Number.isFinite(d.newCount)) tweenTo(d.newCount);
        break;
      }
      case 'settings_update': {
        const g = msg.data && Number(msg.data.followerGoal);
        if (Number.isFinite(g) && g > 0) {
          goal = g;
          drawGoal();
        }
        break;
      }
      default:
        break;
    }
  },
});
