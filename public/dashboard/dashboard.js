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

// ------------------------------------------------------------ GTA 6 section
// Timer controls. The server owns the timer (see server/services/gta6TimerLogic.js);
// this just sends commands and mirrors the result. The readout is derived
// from the server's state + clock, same as the overlay, so it matches what's
// on stream even if this computer's clock is off.

$('gta6TimerUrl').textContent = `${location.origin}/gta6/timer`;
$('gta6FollowerUrl').textContent = `${location.origin}/gta6/followers`;
$('gta6CopyTimerUrlBtn').addEventListener('click', async () => {
  await navigator.clipboard.writeText(`${location.origin}/gta6/timer`);
  showToast('GTA 6 timer URL copied to clipboard');
});
$('gta6CopyFollowerUrlBtn').addEventListener('click', async () => {
  await navigator.clipboard.writeText(`${location.origin}/gta6/followers`);
  showToast('GTA 6 follower URL copied to clipboard');
});

const g6 = { state: null, offset: 0, prefilled: false };
const g6Els = {
  readout: $('gta6TimerReadout'),
  status: $('gta6TimerStatus'),
  start: $('gta6StartBtn'),
  pause: $('gta6PauseBtn'),
  mode: $('gta6ModeSelect'),
  setLabel: $('gta6SetLabel'),
  hours: $('gta6Hours'),
  minutes: $('gta6Minutes'),
  seconds: $('gta6Seconds'),
  label: $('gta6LabelInput'),
};

function g6Elapsed(s, now) {
  const running = s.status === 'running' && Number.isFinite(s.startedAt);
  const total = s.elapsedMs + (running ? Math.max(0, now - s.startedAt) : 0);
  return s.mode === 'countdown' ? Math.min(total, s.durationMs) : total;
}

function g6Pad(n) {
  return String(n).padStart(2, '0');
}

function g6Render() {
  const s = g6.state;
  if (!s) return;
  const now = Date.now() + g6.offset;
  const elapsed = g6Elapsed(s, now);
  const isCountdown = s.mode === 'countdown';
  const remaining = isCountdown ? Math.max(0, s.durationMs - elapsed) : null;
  const finished = isCountdown && remaining <= 0;
  const seconds = isCountdown ? Math.ceil(remaining / 1000) : Math.floor(elapsed / 1000);

  g6Els.readout.textContent = `${g6Pad(Math.floor(seconds / 3600))}:${g6Pad(Math.floor((seconds % 3600) / 60))}:${g6Pad(seconds % 60)}`;
  const kind = isCountdown ? 'counting down' : 'counting up';
  g6Els.status.textContent = finished
    ? "Time's up"
    : s.status === 'running'
      ? `Running · ${kind}`
      : s.status === 'paused'
        ? `Paused · ${kind}`
        : `Not started · ${kind}`;
  g6Els.start.disabled = s.status === 'running' || finished;
  g6Els.pause.disabled = s.status !== 'running';
}

function g6Apply({ state, serverTime }) {
  g6.state = state;
  g6.offset = serverTime - Date.now();
  if (!g6.prefilled) {
    // first load only — fill the "Set the clock" form from the current timer
    // without ever overwriting something the user is in the middle of typing
    g6.prefilled = true;
    const ms = state.mode === 'countdown' ? state.durationMs : state.elapsedMs;
    const totalSeconds = Math.floor(ms / 1000);
    g6Els.mode.value = state.mode;
    g6Els.hours.value = Math.floor(totalSeconds / 3600);
    g6Els.minutes.value = Math.floor((totalSeconds % 3600) / 60);
    g6Els.seconds.value = totalSeconds % 60;
    g6Els.label.value = state.label;
    g6UpdateSetLabel();
  }
  g6Render();
}

function g6UpdateSetLabel() {
  g6Els.setLabel.textContent = g6Els.mode.value === 'countdown' ? 'Count down from' : 'Start counting from';
}
g6Els.mode.addEventListener('change', g6UpdateSetLabel);

