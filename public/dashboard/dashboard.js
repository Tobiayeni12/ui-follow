import { ReconnectingSocket } from '/overlay/wsClient.js';
import { THEMES } from '/overlay/themes.js';

const THEME_OPTIONS = Object.entries(THEMES).map(([key, theme]) => [key, theme.label]);

// Must match server/services/settingsStore.js ANIMATION_STYLE_KEYS.
const ANIMATION_STYLE_OPTIONS = [
  ['default', 'Glow & Particles (default)'],
  ['web', 'Web Shot'],
];

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
const animationStyleSelect = $('animationStyleSelect');
const toast = $('toast');

populateSelect(counterFontSelect, THREE_FONT_OPTIONS);
populateSelect(titleFontSelect, CSS_FONT_OPTIONS);
populateSelect(goalFontSelect, CSS_FONT_OPTIONS);
populateSelect(themeSelect, THEME_OPTIONS);
populateSelect(animationStyleSelect, ANIMATION_STYLE_OPTIONS);

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
  animationStyleSelect.value = state.settings.animationStyle;
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
  towerAllowLiveTestToggle.checked = allowLiveTestToggle.checked;
  treeAllowLiveTestToggle.checked = allowLiveTestToggle.checked;
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
animationStyleSelect.addEventListener('change', () => {
  pushSettings({ animationStyle: animationStyleSelect.value });
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

// ------------------------------------------------------------ objectives

const objectivesUrlEl = $('objectivesUrl');
const newObjectiveInput = $('newObjectiveInput');
const objectivesListEl = $('objectivesList');
const objectivesEmptyText = $('objectivesEmptyText');

objectivesUrlEl.textContent = `${location.origin}/objectives`;
$('copyObjectivesUrlBtn').addEventListener('click', async () => {
  await navigator.clipboard.writeText(`${location.origin}/objectives`);
  showToast('Objectives URL copied to clipboard');
});

function renderObjectives(objectives) {
  objectivesListEl.innerHTML = '';
  objectivesEmptyText.style.display = objectives.length === 0 ? 'block' : 'none';

  objectives.forEach((obj, index) => {
    const row = document.createElement('div');
    row.className = `obj-row${obj.done ? ' done' : ''}`;

    const checkbox = document.createElement('button');
    checkbox.className = `obj-checkbox${obj.done ? ' checked' : ''}`;
    checkbox.type = 'button';
    checkbox.textContent = obj.done ? '✓' : '';
    checkbox.title = obj.done ? 'Mark as not done' : 'Mark as done';
    checkbox.addEventListener('click', async () => {
      await api(`/dashboard/objectives/${obj.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ done: !obj.done }),
      });
      await loadObjectives();
    });
    row.appendChild(checkbox);

    const text = document.createElement('input');
    text.type = 'text';
    text.className = 'obj-text';
    text.value = obj.text;
    text.maxLength = 140;
    text.addEventListener('change', async () => {
      const value = text.value.trim();
      if (!value) {
        text.value = obj.text;
        return;
      }
      await api(`/dashboard/objectives/${obj.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ text: value }),
      });
      showToast('Objective updated');
    });
    row.appendChild(text);

    const actions = document.createElement('div');
    actions.className = 'obj-actions';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.textContent = '↑';
    upBtn.title = 'Move up';
    upBtn.disabled = index === 0;
    upBtn.addEventListener('click', () => moveObjective(objectives, index, -1));
    actions.appendChild(upBtn);

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.textContent = '↓';
    downBtn.title = 'Move down';
    downBtn.disabled = index === objectives.length - 1;
    downBtn.addEventListener('click', () => moveObjective(objectives, index, 1));
    actions.appendChild(downBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'obj-delete';
    deleteBtn.textContent = '✕';
    deleteBtn.title = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      await api(`/dashboard/objectives/${obj.id}`, { method: 'DELETE' });
      await loadObjectives();
    });
    actions.appendChild(deleteBtn);

    row.appendChild(actions);
    objectivesListEl.appendChild(row);
  });
}

