const db = require('../db');
const { FARM_ID } = require('../config');
const { HttpError } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const { WEEK_STARTS } = require('../constants/enums');

async function get() {
  const farm = await db.get('SELECT * FROM farms WHERE id = ?', [FARM_ID]);
  if (!farm) throw new HttpError(500, 'Farm settings are missing. Run the database seed.');
  return farm;
}

async function update(body) {
  const data = validate(body, {
    name: { required: true, label: 'Farm name', maxLength: 120 },
    currency: { required: true, label: 'Currency', maxLength: 10 },
    milk_unit: { required: true, label: 'Milk unit', maxLength: 10 },
    week_start: { required: true, enum: WEEK_STARTS, label: 'Week starts on' },
    gestation_days: {
      required: true,
      type: 'integer',
      label: 'Gestation length',
      validate: (v) => (v < 150 || v > 400 ? 'Gestation length must be between 150 and 400 days.' : null)
    }
  });

  await db.run(
    `UPDATE farms SET name = ?, currency = ?, milk_unit = ?, week_start = ?, gestation_days = ?, updated_at = ?
     WHERE id = ?`,
    [data.name, data.currency.toUpperCase(), data.milk_unit, data.week_start, data.gestation_days, db.now(), FARM_ID]
  );

  return get();
}

module.exports = { get, update };