// Plain fetch (not api()) so the server's own message — e.g. "A countdown
// needs at least 1 second." — reaches the toast instead of a bare status code.
async function g6Post(action, body) {
  try {
    const res = await fetch(`/api/dashboard/gta6/timer/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error || `Request failed (${res.status})`);
      return null;
    }
    g6Apply(data);
    return data;
  } catch {
    showToast('Could not reach the server');
    return null;
  }
}

$('gta6StartBtn').addEventListener('click', () => g6Post('start'));
$('gta6PauseBtn').addEventListener('click', () => g6Post('pause'));

$('gta6ResetBtn').addEventListener('click', () => {
  if (g6.state && g6.state.status !== 'idle' && !confirm('Reset the timer back to the start? This clears the time counted so far.')) return;
  g6Post('reset');
});

document.querySelectorAll('button[data-gta6-adjust]').forEach((btn) => {
  btn.addEventListener('click', () => g6Post('adjust', { deltaMs: parseInt(btn.dataset.gta6Adjust, 10) }));
});

$('gta6SetBtn').addEventListener('click', async () => {
  if (g6.state && g6.state.status !== 'idle' && !confirm('The timer is already started. Setting a new time puts it back to "not started". Continue?')) return;
  const res = await g6Post('set', {
    mode: g6Els.mode.value,
    hours: g6Els.hours.value,
    minutes: g6Els.minutes.value,
    seconds: g6Els.seconds.value,
  });
  if (res) showToast('Timer set — press Start when you\'re ready');
});

$('gta6LabelBtn').addEventListener('click', async () => {
  const res = await g6Post('label', { label: g6Els.label.value });
  if (res) {
    g6Els.label.value = res.state.label;
    showToast(res.state.label ? 'Label saved' : 'Label cleared');
  }
});

async function g6Load() {
  try {
    g6Apply(await api('/dashboard/gta6/timer'));
  } catch (err) {
    console.error(err);
    g6Els.status.textContent = 'Could not load the timer';
  }
}
g6Load();
setInterval(g6Render, 250);
// re-sync now and then (another tab, or a start/pause made elsewhere)
setInterval(() => {
  api('/dashboard/gta6/timer')
    .then((data) => {
      g6.state = data.state;
      g6.offset = data.serverTime - Date.now();
      g6Render();
    })
    .catch(() => {});
}, 10000);

// ---------------------------------------------------- GTA 6 objectives
// Its own checklist + look settings (separate from the "Current Objectives"
// panel above); the overlay is /gta6/objectives.

$('gta6ObjUrl').textContent = `${location.origin}/gta6/objectives`;
$('gta6CopyObjUrlBtn').addEventListener('click', async () => {
  await navigator.clipboard.writeText(`${location.origin}/gta6/objectives`);
  showToast('GTA 6 objectives URL copied to clipboard');
});

const g6ObjEls = {
  list: $('gta6ObjList'),
  empty: $('gta6ObjEmpty'),
  input: $('gta6NewObjInput'),
  title: $('gta6ObjTitle'),
  palette: $('gta6ObjPalette'),
  align: $('gta6ObjAlign'),
  size: $('gta6ObjSize'),
  bg: $('gta6ObjBg'),
  max: $('gta6ObjMax'),
  showDone: $('gta6ObjShowDone'),
  showProgress: $('gta6ObjShowProgress'),
};
let g6ObjDefaults = null;

// Plain fetch (not api()) so the server's message — e.g. "Cannot exceed 50
// objectives" — reaches the toast.
async function g6ObjRequest(path, method = 'GET', body) {
  try {
    const res = await fetch(`/api/dashboard/gta6/objectives${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error || `Request failed (${res.status})`);
      return null;
    }
    return data;
  } catch {
    showToast('Could not reach the server');
    return null;
  }
}

function g6ObjApplySettings(s) {
  g6ObjEls.title.value = s.title;
  g6ObjEls.palette.value = s.palette;
  g6ObjEls.align.value = s.align;
  g6ObjEls.size.value = s.size;
  g6ObjEls.bg.value = s.bgOpacity;
  g6ObjEls.max.value = s.maxVisible;
  g6ObjEls.showDone.checked = s.showCompleted;
  g6ObjEls.showProgress.checked = s.showProgress;
  g6ObjShowValues();
}

function g6ObjShowValues() {
  $('gta6ObjSizeVal').textContent = `${g6ObjEls.size.value}%`;
  $('gta6ObjBgVal').textContent = `${g6ObjEls.bg.value}%`;
  $('gta6ObjMaxVal').textContent = g6ObjEls.max.value;
}

