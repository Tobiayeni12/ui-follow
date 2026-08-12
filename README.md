# TikTok 3D Follower Counter

A production-ready, real-time 3D follower counter overlay for TikTok LIVE streaming.
Built with Node.js/Express, WebSockets, and Three.js. Designed to be pasted directly
into an OBS/Streamlabs **Browser Source**.

- **`/overlay`** — the transparent, animated 3D counter used on stream.
- **`/objectives`** — a separate "current objective" checklist overlay.
- **`/tower`** — Tobz Tower, a gamified overlay where every follow stacks a
  permanent block on a 3D tower (see §13).
- **`/dashboard`** — a private control panel (goal, test controls, appearance)
  covering all three overlays above.
- Real TikTok data comes from TikTok's official `GET /v2/user/info/` endpoint
  (`follower_count` field, `user.info.stats` scope) via a server-side OAuth
  connection. There is no "new follower" webhook in TikTok's public API, so
  the backend **polls** `follower_count` on a configurable interval and pushes
  changes to the overlay over a WebSocket the instant an increase is detected.

```
TikTok API → backend follower monitor → change detection → WebSocket → 3D overlay → OBS browser source
```

---

## 1. Project structure

```
tiktok-3d-counter/
  server/
    index.js                 Express app entry point
    config.js                Reads & validates environment variables
    middleware/requireAuth.js
    routes/
      overlay.js              GET /overlay
      objectivesOverlay.js      GET /objectives
      towerOverlay.js            GET /tower
      publicApi.js             GET /api/status, /api/followers
      dashboardPages.js        GET/POST /dashboard, /dashboard/login
      dashboardApi.js          Protected dashboard REST API + test controls
      dashboardObjectives.js    Protected objectives CRUD API
      dashboardTower.js          Protected Tobz Tower API + test controls
      authTikTok.js             /auth/tiktok, /auth/tiktok/callback
    services/
      storage.js                Generic key/value store (Postgres or JSON file)
      tokenStore.js              TikTok token persistence (server-only)
      settingsStore.js           Goal / particles / animation settings
      followerStore.js           Last known follower count
      objectivesStore.js         Objectives checklist state
      towerStore.js               Tobz Tower block/follower-count state
      towerSettingsStore.js       Tobz Tower appearance/behavior settings
      towerEvents.js              Shared "add N follows to the tower" pipeline (see §13)
      tiktok.js                   All direct TikTok API calls
      followerMonitor.js          Background polling + change detection
    websocket/hub.js            WebSocket pub/sub (arbitrary channel names,
                                  e.g. live/preview, tower/tower-preview)
  public/
    overlay/                   3D overlay (HTML/CSS/Three.js, ES modules)
    objectives/                 Objectives checklist overlay
    tower/                       Tobz Tower overlay (HTML/CSS/Three.js)
    dashboard/                 Control panel (HTML/CSS/JS)
  data/                        Local JSON store (only used without DATABASE_URL)
  .env.example
  render.yaml                 Render Blueprint (one-click deploy)
  Procfile
```

---

## 2. Run it locally

**Requirements:** Node.js 18+.

```bash
cd tiktok-3d-counter
npm install
cp .env.example .env
npm start
```

The console will print something like:

```
No DASHBOARD_PASSWORD was set. Generated a temporary password:
   AbCdEf12345
TikTok 3D Follower Counter running on port 3000
  Overlay:   http://localhost:3000/overlay
  Dashboard: http://localhost:3000/dashboard
  Mode:      DEMO_MODE (no TikTok calls)
```

