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

const overlayRoutes = require('./routes/overlay');
const publicApiRoutes = require('./routes/publicApi');
const dashboardPages = require('./routes/dashboardPages');
const dashboardApi = require('./routes/dashboardApi');
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
app.use('/api', publicApiRoutes);
app.use(dashboardPages);
app.use('/api', dashboardApi);
app.use(authTikTok);

app.use('/overlay', express.static(path.join(__dirname, '..', 'public', 'overlay'), { index: false }));
app.use('/dashboard', express.static(path.join(__dirname, '..', 'public', 'dashboard'), { index: false }));

app.get('/', (req, res) => res.redirect('/dashboard'));

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use((req, res) => res.status(404).send('Not found'));

const server = http.createServer(app);
hub.attach(server);

server.listen(config.port, () => {
  console.log(`\nTikTok 3D Follower Counter running on port ${config.port}`);
  console.log(`  Overlay:   http://localhost:${config.port}/overlay`);
  console.log(`  Dashboard: http://localhost:${config.port}/dashboard`);
  console.log(`  Mode:      ${config.demoMode ? 'DEMO_MODE (no TikTok calls)' : 'LIVE (polling TikTok)'}`);
  monitor.start();
});

function shutdown() {
  monitor.stop();
  hub.shutdown();
  server.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