function g6ObjRender(objectives) {
  g6ObjEls.list.innerHTML = '';
  g6ObjEls.empty.style.display = objectives.length === 0 ? 'block' : 'none';
  const ids = objectives.map((o) => o.id);

  objectives.forEach((obj, index) => {
    const row = document.createElement('div');
    row.className = `obj-row${obj.done ? ' done' : ''}`;

    const checkbox = document.createElement('button');
    checkbox.className = `obj-checkbox${obj.done ? ' checked' : ''}`;
    checkbox.type = 'button';
    checkbox.textContent = obj.done ? '✓' : '';
    checkbox.title = obj.done ? 'Mark as not done' : 'Mark as done';
    checkbox.addEventListener('click', async () => {
      const data = await g6ObjRequest(`/${obj.id}`, 'PATCH', { done: !obj.done });
      if (data) g6ObjRender(data.objectives);
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
      const data = await g6ObjRequest(`/${obj.id}`, 'PATCH', { text: value });
      if (data) showToast('Objective updated');
    });
    row.appendChild(text);

    const actions = document.createElement('div');
    actions.className = 'obj-actions';
    const action = (label, title, disabled, onClick, cls) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.title = title;
      btn.disabled = disabled;
      if (cls) btn.className = cls;
      btn.addEventListener('click', onClick);
      actions.appendChild(btn);
    };
    const move = async (delta) => {
      const next = ids.slice();
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      const data = await g6ObjRequest('/reorder', 'POST', { orderedIds: next });
      if (data) g6ObjRender(data.objectives);
    };
    action('↑', 'Move up', index === 0, () => move(-1));
    action('↓', 'Move down', index === objectives.length - 1, () => move(1));
    action('✕', 'Delete', false, async () => {
      const data = await g6ObjRequest(`/${obj.id}`, 'DELETE');
      if (data) g6ObjRender(data.objectives);
    }, 'obj-delete');
    row.appendChild(actions);

    g6ObjEls.list.appendChild(row);
  });
}

async function g6ObjAdd() {
  const value = g6ObjEls.input.value.trim();
  if (!value) return;
  const data = await g6ObjRequest('', 'POST', { text: value });
  if (!data) return;
  g6ObjEls.input.value = '';
  g6ObjRender(data.objectives);
}
$('gta6AddObjBtn').addEventListener('click', g6ObjAdd);
g6ObjEls.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') g6ObjAdd();
});

// Look settings: send the controls' current values shortly after the last
// change (so dragging a slider is one request, not dozens).
let g6ObjSaveTimer = 0;
function g6ObjSaveSettings() {
  g6ObjShowValues();
  clearTimeout(g6ObjSaveTimer);
  g6ObjSaveTimer = setTimeout(() => {
    g6ObjRequest('/settings', 'POST', {
      title: g6ObjEls.title.value,
      palette: g6ObjEls.palette.value,
      align: g6ObjEls.align.value,
      size: Number(g6ObjEls.size.value),
      bgOpacity: Number(g6ObjEls.bg.value),
      maxVisible: Number(g6ObjEls.max.value),
      showCompleted: g6ObjEls.showDone.checked,
      showProgress: g6ObjEls.showProgress.checked,
    });
  }, 200);
}
['title', 'palette', 'align', 'size', 'bg', 'max', 'showDone', 'showProgress'].forEach((key) => {
  g6ObjEls[key].addEventListener('input', g6ObjSaveSettings);
});

$('gta6ObjResetBtn').addEventListener('click', async () => {
  if (!g6ObjDefaults) return;
  const settings = await g6ObjRequest('/settings', 'POST', g6ObjDefaults);
  if (settings) {
    g6ObjApplySettings(settings);
    showToast('Objectives look reset');
  }
});

(async () => {
  const data = await g6ObjRequest('');
  if (!data) return;
  g6ObjDefaults = data.defaults;
  g6ObjApplySettings(data.settings);
  g6ObjRender(data.objectives);
})();

// ------------------------------------------------------------ Trivia game
// Server-authoritative (see server/services/triviaGame.js): this panel sends
// commands and mirrors the state. It polls a small round endpoint because the
// dashboard (unlike viewers) is allowed to see the answer.

$('trvUrl').textContent = `${location.origin}/trivia`;
$('trvCopyUrlBtn').addEventListener('click', async () => {
  await navigator.clipboard.writeText(`${location.origin}/trivia`);
  showToast('Trivia URL copied to clipboard');
});

const trv = { questions: [], settings: null, defaults: null, round: null, offset: 0, pointsPrefilled: false, boardKey: '' };

