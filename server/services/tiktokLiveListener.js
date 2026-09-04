// Connects DIRECTLY to a TikTok LIVE room's real-time gift feed — no
// TikFinity, no local bridge script, nothing running on the streamer's own
// computer. This runs on the deployed server itself via the
// "tiktok-live-connector" npm package (github.com/zerodytrash/TikTok-Live-Connector),
// which the package's own README describes as: "This is not a
// production-ready API. It is a reverse engineering project." It talks
// directly to TikTok's internal Webcast push service, not an official
// TikTok API, using a third-party signing service (Euler Stream) on its
// free community tier by default. Verified against the actual installed
// v2.4.4 package (README + compiled dist/ + a live smoke test against a
// real TikTok LIVE room) before writing this file — see the two behaviors
// below that the library's own README gets wrong for this version:
//   1. `new TikTokLiveConnection(uniqueId)` with no second argument throws
//      (`Cannot read properties of undefined (reading 'processInitialData')`)
//      — an options object, even `{}`, is required.
//   2. `enableExtendedGiftInfo: true` (which would attach a diamond/cost
//      field to gift events) calls an Euler Stream endpoint that currently
//      requires a paid "Business" plan and makes connect() reject entirely
//      on the free tier — so it is deliberately NOT enabled here. Practical
//      effect: growthForGift()'s diamond-based fallback will rarely have a
//      diamond count to work with on this path, so unmapped gifts fall back
//      to its flat minimum-growth default. Populate the dashboard's gift
//      map with the real gift names you expect for accurate values.
//
// Exactly one gift path in: every real gift event funnels into the same
// treeEvents.growthForGift()/addGrowth() pipeline the TikFinity ingest
// route and the dashboard test buttons use, with isTest: false.
const { TikTokLiveConnection, WebcastEvent, ControlEvent } = require('tiktok-live-connector');
const config = require('../config');
const treeEvents = require('./treeEvents');
const configStore = require('./tiktokLiveConfigStore');

// Floor for both "streamer isn't live yet" polling and post-disconnect
// reconnect attempts. tiktok-live-connector's own waitUntilLive() enforces
// a 30s minimum poll itself, and its README explicitly warns to wait before
// reconnecting to avoid being rate-limited by the (third-party) sign
// service — so this reuses that same conservative floor throughout rather
// than inventing a separate number.
const RETRY_FLOOR_MS = 30000;

let connection = null;
let username = '';
let running = false;
let loopToken = 0; // bumped on every stop()/restart so a stale loop iteration exits quietly

