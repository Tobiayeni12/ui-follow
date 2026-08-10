import { FollowerScene } from './scene.js';
import { ReconnectingSocket } from './wsClient.js';

const initial = window.__INITIAL_STATE__;

const canvas = document.getElementById('scene');
const followersEl = document.getElementById('followersLabel');
const gainEl = document.getElementById('gainLabel');
const goalLabelEl = document.getElementById('goalLabel');

let currentAnimationSpeed = initial.animationSpeed || 1;
let gainTimer = null;

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
        if (msg.data.followerGoal) scene.setGoal(msg.data.followerGoal);
        break;
      default:
        break;
    }
  },
});
