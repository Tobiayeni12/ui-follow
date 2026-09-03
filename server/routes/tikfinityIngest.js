// Receives gift events forwarded by the local TikFinity bridge script
// (scripts/tikfinity-bridge.js). This is the ONLY entry point real TikTok
// gifts have into the Community Tree — it does the TikFinity-specific
// parsing (tikfinityGiftParser.js) and then calls the exact same
// treeEvents functions the dashboard's test buttons use, with
// isTest: false so the growth always reaches the live overlay.
//
// Protected by a shared secret (TIKFINITY_BRIDGE_SECRET), not the
// dashboard's cookie session — a standalone script running on the
// streamer's own PC can't hold a browser login.
const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { parseGiftEvent } = require('../services/tikfinityGiftParser');
const treeEvents = require('../services/treeEvents');

const router = express.Router();
router.use(express.json());

const ingestLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120, // generous — a big streak sends one request per intermediate combo tick
  standardHeaders: true,
  legacyHeaders: false,
});

function requireBridgeSecret(req, res, next) {
  const provided = req.get('X-Bridge-Secret') || '';
  if (!config.tikfinityBridgeSecret || provided !== config.tikfinityBridgeSecret) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// In-memory only (not persisted) — just lets the dashboard show "is the
// bridge actually reaching me" without needing to watch a terminal.
let lastEvent = null; // { at, username, giftName, repeatCount, growth, wasIgnored }

router.post('/api/tikfinity/gift', ingestLimiter, requireBridgeSecret, async (req, res) => {
  const parsed = parseGiftEvent(req.body);
  if (!parsed) {
    // Not an error — most likely a mid-combo streak update (repeatEnd
    // false) or a non-gift event the bridge forwarded; both are expected
    // and intentionally ignored, not failures.
    lastEvent = { at: Date.now(), wasIgnored: true };
    return res.json({ ok: true, ignored: true });
  }

  const perGiftGrowth = await treeEvents.growthForGift(parsed.giftName, parsed.diamondCount);
  const totalGrowth = perGiftGrowth * parsed.repeatCount;

  console.log(
    `[tikfinity] gift received: @${parsed.username} sent "${parsed.giftName}" x${parsed.repeatCount} ` +
      `(${parsed.diamondCount} diamonds each) -> +${totalGrowth} growth`
  );

  const message = await treeEvents.addGrowth(totalGrowth, 'gift', parsed.username, {
    isTest: false,
    giftName: parsed.giftName,
  });

  lastEvent = {
    at: Date.now(),
    username: parsed.username,
    giftName: parsed.giftName,
    repeatCount: parsed.repeatCount,
    growth: totalGrowth,
    wasIgnored: false,
  };

  res.json({ ok: true, growth: totalGrowth, message });
});

function getLastEvent() {
  return lastEvent;
}

module.exports = { router, getLastEvent };
