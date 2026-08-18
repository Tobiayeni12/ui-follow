import { ReconnectingSocket } from '/overlay/wsClient.js';

// The loop was originally tuned at 34s for a 1x "speed" — higher speed
// values shorten the loop (faster scroll), lower values lengthen it.
const BASE_DURATION_S = 34;

const initialState = window.__INITIAL_STATE__ || {};
const track = document.querySelector('.ticker-track');

function applySpeed(speed) {
  const s = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const duration = BASE_DURATION_S / s;
  track.style.setProperty('--duration', `${duration}s`);
}

applySpeed(initialState.settings?.speed);

new ReconnectingSocket({
  channel: initialState.channel || 'giftdares',
  onMessage(msg) {
    if (msg?.type === 'giftdares:settings') {
      applySpeed(msg.settings?.speed);
    }
  },
});
