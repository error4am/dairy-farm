const db = require('../db');
const { FARM_ID } = require('../config');
const { HttpError } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const { SESSIONS } = require('../constants/enums');
const settingsService = require('./settingsService');
const healthService = require('./healthService');
const { todayLocal, startOfWeek, startOfMonth } = require('../utils/date');

function clampLimit(value, fallback = 25, max = 200) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

async function list(query = {}) {
  const where = ['r.farm_id = ?'];
  const params = [FARM_ID];

  if (query.from) {
    where.push('r.date >= ?');
    params.push(query.from);
  }
  if (query.to) {
    where.push('r.date <= ?');
    params.push(query.to);
  }
  if (query.animal_id) {
    where.push('r.animal_id = ?');
    params.push(Number(query.animal_id));
  }
  if (query.session) {
    where.push('r.session = ?');
    params.push(query.session);
  }
  if (query.search) {
    where.push('(a.tag_number LIKE ? OR a.name LIKE ?)');
    const s = '%' + query.search + '%';
    params.push(s, s);
  }

  const whereSql = where.join(' AND ');
  const total = (
    await db.get(
      `SELECT CAST(COUNT(*) AS INTEGER) AS n FROM milk_records r JOIN animals a ON a.id = r.animal_id WHERE ${whereSql}`,
      params
    )
  ).n;

  const limit = clampLimit(query.limit);
  const offset = Math.max(0, Number(query.offset) || 0);

  const items = await db.all(
    `SELECT r.*, a.tag_number AS animal_tag, a.name AS animal_name
     FROM milk_records r
     JOIN animals a ON a.id = r.animal_id
     WHERE ${whereSql}
     ORDER BY r.date DESC, r.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return { items, total, limit, offset };
}

async function summary(query = {}) {
  const farm = await settingsService.get();
  const today = todayLocal();

  const range = { from: query.from || null, to: query.to || null };
  const where = ['r.farm_id = ?'];
  const params = [FARM_ID];
  if (range.from) {
    where.push('r.date >= ?');
    params.push(range.from);
  }
  if (range.to) {
    where.push('r.date <= ?');
    params.push(range.to);
  }
  if (query.animal_id) {
    where.push('r.animal_id = ?');
    params.push(Number(query.animal_id));
  }
  if (query.session) {
    where.push('r.session = ?');
    params.push(query.session);
  }
  const whereSql = where.join(' AND ');

  const rangeTotals = await db.get(
    `SELECT
       COALESCE(SUM(r.quantity), 0) AS total,
       COALESCE(SUM(CASE WHEN r.session = 'morning' THEN r.quantity END), 0) AS morning,
       COALESCE(SUM(CASE WHEN r.session = 'evening' THEN r.quantity END), 0) AS evening,
       CAST(COUNT(*) AS INTEGER) AS records
     FROM milk_records r WHERE ${whereSql}`,
    params
  );

  const todayTotals = await db.get(
    `SELECT
       COALESCE(SUM(quantity), 0) AS total,
       COALESCE(SUM(CASE WHEN session = 'morning' THEN quantity END), 0) AS morning,
       COALESCE(SUM(CASE WHEN session = 'evening' THEN quantity END), 0) AS evening
     FROM milk_records WHERE farm_id = ? AND date = ?`,
    [FARM_ID, today]
  );

  const weekTotals = await db.get(
    'SELECT COALESCE(SUM(quantity), 0) AS total FROM milk_records WHERE farm_id = ? AND date >= ? AND date <= ?',
    [FARM_ID, startOfWeek(today, farm.week_start), today]
  );

  const monthTotals = await db.get(
    'SELECT COALESCE(SUM(quantity), 0) AS total FROM milk_records WHERE farm_id = ? AND date >= ? AND date <= ?',
    [FARM_ID, startOfMonth(today), today]
  );

  const byDay = await db.all(
    `SELECT r.date,
       COALESCE(SUM(r.quantity), 0) AS total,
       COALESCE(SUM(CASE WHEN r.session = 'morning' THEN r.quantity END), 0) AS morning,
       COALESCE(SUM(CASE WHEN r.session = 'evening' THEN r.quantity END), 0) AS evening
     FROM milk_records r
     WHERE ${whereSql}
     GROUP BY r.date
     ORDER BY r.date DESC
     LIMIT 366`,
    params
  );

  const byAnimal = await db.all(
    `SELECT r.animal_id, a.tag_number, a.name,
       COALESCE(SUM(r.quantity), 0) AS total,
       COALESCE(SUM(CASE WHEN r.session = 'morning' THEN r.quantity END), 0) AS morning,
       COALESCE(SUM(CASE WHEN r.session = 'evening' THEN r.quantity END), 0) AS evening,
       CAST(COUNT(*) AS INTEGER) AS records
     FROM milk_records r
     JOIN animals a ON a.id = r.animal_id
     WHERE ${whereSql}
     GROUP BY r.animal_id, a.tag_number, a.name
     ORDER BY total DESC
     LIMIT 200`,
    params
  );

  return {
    unit: farm.milk_unit,
    range: { ...range, ...rangeTotals },
    today: todayTotals,
    week: weekTotals.total,
    month: monthTotals.total,
    by_day: byDay,
    by_animal: byAnimal
  };
}

async function assertAnimal(animalId) {
  const animal = await db.get('SELECT id, status FROM animals WHERE id = ? AND farm_id = ?', [animalId, FARM_ID]);
  if (!animal) throw new HttpError(400, 'Selected animal was not found.', { animal_id: 'Selected animal was not found.' });
  return animal;
}

async function rules() {
  const farm = await settingsService.get();
  return {
    animal_id: { required: true, type: 'integer', label: 'Animal' },
    date: { required: true, type: 'date', label: 'Date' },
    session: { required: true, enum: SESSIONS, label: 'Session' },
    quantity: {
      required: true,
      type: 'number',
      label: 'Quantity',
      validate: (v) => (v <= 0 ? 'Quantity must be greater than 0.' : null)
    },
    unit: { label: 'Unit', maxLength: 10, default: farm.milk_unit },
    notes: { label: 'Notes', maxLength: 1000 }
  };
}

async function assertNoWithdrawal(animalId, date) {
  const until = await healthService.activeWithdrawal(animalId, date);
  if (until) {
    throw new HttpError(400, `Milk cannot be recorded while this animal is under withdrawal (until ${until}).`, {
      animal_id: `Under withdrawal until ${until}.`
    });
  }
}

async function create(body) {
  const data = validate(body, await rules());
  const animal = await assertAnimal(data.animal_id);
  if (animal.status !== 'active') {
    throw new HttpError(400, 'Milk can only be recorded for active animals.', {
      animal_id: 'This animal is not active.'
    });
  }
  await assertNoWithdrawal(data.animal_id, data.date);
  try {
    const info = await db.run(
      `INSERT INTO milk_records (farm_id, animal_id, date, session, quantity, unit, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [FARM_ID, data.animal_id, data.date, data.session, data.quantity, data.unit, data.notes]
    );
    return db.get('SELECT * FROM milk_records WHERE id = ?', [info.lastInsertRowid]);
  } catch (err) {
    if (db.isUniqueViolation(err)) {
      throw new HttpError(409, 'A milk record for this animal, date and session already exists.', {
        animal_id: 'This animal already has a record for this date and session.'
      });
    }
    throw err;
  }
}

