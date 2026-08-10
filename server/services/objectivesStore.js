// Persists the "Current Objectives" checklist shown on /objectives.
// Checking items off happens only from the dashboard (see routes/dashboardObjectives.js) —
// the public overlay is read-only, consistent with the rest of this app.
const crypto = require('crypto');
const storage = require('./storage');

const KEY = 'objectives_list';
const MAX_TEXT_LENGTH = 140;
const MAX_OBJECTIVES = 50;

async function getObjectives() {
  const list = await storage.get(KEY, []);
  return Array.isArray(list) ? list : [];
}

async function addObjective(text) {
  const clean = sanitizeText(text);
  if (!clean) throw new Error('Objective text is required');
  const list = await getObjectives();
  if (list.length >= MAX_OBJECTIVES) throw new Error(`Cannot exceed ${MAX_OBJECTIVES} objectives`);
  const objective = { id: crypto.randomUUID(), text: clean, done: false };
  const next = [...list, objective];
  await storage.set(KEY, next);
  return next;
}

async function updateObjective(id, { text, done } = {}) {
  const list = await getObjectives();
  let found = false;
  const next = list.map((obj) => {
    if (obj.id !== id) return obj;
    found = true;
    const updated = { ...obj };
    if (text !== undefined) {
      const clean = sanitizeText(text);
      if (!clean) throw new Error('Objective text is required');
      updated.text = clean;
    }
    if (done !== undefined) updated.done = !!done;
    return updated;
  });
  if (!found) throw new Error('Objective not found');
  await storage.set(KEY, next);
  return next;
}

async function deleteObjective(id) {
  const list = await getObjectives();
  const next = list.filter((obj) => obj.id !== id);
  await storage.set(KEY, next);
  return next;
}

async function reorderObjectives(orderedIds) {
  const list = await getObjectives();
  const byId = new Map(list.map((obj) => [obj.id, obj]));
  const next = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  // Keep any objectives not mentioned in orderedIds (defensive, shouldn't happen).
  for (const obj of list) {
    if (!orderedIds.includes(obj.id)) next.push(obj);
  }
  await storage.set(KEY, next);
  return next;
}

function sanitizeText(text) {
  return String(text || '').trim().slice(0, MAX_TEXT_LENGTH);
}

module.exports = { getObjectives, addObjective, updateObjective, deleteObjective, reorderObjectives };