let status = {
  configured: false,
  connecting: false,
  connected: false,
  roomId: null,
  lastConnectedAt: null,
  lastDisconnectedAt: null,
  lastError: null,
  lastGiftAt: null,
  lastGift: null, // { username, giftName, repeatCount, growth }
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// `myToken` gates every handler below: stop()/restart() bump the module
// loopToken immediately, but the old connection's socket can keep emitting
// events for a moment after (a CONNECTED that was already in flight, a
// trailing GIFT). Checking loopToken first stops an orphaned connection
// from clobbering shared `status` (or, worse, still growing the tree) after
// the operator has stopped it or switched to a different username — caught
// during testing when a late CONNECTED overwrote status back to "connected"
// immediately after clearing the username.
function buildConnection(user, myToken) {
  const opts = {};
  if (config.eulerStreamApiKey) opts.signApiKey = config.eulerStreamApiKey;
  const conn = new TikTokLiveConnection(user, opts);

  conn.on(ControlEvent.CONNECTED, (state) => {
    if (loopToken !== myToken) return;
    status.connecting = false;
    status.connected = true;
    status.roomId = state.roomId;
    status.lastConnectedAt = Date.now();
    status.lastError = null;
    console.log(`[tiktokLive] Connected to @${user}'s LIVE (room ${state.roomId}).`);
  });

  conn.on(ControlEvent.DISCONNECTED, ({ code, reason } = {}) => {
    if (loopToken !== myToken) return;
    const wasConnected = status.connected;
    status.connected = false;
    status.lastDisconnectedAt = Date.now();
    if (wasConnected) {
      console.log(`[tiktokLive] Disconnected from @${user}'s LIVE${reason ? ` (${reason})` : ''}. Reconnecting...`);
    }
  });

  conn.on(WebcastEvent.STREAM_END, () => {
    if (loopToken !== myToken) return;
    console.log(`[tiktokLive] @${user} ended the stream.`);
  });

  conn.on(ControlEvent.ERROR, ({ info, exception } = {}) => {
    if (loopToken !== myToken) return;
    status.lastError = (exception && exception.message) || info || 'unknown error';
    console.error('[tiktokLive] error:', status.lastError);
  });

  conn.on(WebcastEvent.GIFT, (data) => handleGift(data, myToken));

  return conn;
}

async function handleGift(data, myToken) {
  try {
    if (loopToken !== myToken) return; // orphaned connection — ignore, never grow the tree from a stopped/replaced watch
    // Per the library's own documented pattern: a streakable gift
    // (giftType 1) fires repeatedly with a growing repeatCount while the
    // streak is live, and once more with repeatEnd:true when it finishes.
    // Ignoring every event until repeatEnd is what prevents double-counting
    // a single streak (e.g. Rose x1, x2, x3...).
    const giftType = data?.giftDetails?.giftType;
    if (giftType === 1 && data?.repeatEnd === false) return;

    const giftName = data?.giftDetails?.giftName || 'Gift';
    const uniqueId = String(data?.user?.uniqueId || data?.user?.nickname || 'someone').slice(0, 40);
    const repeatCount = Math.max(1, Math.floor(Number(data?.repeatCount) || 1));

    // Best-effort only — see the file header. This library does not expose
    // a documented diamond-cost field on the base gift event, and the
    // option that would (`enableExtendedGiftInfo`) is not usable on the
    // free tier, so this almost always ends up undefined and
    // growthForGift() falls back to its flat minimum for unmapped gifts.
    const diamondCount = data?.extendedGiftInfo?.diamondCount ?? data?.extendedGiftInfo?.diamond_count ?? undefined;

    const perGiftGrowth = await treeEvents.growthForGift(giftName, diamondCount);
    const totalGrowth = perGiftGrowth * repeatCount;

    console.log(
      `[tiktokLive] gift: @${uniqueId} sent "${giftName}" x${repeatCount} -> +${totalGrowth} growth`
    );

    await treeEvents.addGrowth(totalGrowth, 'gift', uniqueId, { isTest: false, giftName });

    status.lastGiftAt = Date.now();
    status.lastGift = { username: uniqueId, giftName, repeatCount, growth: totalGrowth };
  } catch (err) {
    console.error('[tiktokLive] failed to process gift event:', err.message);
  }
}

// Keeps (re)attempting connect() for as long as running===true and this is
// still the current loop generation. Handles both "not live yet" (via the
// library's own waitUntilLive) and post-disconnect reconnection with the
// same conservative backoff floor.
// `conn` is captured once per loop generation and used exclusively from
// here on — never re-reads the module-level `connection` variable, which
// stop()/restart() may null out from under an in-flight await at any time
// (e.g. a DISCONNECTED event arriving just after stop() runs). Mixing the
// two caused a real crash during testing: "Cannot read properties of null
// (reading 'off')" when a stale event fired after connection was nulled.
async function connectLoop(conn, myToken) {
  while (running && loopToken === myToken) {
    try {
      status.connecting = true;
      await conn.connect();
      // Success — CONNECTED listener already updated status. Just wait
      // here until we drop, then loop back around to reconnect.
      await waitForDisconnect(conn, myToken);
      if (!running || loopToken !== myToken) return;
      await delay(5000); // brief cooldown before calling connect() again, per the README's caution
      continue;
    } catch (err) {
      status.connecting = false;
      status.lastError = err.message;
      if (!running || loopToken !== myToken) return;

      if (err.name === 'UserOfflineError' || /offline/i.test(err.message || '')) {
        console.log(`[tiktokLive] @${username} is not live right now. Will keep checking...`);
        try {
          await conn.waitUntilLive(30); // library's own poll, 30s minimum
          if (!running || loopToken !== myToken) return;
          continue; // they're live now — loop back and connect()
        } catch (waitErr) {
          if (!running || loopToken !== myToken) return;
          // waitUntilLive itself failed (e.g. transient network error) —
          // fall through to the standard backoff delay below.
        }
      } else {
        console.error(`[tiktokLive] connect failed: ${err.message}`);
      }
      await delay(RETRY_FLOOR_MS);
    }
  }
}

function waitForDisconnect(conn, myToken) {
  return new Promise((resolve) => {
    let settled = false;
    const onDisconnect = () => {
      if (settled) return;
      settled = true;
      clearInterval(check);
      conn.off(ControlEvent.DISCONNECTED, onDisconnect);
      resolve();
    };
    conn.on(ControlEvent.DISCONNECTED, onDisconnect);
    // Also resolve if we get stopped/restarted out from under this wait.
    const check = setInterval(() => {
      if (!running || loopToken !== myToken) onDisconnect();
    }, 1000);
  });
}

async function start() {
  username = await configStore.getUsername();
  status.configured = Boolean(username);
  if (!username) {
    console.log('[tiktokLive] No TikTok username configured yet — set one in the dashboard to start listening.');
    return;
  }
  if (running) return;

  running = true;
  loopToken += 1;
  const myToken = loopToken;
  const conn = buildConnection(username, myToken);
  connection = conn;
  console.log(`[tiktokLive] Watching @${username} for LIVE gifts (direct connection, no TikFinity needed).`);
  connectLoop(conn, myToken);
}

function stop() {
  running = false;
  loopToken += 1; // invalidate any in-flight loop/wait
  status.connecting = false;
  status.connected = false;
  if (connection) {
    // Capture the reference before nulling the module variable below —
    // disconnect() returns a Promise ("waits for the close event before
    // resolving"), so this .catch() runs on a later microtask, by which
    // point `connection` itself would already be null if referenced
    // directly inside the callback instead of via this local.
    const conn = connection;
    Promise.resolve()
      .then(() => conn.disconnect())
      .catch(() => {}); // already disconnected / socket gone — fine either way
  }
  connection = null;
}

// Called by the dashboard when the operator changes the watched username —
// stop whatever's running and start fresh with the new one.
async function restart() {
  stop();
  await start();
}

function getStatus() {
  return { ...status, username };
}

module.exports = { start, stop, restart, getStatus };
