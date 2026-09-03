// Parses TikFinity's raw gift-event payload into a clean shape the growth
// engine understands. This is the ONLY place that knows what TikFinity's
// field names look like — kept deliberately separate from treeEvents.js so
// that if TikFinity ever changes their format, only this file needs to
// change, not the growth engine or the local bridge script.
//
// Field names verified against TikFinity's own local-widget WebSocket
// contract (ws://127.0.0.1:21213/, envelope `{ event: "gift", data: {...} }`)
// as consumed by a real third-party TikFinity overlay project
// (github.com/darinh/tiktok-overlays) — TikFinity's own docs pages are
// client-rendered and didn't expose the raw schema directly, so this reads
// several plausible field-name variants defensively rather than assuming
// one exact shape, the same defensive approach that project uses.
function pick(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * @param {object} raw the full raw message the bridge forwarded (the
 *   TikFinity envelope, e.g. `{ event: "gift", data: {...} }`)
 * @returns {null|object} null if this isn't a *finished* gift event (wrong
 *   type, or mid-combo-streak — see repeatEnd below); otherwise
 *   { giftName, giftId, diamondCount, repeatCount, username }
 */
function parseGiftEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const eventType = String(pick(raw.event, raw.type, raw.eventType, '')).toLowerCase();
  if (eventType && eventType !== 'gift') return null;

  const d = raw.data && typeof raw.data === 'object' ? raw.data : raw;
  const details = d.giftDetails || d.gift || {};
  const user = d.user || {};

  // TikTok streaks combo-able gifts (Rose x1, x2, x3...) as repeated events
  // with a growing repeatCount; only the last one is marked repeatEnd. A
  // non-streakable gift has no repeatEnd field at all. Either way, treating
  // "repeatEnd === false" as "still streaking, wait for the final one" and
  // everything else as final is what prevents double-counting a combo.
  const repeatEndRaw = pick(d.repeatEnd, d.repeat_end);
  const repeatEnd = repeatEndRaw === undefined ? true : repeatEndRaw === true || repeatEndRaw === 'true';
  if (!repeatEnd) return null;

  const giftName = String(pick(d.giftName, details.giftName, d.gift_name, 'Gift'));
  const giftId = pick(d.giftId, details.giftId, d.gift_id);
  const diamondCount = Math.max(0, num(pick(d.diamondCount, details.diamondCount, d.diamond_count, d.coins), 0));
  const repeatCount = Math.max(1, Math.floor(num(pick(d.repeatCount, d.repeat_count, d.comboCount), 1)));
  const username = String(
    pick(d.uniqueId, user.uniqueId, d.nickname, user.nickname, d.userId, user.userId, 'someone')
  ).slice(0, 40);

  return {
    giftName,
    giftId: giftId !== undefined ? String(giftId) : null,
    diamondCount,
    repeatCount,
    username,
  };
}

module.exports = { parseGiftEvent };