// Plain fetch (not api()) so the server's own message — "Add a question
// first.", "Type the question first." — reaches the toast.
async function trvRequest(path, method = 'GET', body) {
  try {
    const res = await fetch(`/api/dashboard/trivia${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error || `Request failed (${res.status})`);
      return null;
    }
    return data;
  } catch {
    showToast('Could not reach the server');
    return null;
  }
}

// ---- round readout + controls

function trvRenderRound() {
  const r = trv.round;
  if (!r) return;
  const now = Date.now() + trv.offset;
  const live = r.status === 'active';
  const auto = r.auto && r.auto.active ? r.auto : null;
  const left = live ? Math.max(0, Math.ceil((r.endsAt - now) / 1000)) : 0;
  const nowBox = $('trvNow');
  nowBox.classList.toggle('live', live);

  let status = 'Nothing on screen';
  if (live) status = `Question live · ${left}s left`;
  else if (r.status === 'solved') status = `Solved by ${r.winner ? r.winner.name : '?'} (+${r.winner ? r.winner.points : 0})`;
  else if (r.status === 'expired') status = 'Time ran out — answer revealed';
  else if (auto && auto.nextAt) status = `Next question in ${Math.max(0, Math.ceil((auto.nextAt - now) / 1000))}s`;
  if (auto) {
    status = `Playlist ${auto.position}/${auto.total} · ${status}${auto.stopAfter ? ' · stopping after this question' : ''}`;
  }
  $('trvStatus').textContent = status;
  $('trvNowQ').textContent = r.question ? r.question.text : '';
  $('trvNowA').innerHTML = '';
  if (r.question && r.answers && r.answers.length) {
    $('trvNowA').append('Answer: ');
    const b = document.createElement('b');
    b.textContent = r.answers.join('  /  ');
    $('trvNowA').appendChild(b);
  }
  $('trvRevealBtn').disabled = !live;
  $('trvClearBtn').disabled = r.status === 'idle' && !auto;
  // while the playlist runs it owns the screen: asking by hand would fight it
  $('trvAskBtn').disabled = !!auto;
  document.querySelectorAll('.trv-ask-btn').forEach((b) => { b.disabled = !!auto; });
  $('trvPlStartBtn').disabled = !!auto;
  $('trvPlStopBtn').disabled = !auto;
  $('trvPlStopAfterBtn').disabled = !auto || auto.stopAfter || (r.status === 'idle');
}

function trvApplyRound(data) {
  if (!data || !data.round) return;
  trv.round = data.round;
  trv.offset = data.round.serverTime - Date.now();
  trvRenderRound();
}

// ---- leaderboard

function trvRenderBoard(entries) {
  const key = JSON.stringify(entries);
  if (key === trv.boardKey) return; // unchanged since the last poll — don't rebuild under the user's cursor
  trv.boardKey = key;
  const list = $('trvBoardList');
  list.innerHTML = '';
  $('trvBoardEmpty').style.display = entries.length ? 'none' : 'block';
  entries.forEach((e, i) => {
    const row = document.createElement('div');
    row.className = 'trv-lb-row';
    const rank = document.createElement('span');
    rank.className = 'trv-lb-rank';
    rank.textContent = String(i + 1);
    const name = document.createElement('span');
    name.className = 'trv-lb-name';
    name.textContent = e.name;
    name.title = `@${e.uniqueId} · ${e.wins} win${e.wins === 1 ? '' : 's'}`;
    const pts = document.createElement('span');
    pts.className = 'trv-lb-pts';
    pts.textContent = e.points.toLocaleString('en-US');
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn small';
    del.textContent = '✕';
    del.title = 'Remove from leaderboard';
    del.addEventListener('click', async () => {
      const data = await trvRequest(`/leaderboard/${encodeURIComponent(e.uniqueId)}`, 'DELETE');
      if (data) trvRenderBoard(data.leaderboard);
    });
    row.append(rank, name, pts, del);
    list.appendChild(row);
  });
}

$('trvBoardResetBtn').addEventListener('click', async () => {
  if (!confirm('Reset the leaderboard? Everyone goes back to 0 points. This cannot be undone.')) return;
  const data = await trvRequest('/leaderboard/reset', 'POST');
  if (data) {
    trvRenderBoard([]);
    showToast('Leaderboard reset');
  }
});

// ---- questions

function trvRenderQuestions() {
  const list = $('trvQList');
  const qs = trv.questions;
  list.innerHTML = '';
  $('trvQEmpty').style.display = qs.length ? 'none' : 'block';
  const asked = qs.filter((q) => q.askedAt).length;
  $('trvCount').textContent = `${qs.length} question${qs.length === 1 ? '' : 's'} · ${asked} asked`;

  qs.forEach((q, index) => {
    const row = document.createElement('div');
    row.className = `trv-q${q.askedAt ? ' asked' : ''}${q.inPlaylist ? ' in-playlist' : ''}`;

    const tick = document.createElement('input');
    tick.type = 'checkbox';
    tick.className = 'trv-q-tick';
    tick.checked = q.inPlaylist;
    tick.title = 'In the playlist';
    tick.addEventListener('change', async () => {
      const data = await trvRequest(`/questions/${q.id}`, 'PATCH', { inPlaylist: tick.checked });
      if (data) trv.questions = data.questions;
      trvRenderQuestions();
    });

    const text = document.createElement('input');
    text.type = 'text';
    text.className = 'trv-q-q';
    text.value = q.text;
    text.maxLength = 200;

    const move = document.createElement('div');
    move.className = 'trv-q-move';
    const ids = qs.map((x) => x.id);
    const mover = (label, title, delta) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn small';
      btn.textContent = label;
      btn.title = title;
      btn.disabled = index + delta < 0 || index + delta >= qs.length;
      btn.addEventListener('click', async () => {
        const next = ids.slice();
        [next[index], next[index + delta]] = [next[index + delta], next[index]];
        const data = await trvRequest('/questions/reorder', 'POST', { orderedIds: next });
        if (data) trv.questions = data.questions;
        trvRenderQuestions();
      });
      move.appendChild(btn);
    };
    mover('↑', 'Move up', -1);
    mover('↓', 'Move down', 1);

    const answers = document.createElement('input');
    answers.type = 'text';
    answers.className = 'trv-q-a';
    answers.value = q.answers.join(', ');
    answers.title = 'Correct answer(s), separated by commas';
    answers.maxLength = 300;
    const pts = document.createElement('input');
    pts.type = 'number';
    pts.className = 'trv-q-pts';
    pts.min = '1';
    pts.max = '1000';
    pts.value = q.points;
    pts.title = 'Points';

    const actions = document.createElement('div');
    actions.className = 'trv-q-actions';
    if (q.askedAt) {
      const tag = document.createElement('span');
      tag.className = 'trv-asked-tag';
      tag.textContent = 'asked';
      actions.appendChild(tag);
    }
    const ask = document.createElement('button');
    ask.type = 'button';
    ask.className = 'btn small trv-ask-btn';
    ask.textContent = 'Ask now';
    ask.addEventListener('click', () => trvStart(q.id));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn small danger';
    del.textContent = '✕';
    del.title = 'Delete question';
    del.addEventListener('click', async () => {
      const data = await trvRequest(`/questions/${q.id}`, 'DELETE');
      if (data) {
        trv.questions = data.questions;
        trvRenderQuestions();
      }
    });
    actions.append(ask, del);

    // save an edit when a field is left; put the old value back if it's rejected
    const save = async () => {
      const data = await trvRequest(`/questions/${q.id}`, 'PATCH', {
        text: text.value,
        answers: answers.value,
        points: pts.value,
      });
      if (data) {
        trv.questions = data.questions;
        showToast('Question saved');
      }
      trvRenderQuestions();
    };
    [text, answers, pts].forEach((el) => el.addEventListener('change', save));

    const sub = document.createElement('div');
    sub.className = 'trv-q-sub';
    sub.append(answers, pts, actions);
    row.append(tick, text, move, sub);
    list.appendChild(row);
  });
  trvRenderRound(); // re-apply disabled states to the fresh buttons
  trvRenderPlaylistSummary();
}

// "6 of 8 in the playlist · up to ~7 min" — an upper bound: every question using its
// full time limit (answered ones finish sooner)
function trvRenderPlaylistSummary() {
  const n = trv.questions.filter((q) => q.inPlaylist).length;
  const el = $('trvPlSummary');
  if (!trv.questions.length) {
    el.textContent = '';
    return;
  }
  let text = `${n} of ${trv.questions.length} in the playlist`;
  if (n && trv.settings) {
    const s = trv.settings;
    const secs = n * (s.timeLimitSec + s.resultSeconds) + (n - 1) * s.gapSeconds;
    text += ` · up to ${secs >= 3600 ? `${(secs / 3600).toFixed(1)} h` : `${Math.ceil(secs / 60)} min`}${s.playlistLoop ? ' per pass' : ''}`;
  }
  el.textContent = text;
}

$('trvAddBtn').addEventListener('click', async () => {
  const data = await trvRequest('/questions', 'POST', {
    text: $('trvNewQ').value,
    answers: $('trvNewA').value,
    points: $('trvNewPts').value,
  });
  if (!data) return;
  $('trvNewQ').value = '';
  $('trvNewA').value = '';
  trv.questions = data.questions;
  trvRenderQuestions();
  $('trvNewQ').focus();
});
['trvNewQ', 'trvNewA', 'trvNewPts'].forEach((id) => {
  $(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('trvAddBtn').click();
  });
});

$('trvImportBtn').addEventListener('click', async () => {
  const data = await trvRequest('/questions/import', 'POST', { text: $('trvBulk').value });
  if (!data) return;
  trv.questions = data.questions;
  trvRenderQuestions();
  $('trvBulk').value = '';
  const notes = [];
  if (data.skipped.length) notes.push(`skipped line${data.skipped.length === 1 ? '' : 's'} ${data.skipped.join(', ')} (no answer)`);
  if (data.dropped) notes.push(`${data.dropped} over the 300 limit`);
  showToast(`Imported ${data.added} question${data.added === 1 ? '' : 's'}${notes.length ? ' — ' + notes.join('; ') : ''}`);
});

$('trvResetAskedBtn').addEventListener('click', async () => {
  const data = await trvRequest('/questions/reset-asked', 'POST');
  if (data) {
    trv.questions = data.questions;
    trvRenderQuestions();
    showToast('All questions can be asked again');
  }
});

// ---- running the game

async function trvStart(id) {
  const data = await trvRequest('/start', 'POST', id ? { id } : {});
  if (!data) return;
  trvApplyRound(data);
  trv.questions = data.questions;
  trvRenderQuestions();
}
$('trvAskBtn').addEventListener('click', () => trvStart());

$('trvPlStartBtn').addEventListener('click', async () => {
  const data = await trvRequest('/playlist/start', 'POST');
  if (!data) return;
  trvApplyRound(data);
  trv.questions = data.questions;
  trvRenderQuestions();
});
$('trvPlStopBtn').addEventListener('click', async () => trvApplyRound(await trvRequest('/playlist/stop', 'POST', {})));
$('trvPlStopAfterBtn').addEventListener('click', async () => {
  const data = await trvRequest('/playlist/stop', 'POST', { afterCurrent: true });
  if (data) {
    trvApplyRound(data);
    showToast(data.round.auto.active ? 'The playlist will stop after this question' : 'Playlist stopped');
  }
});
$('trvSelectAllBtn').addEventListener('click', async () => {
  const data = await trvRequest('/questions/playlist', 'POST', { value: true });
  if (data) {
    trv.questions = data.questions;
    trvRenderQuestions();
  }
});
$('trvSelectNoneBtn').addEventListener('click', async () => {
  const data = await trvRequest('/questions/playlist', 'POST', { value: false });
  if (data) {
    trv.questions = data.questions;
    trvRenderQuestions();
  }
});

$('trvRevealBtn').addEventListener('click', async () => trvApplyRound(await trvRequest('/reveal', 'POST')));
$('trvClearBtn').addEventListener('click', async () => trvApplyRound(await trvRequest('/clear', 'POST')));

async function trvSendTest() {
  const text = $('trvTestText').value.trim();
  if (!text) return;
  const data = await trvRequest('/test-chat', 'POST', { username: $('trvTestUser').value, text });
  if (!data) return;
  $('trvTestText').value = '';
  trvApplyRound(data);
  trvRenderBoard(data.leaderboard);
}
$('trvTestBtn').addEventListener('click', trvSendTest);
$('trvTestText').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') trvSendTest();
});

// ---- settings

const trvSettingEls = {
  timeLimitSec: $('trvTimeLimit'),
  defaultPoints: $('trvDefaultPts'),
  resultSeconds: $('trvResultSecs'),
  gapSeconds: $('trvGap'),
  playlistLoop: $('trvLoop'),
  order: $('trvOrder'),
  idleView: $('trvIdleView'),
  typoTolerance: $('trvTypo'),
  ignoreHost: $('trvIgnoreHost'),
  showLeaderboard: $('trvShowBoard'),
  palette: $('trvPalette'),
  align: $('trvAlign'),
  size: $('trvSize'),
  leaderboardSize: $('trvBoardSize'),
};

function trvShowValues() {
  $('trvSizeVal').textContent = `${trvSettingEls.size.value}%`;
  $('trvBoardSizeVal').textContent = trvSettingEls.leaderboardSize.value;
}

function trvApplySettings(s) {
  for (const [key, el] of Object.entries(trvSettingEls)) {
    if (el.type === 'checkbox') el.checked = !!s[key];
    else el.value = s[key];
  }
  trvShowValues();
  if (!trv.pointsPrefilled) {
    $('trvNewPts').value = s.defaultPoints;
    trv.pointsPrefilled = true;
  }
}

// Number boxes save when you leave them (typing "30" shouldn't send "3" first);
// sliders/selects/checkboxes save shortly after the last change.
let trvSaveTimer = 0;
function trvSaveSettings() {
  trvShowValues();
  clearTimeout(trvSaveTimer);
  trvSaveTimer = setTimeout(async () => {
    const body = {};
    for (const [key, el] of Object.entries(trvSettingEls)) {
      body[key] = el.type === 'checkbox' ? el.checked : el.type === 'number' || el.type === 'range' ? Number(el.value) : el.value;
    }
    const settings = await trvRequest('/settings', 'POST', body);
    if (settings) {
      trv.settings = settings;
      $('trvNewPts').placeholder = String(settings.defaultPoints);
      trvRenderPlaylistSummary();
    }
  }, 200);
}
Object.values(trvSettingEls).forEach((el) => {
  el.addEventListener(el.type === 'number' ? 'change' : 'input', trvSaveSettings);
});

// ---- load + poll

async function trvLoad() {
  const data = await trvRequest('');
  if (!data) {
    $('trvStatus').textContent = 'Could not load trivia';
    return;
  }
  trv.questions = data.questions;
  trv.settings = data.settings;
  trvApplySettings(data.settings);
  trvRenderQuestions();
  trvRenderBoard(data.leaderboard);
  trvApplyRound({ round: data.round });
  $('trvHostName').textContent = data.host ? `(@${data.host})` : '(set your TikTok username above)';
}
trvLoad();

setInterval(trvRenderRound, 250);
setInterval(async () => {
  if (document.hidden) return;
  try {
    const res = await fetch('/api/dashboard/trivia/round', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    trvApplyRound(data);
    trvRenderBoard(data.leaderboard);
  } catch {
    // transient — the next poll will catch up
  }
}, 1500);

// ------------------------------------- GTA 6 schedule + milestone banners
// Both run on the stream timer's clock (see server/services/gta6Milestones.js
// for how banners are fired). Times are typed as hours + minutes into the
// stream and stored as minutes.

for (const [id, path] of [['gta6SchUrl', '/gta6/schedule'], ['gta6MsUrl', '/gta6/banner']]) {
  $(id).textContent = `${location.origin}${path}`;
}
$('gta6SchCopyBtn').addEventListener('click', async () => {
  await navigator.clipboard.writeText(`${location.origin}/gta6/schedule`);
  showToast('Schedule URL copied to clipboard');
});
$('gta6MsCopyBtn').addEventListener('click', async () => {
  await navigator.clipboard.writeText(`${location.origin}/gta6/banner`);
  showToast('Milestone banner URL copied to clipboard');
});

// Plain fetch (not api()) so the server's message reaches the toast.
async function g6Req(path, method = 'GET', body) {
  try {
    const res = await fetch(`/api/dashboard/gta6${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error || `Request failed (${res.status})`);
      return null;
    }
    return data;
  } catch {
    showToast('Could not reach the server');
    return null;
  }
}

