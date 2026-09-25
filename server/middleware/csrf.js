'use strict';

const crypto = require('crypto');
const { AUTH_ENABLED, SESSION_TTL_SECONDS, COOKIE_SECURE } = require('../config');

const CSRF_COOKIE = 'dairy_csrf';
const CSRF_HEADER = 'x-csrf-token';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function csrfCookieOptions() {
  return { httpOnly: false, secure: COOKIE_SECURE, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_SECONDS * 1000 };
}

function ensureCsrfToken(req, res) {
  if (req.cookies && req.cookies[CSRF_COOKIE]) return;
  res.cookie(CSRF_COOKIE, crypto.randomBytes(32).toString('base64url'), csrfCookieOptions());
}

function tokensMatch(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function csrfProtection(req, res, next) {
  if (!AUTH_ENABLED) return next();

  if (!MUTATING.has(req.method)) {
    ensureCsrfToken(req, res);
    return next();
  }

  const cookieToken = req.cookies ? req.cookies[CSRF_COOKIE] : null;
  const headerToken = req.headers[CSRF_HEADER];
  if (!cookieToken || !headerToken || Array.isArray(headerToken) || !tokensMatch(cookieToken, headerToken)) {
    return res.status(403).json({ error: 'Invalid CSRF token.' });
  }

  next();
}

module.exports = { csrfProtection, ensureCsrfToken, CSRF_COOKIE, CSRF_HEADER };