async function moveObjective(objectives, index, delta) {
  const target = index + delta;
  if (target < 0 || target >= objectives.length) return;
  const ids = objectives.map((o) => o.id);
  [ids[index], ids[target]] = [ids[target], ids[index]];
  await api('/dashboard/objectives/reorder', {
    method: 'POST',
    body: JSON.stringify({ orderedIds: ids }),
  });
  await loadObjectives();
}

async function loadObjectives() {
  const { objectives, settings } = await api('/dashboard/objectives');
  renderObjectives(objectives);
  applyObjColorInputs(settings);
}

async function addObjective() {
  const value = newObjectiveInput.value.trim();
  if (!value) return;
  await api('/dashboard/objectives', { method: 'POST', body: JSON.stringify({ text: value }) });
  newObjectiveInput.value = '';
  await loadObjectives();
}

$('addObjectiveBtn').addEventListener('click', addObjective);
newObjectiveInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addObjective();
});

// -------------------------------------------------------- objectives colors

const OBJ_COLOR_DEFAULTS = {
  bgColor: '#0c0c0c',
  borderColor: '#f4f4f4',
  labelColor: '#ffe066',
  currentTextColor: '#f6f6f2',
  itemTextColor: '#f4f4f4',
  doneTextColor: '#8a8a86',
  accentColor: '#ffe066',
};

const OBJ_COLOR_INPUTS = {
  bgColor: $('objBgColor'),
  borderColor: $('objBorderColor'),
  labelColor: $('objLabelColor'),
  currentTextColor: $('objCurrentTextColor'),
  itemTextColor: $('objItemTextColor'),
  doneTextColor: $('objDoneTextColor'),
  accentColor: $('objAccentColor'),
};

function applyObjColorInputs(settings) {
  for (const [key, input] of Object.entries(OBJ_COLOR_INPUTS)) {
    input.value = settings[key] || OBJ_COLOR_DEFAULTS[key];
  }
}

Object.entries(OBJ_COLOR_INPUTS).forEach(([key, input]) => {
  input.addEventListener('input', async () => {
    await api('/dashboard/objectives/settings', {
      method: 'POST',
      body: JSON.stringify({ [key]: input.value }),
    });
  });
});

$('resetObjColorsBtn').addEventListener('click', async () => {
  const settings = await api('/dashboard/objectives/settings', {
    method: 'POST',
    body: JSON.stringify(OBJ_COLOR_DEFAULTS),
  });
  applyObjColorInputs(settings);
  showToast('Objectives colors reset');
});

loadObjectives().catch((err) => {
  console.error(err);
  showToast('Failed to load objectives');
});

// ------------------------------------------------------------ tobz tower

const towerUrlEl = $('towerUrl');
const towerStatCount = $('towerStatCount');
const towerStatGoal = $('towerStatGoal');
const towerUsernameInput = $('towerUsernameInput');
const towerAllowLiveTestToggle = $('towerAllowLiveTestToggle');
const towerPositionSelect = $('towerPositionSelect');
const towerScaleRange = $('towerScaleRange');
const towerParticlesToggle = $('towerParticlesToggle');
const towerUsernamesToggle = $('towerUsernamesToggle');
const towerSoundsToggle = $('towerSoundsToggle');

towerUrlEl.textContent = `${location.origin}/tower`;
$('copyTowerUrlBtn').addEventListener('click', async () => {
  await navigator.clipboard.writeText(`${location.origin}/tower`);
  showToast('Tobz Tower URL copied to clipboard');
});

let towerMilestones = [];

function updateTowerStats(followerCount, milestones) {
  if (milestones) towerMilestones = milestones;
  towerStatCount.textContent = followerCount.toLocaleString('en-US');
  const next = towerMilestones.find((m) => m > followerCount);
  towerStatGoal.textContent = next ? `next level ${next.toLocaleString('en-US')}` : 'next level —';
}

