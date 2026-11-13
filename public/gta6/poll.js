import { ReconnectingSocket } from '/overlay/wsClient.js';
import { fitToViewport } from '/gta6/digits.js';

// Draws the chat poll the server describes: question, live bars, countdown and
// (when voting ends) the winner. Read-only; the server counts the votes.

const raw = window.__INITIAL_STATE__;
const initial = raw && typeof raw === 'object' ? raw : {};

const stage = document.getElementById('stage');
const widget = document.getElementById('polWidget');
const card = stage.querySelector('.pol-card');
const totalEl = document.getElementById('polTotal');
const timeEl = document.getElementById('polTime');
const questionEl = document.getElementById('polQuestion');
const optsEl = document.getElementById('polOpts');
const footEl = document.getElementById('polFoot');
const hintEl = document.getElementById('polHint');

const isPreview = !!initial.preview;
let snap = null;
let offset = 0; // server clock − this clock
let lastId = null;
const rowEls = [];

function fit() {
  fitToViewport(widget);
}

function applySettings(s) {
  stage.dataset.palette = s.palette || 'sunset';
  stage.dataset.align = s.align || 'center';
  stage.style.setProperty('--pol-scale', String((s.size || 100) / 100));
}

function buildRow(i) {
  const li = document.createElement('li');
  li.className = 'pol-opt';
  li.innerHTML = '<span class="pol-fill"></span><span class="pol-num"></span><span class="pol-text"></span><span class="pol-pct"></span>';
  li.querySelector('.pol-num').textContent = String(i + 1);
  return li;
}

function render() {
  const { poll, settings } = snap;
  applySettings(settings);
  const idle = poll.status === 'idle';
  stage.classList.toggle('is-off', idle);
  stage.classList.toggle('preview', isPreview);
  hintEl.hidden = !(isPreview && idle);
  if (idle) {
    lastId = null;
    return;
  }

  if (poll.id !== lastId) {
    card.classList.remove('pop-in');
    // eslint-disable-next-line no-unused-expressions
    card.offsetWidth; // restart the animation
    card.classList.add('pop-in');
    lastId = poll.id;
  }
  card.classList.toggle('closed', poll.status === 'closed');
  questionEl.textContent = poll.question;
  totalEl.textContent = `${poll.total.toLocaleString('en-US')} vote${poll.total === 1 ? '' : 's'}`;

  while (rowEls.length < poll.options.length) {
    const row = buildRow(rowEls.length);
    rowEls.push(row);
    optsEl.appendChild(row);
  }
  while (rowEls.length > poll.options.length) rowEls.pop().remove();
  poll.options.forEach((o, i) => {
    const row = rowEls[i];
    row.querySelector('.pol-text').textContent = o.text;
    row.querySelector('.pol-pct').textContent = `${Math.round(o.pct)}%`;
    row.querySelector('.pol-fill').style.width = `${o.pct}%`;
    row.classList.toggle('win', poll.status === 'closed' && poll.winners.includes(i));
  });

  const n = poll.options.length;
  const list = Array.from({ length: n }, (_, i) => i + 1);
  const how = n === 2 ? '1 or 2' : `${list.slice(0, -1).join(', ')} or ${n}`;
  footEl.textContent =
    poll.status === 'closed'
      ? poll.winners.length === 0
        ? 'No votes'
        : poll.winners.length > 1
          ? "It's a tie"
          : 'Voting is closed'
      : `Type ${how} in chat to vote`;
  tick();
  fit();
}

// the countdown is derived from the server's end time, so it stays right through lag and refreshes
function tick() {
  if (!snap) return;
  const { poll } = snap;
  if (poll.status === 'closed') {
    timeEl.textContent = 'FINAL';
    card.classList.remove('low');
  } else if (poll.status === 'open') {
    if (poll.endsAt) {
      const s = Math.ceil(Math.max(0, poll.endsAt - (Date.now() + offset)) / 1000);
      timeEl.textContent = `${s}s`;
      card.classList.toggle('low', s <= 5 && s > 0);
    } else {
      timeEl.textContent = 'OPEN';
      card.classList.remove('low');
    }
  }
}
setInterval(tick, 250);

// two updates in quick succession can cross on the wire: drop a stale one
// (ordered by the server's clock, then its counter, which survives a restart)
function accept(next) {
  if (!next || !next.poll) return;
  if (snap && (next.serverTime < snap.serverTime || (next.serverTime === snap.serverTime && next.rev <= snap.rev))) return;
  snap = next;
  offset = next.serverTime - Date.now();
  render();
}

accept(initial.snapshot);
window.addEventListener('resize', fit);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);

async function resync() {
  try {
    const res = await fetch('/api/gta6/poll', { cache: 'no-store' });
    if (res.ok) accept(await res.json());
  } catch {
    // keep what we have
  }
}

new ReconnectingSocket({
  channel: initial.channel || 'gta6-poll',
  onOpen: resync,
  onMessage(msg) {
    if (msg && msg.type === 'gta6:poll') accept(msg);
  },
});
