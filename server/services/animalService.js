const db = require('../db/connection');
const { FARM_ID } = require('../config');
const { HttpError } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const { ANIMAL_TYPES, GENDERS, ANIMAL_STATUSES } = require('../constants/enums');
const { todayLocal } = require('../utils/date');

const SORTABLE = {
  tag_number: 'a.tag_number',
  name: 'a.name',
  type: 'a.type',
  status: 'a.status',
  created_at: 'a.created_at',
  total_milk: 'total_milk',
  last_milk_date: 'last_milk_date'
};

const LIST_SELECT = `
  SELECT a.*,
         COALESCE(m.total_milk, 0) AS total_milk,
         m.last_milk_date
  FROM animals a
  LEFT JOIN (
    SELECT animal_id, SUM(quantity) AS total_milk, MAX(date) AS last_milk_date
    FROM milk_records
    WHERE farm_id = ?
    GROUP BY animal_id
  ) m ON m.animal_id = a.id
`;

function list(query = {}) {
  const where = ['a.farm_id = ?'];
  const params = [FARM_ID];

  if (query.status) {
    where.push('a.status = ?');
    params.push(query.status);
  }
  if (query.type) {
    where.push('a.type = ?');
    params.push(query.type);
  }
  if (query.search) {
    where.push('(a.tag_number LIKE ? OR a.name LIKE ? OR a.breed LIKE ?)');
    const s = '%' + query.search + '%';
    params.push(s, s, s);
  }

  const order = SORTABLE[query.sort] || SORTABLE.created_at;
  const direction = String(query.dir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  return db
    .prepare(`${LIST_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} ${direction}, a.id DESC`)
    .all(FARM_ID, ...params);
}

function get(id) {
  const animal = db.prepare(`${LIST_SELECT} WHERE a.id = ? AND a.farm_id = ?`).get(FARM_ID, id, FARM_ID);
  if (!animal) throw new HttpError(404, 'Animal not found.');
  return animal;
}

const RULES = {
  tag_number: { required: true, label: 'Tag number', maxLength: 50 },
  name: { label: 'Name', maxLength: 100 },
  type: { required: true, enum: ANIMAL_TYPES, label: 'Type' },
  breed: { label: 'Breed', maxLength: 100 },
  gender: { required: true, enum: GENDERS, label: 'Gender' },
  date_of_birth: { type: 'date', label: 'Date of birth' },
  purchase_date: { type: 'date', label: 'Purchase date' },
  status: { enum: ANIMAL_STATUSES, default: 'active', label: 'Status' },
  notes: { label: 'Notes', maxLength: 2000 }
};

function create(body) {
  const data = validate(body, RULES);
  try {
    const info = db
      .prepare(
        `INSERT INTO animals
          (farm_id, tag_number, name, type, breed, gender, date_of_birth, purchase_date, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        FARM_ID,
        data.tag_number,
        data.name,
        data.type,
        data.breed,
        data.gender,
        data.date_of_birth,
        data.purchase_date,
        data.status,
        data.notes
      );
    return get(info.lastInsertRowid);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new HttpError(409, `Tag number "${data.tag_number}" is already in use.`);
    }
    throw err;
  }
}

function update(id, body) {
  const existing = get(id);
  const data = validate(body, RULES);
  try {
    db.prepare(
      `UPDATE animals SET
        tag_number = ?, name = ?, type = ?, breed = ?, gender = ?,
        date_of_birth = ?, purchase_date = ?, status = ?, notes = ?,
        updated_at = datetime('now')
       WHERE id = ? AND farm_id = ?`
    ).run(
      data.tag_number,
      data.name,
      data.type,
      data.breed,
      data.gender,
      data.date_of_birth,
      data.purchase_date,
      data.status,
      data.notes,
      existing.id,
      FARM_ID
    );
    return get(existing.id);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new HttpError(409, `Tag number "${data.tag_number}" is already in use.`);
    }
    throw err;
  }
}

function remove(id) {
  get(id);
  const milk = db.prepare('SELECT COUNT(*) AS n FROM milk_records WHERE animal_id = ?').get(id).n;
  const tx = db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE animal_id = ?').get(id).n;
  if (milk > 0 || tx > 0) {
    throw new HttpError(
      409,
      'This animal has linked records and cannot be deleted. Mark it as Sold or Deceased instead.'
    );
  }
  db.prepare('DELETE FROM animals WHERE id = ? AND farm_id = ?').run(id, FARM_ID);
  return { ok: true };
}

function profile(id) {
  const animal = get(id);

  const milk = db
    .prepare(
      `SELECT
         COALESCE(SUM(quantity), 0) AS total,
         COALESCE(SUM(CASE WHEN session = 'morning' THEN quantity END), 0) AS morning,
         COALESCE(SUM(CASE WHEN session = 'evening' THEN quantity END), 0) AS evening,
         COUNT(*) AS records,
         MAX(date) AS last_milk_date
       FROM milk_records WHERE farm_id = ? AND animal_id = ?`
    )
    .get(FARM_ID, id);

  const thisMonth = db
    .prepare(
      `SELECT COALESCE(SUM(quantity), 0) AS total
       FROM milk_records
       WHERE farm_id = ? AND animal_id = ? AND substr(date, 1, 7) = substr(?, 1, 7)`
    )
    .get(FARM_ID, id, todayLocal());

  const recentMilk = db
    .prepare(
      `SELECT * FROM milk_records
       WHERE farm_id = ? AND animal_id = ?
       ORDER BY date DESC, id DESC LIMIT 10`
    )
    .all(FARM_ID, id);

  const finance = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount END), 0) AS income,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expenses
       FROM transactions WHERE farm_id = ? AND animal_id = ?`
    )
    .get(FARM_ID, id);

  const recentTransactions = db
    .prepare(
      `SELECT * FROM transactions
       WHERE farm_id = ? AND animal_id = ?
       ORDER BY date DESC, id DESC LIMIT 10`
    )
    .all(FARM_ID, id);

  const monthlyMilk = db
    .prepare(
      `SELECT substr(date, 1, 7) AS month, SUM(quantity) AS total
       FROM milk_records
       WHERE farm_id = ? AND animal_id = ?
       GROUP BY month ORDER BY month DESC LIMIT 6`
    )
    .all(FARM_ID, id);

  return {
    animal,
    milk: { ...milk, this_month: thisMonth.total },
    recent_milk: recentMilk,
    finance: { income: finance.income, expenses: finance.expenses, net: finance.income - finance.expenses },
    recent_transactions: recentTransactions,
    monthly_milk: monthlyMilk
  };
}

module.exports = { list, get, create, update, remove, profile };
