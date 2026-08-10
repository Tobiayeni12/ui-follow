import { ReconnectingSocket } from '/overlay/wsClient.js';
import { THEMES } from '/overlay/themes.js';

const THEME_OPTIONS = Object.entries(THEMES).map(([key, theme]) => [key, theme.label]);

// Must match server/services/settingsStore.js CSS_FONT_KEYS / THREE_FONT_KEYS.
const CSS_FONT_OPTIONS = [
  ['arial-black', 'Arial Black (default)'],
  ['arial', 'Arial'],
  ['georgia', 'Georgia (serif)'],
  ['courier', 'Courier New (monospace)'],
  ['impact', 'Impact (condensed)'],
  ['verdana', 'Verdana'],
  ['trebuchet', 'Trebuchet MS'],
  ['comic', 'Comic Sans MS'],
];
const THREE_FONT_OPTIONS = [
  ['helvetiker-bold', 'Helvetiker Bold (default)'],
  ['helvetiker-regular', 'Helvetiker Regular'],
  ['optimer-bold', 'Optimer Bold (rounded)'],
  ['optimer-regular', 'Optimer Regular (rounded)'],
  ['gentilis-bold', 'Gentilis Bold (serif)'],
  ['gentilis-regular', 'Gentilis Regular (serif)'],
  ['droid-sans-bold', 'Droid Sans Bold'],
  ['droid-serif-bold', 'Droid Serif Bold'],
  ['droid-sans-mono-regular', 'Droid Sans Mono (monospace)'],
];

const $ = (id) => document.getElementById(id);

function populateSelect(el, options) {
  el.innerHTML = options.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
}

const statCount = $('statCount');
const statGoal = $('statGoal');
const progressFill = $('progressFill');
const percentText = $('percentText');
const modeBadge = $('modeBadge');
const tiktokBadge = $('tiktokBadge');
const tiktokHelp = $('tiktokHelp');
const connectBtn = $('connectBtn');
const disconnectBtn = $('disconnectBtn');
const goalInput = $('goalInput');
const overlayUrl = $('overlayUrl');
const setCountInput = $('setCountInput');
const allowLiveTestToggle = $('allowLiveTestToggle');
const particlesToggle = $('particlesToggle');
const speedRange = $('speedRange');
const rotationRange = $('rotationRange');
const scaleRange = $('scaleRange');
const counterFontSelect = $('counterFontSelect');
const titleSizeRange = $('titleSizeRange');
const titleFontSelect = $('titleFontSelect');
const goalSizeRange = $('goalSizeRange');
const goalFontSelect = $('goalFontSelect');
const themeSelect = $('themeSelect');
const toast = $('toast');

populateSelect(counterFontSelect, THREE_FONT_OPTIONS);
populateSelect(titleFontSelect, CSS_FONT_OPTIONS);
populateSelect(goalFontSelect, CSS_FONT_OPTIONS);
populateSelect(themeSelect, THEME_OPTIONS);

let goal = 2000;

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1800);
}

function updateStats(count) {
  statCount.textContent = count.toLocaleString('en-US');
  statGoal.textContent = `/ ${goal.toLocaleString('en-US')}`;
  const pct = goal > 0 ? Math.min(100, (count / goal) * 100) : 0;
  progressFill.style.width = `${pct}%`;
  percentText.textContent = `${Math.round(pct * 10) / 10}%`;
}

async function api(path, opts) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

async function loadState() {
  const state = await api('/dashboard/state');
  goal = state.settings.followerGoal;

  modeBadge.textContent = state.demoMode ? 'DEMO MODE' : 'LIVE MODE';
  modeBadge.classList.toggle('on', state.demoMode);

  tiktokBadge.textContent = state.tiktokConnected ? 'TikTok connected' : 'TikTok not connected';
  tiktokBadge.classList.toggle('on', state.tiktokConnected);
  connectBtn.style.display = state.tiktokConnected ? 'none' : 'inline-block';
  disconnectBtn.style.display = state.tiktokConnected ? 'inline-block' : 'none';
  tiktokHelp.textContent = state.tiktokConnected
    ? 'Connected. The server polls TikTok periodically and updates the overlay automatically.'
    : state.demoMode
    ? 'DEMO_MODE is on — connect TikTok when you are ready to go live (this will not affect your demo visuals).'
    : 'Not connected. Click "Connect TikTok account" to authorize this app.';

  goalInput.value = goal;
  setCountInput.value = state.count;
  allowLiveTestToggle.checked = !!state.settings.allowTestOnLiveOverlay;
  particlesToggle.checked = !!state.settings.particlesEnabled;
  speedRange.value = state.settings.animationSpeed;
  rotationRange.value = state.settings.rotationIntensity;
  scaleRange.value = state.settings.counterScale;
  counterFontSelect.value = state.settings.counterFont;
  titleSizeRange.value = state.settings.titleFontScale;
  titleFontSelect.value = state.settings.titleFont;
  goalSizeRange.value = state.settings.goalFontScale;
  goalFontSelect.value = state.settings.goalFont;
  themeSelect.value = state.settings.theme;
  syncRangeLabels();

  updateStats(state.count);
}