async function loadTowerState() {
  const state = await api('/dashboard/tower');
  updateTowerStats(state.followerCount, state.settings.milestones);
  towerAllowLiveTestToggle.checked = state.allowTestOnLiveOverlay;
  towerPositionSelect.value = state.settings.position;
  towerScaleRange.value = state.settings.scale;
  $('towerScaleValue').textContent = `${parseFloat(state.settings.scale).toFixed(2)}x`;
  towerParticlesToggle.checked = !!state.settings.particlesEnabled;
  towerUsernamesToggle.checked = !!state.settings.usernamesEnabled;
  towerSoundsToggle.checked = !!state.settings.soundsEnabled;
}

async function pushTowerSettings(partial) {
  return api('/dashboard/tower/settings', { method: 'POST', body: JSON.stringify(partial) });
}

// The dashboard's own tower-preview WS connection (below) reflects the
// resulting followerCount back almost immediately, so these handlers don't
// need to re-fetch state themselves.
$('towerTestFollowBtn').addEventListener('click', async () => {
  const username = towerUsernameInput.value.trim();
  await api('/dashboard/tower/test-follow', { method: 'POST', body: JSON.stringify({ username }) });
  towerUsernameInput.value = '';
});
towerUsernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('towerTestFollowBtn').click();
});

document.querySelectorAll('button[data-tower-count]').forEach((btn) => {
  btn.addEventListener('click', () => {
    api('/dashboard/tower/test-follow', {
      method: 'POST',
      body: JSON.stringify({ count: parseInt(btn.dataset.towerCount, 10) }),
    });
  });
});

$('towerMilestonePreviewBtn').addEventListener('click', async () => {
  const { value } = await api('/dashboard/tower/milestone-preview', { method: 'POST' });
  showToast(value ? `Previewing ${value.toLocaleString('en-US')} milestone` : 'No milestones configured');
});

$('towerResetBtn').addEventListener('click', async () => {
  if (!confirm('Reset Tobz Tower? This permanently clears every block.')) return;
  await api('/dashboard/tower/reset', { method: 'POST' });
  showToast('Tobz Tower reset');
});

towerAllowLiveTestToggle.addEventListener('change', () => {
  pushSettings({ allowTestOnLiveOverlay: towerAllowLiveTestToggle.checked });
  allowLiveTestToggle.checked = towerAllowLiveTestToggle.checked;
  treeAllowLiveTestToggle.checked = towerAllowLiveTestToggle.checked;
});
towerPositionSelect.addEventListener('change', () => {
  pushTowerSettings({ position: towerPositionSelect.value });
});
towerScaleRange.addEventListener('input', () => {
  $('towerScaleValue').textContent = `${parseFloat(towerScaleRange.value).toFixed(2)}x`;
  pushTowerSettings({ scale: parseFloat(towerScaleRange.value) });
});
towerParticlesToggle.addEventListener('change', () => {
  pushTowerSettings({ particlesEnabled: towerParticlesToggle.checked });
});
towerUsernamesToggle.addEventListener('change', () => {
  pushTowerSettings({ usernamesEnabled: towerUsernamesToggle.checked });
});
towerSoundsToggle.addEventListener('change', () => {
  pushTowerSettings({ soundsEnabled: towerSoundsToggle.checked });
});

// Keep the dashboard's own tower readout live too.
new ReconnectingSocket({
  channel: 'tower-preview',
  onMessage(msg) {
    if (msg.type === 'tower:block_added') {
      updateTowerStats(msg.followerCount);
    } else if (msg.type === 'tower:reset') {
      updateTowerStats(0);
    } else if (msg.type === 'tower:settings') {
      updateTowerStats(parseInt(towerStatCount.textContent.replace(/,/g, ''), 10) || 0, msg.settings.milestones);
    }
  },
});

loadTowerState().catch((err) => {
  console.error(err);
  showToast('Failed to load Tobz Tower state');
});

// ------------------------------------------------------------ engagement prompts

