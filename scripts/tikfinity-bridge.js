#!/usr/bin/env node
// Runs LOCALLY, on the same computer as the TikFinity desktop app — NOT
// deployed to Render. TikFinity only exposes its event feed on
// 127.0.0.1 (loopback), which your deployed site cannot reach directly, so
// this small bridge is what carries real gift events from your machine to
// your live overlay: TikFinity -> this script -> your deployed site's
// /api/tikfinity/gift -> the Community Tree.
//
// This file intentionally does almost no TikTok/TikFinity-format parsing
// itself (just enough to avoid forwarding every single like/chat message)
// — the real field-name parsing lives server-side in
// server/services/tikfinityGiftParser.js, so if TikFinity ever changes
// their payload shape, only that file needs updating and redeploying, not
// this script sitting on your PC.
//
// Setup:
//   1. Have the TikFinity desktop app open and connected to your TikTok
//      account (see https://tikfinity.zerody.one).
//   2. Set two environment variables (or edit the constants below):
//        TREE_SITE_URL         e.g. https://tiktok-3d-counter.onrender.com
//        TIKFINITY_BRIDGE_SECRET   the value shown in your dashboard's
//                                  Community Tree panel (must match the
//                                  server's TIKFINITY_BRIDGE_SECRET)
//   3. Run:  npm run tikfinity-bridge
//   4. Leave this running in a terminal for the length of your stream.

const WebSocket = require('ws');

// 'localhost' and '127.0.0.1' resolve to the same place — using the exact
// form confirmed against a real TikFinity install rather than the
// equivalent-but-unconfirmed alternative. Override with TIKFINITY_WS_URL if
// yours differs.
const TIKFINITY_WS_URL = process.env.TIKFINITY_WS_URL || 'ws://localhost:21213/';
const TREE_SITE_URL = (process.env.TREE_SITE_URL || '').replace(/\/$/, '');
const BRIDGE_SECRET = process.env.TIKFINITY_BRIDGE_SECRET || '';

if (!TREE_SITE_URL || !BRIDGE_SECRET) {
  console.error('\n[tikfinity-bridge] Missing configuration. Set both:');
  console.error('  TREE_SITE_URL          — your deployed site, e.g. https://tiktok-3d-counter.onrender.com');
  console.error('  TIKFINITY_BRIDGE_SECRET — copy this from your dashboard\'s Community Tree panel\n');
  console.error('Example:');
  console.error('  TREE_SITE_URL=https://your-site.onrender.com TIKFINITY_BRIDGE_SECRET=xxxx npm run tikfinity-bridge\n');
  process.exit(1);
}

const INGEST_URL = `${TREE_SITE_URL}/api/tikfinity/gift`;

let attempt = 0;

function connect() {
  console.log(`[tikfinity-bridge] Connecting to TikFinity at ${TIKFINITY_WS_URL} ...`);
  const socket = new WebSocket(TIKFINITY_WS_URL);

  socket.on('open', () => {
    attempt = 0;
    console.log('[tikfinity-bridge] Connected to TikFinity. Waiting for gift events...');
    console.log(`[tikfinity-bridge] Forwarding gifts to ${INGEST_URL}`);
  });

  socket.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      return; // not JSON — ignore rather than crash the bridge over one bad frame
    }

    // Light type-check only, so we don't forward every like/comment/viewer
    // update over the network — the real "is this a *finished* gift" check
    // (repeatEnd, event shape) happens server-side.
    const eventType = String(msg?.event || msg?.type || msg?.eventType || '').toLowerCase();
    if (eventType && eventType !== 'gift') return;
    if (!eventType && !(msg?.data?.giftName || msg?.giftName)) return; // no event field at all and doesn't look gift-shaped

    forwardGift(msg);
  });

  socket.on('close', () => {
    scheduleReconnect();
  });

  socket.on('error', (err) => {
    console.error('[tikfinity-bridge] WebSocket error:', err.message);
    socket.close();
  });
}

function scheduleReconnect() {
  attempt += 1;
  const delayMs = Math.min(30000, 1000 * 2 ** attempt);
  console.log(`[tikfinity-bridge] Disconnected from TikFinity. Reconnecting in ${Math.round(delayMs / 1000)}s...`);
  setTimeout(connect, delayMs);
}

async function forwardGift(msg) {
  try {
    const res = await fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bridge-Secret': BRIDGE_SECRET },
      body: JSON.stringify(msg),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[tikfinity-bridge] Server rejected event (${res.status}):`, body);
    } else if (body.ignored) {
      console.log('[tikfinity-bridge] Event received, ignored (mid-combo or non-gift) — normal.');
    } else {
      console.log(`[tikfinity-bridge] Gift forwarded OK — tree grew by ${body.growth ?? '?'}.`);
    }
  } catch (err) {
    console.error('[tikfinity-bridge] Failed to reach the site:', err.message);
  }
}

console.log('[tikfinity-bridge] Starting...');
connect();
