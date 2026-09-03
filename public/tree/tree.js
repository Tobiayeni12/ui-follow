import { ReconnectingSocket } from '/overlay/wsClient.js';

const initialState = window.__INITIAL_STATE__ || {};

const stage = document.getElementById('stage');
const treeArt = document.getElementById('treeArt');
const barFill = document.getElementById('treeBarFill');
const levelEl = document.getElementById('treeLevel');
const pctEl = document.getElementById('treePct');
const toastEl = document.getElementById('treeToast');
const burstEl = document.getElementById('treeBurst');
const stageSvgs = Array.from(document.querySelectorAll('.stage-svg'));

let settings = initialState.settings || {};
let state = initialState.state || { currentLevel: 1, currentGrowth: 0, thresholdForCurrentLevel: 100, stage: 0 };

function applySettings(next) {
  settings = next || settings;
  stage.dataset.position = settings.position || 'bottom-right';
  document.documentElement.style.setProperty('--tree-scale', settings.scale || 1);
}
applySettings(settings);

function setActiveStage(stageIndex) {
  stageSvgs.forEach((svg) => {
    svg.classList.toggle('active', Number(svg.dataset.stage) === stageIndex);
  });
}

function renderState({ animateBar = true } = {}) {
  const pct = state.thresholdForCurrentLevel
    ? Math.max(0, Math.min(100, (state.currentGrowth / state.thresholdForCurrentLevel) * 100))
    : 0;
  if (!animateBar) barFill.style.transition = 'none';
  barFill.style.width = `${pct}%`;
  if (!animateBar) {
    // eslint-disable-next-line no-unused-expressions
    barFill.offsetHeight; // force reflow so the transition re-enables cleanly
    barFill.style.transition = '';
  }
  levelEl.textContent = state.currentLevel;
  pctEl.textContent = `${Math.round(pct)}%`;
  setActiveStage(state.stage ?? 0);
}
renderState({ animateBar: false });

// ------------------------------------------------------------ animations

let toastTimer = null;
function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
}

const BURST_GLYPHS = ['🍃', '✨', '🌿', '💫'];

/** Growth-sized particle burst — bigger gifts get more particles, but the
 * spread always stays close to the widget itself (never a screen-wide
 * effect, per the "don't interfere with the stream" requirement). */
function spawnBurst(amount) {
  let count;
  if (amount >= 30) count = 16;
  else if (amount >= 10) count = 10;
  else if (amount >= 3) count = 6;
  else count = 3;

  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'burst-particle';
    el.textContent = BURST_GLYPHS[Math.floor(Math.random() * BURST_GLYPHS.length)];
    const angle = Math.random() * Math.PI * 2;
    const dist = 30 + Math.random() * 45;
    el.style.setProperty('--tx', `${Math.cos(angle) * dist}px`);
    el.style.setProperty('--ty', `${Math.sin(angle) * dist - 20}px`);
    el.style.setProperty('--rot', `${(Math.random() - 0.5) * 90}deg`);
    el.style.setProperty('--size', `${12 + Math.random() * 10}px`);
    el.style.setProperty('--dur', `${700 + Math.random() * 500}ms`);
    el.style.setProperty('--delay', `${Math.random() * 150}ms`);
    // Self-removing: each particle cleans up its own listener/element once
    // its animation finishes, so a busy stream can never accumulate stale
    // nodes no matter how many gifts arrive.
    el.addEventListener(
      'animationend',
      () => {
        el.remove();
      },
      { once: true }
    );
    burstEl.appendChild(el);
  }
}

function playGrowthPulse() {
  treeArt.classList.remove('pulse');
  // eslint-disable-next-line no-unused-expressions
  treeArt.offsetWidth; // restart the animation if it's already mid-pulse
  treeArt.classList.add('pulse');
  setTimeout(() => treeArt.classList.remove('pulse'), 950);
}

function playEvolvePop() {
  treeArt.classList.remove('evolving');
  // eslint-disable-next-line no-unused-expressions
  treeArt.offsetWidth;
  treeArt.classList.add('evolving');
  setTimeout(() => treeArt.classList.remove('evolving'), 950);
}

function bumpLevelLabel() {
  levelEl.classList.remove('bump');
  // eslint-disable-next-line no-unused-expressions
  levelEl.offsetWidth;
  levelEl.classList.add('bump');
}

function emojiForAmount(amount) {
  if (amount >= 30) return '✨';
  if (amount >= 10) return '🌿';
  return '🌹';
}

// ------------------------------------------------------------ WS handling

new ReconnectingSocket({
  channel: initialState.channel || 'tree',
  onMessage(msg) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'tree:growth': {
        state = msg.state;
        renderState();
        if (msg.amount > 0) {
          playGrowthPulse();
          spawnBurst(msg.amount);
        }
        if (msg.leveledUp) bumpLevelLabel();
        if (msg.stageChanged) playEvolvePop();
        if (msg.username) {
          const emoji = emojiForAmount(msg.amount);
          const bang = msg.amount >= 30 ? '!' : '';
          showToast(`${emoji} @${msg.username} grew the tree +${msg.amount}${bang}`);
        }
        break;
      }
      case 'tree:reset': {
        state = { currentLevel: 1, currentGrowth: 0, thresholdForCurrentLevel: 100, stage: 0 };
        renderState({ animateBar: false });
        break;
      }
      case 'tree:settings': {
        applySettings(msg.settings);
        break;
      }
      default:
        break;
    }
  },
});
