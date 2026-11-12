import { ReconnectingSocket } from '/overlay/wsClient.js';
import { fitToViewport } from '/gta6/digits.js';

// Draws whatever the server says the trivia game looks like. Read-only: the
// streamer runs the game from the dashboard, and the server decides who won.
// (Snapshots never contain the answer while a question is live.)

const raw = window.__INITIAL_STATE__;
const initial = raw && typeof raw === 'object' ? raw : {};

const stage = document.getElementById('stage');
const widget = document.getElementById('trvWidget');
const card = document.getElementById('trvCard');
const ptsEl = document.getElementById('trvPts');
const timeEl = document.getElementById('trvTime');
const questionEl = document.getElementById('trvQuestion');
const fillEl = document.getElementById('trvFill');
const resultEl = document.getElementById('trvResult');
const resultTitleEl = document.getElementById('trvResultTitle');
const answerEl = document.getElementById('trvAnswer');
const boardEl = document.getElementById('trvBoard');
const rowsEl = document.getElementById('trvRows');

const isPreview = !!initial.preview;
let snap = null; // latest snapshot
let offset = 0; // server clock − this clock
let lastRoundId = null;
let lastStatus = null;
const rowEls = new Map(); // leaderboard key -> <li>

function fit() {
  fitToViewport(widget);
}

function applySettings(s) {
  stage.dataset.palette = s.palette || 'sunset';
  stage.dataset.align = s.align || 'center';
  stage.style.setProperty('--trv-scale', String((s.size || 100) / 100));
}

// ---------------------------------------------------------- leaderboard

function renderBoard(entries, winnerKey, gain) {
  const seen = new Set();
  entries.forEach((e, i) => {
    seen.add(e.key);
    let row = rowEls.get(e.key);
    if (!row) {
      row = document.createElement('li');
      row.className = 'trv-row';
      row.innerHTML = '<span class="trv-rank"></span><span class="trv-name"></span><span class="trv-score"></span>';
      rowEls.set(e.key, row);
    }
    row.querySelector('.trv-rank').textContent = String(e.rank);
    row.querySelector('.trv-name').textContent = e.name;
    row.querySelector('.trv-score').textContent = e.points.toLocaleString('en-US');
    if (rowsEl.children[i] !== row) rowsEl.insertBefore(row, rowsEl.children[i] || null);

    const gainEl = row.querySelector('.trv-gain');
    if (winnerKey && e.key === winnerKey) {
      if (!gainEl) {
        const g = document.createElement('span');
        g.className = 'trv-gain';
        g.textContent = `+${gain}`;
        row.insertBefore(g, row.querySelector('.trv-score'));
      }
      row.classList.remove('just-won');
      // eslint-disable-next-line no-unused-expressions
      row.offsetWidth; // restart the animation
      row.classList.add('just-won');
    } else if (gainEl) {
      gainEl.remove();
    }
  });
  for (const [key, row] of rowEls) {
    if (!seen.has(key)) {
      row.remove();
      rowEls.delete(key);
    }
  }
}

// ----------------------------------------------------------------- render

function render() {
  const { round, leaderboard, settings } = snap;
  applySettings(settings);

  const idle = round.status === 'idle';
  // between questions: only if the streamer chose to, or a playlist has just finished
  const showBoard =
    leaderboard.length > 0 &&
    (idle ? settings.idleView === 'leaderboard' || snap.finale : settings.showLeaderboard !== false);

  card.hidden = idle;
  boardEl.hidden = !showBoard;
  stage.classList.toggle('is-off', idle && !showBoard && !isPreview);

  if (!idle) {
    const newRound = round.id !== lastRoundId;
    questionEl.textContent = round.question ? round.question.text : '';
    ptsEl.textContent = round.question ? `+${round.question.points} pts` : '';
    card.classList.toggle('is-active', round.status === 'active');
    card.classList.toggle('is-solved', round.status === 'solved');
    card.classList.toggle('is-expired', round.status === 'expired');
    if (newRound) {
      card.classList.remove('pop-in');
      // eslint-disable-next-line no-unused-expressions
      card.offsetWidth; // restart the animation
      card.classList.add('pop-in');
    }

    const ended = round.status !== 'active';
    resultEl.hidden = !ended;
    if (ended) {
      resultTitleEl.textContent =
        round.status === 'solved' ? `${round.winner.name} got it!` : "Time's up — nobody got it";
      answerEl.textContent = round.answer || '';
    }
  }

  const justSolved = round.status === 'solved' && lastStatus !== 'solved';
  renderBoard(
    showBoard ? leaderboard : [],
    justSolved && round.winner ? round.winner.key : null,
    round.winner ? round.winner.points : 0
  );

  lastRoundId = round.id;
  lastStatus = round.status;
  tick();
  fit();
}

// The countdown is derived from the server's end time (and clock), not
// counted down locally, so it stays right through refreshes and lag.
function tick() {
  if (!snap || snap.round.status !== 'active') return;
  const { endsAt, timeLimitMs } = snap.round;
  const remaining = Math.max(0, endsAt - (Date.now() + offset));
  const pct = timeLimitMs ? (remaining / timeLimitMs) * 100 : 0;
  fillEl.style.setProperty('--rest', `${(100 - pct).toFixed(2)}%`);
  const seconds = Math.ceil(remaining / 1000);
  timeEl.textContent = String(seconds);
  card.classList.toggle('low', seconds <= 5 && seconds > 0);
}
setInterval(tick, 100);

// Ignore a snapshot that arrives after a newer one (two updates in quick
// succession can cross on the wire). Ordered by the server's clock, then its
// counter; the clock part keeps working across a server restart.
function accept(next) {
  if (!next || !next.round || !Array.isArray(next.leaderboard)) return;
  if (snap && (next.serverTime < snap.serverTime || (next.serverTime === snap.serverTime && next.rev <= snap.rev))) {
    return;
  }
  snap = next;
  offset = next.serverTime - Date.now();
  render();
}

accept(initial.snapshot);
window.addEventListener('resize', fit);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);

// After a socket drop, re-read the real state so a missed update can't leave
// a finished question on screen (or hide a running one).
async function resync() {
  try {
    const res = await fetch('/api/trivia', { cache: 'no-store' });
    if (res.ok) accept(await res.json());
  } catch {
    // keep what we have
  }
}

new ReconnectingSocket({
  channel: initial.channel || 'trivia',
  onOpen: resync,
  onMessage(msg) {
    if (msg && msg.type === 'trivia:snapshot') accept(msg);
  },
});
