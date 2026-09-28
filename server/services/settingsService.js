const db = require('../db');
const { FARM_ID } = require('../config');
const { HttpError } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const { WEEK_STARTS } = require('../constants/enums');

function gestationRule(label) {
  return {
    type: 'integer',
    label,
    validate: (v) => (v < 150 || v > 400 ? `${label} must be between 150 and 400 days.` : null)
  };
}

async function get() {
  const farm = await db.get('SELECT * FROM farms WHERE id = ?', [FARM_ID]);
  if (!farm) throw new HttpError(500, 'Farm settings are missing. Run the database seed.');
  return farm;
}

async function update(body) {
  const current = await get();
  const data = validate(body, {
    name: { required: true, label: 'Farm name', maxLength: 120 },
    currency: { required: true, label: 'Currency', maxLength: 10 },
    milk_unit: { required: true, label: 'Milk unit', maxLength: 10 },
    week_start: { required: true, enum: WEEK_STARTS, label: 'Week starts on' },
    gestation_days: gestationRule('Gestation length'),
    cow_gestation_days: gestationRule('Cow gestation'),
    buffalo_gestation_days: gestationRule('Buffalo gestation')
  });

  await db.run(
    `UPDATE farms SET name = ?, currency = ?, milk_unit = ?, week_start = ?, gestation_days = ?,
            cow_gestation_days = ?, buffalo_gestation_days = ?, updated_at = ?
     WHERE id = ?`,
    [
      data.name,
      data.currency.toUpperCase(),
      data.milk_unit,
      data.week_start,
      data.gestation_days ?? current.gestation_days,
      data.cow_gestation_days ?? current.cow_gestation_days,
      data.buffalo_gestation_days ?? current.buffalo_gestation_days,
      db.now(),
      FARM_ID
    ]
  );

  return get();
}

async function getBreeding() {
  const farm = await get();
  return {
    cow_gestation_days: farm.cow_gestation_days,
    buffalo_gestation_days: farm.buffalo_gestation_days
  };
}

async function updateBreeding(body) {
  const data = validate(body, {
    cow_gestation_days: { ...gestationRule('Cow gestation'), required: true },
    buffalo_gestation_days: { ...gestationRule('Buffalo gestation'), required: true }
  });

  await db.run(
    `UPDATE farms SET cow_gestation_days = ?, buffalo_gestation_days = ?, updated_at = ?
     WHERE id = ?`,
    [data.cow_gestation_days, data.buffalo_gestation_days, db.now(), FARM_ID]
  );

  return getBreeding();
}

module.exports = { get, update, getBreeding, updateBreeding };
