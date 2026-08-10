const path = require('path');
require('dotenv').config();

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1' || value === 'yes';
}

function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const rawPollInterval = int(process.env.FOLLOWER_POLL_INTERVAL, 60000);
// Enforce a safe floor so we never hammer TikTok's API.
const MIN_POLL_INTERVAL_MS = 30000;

module.exports = {
  port: int(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),

  demoMode: bool(process.env.DEMO_MODE, true),
  demoStartCount: int(process.env.DEMO_START_COUNT, 1247),

  followerGoal: int(process.env.FOLLOWER_GOAL, 2000),

  tiktok: {
    clientKey: process.env.TIKTOK_CLIENT_KEY || '',
    clientSecret: process.env.TIKTOK_CLIENT_SECRET || '',
    redirectUri: process.env.TIKTOK_REDIRECT_URI || '',
    scopes: 'user.info.basic,user.info.stats',
    authorizeUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    userInfoUrl: 'https://open.tiktokapis.com/v2/user/info/',
  },

  pollIntervalMs: Math.max(rawPollInterval, MIN_POLL_INTERVAL_MS),

  dashboardPassword: process.env.DASHBOARD_PASSWORD || '',
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-me',

  databaseUrl: process.env.DATABASE_URL || '',
  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),

  allowTestOnLiveOverlay: bool(process.env.ALLOW_TEST_ON_LIVE_OVERLAY, false),
};