$('engageUrl').textContent = `${location.origin}/engage`;
$('copyEngageUrlBtn').addEventListener('click', async () => {
  await navigator.clipboard.writeText(`${location.origin}/engage`);
  showToast('Engagement prompts URL copied to clipboard');
});

// ------------------------------------------------------------ gift dares ticker

$('giftDaresUrl').textContent = `${location.origin}/giftdares`;
$('copyGiftDaresUrlBtn').addEventListener('click', async () => {
  await navigator.clipboard.writeText(`${location.origin}/giftdares`);
  showToast('Gift dares ticker URL copied to clipboard');
});

const giftDaresSpeedRange = $('giftDaresSpeedRange');

async function loadGiftDaresState() {
  const { settings } = await api('/dashboard/giftdares');
  giftDaresSpeedRange.value = settings.speed;
  $('giftDaresSpeedValue').textContent = `${parseFloat(settings.speed).toFixed(1)}x`;
}

giftDaresSpeedRange.addEventListener('input', () => {
  $('giftDaresSpeedValue').textContent = `${parseFloat(giftDaresSpeedRange.value).toFixed(1)}x`;
  api('/dashboard/giftdares/settings', {
    method: 'POST',
    body: JSON.stringify({ speed: parseFloat(giftDaresSpeedRange.value) }),
  });
});

loadGiftDaresState().catch((err) => {
  console.error(err);
  showToast('Failed to load gift dares settings');
});

// ------------------------------------------------------------ community tree

$('treeUrl').textContent = `${location.origin}/tree`;
$('copyTreeUrlBtn').addEventListener('click', async () => {
  await navigator.clipboard.writeText(`${location.origin}/tree`);
  showToast('Tobz Pet Tree URL copied to clipboard');
});

$('petDogUrl').textContent = `${location.origin}/pet-dog`;
$('copyPetDogUrlBtn').addEventListener('click', async () => {
  await navigator.clipboard.writeText(`${location.origin}/pet-dog`);
  showToast('Tobz Pet Dog URL copied to clipboard');
});

const treeAllowLiveTestToggle = $('treeAllowLiveTestToggle');
const treePositionSelect = $('treePositionSelect');
const treeScaleRange = $('treeScaleRange');
const treeGiftMapInput = $('treeGiftMapInput');
const treeCoinsPerLevelInput = $('treeCoinsPerLevelInput');

function updateTreeStats(treeState) {
  $('treeStatLevel').textContent = `LVL ${treeState.currentLevel}`;
  const pct = treeState.thresholdForCurrentLevel
    ? Math.round((treeState.currentGrowth / treeState.thresholdForCurrentLevel) * 100)
    : 0;
  $('treeStatPct').textContent = `${pct}%`;
}

function renderTikfinityStatus(tikfinity) {
  $('treeBridgeSecretInput').value = tikfinity.bridgeSecret;
  $('treeBridgeCommand').textContent =
    `TREE_SITE_URL=${location.origin} TIKFINITY_BRIDGE_SECRET=${tikfinity.bridgeSecret} npm run tikfinity-bridge`;

  const last = tikfinity.lastEvent;
  const statusEl = $('treeTikfinityStatus');
  if (!last) {
    statusEl.textContent = 'No events received yet from the bridge script.';
  } else {
    const ago = Math.round((Date.now() - last.at) / 1000);
    statusEl.textContent = last.wasIgnored
      ? `Bridge is connected — last event ${ago}s ago (ignored: mid-combo or non-gift).`
      : `Bridge is connected — @${last.username} sent "${last.giftName}" x${last.repeatCount} (+${last.growth}) ${ago}s ago.`;
  }
}

