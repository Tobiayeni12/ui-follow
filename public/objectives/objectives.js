import { ReconnectingSocket } from '/overlay/wsClient.js';

const initial = window.__INITIAL_STATE__;

const stageEl = document.getElementById('stage');
const listEl = document.getElementById('list');
const progressFillEl = document.getElementById('progressFill');
const progressTextEl = document.getElementById('progressText');
const canvas = document.getElementById('fx');
const ctx = canvas.getContext('2d');

const SVG_NS = 'http://www.w3.org/2000/svg';
const cardEls = new Map(); // id -> element
let prevDone = new Map(); // id -> done, from the previous render

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
  const colors = ['#7cfbff', '#ff6fa5', '#ffffff'];
  for (let i = 0; i < 18; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.2 + Math.random() * 2.2;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.6,
      life: 1,
      decay: 0.018 + Math.random() * 0.014,
      size: 2 + Math.random() * 2.5,
      color: colors[i % colors.length],
    });
  }
}

function tickParticles() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  particles.forEach((p) => {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.05;
    p.life -= p.decay;
  });
  particles = particles.filter((p) => p.life > 0);
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  requestAnimationFrame(tickParticles);
}
requestAnimationFrame(tickParticles);

// ------------------------------------------------------------ card element

function buildCard(objective) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.id = objective.id;

  const accent = document.createElement('div');
  accent.className = 'accent';
  card.appendChild(accent);

  const checkbox = document.createElement('div');
  checkbox.className = 'checkbox';
  checkbox.innerHTML = `
    <svg viewBox="0 0 36 36">
      <defs>
        <linearGradient id="checkGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#7cfbff" />
          <stop offset="1" stop-color="#ff6fa5" />
        </linearGradient>
      </defs>
      <circle class="fill" cx="18" cy="18" r="15" />
      <circle class="ring" cx="18" cy="18" r="15" />
      <path class="check" d="M10 18.5 L15.5 24 L26.5 11.5" />
    </svg>
  `;
  card.appendChild(checkbox);

  const text = document.createElement('div');
  text.className = 'text';
  const strike = document.createElement('span');
  strike.className = 'strike';
  text.appendChild(strike);
  text.appendChild(document.createTextNode(objective.text));
  card.appendChild(text);

  return card;
}

function render(objectives) {
  stageEl.classList.toggle('is-empty', objectives.length === 0);

  const seenIds = new Set();
  const nextDone = new Map();

  objectives.forEach((obj, index) => {
    seenIds.add(obj.id);
    nextDone.set(obj.id, obj.done);

    let card = cardEls.get(obj.id);
    if (!card) {
      card = buildCard(obj);
      card.style.setProperty('--stagger', `${Math.min(index, 8) * 0.06}s`);
      cardEls.set(obj.id, card);
      listEl.appendChild(card);
    } else {
      const textNode = card.querySelector('.text');
      // Preserve the .strike element, just update the trailing text node.
      const lastChild = textNode.lastChild;
      if (lastChild && lastChild.nodeType === Node.TEXT_NODE) {
        lastChild.textContent = obj.text;
      }
      if (listEl.children[index] !== card) {
        listEl.insertBefore(card, listEl.children[index] || null);
      }
    }

    const wasDone = prevDone.get(obj.id);
    card.classList.toggle('done', !!obj.done);

    if (obj.done && wasDone === false) {
      const rect = card.querySelector('.checkbox').getBoundingClientRect();
      burstAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
  });

  for (const [id, card] of cardEls) {
    if (!seenIds.has(id)) {
      card.classList.add('leaving');
      setTimeout(() => card.remove(), 300);
      cardEls.delete(id);
    }
  }

  const total = objectives.length;
  const done = objectives.filter((o) => o.done).length;
  const pct = total > 0 ? (done / total) * 100 : 0;
  progressFillEl.style.width = `${pct}%`;
  progressTextEl.textContent = `${done} / ${total} complete`;

  prevDone = nextDone;
}

render(initial.objectives || []);

new ReconnectingSocket({
  channel: initial.channel || 'objectives',
  onMessage(msg) {
    if (msg.type === 'objectives_update') {
      render(msg.data.objectives || []);
    }
  },
});
