import { FollowerScene } from './scene.js';
import { ReconnectingSocket } from './wsClient.js';

// Generic, system-safe CSS font families — must match server/services/settingsStore.js CSS_FONT_KEYS.
const CSS_FONTS = {
  'arial-black': "'Arial Black', Arial, Helvetica, sans-serif",
  arial: "Arial, Helvetica, sans-serif",
  georgia: "Georgia, 'Times New Roman', serif",
  courier: "'Courier New', Courier, monospace",
  impact: "Impact, 'Arial Narrow', sans-serif",
  verdana: "Verdana, Geneva, sans-serif",
  trebuchet: "'Trebuchet MS', sans-serif",
  comic: "'Comic Sans MS', cursive, sans-serif",
};

const TITLE_BASE_SIZE = 'clamp(13px, 2.1vh, 26px)';
const GOAL_BASE_SIZE = 'clamp(12px, 1.8vh, 20px)';

const initial = window.__INITIAL_STATE__;

const canvas = document.getElementById('scene');
const followersEl = document.getElementById('followersLabel');
const gainEl = document.getElementById('gainLabel');
const goalLabelEl = document.getElementById('goalLabel');

let currentAnimationSpeed = initial.animationSpeed || 1;
let gainTimer = null;

function applyTextStyle(el, fontKey, scale, baseSize) {
  el.style.fontFamily = CSS_FONTS[fontKey] || CSS_FONTS['arial-black'];
  el.style.fontSize = `calc(${scale || 1} * ${baseSize})`;
}

function applyLabelSettings(settings) {
  applyTextStyle(followersEl, settings.titleFont, settings.titleFontScale, TITLE_BASE_SIZE);
  applyTextStyle(goalLabelEl, settings.goalFont, settings.goalFontScale, GOAL_BASE_SIZE);
}

function onLabel(evt) {
  if (evt.type === 'progress') {
    goalLabelEl.textContent = `Goal: ${evt.goal}`;
  } else if (evt.type === 'gain') {
    gainEl.textContent = evt.text;
    gainEl.classList.add('show');
    clearTimeout(gainTimer);
    const holdMs = 1100 / Math.max(0.25, currentAnimationSpeed);
    gainTimer = setTimeout(() => gainEl.classList.remove('show'), holdMs);
  }
}

applyLabelSettings(initial);

const scene = new FollowerScene(canvas, { onLabel });

scene
  .init({
    count: initial.count,
    goal: initial.goal,
    settings: {
      particlesEnabled: initial.particlesEnabled,
      animationSpeed: initial.animationSpeed,
      rotationIntensity: initial.rotationIntensity,
      counterScale: initial.counterScale,
      counterFont: initial.counterFont,
    },
  })
  .then(() => {
    followersEl.style.opacity = '0.92';
  })
  .catch((err) => {
    console.error('Failed to initialize 3D scene:', err);
  });

new ReconnectingSocket({
  channel: initial.channel || 'live',
  onMessage(msg) {
    switch (msg.type) {
      case 'follower_update':
        scene.handleFollowerUpdate(msg.data);
        break;
      case 'count_sync':
        scene.handleCountSync(msg.data);
        break;
      case 'settings_update':
        currentAnimationSpeed = msg.data.animationSpeed ?? currentAnimationSpeed;
        scene.applySettings(msg.data);
        applyLabelSettings(msg.data);
        if (msg.data.followerGoal) scene.setGoal(msg.data.followerGoal);
        break;
      default:
        break;
    }
  },
});
