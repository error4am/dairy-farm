const db = require('../db');
const { FARM_ID } = require('../config');
const { HttpError } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const { ANIMAL_TYPES, GENDERS, ANIMAL_STATUSES } = require('../constants/enums');
const { todayLocal } = require('../utils/date');
const breedingService = require('./breedingService');

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
         m.last_milk_date,
         w.withdrawal_until
  FROM animals a
  LEFT JOIN (
    SELECT animal_id, SUM(quantity) AS total_milk, MAX(date) AS last_milk_date
    FROM milk_records
    WHERE farm_id = ?
    GROUP BY animal_id
  ) m ON m.animal_id = a.id
  LEFT JOIN (
    SELECT animal_id, MAX(withdrawal_until) AS withdrawal_until
    FROM health_records
    WHERE farm_id = ? AND withdrawal_until IS NOT NULL AND withdrawal_until >= ?
    GROUP BY animal_id
  ) w ON w.animal_id = a.id
`;

async function list(query = {}) {
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

  return db.all(`${LIST_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} ${direction}, a.id DESC`, [
    FARM_ID,
    FARM_ID,
    todayLocal(),
    ...params
  ]);
}

async function get(id) {
  const animal = await db.get(`${LIST_SELECT} WHERE a.id = ? AND a.farm_id = ?`, [
    FARM_ID,
    FARM_ID,
    todayLocal(),
    id,
    FARM_ID
  ]);
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

async function create(body) {
  const data = validate(body, RULES);
  try {
    const info = await db.run(
      `INSERT INTO animals
        (farm_id, tag_number, name, type, breed, gender, date_of_birth, purchase_date, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
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
      ]
    );
    return get(info.lastInsertRowid);
  } catch (err) {
    if (db.isUniqueViolation(err)) {
      throw new HttpError(409, `Tag number "${data.tag_number}" is already in use.`);
    }
    throw err;
  }
}

async function update(id, body) {
  const existing = await get(id);
  const data = validate(body, RULES);
  try {
    await db.run(
      `UPDATE animals SET
        tag_number = ?, name = ?, type = ?, breed = ?, gender = ?,
        date_of_birth = ?, purchase_date = ?, status = ?, notes = ?,
        updated_at = ?
       WHERE id = ? AND farm_id = ?`,
      [
        data.tag_number,
        data.name,
        data.type,
        data.breed,
        data.gender,
        data.date_of_birth,
        data.purchase_date,
        data.status,
        data.notes,
        db.now(),
        existing.id,
        FARM_ID
      ]
    );
    return get(existing.id);
  } catch (err) {
    if (db.isUniqueViolation(err)) {
      throw new HttpError(409, `Tag number "${data.tag_number}" is already in use.`);
    }
    throw err;
  }
}

async function remove(id) {
  await get(id);
  const milk = (await db.get('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM milk_records WHERE animal_id = ?', [id])).n;
  const tx = (await db.get('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM transactions WHERE animal_id = ?', [id])).n;
  const health = (await db.get('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM health_records WHERE animal_id = ?', [id])).n;
  const breeding = (await db.get('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM breeding_records WHERE animal_id = ?', [id])).n;
  if (milk > 0 || tx > 0 || health > 0 || breeding > 0) {
    throw new HttpError(
      409,
      'This animal has linked records and cannot be deleted. Mark it as Sold or Deceased instead.'
    );
  }
  await db.run('DELETE FROM animals WHERE id = ? AND farm_id = ?', [id, FARM_ID]);
  return { ok: true };
}

async function profile(id) {
  const animal = await get(id);

  const milk = await db.get(
    `SELECT
       COALESCE(SUM(quantity), 0) AS total,
       COALESCE(SUM(CASE WHEN session = 'morning' THEN quantity END), 0) AS morning,
       COALESCE(SUM(CASE WHEN session = 'evening' THEN quantity END), 0) AS evening,
       CAST(COUNT(*) AS INTEGER) AS records,
       MAX(date) AS last_milk_date
     FROM milk_records WHERE farm_id = ? AND animal_id = ?`,
    [FARM_ID, id]
  );

  const thisMonth = await db.get(
    `SELECT COALESCE(SUM(quantity), 0) AS total
     FROM milk_records
     WHERE farm_id = ? AND animal_id = ? AND substr(date, 1, 7) = substr(?, 1, 7)`,
    [FARM_ID, id, todayLocal()]
  );

  const recentMilk = await db.all(
    `SELECT * FROM milk_records
     WHERE farm_id = ? AND animal_id = ?
     ORDER BY date DESC, id DESC LIMIT 10`,
    [FARM_ID, id]
  );

  const finance = await db.get(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'income' THEN amount END), 0) AS income,
       COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expenses
     FROM transactions WHERE farm_id = ? AND animal_id = ?`,
    [FARM_ID, id]
  );

  const recentTransactions = await db.all(
    `SELECT * FROM transactions
     WHERE farm_id = ? AND animal_id = ?
     ORDER BY date DESC, id DESC LIMIT 10`,
    [FARM_ID, id]
  );

  const monthlyMilk = await db.all(
    `SELECT substr(date, 1, 7) AS month, SUM(quantity) AS total
     FROM milk_records
     WHERE farm_id = ? AND animal_id = ?
     GROUP BY substr(date, 1, 7) ORDER BY month DESC LIMIT 6`,
    [FARM_ID, id]
  );

  const recentHealth = await db.all(
    `SELECT h.*, t.amount AS cost
     FROM health_records h
     LEFT JOIN transactions t ON t.id = h.transaction_id
     WHERE h.farm_id = ? AND h.animal_id = ?
     ORDER BY h.date DESC, h.id DESC LIMIT 10`,
    [FARM_ID, id]
  );

  const recentBreeding = await db.all(
    `SELECT * FROM breeding_records
     WHERE farm_id = ? AND animal_id = ?
     ORDER BY COALESCE(service_date, heat_date, substr(created_at, 1, 10)) DESC, id DESC LIMIT 10`,
    [FARM_ID, id]
  );

  return {
    animal,
    milk: { ...milk, this_month: thisMonth.total },
    recent_milk: recentMilk,
    finance: { income: finance.income, expenses: finance.expenses, net: finance.income - finance.expenses },
    recent_transactions: recentTransactions,
    monthly_milk: monthlyMilk,
    recent_health: recentHealth,
    breeding: {
      current: await breedingService.currentForAnimal(id),
      recent: recentBreeding
    }
  };
}

module.exports = { list, get, create, update, remove, profile };
