import { ReconnectingSocket } from '/overlay/wsClient.js';
import { fitToViewport } from '/gta6/digits.js';

// A GTA 6-styled objectives checklist with its own list and look settings
// (managed from the dashboard's GTA 6 section). Read-only here: this page
// only draws whatever the server broadcasts.

const raw = window.__INITIAL_STATE__;
const initial = raw && typeof raw === 'object' ? raw : {};

const stage = document.getElementById('stage');
const widget = document.getElementById('objWidget');
const titleRow = document.getElementById('objTitleRow');
const titleEl = document.getElementById('objTitle');
const currentEl = document.getElementById('objCurrent');
const kickerEl = document.getElementById('objKicker');
const currentTextEl = document.getElementById('objCurrentText');
const listEl = document.getElementById('objList');
const moreEl = document.getElementById('objMore');
const progressEl = document.getElementById('objProgress');
const fillEl = document.getElementById('objFill');
const countEl = document.getElementById('objCount');
const pctEl = document.getElementById('objPct');
const hintEl = document.getElementById('objHint');

const rowEls = new Map(); // id -> <li>
let prevDone = new Map(); // id -> done, from the previous render
let prevCurrentId; // undefined until the first render, so the first paint isn't animated
let firstRender = true;
let objectives = Array.isArray(initial.objectives) ? initial.objectives : [];
let settings = { ...(initial.settings || {}) };
const isPreview = !!initial.preview;

function fit() {
  fitToViewport(widget);
}

// ------------------------------------------------------------ appearance

function applySettings() {
  stage.dataset.palette = settings.palette || 'sunset';
  stage.dataset.align = settings.align || 'left';
  stage.style.setProperty('--obj-scale', String((settings.size || 100) / 100));
  stage.style.setProperty('--obj-bg', String((settings.bgOpacity ?? 40) / 100));
  const title = settings.title || '';
  titleEl.textContent = title;
  titleRow.hidden = !title;
  progressEl.hidden = settings.showProgress === false;
}

// ---------------------------------------------------------------- rows

function buildRow(obj) {
  const row = document.createElement('li');
  row.className = 'obj-row';
  row.dataset.id = obj.id;

  const box = document.createElement('span');
  box.className = 'obj-check';
  row.appendChild(box);

  const text = document.createElement('span');
  text.className = 'obj-text';
  row.appendChild(text);
  return row;
}

/**
 * Which of the non-current objectives to show. Over the limit, finished ones
 * drop off first (oldest first) so what's still ahead stays visible; only
 * then are upcoming ones cut from the end ("+N more").
 */
function pickVisible(rest) {
  let visible = settings.showCompleted === false ? rest.filter((o) => !o.done) : rest.slice();
  const max = settings.maxVisible || 6;
  while (visible.length > max) {
    const doneIdx = visible.findIndex((o) => o.done);
    if (doneIdx !== -1) visible.splice(doneIdx, 1);
    else visible.pop();
  }
  return visible;
}

function render() {
  const total = objectives.length;
  const doneCount = objectives.filter((o) => o.done).length;
  const current = objectives.find((o) => !o.done) || null;
  const rest = objectives.filter((o) => o.id !== current?.id);
  const visible = pickVisible(rest);
  const hiddenPending = rest.filter((o) => !o.done && !visible.includes(o)).length;

  stage.classList.toggle('is-empty', total === 0);
  hintEl.hidden = !(total === 0 && isPreview);

  // current objective
  const allDone = total > 0 && !current;
  currentEl.hidden = total === 0;
  currentEl.classList.toggle('all-done', allDone);
  kickerEl.textContent = allDone ? 'Complete' : 'Current';
  const currentText = current ? current.text : allDone ? 'All objectives complete' : '';
  if (current?.id !== prevCurrentId && prevCurrentId !== undefined) {
    // the focus moved on (a ticked-off objective, a reorder): swap with a short fade
    currentTextEl.classList.add('swap');
    setTimeout(() => {
      currentTextEl.textContent = currentText;
      currentTextEl.classList.remove('swap');
      fit();
    }, 180);
  } else {
    currentTextEl.textContent = currentText;
  }
  prevCurrentId = current?.id ?? null;

  // checklist
  const shown = new Set();
  const nextDone = new Map();
  visible.forEach((obj, index) => {
    shown.add(obj.id);
    nextDone.set(obj.id, obj.done);

    let row = rowEls.get(obj.id);
    if (!row) {
      row = buildRow(obj);
      rowEls.set(obj.id, row);
      if (!firstRender) row.classList.add('enter'); // slide in only for rows added while live
    }
    row.querySelector('.obj-text').textContent = obj.text;
    if (listEl.children[index] !== row) listEl.insertBefore(row, listEl.children[index] || null);

    row.classList.toggle('done', !!obj.done);
    if (obj.done && prevDone.get(obj.id) === false) {
      row.classList.remove('just-done');
      // eslint-disable-next-line no-unused-expressions
      row.offsetWidth; // restart the animation
      row.classList.add('just-done');
    }
  });
  for (const [id, row] of rowEls) {
    if (shown.has(id)) continue;
    rowEls.delete(id);
    row.classList.add('leaving');
    setTimeout(() => {
      row.remove();
      fit();
    }, 200);
  }
  prevDone = nextDone;

  moreEl.hidden = hiddenPending === 0;
  moreEl.textContent = `+${hiddenPending} more`;

  // progress
  const pct = total ? (doneCount / total) * 100 : 0;
  fillEl.style.setProperty('--rest', `${(100 - pct).toFixed(2)}%`);
  countEl.textContent = `${doneCount} / ${total} complete`;
  pctEl.textContent = `${Math.floor(pct)}%`;

  firstRender = false;
  fit();
}

applySettings();
render();
window.addEventListener('resize', fit);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);

// After any socket drop, re-read the real list so a missed update can't
// leave the overlay stale.
async function resync() {
  try {
    const res = await fetch('/api/gta6/objectives', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data.objectives)) objectives = data.objectives;
    if (data.settings) settings = { ...settings, ...data.settings };
    applySettings();
    render();
  } catch {
    // keep showing what we have
  }
}

new ReconnectingSocket({
  channel: initial.channel || 'gta6-objectives',
  onOpen: resync,
  onMessage(msg) {
    if (!msg || !msg.type) return;
    if (msg.type === 'gta6:objectives') {
      objectives = (msg.data && msg.data.objectives) || [];
      render();
    } else if (msg.type === 'gta6:objectives_settings') {
      settings = { ...settings, ...(msg.data || {}) };
      applySettings();
      render();
    }
  },
});