const g6Input = (type, value, attrs = {}) => {
  const el = document.createElement('input');
  el.type = type;
  el.value = value;
  Object.assign(el, attrs);
  return el;
};

/** "hr : min" boxes for a time in minutes. */
function g6TimeCell(minutes) {
  const wrap = document.createElement('div');
  wrap.className = 'g6-tr-time';
  const h = g6Input('number', Math.floor(minutes / 60), { min: '0', max: '999', step: '1', title: 'Hours into the stream' });
  const m = g6Input('number', minutes % 60, { min: '0', max: '59', step: '1', title: 'Minutes' });
  wrap.append(h, document.createTextNode(':'), m);
  return { el: wrap, h, m };
}

const g6Button = (label, title, cls, onClick) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `btn small ${cls || ''}`.trim();
  btn.textContent = label;
  btn.title = title;
  btn.addEventListener('click', onClick);
  return btn;
};

/** Settings controls → one debounced POST of all their values. */
function g6BindSettings({ els, path, onSaved }) {
  let timer = 0;
  const save = () => {
    onSaved && onSaved(null); // refresh the little "120%" labels immediately
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const body = {};
      for (const [key, el] of Object.entries(els)) {
        body[key] = el.type === 'checkbox' ? el.checked : el.type === 'number' || el.type === 'range' ? Number(el.value) : el.value;
      }
      const data = await g6Req(path, 'POST', body);
      if (data) onSaved && onSaved(data.settings || data);
    }, 200);
  };
  Object.values(els).forEach((el) => el.addEventListener(el.type === 'number' ? 'change' : 'input', save));
}

