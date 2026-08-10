const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const config = require('../config');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

function safePasswordCompare(input, expected) {
  const a = Buffer.from(String(input || ''));
  const b = Buffer.from(String(expected || ''));
  if (a.length !== b.length) {
    // Still run a comparison of equal length to keep timing constant-ish.
    crypto.timingSafeEqual(Buffer.alloc(b.length), Buffer.alloc(b.length));
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

router.get('/dashboard/login', (req, res) => {
  if (req.session && req.session.authed) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'dashboard', 'login.html'));
});

router.post('/dashboard/login', loginLimiter, express.urlencoded({ extended: false }), (req, res) => {
  const { password } = req.body || {};
  if (safePasswordCompare(password, config.dashboardPassword)) {
    req.session.authed = true;
    return res.redirect('/dashboard');
  }
  return res.redirect('/dashboard/login?error=1');
});

router.post('/dashboard/logout', (req, res) => {
  req.session = null;
  res.redirect('/dashboard/login');
});

router.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'dashboard', 'index.html'));
});

module.exports = router;
