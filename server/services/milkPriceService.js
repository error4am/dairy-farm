const db = require('../db');
const { FARM_ID } = require('../config');
const { HttpError } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const { todayLocal } = require('../utils/date');

const RULES = {
  price_per_litre: {
    required: true,
    type: 'number',
    label: 'Price per litre',
    validate: (v) => (v <= 0 ? 'Price must be greater than 0.' : null)
  },
  effective_date: { required: true, type: 'date', label: 'Effective date' }
};

async function list(query = {}) {
  const where = ['farm_id = ?'];
  const params = [FARM_ID];

  if (query.from) {
    where.push('effective_date >= ?');
    params.push(query.from);
  }
  if (query.to) {
    where.push('effective_date <= ?');
    params.push(query.to);
  }

  return db.all(
    `SELECT * FROM milk_prices WHERE ${where.join(' AND ')}
     ORDER BY effective_date DESC, id DESC
     LIMIT 200`,
    params
  );
}

async function resolve(date) {
  const row = await db.get(
    `SELECT price_per_litre FROM milk_prices
     WHERE farm_id = ? AND effective_date <= ?
     ORDER BY effective_date DESC, id DESC
     LIMIT 1`,
    [FARM_ID, date]
  );
  return row ? row.price_per_litre : null;
}

async function applicable(query = {}) {
  const date = query.date || todayLocal();
  return { date, price_per_litre: await resolve(date) };
}

async function get(id) {
  const price = await db.get('SELECT * FROM milk_prices WHERE id = ? AND farm_id = ?', [id, FARM_ID]);
  if (!price) throw new HttpError(404, 'Milk price not found.');
  return price;
}

async function create(body) {
  const data = validate(body, RULES);
  try {
    const info = await db.run('INSERT INTO milk_prices (farm_id, price_per_litre, effective_date) VALUES (?, ?, ?)', [
      FARM_ID,
      data.price_per_litre,
      data.effective_date
    ]);
    return db.get('SELECT * FROM milk_prices WHERE id = ?', [info.lastInsertRowid]);
  } catch (err) {
    if (db.isUniqueViolation(err)) {
      throw new HttpError(409, 'A milk price for this effective date already exists.', {
        effective_date: 'A price is already set for this date.'
      });
    }
    throw err;
  }
}

async function update(id, body) {
  await get(id);
  const data = validate(body, RULES);
  try {
    await db.run('UPDATE milk_prices SET price_per_litre = ?, effective_date = ? WHERE id = ? AND farm_id = ?', [
      data.price_per_litre,
      data.effective_date,
      id,
      FARM_ID
    ]);
  } catch (err) {
    if (db.isUniqueViolation(err)) {
      throw new HttpError(409, 'A milk price for this effective date already exists.', {
        effective_date: 'A price is already set for this date.'
      });
    }
    throw err;
  }
  return db.get('SELECT * FROM milk_prices WHERE id = ?', [id]);
}

async function remove(id) {
  const info = await db.run('DELETE FROM milk_prices WHERE id = ? AND farm_id = ?', [id, FARM_ID]);
  if (info.changes === 0) throw new HttpError(404, 'Milk price not found.');
  return { ok: true };
}

module.exports = { list, resolve, applicable, get, create, update, remove };
