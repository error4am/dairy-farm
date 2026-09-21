const db = require('../db');

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof HttpError) {
    const body = { error: err.message };
    if (err.details) body.details = err.details;
    return res.status(err.status).json(body);
  }

  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid request body.' });
  }

  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.' });
  }

  if (db.isUniqueViolation(err)) {
    return res.status(409).json({ error: 'A record with these values already exists.' });
  }

  if (db.isConstraintViolation(err)) {
    return res.status(400).json({ error: 'Invalid data. Please check the values and try again.' });
  }

  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
}

module.exports = { HttpError, notFound, errorHandler };