function renderTiktokLiveStatus(tiktokLive) {
  if (!tiktokLive) return;
  $('treeLiveUsernameInput').value = tiktokLive.username || '';

  const statusEl = $('treeLiveStatus');
  if (!tiktokLive.configured) {
    statusEl.textContent = 'Not set up yet — enter your TikTok username above and click Save.';
  } else if (tiktokLive.connected) {
    const last = tiktokLive.lastGift;
    statusEl.textContent = last
      ? `Connected to @${tiktokLive.username}'s LIVE — last gift: @${last.username} sent "${last.giftName}" x${last.repeatCount} (+${last.growth}).`
      : `Connected to @${tiktokLive.username}'s LIVE — waiting for gifts.`;
  } else if (tiktokLive.connecting) {
    statusEl.textContent = `Connecting to @${tiktokLive.username}...`;
  } else {
    statusEl.textContent = `Not currently live — waiting for @${tiktokLive.username} to start streaming (checks automatically).`;
  }
}

async function loadTreeState() {
  const { state: treeState, settings, tikfinity, tiktokLive } = await api('/dashboard/tree');
  updateTreeStats(treeState);
  treeAllowLiveTestToggle.checked = !!(await api('/dashboard/state')).settings.allowTestOnLiveOverlay;
  treePositionSelect.value = settings.position;
  treeScaleRange.value = settings.scale;
  $('treeScaleValue').textContent = `${parseFloat(settings.scale).toFixed(2)}x`;
  treeGiftMapInput.value = JSON.stringify(settings.giftGrowthValues, null, 2);
  treeCoinsPerLevelInput.value = settings.baseThreshold;
  renderTikfinityStatus(tikfinity);
  renderTiktokLiveStatus(tiktokLive);
}

async function pushTreeSettings(partial) {
  return api('/dashboard/tree/settings', { method: 'POST', body: JSON.stringify(partial) });
}

document.querySelectorAll('button[data-tree-growth]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const { message } = await api('/dashboard/tree/test-growth', {
      method: 'POST',
      body: JSON.stringify({ amount: parseInt(btn.dataset.treeGrowth, 10) }),
    });
    if (message) updateTreeStats(message.state);
  });
});

$('treeSimulateGiftBtn').addEventListener('click', async () => {
  const username = $('treeGiftUsername').value.trim() || 'testviewer';
  const giftName = $('treeGiftName').value.trim() || null;
  const { message } = await api('/dashboard/tree/simulate-gift', {
    method: 'POST',
    body: JSON.stringify({ username, giftName }),
  });
  if (message) updateTreeStats(message.state);
  showToast(giftName ? `Simulated "${giftName}" from @${username}` : `Simulated a gift from @${username}`);
});

$('treeEvolveBtn').addEventListener('click', async () => {
  const { message } = await api('/dashboard/tree/evolve', { method: 'POST' });
  if (message) updateTreeStats(message.state);
});

$('treeResetBtn').addEventListener('click', async () => {
  if (!confirm('Reset the Community Tree? This clears its level and growth back to the seed stage.')) return;
  await api('/dashboard/tree/reset', { method: 'POST' });
  updateTreeStats({ currentLevel: 1, currentGrowth: 0, thresholdForCurrentLevel: 100 });
  showToast('Community Tree reset');
});

treeAllowLiveTestToggle.addEventListener('change', () => {
  pushSettings({ allowTestOnLiveOverlay: treeAllowLiveTestToggle.checked });
  allowLiveTestToggle.checked = treeAllowLiveTestToggle.checked;
  towerAllowLiveTestToggle.checked = treeAllowLiveTestToggle.checked;
});
treePositionSelect.addEventListener('change', () => {
  pushTreeSettings({ position: treePositionSelect.value });
});
treeScaleRange.addEventListener('input', () => {
  $('treeScaleValue').textContent = `${parseFloat(treeScaleRange.value).toFixed(2)}x`;
  pushTreeSettings({ scale: parseFloat(treeScaleRange.value) });
});
$('treeCoinsPerLevelBtn').addEventListener('click', async () => {
  const n = parseInt(treeCoinsPerLevelInput.value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    showToast('Enter a positive number of coins');
    return;
  }
  // levelScaling: 1 pinned here too — without it, a site with an
  // old stored levelScaling (>1) would keep compounding on top of this
  // number, so level 2+ would cost more than what's shown here.
  const settings = await pushTreeSettings({ baseThreshold: n, levelScaling: 1 });
  treeCoinsPerLevelInput.value = settings.baseThreshold;
  showToast(`Each level now takes ${settings.baseThreshold} coins`);
});