function g6FillSettings(els, settings) {
  for (const [key, el] of Object.entries(els)) {
    if (el.type === 'checkbox') el.checked = !!settings[key];
    else el.value = settings[key];
  }
}

// ---- schedule

const g6SchEls = {
  palette: $('gta6SchPalette'),
  align: $('gta6SchAlign'),
  size: $('gta6SchSize'),
  upcoming: $('gta6SchUpcoming'),
  showProgress: $('gta6SchProgress'),
  showClock: $('gta6SchClock'),
};
const g6SchLabels = () => {
  $('gta6SchSizeVal').textContent = `${g6SchEls.size.value}%`;
  $('gta6SchUpcomingVal').textContent = g6SchEls.upcoming.value;
};

function g6SchRender(blocks) {
  const list = $('gta6SchList');
  list.innerHTML = '';
  $('gta6SchEmpty').style.display = blocks.length ? 'none' : 'block';
  for (const b of blocks) {
    const row = document.createElement('div');
    row.className = 'g6-tr g6-tr-row';
    const time = g6TimeCell(b.startMin);
    const title = g6Input('text', b.title, { maxLength: 50, className: 'g6-tr-title' });
    const note = g6Input('text', b.note || '', { maxLength: 80, className: 'g6-tr-note', placeholder: 'note (optional)' });
    const save = async () => {
      const data = await g6Req(`/schedule/blocks/${b.id}`, 'PATCH', {
        hours: time.h.value,
        minutes: time.m.value,
        title: title.value,
        note: note.value,
      });
      if (data) showToast('Block saved');
      // re-draw either way: a rejected edit snaps back, and a new time re-sorts the list
      g6SchRender(data ? data.blocks : blocks);
    };
    [time.h, time.m, title, note].forEach((el) => el.addEventListener('change', save));
    const del = g6Button('✕', 'Delete block', 'danger', async () => {
      const data = await g6Req(`/schedule/blocks/${b.id}`, 'DELETE');
      if (data) g6SchRender(data.blocks);
    });
    row.append(time.el, title, note, del);
    list.appendChild(row);
  }
}

