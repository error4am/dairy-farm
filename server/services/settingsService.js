const db = require('../db/connection');
const { FARM_ID } = require('../config');
const { HttpError } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const { WEEK_STARTS } = require('../constants/enums');

function get() {
  const farm = db.prepare('SELECT * FROM farms WHERE id = ?').get(FARM_ID);
  if (!farm) throw new HttpError(500, 'Farm settings are missing. Run the database seed.');
  return farm;
}

function update(body) {
  const data = validate(body, {
    name: { required: true, label: 'Farm name', maxLength: 120 },
    currency: { required: true, label: 'Currency', maxLength: 10 },
    milk_unit: { required: true, label: 'Milk unit', maxLength: 10 },
    week_start: { required: true, enum: WEEK_STARTS, label: 'Week starts on' }
  });

  db.prepare(
    `UPDATE farms SET name = ?, currency = ?, milk_unit = ?, week_start = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(data.name, data.currency.toUpperCase(), data.milk_unit, data.week_start, FARM_ID);

  return get();
}

module.exports = { get, update };