async function update(id, body) {
  const existing = await db.get('SELECT * FROM milk_records WHERE id = ? AND farm_id = ?', [id, FARM_ID]);
  if (!existing) throw new HttpError(404, 'Milk record not found.');

  const data = validate(body, await rules());
  await assertAnimal(data.animal_id);
  await assertNoWithdrawal(data.animal_id, data.date);
  try {
    await db.run(
      `UPDATE milk_records SET
        animal_id = ?, date = ?, session = ?, quantity = ?, unit = ?, notes = ?,
        updated_at = ?
       WHERE id = ? AND farm_id = ?`,
      [data.animal_id, data.date, data.session, data.quantity, data.unit, data.notes, db.now(), id, FARM_ID]
    );
    return db.get('SELECT * FROM milk_records WHERE id = ?', [id]);
  } catch (err) {
    if (db.isUniqueViolation(err)) {
      throw new HttpError(409, 'A milk record for this animal, date and session already exists.', {
        animal_id: 'This animal already has a record for this date and session.'
      });
    }
    throw err;
  }
}

async function remove(id) {
  const info = await db.run('DELETE FROM milk_records WHERE id = ? AND farm_id = ?', [id, FARM_ID]);
  if (info.changes === 0) throw new HttpError(404, 'Milk record not found.');
  return { ok: true };
}

module.exports = { list, summary, create, update, remove };
