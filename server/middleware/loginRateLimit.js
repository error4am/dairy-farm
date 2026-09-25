'use strict';

const { LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS } = require('../config');

const attempts = new Map();

function sweep() {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (now - entry.windowStart >= LOGIN_WINDOW_MS) attempts.delete(key);
  }
}

const timer = setInterval(sweep, LOGIN_WINDOW_MS);
if (timer.unref) timer.unref();

function loginRateLimiter(req, res, next) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const entry = attempts.get(key);

  if (entry && now - entry.windowStart < LOGIN_WINDOW_MS && entry.count >= LOGIN_MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
  }

  if (!entry || now - entry.windowStart >= LOGIN_WINDOW_MS) {
    attempts.set(key, { count: 0, windowStart: now });
  }

  req.loginRateLimit = {
    recordFailure() {
      const current = attempts.get(key);
      if (current) current.count += 1;
    },
    recordSuccess() {
      attempts.delete(key);
    }
  };

  next();
}

module.exports = { loginRateLimiter };
