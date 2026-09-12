const db = require('../db/connection');
const { FARM_ID } = require('../config');
const { HttpError } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const { SESSIONS } = require('../constants/enums');
const settingsService = require('./settingsService');
const { todayLocal, startOfWeek, startOfMonth } = require('../utils/date');

function clampLimit(value, fallback = 25, max = 200) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function list(query = {}) {
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
  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM milk_records r JOIN animals a ON a.id = r.animal_id WHERE ${whereSql}`)
    .get(...params).n;

  const limit = clampLimit(query.limit);
  const offset = Math.max(0, Number(query.offset) || 0);

  const items = db
    .prepare(
      `SELECT r.*, a.tag_number AS animal_tag, a.name AS animal_name
       FROM milk_records r
       JOIN animals a ON a.id = r.animal_id
       WHERE ${whereSql}
       ORDER BY r.date DESC, r.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  return { items, total, limit, offset };
}

function summary(query = {}) {
  const farm = settingsService.get();
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

  const rangeTotals = db
    .prepare(
      `SELECT
         COALESCE(SUM(r.quantity), 0) AS total,
         COALESCE(SUM(CASE WHEN r.session = 'morning' THEN r.quantity END), 0) AS morning,
         COALESCE(SUM(CASE WHEN r.session = 'evening' THEN r.quantity END), 0) AS evening,
         COUNT(*) AS records
       FROM milk_records r WHERE ${whereSql}`
    )
    .get(...params);

  const todayTotals = db
    .prepare(
      `SELECT
         COALESCE(SUM(quantity), 0) AS total,
         COALESCE(SUM(CASE WHEN session = 'morning' THEN quantity END), 0) AS morning,
         COALESCE(SUM(CASE WHEN session = 'evening' THEN quantity END), 0) AS evening
       FROM milk_records WHERE farm_id = ? AND date = ?`
    )
    .get(FARM_ID, today);

  const weekTotals = db
    .prepare('SELECT COALESCE(SUM(quantity), 0) AS total FROM milk_records WHERE farm_id = ? AND date >= ? AND date <= ?')
    .get(FARM_ID, startOfWeek(today, farm.week_start), today);

  const monthTotals = db
    .prepare('SELECT COALESCE(SUM(quantity), 0) AS total FROM milk_records WHERE farm_id = ? AND date >= ? AND date <= ?')
    .get(FARM_ID, startOfMonth(today), today);

  const byDay = db
    .prepare(
      `SELECT r.date,
         COALESCE(SUM(r.quantity), 0) AS total,
         COALESCE(SUM(CASE WHEN r.session = 'morning' THEN r.quantity END), 0) AS morning,
         COALESCE(SUM(CASE WHEN r.session = 'evening' THEN r.quantity END), 0) AS evening
       FROM milk_records r
       WHERE ${whereSql}
       GROUP BY r.date
       ORDER BY r.date DESC
       LIMIT 366`
    )
    .all(...params);

  const byAnimal = db
    .prepare(
      `SELECT r.animal_id, a.tag_number, a.name,
         COALESCE(SUM(r.quantity), 0) AS total,
         COALESCE(SUM(CASE WHEN r.session = 'morning' THEN r.quantity END), 0) AS morning,
         COALESCE(SUM(CASE WHEN r.session = 'evening' THEN r.quantity END), 0) AS evening,
         COUNT(*) AS records
       FROM milk_records r
       JOIN animals a ON a.id = r.animal_id
       WHERE ${whereSql}
       GROUP BY r.animal_id
       ORDER BY total DESC
       LIMIT 200`
    )
    .all(...params);

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

function assertAnimal(animalId) {
  const animal = db.prepare('SELECT id, status FROM animals WHERE id = ? AND farm_id = ?').get(animalId, FARM_ID);
  if (!animal) throw new HttpError(400, 'Selected animal was not found.', { animal_id: 'Selected animal was not found.' });
  return animal;
}

function rules() {
  const farm = settingsService.get();
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

function create(body) {
  const data = validate(body, rules());
  const animal = assertAnimal(data.animal_id);
  if (animal.status !== 'active') {
    throw new HttpError(400, 'Milk can only be recorded for active animals.', {
      animal_id: 'This animal is not active.'
    });
  }
  try {
    const info = db
      .prepare(
        `INSERT INTO milk_records (farm_id, animal_id, date, session, quantity, unit, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(FARM_ID, data.animal_id, data.date, data.session, data.quantity, data.unit, data.notes);
    return db.prepare('SELECT * FROM milk_records WHERE id = ?').get(info.lastInsertRowid);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new HttpError(409, 'A milk record for this animal, date and session already exists.', {
        animal_id: 'This animal already has a record for this date and session.'
      });
    }
    throw err;
  }
}

function update(id, body) {
  const existing = db.prepare('SELECT * FROM milk_records WHERE id = ? AND farm_id = ?').get(id, FARM_ID);
  if (!existing) throw new HttpError(404, 'Milk record not found.');

  const data = validate(body, rules());
  assertAnimal(data.animal_id);
  try {
    db.prepare(
      `UPDATE milk_records SET
        animal_id = ?, date = ?, session = ?, quantity = ?, unit = ?, notes = ?,
        updated_at = datetime('now')
       WHERE id = ? AND farm_id = ?`
    ).run(data.animal_id, data.date, data.session, data.quantity, data.unit, data.notes, id, FARM_ID);
    return db.prepare('SELECT * FROM milk_records WHERE id = ?').get(id);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new HttpError(409, 'A milk record for this animal, date and session already exists.', {
        animal_id: 'This animal already has a record for this date and session.'
      });
    }
    throw err;
  }
}

function remove(id) {
  const info = db.prepare('DELETE FROM milk_records WHERE id = ? AND farm_id = ?').run(id, FARM_ID);
  if (info.changes === 0) throw new HttpError(404, 'Milk record not found.');
  return { ok: true };
}

module.exports = { list, summary, create, update, remove };