$('gta6SchAddBtn').addEventListener('click', async () => {
  const data = await g6Req('/schedule/blocks', 'POST', {
    hours: $('gta6SchH').value,
    minutes: $('gta6SchM').value,
    title: $('gta6SchTitle').value,
    note: $('gta6SchNote').value,
  });
  if (!data) return;
  for (const id of ['gta6SchTitle', 'gta6SchNote']) $(id).value = '';
  g6SchRender(data.blocks);
  $('gta6SchTitle').focus();
});
['gta6SchH', 'gta6SchM', 'gta6SchTitle', 'gta6SchNote'].forEach((id) => {
  $(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('gta6SchAddBtn').click();
  });
});
g6BindSettings({ els: g6SchEls, path: '/schedule/settings', onSaved: g6SchLabels });

(async () => {
  const data = await g6Req('/schedule');
  if (!data) return;
  g6FillSettings(g6SchEls, data.settings);
  g6SchLabels();
  g6SchRender(data.blocks);
})();

// ---- milestones

const g6MsEls = {
  seconds: $('gta6MsSeconds'),
  position: $('gta6MsPosition'),
  palette: $('gta6MsPalette'),
  size: $('gta6MsSize'),
  announceBlocks: $('gta6MsBlocks'),
};
const g6MsLabels = () => {
  $('gta6MsSizeVal').textContent = `${g6MsEls.size.value}%`;
};

