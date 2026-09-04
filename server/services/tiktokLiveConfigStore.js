// Persists which TikTok account the direct-connection gift listener should
// watch. Deliberately separate from treeSettingsStore: that store's contents
// are sent verbatim to the public /tree overlay page as initial state
// (see routes/treeOverlay.js), and there's no reason for a viewer's browser
// to ever see this value. Same minimal shape as tokenStore.js.
const storage = require('./storage');

const KEY = 'tiktok_live_username';

async function getUsername() {
  return storage.get(KEY, '');
}

async function setUsername(username) {
  const clean = sanitize(username);
  await storage.set(KEY, clean);
  return clean;
}

// TikTok usernames: letters, numbers, underscore, period, 2-24 chars. Also
// accepts a leading "@" or a full profile/live URL, same as the library
// itself accepts, and strips either down to the bare uniqueId.
function sanitize(input) {
  let value = String(input || '').trim();
  const urlMatch = value.match(/tiktok\.com\/@([^/?#]+)/i);
  if (urlMatch) value = urlMatch[1];
  value = value.replace(/^@/, '');
  return value.slice(0, 24);
}

module.exports = { getUsername, setUsername, sanitize };