// Verified real TikTok coin prices — same source/list as the server's code
// defaults (server/services/treeSettingsStore.js). Only touches these
// specific keys; anything else already in the user's map (e.g. gifts they
// added themselves, or ones I couldn't verify a price for) is left as-is.
const VERIFIED_REAL_COIN_PRICES = {
  Rose: 1,
  GG: 1,
  'Finger Heart': 5,
  Perfume: 20,
  Galaxy: 1000,
  Universe: 44999,
  'TikTok Universe': 44999,
};

$('treeUseRealCoinsBtn').addEventListener('click', async () => {
  let current;
  try {
    current = JSON.parse(treeGiftMapInput.value);
  } catch (err) {
    showToast('Fix the invalid JSON in the gift values box first');
    return;
  }
  const merged = { ...current, ...VERIFIED_REAL_COIN_PRICES };
  // levelScaling: 1 is required here, not optional — omitting it was the
  // bug: baseThreshold alone doesn't stop an old stored levelScaling from
  // still compounding, so level 2+ ended up costing more than 1000.
  const settings = await pushTreeSettings({ baseThreshold: 1000, levelScaling: 1, giftGrowthValues: merged });
  treeGiftMapInput.value = JSON.stringify(settings.giftGrowthValues, null, 2);
  treeCoinsPerLevelInput.value = settings.baseThreshold;
  showToast('Applied: 1000 coins/level + verified gift prices');
});

$('treeSaveGiftMapBtn').addEventListener('click', async () => {
  let parsed;
  try {
    parsed = JSON.parse(treeGiftMapInput.value);
  } catch (err) {
    showToast('Invalid JSON — fix it and try again');
    return;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    showToast('Gift values must be a JSON object like {"Rose": 1}');
    return;
  }
  const settings = await pushTreeSettings({ giftGrowthValues: parsed });
  treeGiftMapInput.value = JSON.stringify(settings.giftGrowthValues, null, 2);
  showToast('Gift values saved');
});

$('treeLiveSaveBtn').addEventListener('click', async () => {
  const username = $('treeLiveUsernameInput').value.trim();
  if (!username) {
    showToast('Enter your TikTok username first');
    return;
  }
  const { username: saved, status } = await api('/dashboard/tree/tiktok-live/username', {
    method: 'POST',
    body: JSON.stringify({ username }),
  });
  $('treeLiveUsernameInput').value = saved;
  renderTiktokLiveStatus(status);
  showToast(saved ? `Watching @${saved} for LIVE gifts` : 'TikTok username cleared');
});

$('treeLiveReconnectBtn').addEventListener('click', async () => {
  const { status } = await api('/dashboard/tree/tiktok-live/reconnect', { method: 'POST' });
  renderTiktokLiveStatus(status);
  showToast('Reconnecting…');
});

$('treeCopySecretBtn').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('treeBridgeSecretInput').value);
  showToast('Bridge secret copied');
});
$('treeCopyCommandBtn').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('treeBridgeCommand').textContent);
  showToast('Bridge command copied');
});

loadTreeState().catch((err) => {
  console.error(err);
  showToast('Failed to load Community Tree state');
});

// Light polling so growth (from real gifts, which don't go through any
// button here) and "is the bridge connected" both stay current while this
// dashboard tab is open, without needing a manual refresh mid-test.
setInterval(() => {
  api('/dashboard/tree')
    .then(({ state: treeState, tikfinity, tiktokLive }) => {
      updateTreeStats(treeState);
      renderTikfinityStatus(tikfinity);
      renderTiktokLiveStatus(tiktokLive);
    })
    .catch(() => {});
}, 5000);