function g6MsRender(list) {
  const box = $('gta6MsList');
  box.innerHTML = '';
  $('gta6MsEmpty').style.display = list.length ? 'none' : 'block';
  for (const m of list) {
    const row = document.createElement('div');
    row.className = 'g6-tr g6-tr-row';
    const time = g6TimeCell(m.atMin);
    const title = g6Input('text', m.title, { maxLength: 40, className: 'g6-tr-title' });
    const sub = g6Input('text', m.subtitle || '', { maxLength: 70, className: 'g6-tr-note', placeholder: 'subtitle (optional)' });
    const save = async () => {
      const data = await g6Req(`/milestones/${m.id}`, 'PATCH', {
        hours: time.h.value,
        minutes: time.m.value,
        title: title.value,
        subtitle: sub.value,
      });
      if (data) showToast('Milestone saved');
      g6MsRender(data ? data.milestones : list);
    };
    [time.h, time.m, title, sub].forEach((el) => el.addEventListener('change', save));
    const show = g6Button('Show now', 'Show this banner on the overlay right now', '', async () => {
      if (await g6Req(`/milestones/${m.id}/fire`, 'POST')) showToast('Banner sent to the overlay');
    });
    const del = g6Button('✕', 'Delete milestone', 'danger', async () => {
      const data = await g6Req(`/milestones/${m.id}`, 'DELETE');
      if (data) g6MsRender(data.milestones);
    });
    row.append(time.el, title, sub, show, del);
    box.appendChild(row);
  }
}

$('gta6MsAddBtn').addEventListener('click', async () => {
  const data = await g6Req('/milestones', 'POST', {
    hours: $('gta6MsH').value,
    minutes: $('gta6MsM').value,
    title: $('gta6MsTitle').value,
    subtitle: $('gta6MsSub').value,
  });
  if (!data) return;
  for (const id of ['gta6MsTitle', 'gta6MsSub']) $(id).value = '';
  g6MsRender(data.milestones);
  $('gta6MsTitle').focus();
});
['gta6MsH', 'gta6MsM', 'gta6MsTitle', 'gta6MsSub'].forEach((id) => {
  $(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('gta6MsAddBtn').click();
  });
});
$('gta6MsTestBtn').addEventListener('click', () => g6Req('/milestones/test', 'POST'));
$('gta6MsPresetsBtn').addEventListener('click', async () => {
  const data = await g6Req('/milestones/presets', 'POST');
  if (!data) return;
  g6MsRender(data.milestones);
  showToast(data.added ? `Added ${data.added} milestone${data.added === 1 ? '' : 's'}` : 'Those times are already in the list');
});
g6BindSettings({ els: g6MsEls, path: '/milestones/settings', onSaved: g6MsLabels });

(async () => {
  const data = await g6Req('/milestones');
  if (!data) return;
  g6FillSettings(g6MsEls, data.settings);
  g6MsLabels();
  g6MsRender(data.milestones);
})();
