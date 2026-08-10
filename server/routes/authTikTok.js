// TikTok OAuth 2.0 flow. /auth/tiktok kicks it off, /auth/tiktok/callback
// completes it. State is stored in a short-lived, httpOnly, signed cookie
// and validated on return to prevent CSRF.
const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const tiktok = require('../services/tiktok');
const tokenStore = require('../services/tokenStore');
const requireAuth = require('../middleware/requireAuth');
const monitor = require('../services/followerMonitor');

const router = express.Router();
const STATE_COOKIE = 'tiktok_oauth_state';

router.get('/auth/tiktok', requireAuth, (req, res) => {
  if (!config.tiktok.clientKey || !config.tiktok.clientSecret || !config.tiktok.redirectUri) {
    return res
      .status(500)
      .send('TikTok is not configured. Set TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, and TIKTOK_REDIRECT_URI in your .env, then restart the server.');
  }
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000,
  });
  res.redirect(tiktok.buildAuthorizeUrl(state));
});

router.get('/auth/tiktok/callback', async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;
  const expectedState = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE);

  if (error) {
    return res.status(400).send(`TikTok authorization failed: ${errorDescription || error}`);
  }
  if (!state || !expectedState || state !== expectedState) {
    return res.status(403).send('Invalid OAuth state. Please try connecting again from the dashboard.');
  }
  if (!code) {
    return res.status(400).send('Missing authorization code from TikTok.');
  }

  try {
    const tokens = await tiktok.exchangeCodeForToken(code);
    await tokenStore.saveTokens(tokens);
    monitor.start();
    res.redirect('/dashboard?tiktok=connected');
  } catch (err) {
    console.error('[auth/tiktok] token exchange failed:', err.message);
    res.status(500).send(`Failed to complete TikTok connection: ${err.message}`);
  }
});

module.exports = router;