function syncRangeLabels() {
  $('speedValue').textContent = `${parseFloat(speedRange.value).toFixed(1)}x`;
  $('rotationValue').textContent = `${parseFloat(rotationRange.value).toFixed(1)}x`;
  $('scaleValue').textContent = `${parseFloat(scaleRange.value).toFixed(2)}x`;
  $('titleSizeValue').textContent = `${parseFloat(titleSizeRange.value).toFixed(1)}x`;
  $('goalSizeValue').textContent = `${parseFloat(goalSizeRange.value).toFixed(1)}x`;
}

overlayUrl.textContent = `${location.origin}/overlay`;
$('copyUrlBtn').addEventListener('click', async () => {
  await navigator.clipboard.writeText(`${location.origin}/overlay`);
  showToast('Overlay URL copied to clipboard');
});

$('logoutLink').addEventListener('click', async (e) => {
  e.preventDefault();
  await fetch('/dashboard/logout', { method: 'POST' });
  location.href = '/dashboard/login';
});

disconnectBtn.addEventListener('click', async () => {
  if (!confirm('Disconnect this TikTok account? Polling will stop until you reconnect.')) return;
  await api('/dashboard/tiktok/disconnect', { method: 'POST' });
  showToast('TikTok disconnected');
  loadState();
});

$('saveGoalBtn').addEventListener('click', async () => {
  const value = parseInt(goalInput.value, 10);
  if (!Number.isFinite(value) || value <= 0) return showToast('Enter a valid goal');
  const updated = await api('/dashboard/settings', {
    method: 'POST',
    body: JSON.stringify({ followerGoal: value }),
  });
  goal = updated.followerGoal;
  updateStats(parseInt(statCount.textContent.replace(/,/g, ''), 10) || 0);
  showToast('Goal saved');
});

document.querySelectorAll('button[data-amount]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    await api('/dashboard/test/increment', {
      method: 'POST',
      body: JSON.stringify({ amount: parseInt(btn.dataset.amount, 10) }),
    });
  });
});

$('setCountBtn').addEventListener('click', async () => {
  const value = parseInt(setCountInput.value, 10);
  if (!Number.isFinite(value) || value < 0) return showToast('Enter a valid count');
  await api('/dashboard/test/set', { method: 'POST', body: JSON.stringify({ count: value }) });
});

$('resetBtn').addEventListener('click', async () => {
  await api('/dashboard/test/reset', { method: 'POST' });
});

async function pushSettings(partial) {
  await api('/dashboard/settings', { method: 'POST', body: JSON.stringify(partial) });
}

allowLiveTestToggle.addEventListener('change', () => {
  pushSettings({ allowTestOnLiveOverlay: allowLiveTestToggle.checked });
});
particlesToggle.addEventListener('change', () => {
  pushSettings({ particlesEnabled: particlesToggle.checked });
});
speedRange.addEventListener('input', () => {
  syncRangeLabels();
  pushSettings({ animationSpeed: parseFloat(speedRange.value) });
});
rotationRange.addEventListener('input', () => {
  syncRangeLabels();
  pushSettings({ rotationIntensity: parseFloat(rotationRange.value) });
});
scaleRange.addEventListener('input', () => {
  syncRangeLabels();
  pushSettings({ counterScale: parseFloat(scaleRange.value) });
});
counterFontSelect.addEventListener('change', () => {
  pushSettings({ counterFont: counterFontSelect.value });
});
titleSizeRange.addEventListener('input', () => {
  syncRangeLabels();
  pushSettings({ titleFontScale: parseFloat(titleSizeRange.value) });
});
titleFontSelect.addEventListener('change', () => {
  pushSettings({ titleFont: titleFontSelect.value });
});
goalSizeRange.addEventListener('input', () => {
  syncRangeLabels();
  pushSettings({ goalFontScale: parseFloat(goalSizeRange.value) });
});
goalFontSelect.addEventListener('change', () => {
  pushSettings({ goalFont: goalFontSelect.value });
});
themeSelect.addEventListener('change', () => {
  pushSettings({ theme: themeSelect.value });
});

// Keep the dashboard's own stat readout live (mirrors the preview channel,
// which always receives real TikTok data plus test-driven updates).
new ReconnectingSocket({
  channel: 'preview',
  onMessage(msg) {
    if (msg.type === 'follower_update' || msg.type === 'count_sync') {
      if (msg.data.goal) goal = msg.data.goal;
      updateStats(msg.data.newCount);
      setCountInput.value = msg.data.newCount;
    } else if (msg.type === 'settings_update') {
      if (msg.data.followerGoal) {
        goal = msg.data.followerGoal;
        goalInput.value = goal;
        updateStats(parseInt(statCount.textContent.replace(/,/g, ''), 10) || 0);
      }
    }
  },
});

loadState().catch((err) => {
  console.error(err);
  showToast('Failed to load dashboard state');
});