Copy that temporary password (or, better, set `DASHBOARD_PASSWORD` in `.env`
so it doesn't change every restart — see §10).

## 3. Open the demo overlay

With the defaults in `.env.example`, `DEMO_MODE=true`, so the server never
contacts TikTok — it just runs an in-memory counter starting at
`DEMO_START_COUNT` (1247 by default).

Open **http://localhost:3000/overlay** in a browser. You should see a dark,
transparent-background page with a glossy 3D "1,247" and a "ROAD TO 2K"
progress bar. This is exactly what OBS will render, minus OBS's own window
chrome.

## 4. Test new follows

Open **http://localhost:3000/dashboard** in a second tab and log in with the
password from step 2. Use the **Test Controls** panel:

- **+1 / +5 / +10 followers** — plays the real flip/rise/glow/particle
  animation through the exact same WebSocket pipeline a real TikTok update
  would use.
- **Set an exact test follower count** — jump straight to any number.
- **Reset** — back to `DEMO_START_COUNT`.

By default these only affect the **preview** shown inside the dashboard
(safe sandbox) — see §12 for why, and how to point them at the real overlay
while still in `DEMO_MODE`.

A small jump (≤5) animates through every intermediate number
(`1247→1248→1249…`). A big jump (>5) automatically switches to a fast,
accelerated count-up instead of playing dozens of individual flips.

---

## 5. Creating a TikTok Developer app

You only need this once you're ready to show your **real** follower count.
Everything above works with zero TikTok credentials.

1. Go to **https://developers.tiktok.com/** and sign in with your TikTok
   account, then click **Manage apps → Create an app**.
2. Give it a name (e.g. "My Stream Overlay") and fill in the basic app
   details TikTok asks for.
3. Under **Products**, add **"Login Kit"**. This is what gives you OAuth and
   the `user.info` scopes — you do not need "Content Posting API" or any
   other product for this project.
4. Under **Login Kit → Scopes**, request:
   - `user.info.basic`
   - `user.info.stats` — **this is the one that unlocks `follower_count`**
5. Under **Login Kit → Redirect URI**, add the callback URL for wherever
   this app is running, e.g.:
   - Local dev: `http://localhost:3000/auth/tiktok/callback`
   - Production: `https://your-domain.com/auth/tiktok/callback`
   (You can add more than one; add both.)
6. Submit the app for review if required by TikTok for your account type.
   Sandbox/testing access with your own TikTok account is usually available
   immediately, even before full review — that's enough to test this
   project end-to-end. Public/production approval is only needed if other
   creators besides you will use it.
7. Once created, TikTok shows you a **Client Key** and **Client Secret** —
   you'll need both in the next step.

### How the OAuth flow works here

1. You click **"Connect TikTok account"** in `/dashboard` (this route is
   itself protected by your dashboard login, so a stranger can't link a
   TikTok account to your overlay).
2. The server redirects your browser to TikTok's authorize page
   (`https://www.tiktok.com/v2/auth/authorize/`) with a random, single-use
   `state` value stored in a short-lived signed cookie.
3. You approve access on TikTok's site.
4. TikTok redirects back to `/auth/tiktok/callback` with a `code` and the
   `state` you started with. The server checks the `state` matches (CSRF
   protection), then exchanges the `code` for an access token + refresh
   token **server-side**, using your Client Secret.
5. Tokens are stored server-side only (Postgres or a local file — see §13)
   and are **never** sent to the browser, the overlay, or any frontend
   JavaScript.
6. The background follower monitor starts polling
   `GET https://open.tiktokapis.com/v2/user/info/?fields=follower_count`
   using that access token, refreshing it automatically before it expires.

## 6. Where to put your Client Key and Client Secret

Open `.env` (create it from `.env.example` if you haven't) and set:

```
TIKTOK_CLIENT_KEY=your_client_key_from_tiktok
TIKTOK_CLIENT_SECRET=your_client_secret_from_tiktok
TIKTOK_REDIRECT_URI=http://localhost:3000/auth/tiktok/callback
```

In production, set `TIKTOK_REDIRECT_URI` to your real domain instead, and
make sure that exact URL is also listed in your TikTok app's Redirect URIs.

**Never** put these values in any file under `public/` and never log them —
they are only read by `server/config.js` and used inside
`server/services/tiktok.js`.

Restart the server after editing `.env`.

---

## 7. Deploying

This app needs a **persistent Node.js process** — it holds open WebSocket
connections and runs a background polling loop. That rules out classic
serverless platforms like Vercel Functions or AWS Lambda, which spin
processes up and down per-request and can't do either of those things
reliably. Use a platform that runs a long-lived web service instead.

### Option A — Render (recommended, simplest)

1. Push this repo to GitHub.
2. In Render, click **New → Blueprint** and point it at your repo — it will
   read `render.yaml` and set up a **Web Service** plus a free **Postgres**
   database automatically.
3. Render will prompt you for the env vars marked `sync: false`
   (`TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`,
   `DASHBOARD_PASSWORD`). Fill those in (`TIKTOK_REDIRECT_URI` should be
   `https://<your-render-subdomain>.onrender.com/auth/tiktok/callback`).
4. Deploy. Render gives you an HTTPS URL like
   `https://tiktok-3d-counter.onrender.com` automatically — no extra TLS
   setup needed.
5. Go back to your TikTok app's Login Kit settings and add
   `https://tiktok-3d-counter.onrender.com/auth/tiktok/callback` as a
   Redirect URI.

Postgres is used automatically here (via `DATABASE_URL`), so your TikTok
connection survives redeploys — Render's web service filesystem is
otherwise ephemeral.

### Option B — Railway

1. Push this repo to GitHub, then **New Project → Deploy from GitHub repo**
   in Railway.
2. Railway auto-detects the Node app (`npm install` / `npm start`) — no
   extra config file needed.
3. Add a Postgres plugin from Railway's marketplace and copy its
   `DATABASE_URL` into your service's variables (or let Railway's variable
   reference feature do it for you).
4. Set the same environment variables as in `.env.example` under your
   service's **Variables** tab.
5. Railway gives you an HTTPS `*.up.railway.app` URL by default.

### After deploying, either way

- Your public overlay URL is `https://<your-domain>/overlay`.
- Your private dashboard is `https://<your-domain>/dashboard`.
- Set `DEMO_MODE=false` once you're ready to switch from the fake demo
  counter to your real TikTok follower count, and connect your account from
  the dashboard.

---

## 8. Environment variables reference

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | `3000` | Port the server listens on |
| `NODE_ENV` | recommended in prod | `development` | Enables secure cookies, etc. when `production` |
| `PUBLIC_BASE_URL` | no | — | Informational only |
| `DEMO_MODE` | no | `true` | When true, never calls TikTok; dashboard test buttons drive the counter |
| `DEMO_START_COUNT` | no | `1247` | Starting count in demo mode |
| `FOLLOWER_GOAL` | no | `2000` | "ROAD TO ___" target |
| `TIKTOK_CLIENT_KEY` | for live mode | — | From your TikTok Developer app |
| `TIKTOK_CLIENT_SECRET` | for live mode | — | From your TikTok Developer app — **server only** |
| `TIKTOK_REDIRECT_URI` | for live mode | — | Must exactly match a Redirect URI in your TikTok app |
| `FOLLOWER_POLL_INTERVAL` | no | `60000` | Milliseconds between TikTok checks. Floored at 30000 to respect rate limits |
| `DASHBOARD_PASSWORD` | recommended | random, regenerated each boot if unset | Password for `/dashboard` |
| `SESSION_SECRET` | recommended in prod | insecure default | Signs the dashboard session cookie |
| `DATABASE_URL` | recommended in prod | — | Postgres connection string; falls back to a local JSON file if unset |
| `ALLOW_TEST_ON_LIVE_OVERLAY` | no | `false` | If true, dashboard test buttons also push fake numbers to the public `/overlay` (only relevant once connected to real TikTok data) |

---

## 9. Connecting your TikTok account

1. Set `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI` in
   your `.env` (local) or host's env var settings (production).
2. Restart the server.
3. Open `/dashboard`, log in, and click **"Connect TikTok account"**.
4. Approve access on TikTok's page.
5. You'll be redirected back to `/dashboard`; the "TikTok Connection" panel
   should now say **connected**, and the mode badge will show whether you're
   still in `DEMO_MODE` (fake counter) or live (once you also set
   `DEMO_MODE=false` and restart).

## 10. Verifying follower counts are updating

- `/api/status` shows `tiktokConnected`, and under `monitor`:
  `active`, `lastPolledAt`, `lastSuccessAt`, `lastError`.
- The dashboard's "Current Followers" panel updates live.
- To see it react to a real new follower without waiting for the poll
  interval, have a friend follow you on TikTok, then wait up to
  `FOLLOWER_POLL_INTERVAL` milliseconds — the overlay will animate the
  increase automatically the next time the server polls.
- If `lastError` is non-empty, that's TikTok's API error message — usually
  an expired/invalid token (reconnect from the dashboard) or a misconfigured
  scope (double-check `user.info.stats` is approved for your app).

## 11. Getting your final `/overlay` URL

Once deployed (§7), your overlay URL is simply:

```
https://<your-domain>/overlay
```

The dashboard's "Overlay Browser Source URL" panel shows this and has a
one-click **Copy** button.

## 12. Adding it to OBS / Streamlabs

1. In OBS, click **+** under Sources → **Browser**.
2. Paste your `/overlay` URL.
3. Set the size:
   - **Horizontal streams:** Width `1920`, Height `1080`.
   - **Vertical / TikTok LIVE:** Width `1080`, Height `1920`.
4. Leave "Shutdown source when not visible" **unchecked** so the WebSocket
   connection and animations keep running smoothly across scene switches.
5. Click OK — no further clicking required. The overlay connects, loads its
   current follower count, and reconnects automatically if your backend
   briefly restarts or redeploys.
6. Resize/reposition the source freely in OBS; the overlay's CSS is
   responsive and will re-frame itself for both orientations.

### About test controls and your live stream

By default, once you connect a real TikTok account (`DEMO_MODE=false`),
dashboard test buttons only affect the **dashboard's own preview** — never
your public overlay — so you can't accidentally show a fake number on
stream. If you explicitly want test buttons to also drive the live overlay,
flip **"Allow test buttons to affect the LIVE overlay"** in the dashboard
(persists via `ALLOW_TEST_ON_LIVE_OVERLAY`). While `DEMO_MODE=true`, test
buttons always drive the live overlay directly, since there's no real data
feed to protect yet.

---

## 13. Tobz Tower — gamified follower overlay

`/tower` is a third, independently switchable overlay: every new follow
stacks a permanent 3D block on a tower instead of (or alongside) the plain
numeric counter. It shares this same server, storage, and WebSocket hub —
it's not a separate app.

- **Overlay URL:** `https://<your-domain>/tower` (also shown with a copy
  button in the dashboard's "Tobz Tower" panel).
- **Dashboard controls:** test follow (with an optional username), simulate
  +5/+10/+50, a milestone-preview button, reset, and position/scale/
  particles/usernames/sounds settings — all in the "Tobz Tower" panel.
- **Automatic block rarity:** every 10th follow is "special", every 100th is
  "rare", every 1000th is "legendary".
- **Combos & milestones:** consecutive follows within 4 seconds build a
  combo streak (2x/5x/10x/25x/50x); crossing a configured follower milestone
  triggers a level-up banner.
- **Performance:** only the most recent ~60 blocks render as individually
  colored meshes; older ones are merged into flat "floor slab" meshes 20 at
  a time, and a burst of 50+ new follows at once only animates the most
  recent 50 individually — so an 8-hour stream with thousands of follows
  doesn't grow unbounded render cost. See `server/services/towerEvents.js`
  and the compaction logic in `public/tower/tower.js`.

### Provider limitations — what's real and what isn't

This project only integrates with **TikTok**, and only the way TikTok's
public API actually allows:

- TikTok has **no "new follower" webhook or event stream**, and no endpoint
  that returns individual follow events or the usernames of people who just
  followed you. The only thing available is the aggregate `follower_count`
  field on `GET /v2/user/info/`, polled on an interval (see §9–10).
- Because of that, every block Tobz Tower spawns from a **real** TikTok
  follow is anonymous (no `@username` on the gain banner) — there's no data
  source to pull a username from. If a poll detects the count went up by
  more than 1 since the last check (e.g. you gained 5 followers between
  60-second polls), Tobz Tower spawns that many anonymous blocks at once.
  Usernames only ever appear on **test** follows, where you type one in
  yourself.
- **Twitch and YouTube are not implemented.** There is no Twitch or YouTube
  code anywhere in this project — no client, no OAuth flow, no polling loop,
  nothing pretending to be a connection to either platform. Twitch's
  EventSub API does support a real `channel.follow` webhook with individual
  usernames (a meaningfully better fit for the per-follow, named-block
  experience this overlay is built for), and YouTube has the same
  aggregate-count-only limitation TikTok does — but neither is built here.

### Where a future provider integration would plug in

`server/services/towerEvents.js` exports one function,
`addFollowersAndBroadcast(count, { username, kindOverride, isTest })`, which
is the entire interface between "a follow happened" and "a block appears on
the tower." `server/services/followerMonitor.js` calls it today when its
TikTok poll detects an increase. A Twitch or YouTube integration would be a
new poller/webhook-handler service that calls this same function — it
would **not** need to touch `towerStore.js`, `towerEvents.js`, the WebSocket
hub, or any of `public/tower/`. That's the extent of the abstraction: a
single, documented call site, not a fake multi-provider system.

---

## Security notes

- `TIKTOK_CLIENT_SECRET` and all TikTok access/refresh tokens live only on
  the server (in Postgres or `data/store.json`, which is gitignored) and are
  never sent to `/overlay`, `/dashboard`'s HTML/JS, or any API response.
- `/dashboard` requires a password (session cookie, `httpOnly`, `sameSite:
  lax`, `secure` in production). If you don't set `DASHBOARD_PASSWORD`, a
  random one is generated and printed to the server log on every boot —
  set it explicitly before deploying so it doesn't change on redeploy.
- The OAuth flow validates a signed, single-use `state` cookie to prevent
  CSRF.
- `/overlay` and `/api/*` (public) are strictly read-only; all
  state-changing routes live under the authenticated `/api/dashboard/*`
  namespace.
- Login attempts are rate-limited.

## Troubleshooting

- **"TikTok is not configured"** when clicking Connect — you're missing one
  of `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` / `TIKTOK_REDIRECT_URI`.
- **Invalid OAuth state** — you took too long on TikTok's consent screen (the
  state cookie expires after 10 minutes), or you started the flow from a
  different browser/device than you finished it in. Just click Connect
  again.
- **Overlay shows 0 or doesn't move** — check `/api/status`; if
  `monitor.lastError` is set, that's the reason TikTok's API gave.
- **OBS shows a white/black box instead of transparency** — make sure you
  added it as a **Browser** source (not a Window Capture), and that no
  custom CSS overrides `background` in your OBS browser source settings.
