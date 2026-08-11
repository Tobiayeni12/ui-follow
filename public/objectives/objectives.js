import { ReconnectingSocket } from '/overlay/wsClient.js';

const initial = window.__INITIAL_STATE__;

const stageEl = document.getElementById('stage');
const listEl = document.getElementById('list');
const currentTextEl = document.getElementById('currentText');
const canvas = document.getElementById('fx');
const ctx = canvas.getContext('2d');

const rowEls = new Map(); // id -> element
let prevDone = new Map(); // id -> done, from the previous render
let prevCurrentId = null;
let currentSettings = initial.settings || {};

// ------------------------------------------------------------ appearance

const SETTINGS_TO_CSS_VAR = {
  bgColor: '--obj-bg',
  borderColor: '--obj-border',
  labelColor: '--obj-label',
  currentTextColor: '--obj-current-text',
  itemTextColor: '--obj-item-text',
  doneTextColor: '--obj-done-text',
  accentColor: '--obj-accent',
};

function applySettings(settings) {
  currentSettings = { ...currentSettings, ...settings };
  for (const [key, cssVar] of Object.entries(SETTINGS_TO_CSS_VAR)) {
    if (currentSettings[key]) stageEl.style.setProperty(cssVar, currentSettings[key]);
  }
}

applySettings(initial.settings || {});

// ---------------------------------------------------------------- canvas fx

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

let particles = [];

function burstAt(x, y) {
  // Small, blocky "pixel dust" burst — square specks to match the retro look.
  const colors = [currentSettings.accentColor || '#ffe066', currentSettings.borderColor || '#f4f4f4'];
  for (let i = 0; i < 10; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 1.8;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.5,
      life: 1,
      decay: 0.03 + Math.random() * 0.02,
      size: 2 + Math.random() * 2,
      color: colors[i % colors.length],
    });
  }
}

function tickParticles() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  particles.forEach((p) => {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.06;
    p.life -= p.decay;
  });
  particles = particles.filter((p) => p.life > 0);
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  requestAnimationFrame(tickParticles);
}
requestAnimationFrame(tickParticles);

// ------------------------------------------------------------- row element

function buildRow(objective) {
  const row = document.createElement('div');
  row.className = 'item-box pixel-box';
  row.dataset.id = objective.id;

  const text = document.createElement('div');
  text.className = 'item-text';
  text.textContent = objective.text;
  row.appendChild(text);

  const checkbox = document.createElement('div');
  checkbox.className = 'item-checkbox';
  row.appendChild(checkbox);

  return row;
}

function render(objectives) {
  const current = objectives.find((o) => !o.done) || null;
  const rest = objectives.filter((o) => o.id !== current?.id);

  stageEl.classList.toggle('is-empty', objectives.length === 0);

  // Current objective — crossfade when it changes.
  if (current?.id !== prevCurrentId) {
    currentTextEl.classList.add('swap');
    setTimeout(() => {
      currentTextEl.textContent = current ? current.text : 'All objectives complete!';
      currentTextEl.classList.toggle('all-done', !current && objectives.length > 0);
      currentTextEl.classList.remove('swap');
    }, 180);
  } else if (current) {
    currentTextEl.textContent = current.text;
  }
  prevCurrentId = current?.id ?? null;

  // Checklist rows for everything except the current objective.
  const seenIds = new Set();
  const nextDone = new Map();

  rest.forEach((obj, index) => {
    seenIds.add(obj.id);
    nextDone.set(obj.id, obj.done);

    let row = rowEls.get(obj.id);
    if (!row) {
      row = buildRow(obj);
      rowEls.set(obj.id, row);
      listEl.appendChild(row);
    } else {
      row.querySelector('.item-text').textContent = obj.text;
      if (listEl.children[index] !== row) {
        listEl.insertBefore(row, listEl.children[index] || null);
      }
    }

    const wasDone = prevDone.get(obj.id);
    row.classList.toggle('done', !!obj.done);

    if (obj.done && wasDone === false) {
      const rect = row.querySelector('.item-checkbox').getBoundingClientRect();
      burstAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
  });

  for (const [id, row] of rowEls) {
    if (!seenIds.has(id)) {
      row.classList.add('leaving');
      setTimeout(() => row.remove(), 200);
      rowEls.delete(id);
    }
  }

  prevDone = nextDone;
}

render(initial.objectives || []);

new ReconnectingSocket({
  channel: initial.channel || 'objectives',
  onMessage(msg) {
    if (msg.type === 'objectives_update') {
      render(msg.data.objectives || []);
    } else if (msg.type === 'objectives_settings_update') {
      applySettings(msg.data || {});
    }
  },
});
