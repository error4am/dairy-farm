const { HttpError } = require('../middleware/errors');

function parseId(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'Not found');
  return id;
}

module.exports = { parseId };
