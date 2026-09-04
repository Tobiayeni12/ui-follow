const path = require('path');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const cookieSession = require('cookie-session');

const config = require('./config');
const hub = require('./websocket/hub');
const monitor = require('./services/followerMonitor');
const tiktokLiveListener = require('./services/tiktokLiveListener');
const treeSettingsStore = require('./services/treeSettingsStore');

const overlayRoutes = require('./routes/overlay');
const objectivesOverlayRoutes = require('./routes/objectivesOverlay');
const towerOverlayRoutes = require('./routes/towerOverlay');
const giftdaresOverlayRoutes = require('./routes/giftdaresOverlay');
const treeOverlayRoutes = require('./routes/treeOverlay');
const publicApiRoutes = require('./routes/publicApi');
const dashboardPages = require('./routes/dashboardPages');
const dashboardApi = require('./routes/dashboardApi');
const dashboardObjectives = require('./routes/dashboardObjectives');
const dashboardTower = require('./routes/dashboardTower');
const dashboardGiftdares = require('./routes/dashboardGiftdares');
const dashboardTree = require('./routes/dashboardTree');
const { router: tikfinityIngestRoutes } = require('./routes/tikfinityIngest');
const authTikTok = require('./routes/authTikTok');

// Generate a random dashboard password on boot if the operator hasn't set
// one, so the dashboard is never left wide open by accident.
if (!config.dashboardPassword) {
  config.dashboardPassword = crypto.randomBytes(9).toString('base64url');
  console.log('\n=================================================================');
  console.log(' No DASHBOARD_PASSWORD was set. Generated a temporary password:');
  console.log(`   ${config.dashboardPassword}`);
  console.log(' Set DASHBOARD_PASSWORD in your .env to make this permanent.');
  console.log('=================================================================\n');
}

// Same pattern for the TikFinity bridge secret — auto-generated so the
// gift-ingest endpoint is never left open with an empty/guessable secret.
// Also readable from the dashboard's TikFinity panel, since this one isn't
// meant to be typed in by a person, just pasted into the bridge script.
if (!config.tikfinityBridgeSecret) {
  config.tikfinityBridgeSecret = crypto.randomBytes(24).toString('base64url');
  console.log('\n=================================================================');
  console.log(' No TIKFINITY_BRIDGE_SECRET was set. Generated a temporary one:');
  console.log(`   ${config.tikfinityBridgeSecret}`);
  console.log(' Set TIKFINITY_BRIDGE_SECRET in your .env to make this permanent —');
  console.log(' otherwise it changes (and the bridge script needs re-copying) on');
  console.log(' every restart. Also shown in the dashboard\'s Community Tree panel.');
  console.log('=================================================================\n');
}

const app = express();
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false, // overlay/dashboard load a WS + module scripts; keep this simple & permissive for same-origin assets
    crossOriginEmbedderPolicy: false,
  })
);
app.use(cookieParser());
app.use(
  cookieSession({
    name: 'session',
    secret: config.sessionSecret,
    maxAge: 12 * 60 * 60 * 1000,
    secure: config.isProduction,
    httpOnly: true,
    sameSite: 'lax',
  })
);

// Static assets (three.js build + addons served straight from node_modules
// so the overlay never depends on a third-party CDN at stream time).
const threeMain = require.resolve('three');
const threeMarker = path.sep + 'three' + path.sep;
const threeRoot = threeMain.slice(0, threeMain.lastIndexOf(threeMarker) + threeMarker.length - 1);
app.use('/vendor/three', express.static(threeRoot, { maxAge: '1d' }));

// Dynamic page routes must come BEFORE the static mounts below, otherwise
// serve-static's directory-redirect (GET /overlay -> /overlay/) would win.
app.use(overlayRoutes);
app.use(objectivesOverlayRoutes);
app.use(towerOverlayRoutes);
app.use(giftdaresOverlayRoutes);
app.use(treeOverlayRoutes);
app.use('/api', publicApiRoutes);
// Also public (its own secret-header check, not cookie-session auth) — must
// come before the dashboard routers below, since each of those applies
// requireAuth unconditionally to its whole router and all of them are
// mounted at the same broad '/api' prefix. Express matches mount order, so
// registering this after them would have every dashboard router's
// requireAuth intercept it first and redirect to the login page before it
// ever reached this route.
app.use(tikfinityIngestRoutes);
app.use(dashboardPages);
app.use('/api', dashboardApi);
app.use('/api', dashboardObjectives);
app.use('/api', dashboardTower);
app.use('/api', dashboardGiftdares);
app.use('/api', dashboardTree);
app.use(authTikTok);

app.use('/overlay', express.static(path.join(__dirname, '..', 'public', 'overlay'), { index: false }));
app.use('/objectives', express.static(path.join(__dirname, '..', 'public', 'objectives'), { index: false }));
app.use('/tower', express.static(path.join(__dirname, '..', 'public', 'tower'), { index: false }));
app.use('/dashboard', express.static(path.join(__dirname, '..', 'public', 'dashboard'), { index: false }));
// No dynamic state to inject here (pure CSS-looped animation, no settings),
// so this one serves its own index.html directly — no dedicated route
// file needed.
app.use('/engage', express.static(path.join(__dirname, '..', 'public', 'engage')));
// giftdares/tree have a dynamic route above (for injecting settings) that
// handles their own GET; these just serve CSS/JS/image assets.
app.use('/giftdares', express.static(path.join(__dirname, '..', 'public', 'giftdares'), { index: false }));
app.use('/tree', express.static(path.join(__dirname, '..', 'public', 'tree'), { index: false }));

app.get('/', (req, res) => res.redirect('/dashboard'));

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use((req, res) => res.status(404).send('Not found'));

const server = http.createServer(app);
hub.attach(server);

server.listen(config.port, () => {
  console.log(`\nTikTok 3D Follower Counter running on port ${config.port}`);
  console.log(`  Overlay:   http://localhost:${config.port}/overlay`);
  console.log(`  Objectives: http://localhost:${config.port}/objectives`);
  console.log(`  Tobz Tower: http://localhost:${config.port}/tower`);
  console.log(`  Engagement: http://localhost:${config.port}/engage`);
  console.log(`  Gift Dares: http://localhost:${config.port}/giftdares`);
  console.log(`  Community Tree: http://localhost:${config.port}/tree`);
  console.log(`  Dashboard: http://localhost:${config.port}/dashboard`);
  console.log(`  Mode:      ${config.demoMode ? 'DEMO_MODE (no TikTok calls)' : 'LIVE (polling TikTok)'}`);
  monitor.start();
  // Self-heal: corrects a stored levelScaling left over from before the
  // coins-per-level feature, which would otherwise silently make level 2+
  // cost more than the configured flat amount. See treeSettingsStore.js.
  treeSettingsStore
    .healLevelScaling()
    .then((result) => {
      if (result) {
        console.log(`[tree] Corrected levelScaling ${result.before} -> ${result.after} (flat coins-per-level).`);
      }
    })
    .catch((err) => console.error('[tree] levelScaling self-heal failed:', err.message));
  // Independent of DEMO_MODE — this connects directly to TikTok LIVE's
  // public gift feed for the Community Tree, unrelated to the OAuth-based
  // follower counter above. Only starts once a username is set in the
  // dashboard; safe/inert (just logs and returns) if none is set yet.
  tiktokLiveListener.start().catch((err) => console.error('[tiktokLive] failed to start:', err.message));
});

function shutdown() {
  monitor.stop();
  tiktokLiveListener.stop();
  hub.shutdown();
  server.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
