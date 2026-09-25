'use strict';

const authService = require('../services/authService');

const SESSION_COOKIE = 'dairy_session';

async function requireAuth(req, res, next) {
  const token = req.cookies ? req.cookies[SESSION_COOKIE] : null;
  const user = token ? await authService.userForToken(token) : null;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.user = user;
  next();
}

module.exports = { requireAuth, SESSION_COOKIE };
