'use strict';

const express = require('express');
const { HttpError } = require('../middleware/errors');
const { asyncHandler } = require('../middleware/asyncHandler');
const { ensureCsrfToken } = require('../middleware/csrf');
const { SESSION_COOKIE } = require('../middleware/requireAuth');
const { loginRateLimiter } = require('../middleware/loginRateLimit');
const authService = require('../services/authService');
const { AUTH_ENABLED, SESSION_TTL_SECONDS, COOKIE_SECURE } = require('../config');

const router = express.Router();

function sessionCookieOptions() {
  return { httpOnly: true, secure: COOKIE_SECURE, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_SECONDS * 1000 };
}

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
}

router.get(
  '/status',
  asyncHandler(async (req, res) => {
    if (AUTH_ENABLED) ensureCsrfToken(req, res);
    res.json(await authService.status());
  })
);

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    if (AUTH_ENABLED) ensureCsrfToken(req, res);
    const token = req.cookies ? req.cookies[SESSION_COOKIE] : null;
    const user = token ? await authService.userForToken(token) : null;
    if (user) return res.json({ authenticated: true, user });
    res.json({ authenticated: false });
  })
);

router.post(
  '/setup',
  asyncHandler(async (req, res) => {
    const result = await authService.setup(req.body);
    setSessionCookie(res, result.token);
    ensureCsrfToken(req, res);
    res.status(201).json({ user: result.user });
  })
);

router.post(
  '/login',
  loginRateLimiter,
  asyncHandler(async (req, res) => {
    try {
      const result = await authService.login(req.body);
      if (req.loginRateLimit) req.loginRateLimit.recordSuccess();
      setSessionCookie(res, result.token);
      ensureCsrfToken(req, res);
      res.json({ user: result.user });
    } catch (err) {
      if (err instanceof HttpError && err.status === 401 && req.loginRateLimit) {
        req.loginRateLimit.recordFailure();
      }
      throw err;
    }
  })
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = req.cookies ? req.cookies[SESSION_COOKIE] : null;
    if (token) await authService.logout(token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  })
);

module.exports = router;
