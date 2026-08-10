// All direct communication with TikTok's official Login Kit / Display API
// lives here. Uses Node's built-in fetch. Nothing in this file is ever
// imported by frontend code — access tokens and the client secret never
// leave the server process.
const config = require('../config');
const tokenStore = require('./tokenStore');

const REFRESH_SAFETY_WINDOW_MS = 5 * 60 * 1000; // refresh 5 min before expiry

function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_key: config.tiktok.clientKey,
    scope: config.tiktok.scopes,
    response_type: 'code',
    redirect_uri: config.tiktok.redirectUri,
    state,
  });
  return `${config.tiktok.authorizeUrl}?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    client_key: config.tiktok.clientKey,
    client_secret: config.tiktok.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: config.tiktok.redirectUri,
  });

  const res = await fetch(config.tiktok.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`TikTok token exchange failed: ${json.error_description || json.error || res.statusText}`);
  }
  return normalizeTokenResponse(json);
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    client_key: config.tiktok.clientKey,
    client_secret: config.tiktok.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const res = await fetch(config.tiktok.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`TikTok token refresh failed: ${json.error_description || json.error || res.statusText}`);
  }
  return normalizeTokenResponse(json);
}

function normalizeTokenResponse(json) {
  const now = Date.now();
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    open_id: json.open_id,
    expires_at: now + (json.expires_in || 0) * 1000,
    refresh_expires_at: now + (json.refresh_expires_in || 0) * 1000,
  };
}

/**
 * Returns a valid access token, transparently refreshing it if it's about
 * to expire. Throws if there is no stored connection or the refresh token
 * itself has expired (caller should prompt reconnection via /auth/tiktok).
 */
async function ensureValidAccessToken() {
  const tokens = await tokenStore.getTokens();
  if (!tokens) throw new Error('TikTok is not connected');

  const needsRefresh = Date.now() >= tokens.expires_at - REFRESH_SAFETY_WINDOW_MS;
  if (!needsRefresh) return tokens.access_token;

  if (Date.now() >= tokens.refresh_expires_at) {
    await tokenStore.clearTokens();
    throw new Error('TikTok refresh token expired — reconnect required');
  }

  const refreshed = await refreshAccessToken(tokens.refresh_token);
  await tokenStore.saveTokens({ ...tokens, ...refreshed });
  return refreshed.access_token;
}

async function getFollowerCount(accessToken) {
  const url = `${config.tiktok.userInfoUrl}?fields=follower_count`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json();
  if (!res.ok || (json.error && json.error.code !== 'ok')) {
    const message = json.error?.message || res.statusText;
    const err = new Error(`TikTok user/info request failed: ${message}`);
    err.status = res.status;
    throw err;
  }
  return json.data.user.follower_count;
}

module.exports = {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  ensureValidAccessToken,
  getFollowerCount,
};
