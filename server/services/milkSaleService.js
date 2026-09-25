const db = require('../db');
const { FARM_ID } = require('../config');
const { HttpError } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const settingsService = require('./settingsService');
const priceService = require('./milkPriceService');
const { todayLocal, startOfWeek, startOfMonth } = require('../utils/date');

const RULES = {
  date: { required: true, type: 'date', label: 'Date' },
  litres: {
    required: true,
    type: 'number',
    label: 'Litres',
    validate: (v) => (v <= 0 ? 'Litres must be greater than 0.' : null)
  },
  price_per_litre: {
    type: 'number',
    label: 'Price per litre',
    validate: (v) => (v <= 0 ? 'Price must be greater than 0.' : null)
  },
  notes: { label: 'Notes', maxLength: 1000 }
};

function round2(value) {
  return Math.round(value * 100) / 100;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function trim(value) {
  return String(Number(Number(value).toFixed(3)));
}

function clampLimit(value, fallback = 25, max = 200) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function saleDescription(litres, price, unit) {
  return `Milk sale: ${trim(litres)} ${unit} @ ${trim(price)}/${unit}`;
}

async function priceForDate(date) {
  const price = await priceService.resolve(date);
  if (price === null) {
    throw new HttpError(400, 'Please check the highlighted fields.', {
      date: 'No milk price is set for this date. Add a price first.'
    });
  }
  return price;
}

async function list(query = {}) {
  const where = ['farm_id = ?'];
  const params = [FARM_ID];

  if (query.from) {
    where.push('date >= ?');
    params.push(query.from);
  }
  if (query.to) {
    where.push('date <= ?');
    params.push(query.to);
  }
  if (query.search) {
    where.push('notes LIKE ?');
    params.push('%' + query.search + '%');
  }

  const whereSql = where.join(' AND ');
  const total = (await db.get(`SELECT CAST(COUNT(*) AS INTEGER) AS n FROM milk_sales WHERE ${whereSql}`, params)).n;

  const limit = clampLimit(query.limit);
  const offset = Math.max(0, Number(query.offset) || 0);

  const items = await db.all(
    `SELECT * FROM milk_sales WHERE ${whereSql}
     ORDER BY date DESC, id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return { items, total, limit, offset };
}

async function get(id) {
  const sale = await db.get('SELECT * FROM milk_sales WHERE id = ? AND farm_id = ?', [id, FARM_ID]);
  if (!sale) throw new HttpError(404, 'Milk sale not found.');
  return sale;
}

async function summary(query = {}) {
  const farm = await settingsService.get();
  const today = todayLocal();
  const from = query.from || null;
  const to = query.to || null;

  const rangeWhere = ['farm_id = ?'];
  const rangeParams = [FARM_ID];
  if (from) {
    rangeWhere.push('date >= ?');
    rangeParams.push(from);
  }
  if (to) {
    rangeWhere.push('date <= ?');
    rangeParams.push(to);
  }

  const sold = await db.get(
    `SELECT COALESCE(SUM(litres), 0) AS litres, COALESCE(SUM(revenue), 0) AS revenue,
            CAST(COUNT(*) AS INTEGER) AS count
     FROM milk_sales WHERE ${rangeWhere.join(' AND ')}`,
    rangeParams
  );

  const producedWhere = ['farm_id = ?'];
  const producedParams = [FARM_ID];
  if (from) {
    producedWhere.push('date >= ?');
    producedParams.push(from);
  }
  if (to) {
    producedWhere.push('date <= ?');
    producedParams.push(to);
  }
  const produced = await db.get(
    `SELECT COALESCE(SUM(quantity), 0) AS total FROM milk_records WHERE ${producedWhere.join(' AND ')}`,
    producedParams
  );

  const todaySold = await db.get(
    `SELECT COALESCE(SUM(litres), 0) AS litres, COALESCE(SUM(revenue), 0) AS revenue,
            CAST(COUNT(*) AS INTEGER) AS count
     FROM milk_sales WHERE farm_id = ? AND date = ?`,
    [FARM_ID, today]
  );

  const monthSold = await db.get(
    `SELECT COALESCE(SUM(litres), 0) AS litres, COALESCE(SUM(revenue), 0) AS revenue,
            CAST(COUNT(*) AS INTEGER) AS count
     FROM milk_sales WHERE farm_id = ? AND date >= ? AND date <= ?`,
    [FARM_ID, startOfMonth(today), today]
  );

  const weekSold = await db.get(
    `SELECT COALESCE(SUM(litres), 0) AS litres, COALESCE(SUM(revenue), 0) AS revenue,
            CAST(COUNT(*) AS INTEGER) AS count
     FROM milk_sales WHERE farm_id = ? AND date >= ? AND date <= ?`,
    [FARM_ID, startOfWeek(today, farm.week_start), today]
  );

  const producedTotal = round3(produced.total);
  const soldTotal = round3(sold.litres);

  return {
    unit: farm.milk_unit,
    currency: farm.currency,
    current_price: await priceService.resolve(today),
    range: {
      from,
      to,
      produced: producedTotal,
      sold: soldTotal,
      remaining: round3(producedTotal - soldTotal),
      revenue: round2(sold.revenue),
      sales_count: sold.count
    },
    today: { sold: round3(todaySold.litres), revenue: round2(todaySold.revenue), sales_count: todaySold.count },
    week: { sold: round3(weekSold.litres), revenue: round2(weekSold.revenue), sales_count: weekSold.count },
    month: { sold: round3(monthSold.litres), revenue: round2(monthSold.revenue), sales_count: monthSold.count }
  };
}

async function create(body) {
  const data = validate(body, RULES);
  const farm = await settingsService.get();
  const price = await priceForDate(data.date);
  const revenue = round2(data.litres * price);
  const description = saleDescription(data.litres, price, farm.milk_unit);

  const id = await db.transaction(async (tx) => {
    const txInfo = await tx.run(
      `INSERT INTO transactions (farm_id, animal_id, date, type, category, amount, description)
       VALUES (?, NULL, ?, 'income', 'milk_sale', ?, ?)`,
      [FARM_ID, data.date, revenue, description]
    );
    const info = await tx.run(
      `INSERT INTO milk_sales (farm_id, date, litres, price_per_litre, revenue, notes, transaction_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [FARM_ID, data.date, data.litres, price, revenue, data.notes, txInfo.lastInsertRowid]
    );
    return info.lastInsertRowid;
  });

  return get(id);
}

async function update(id, body) {
  const existing = await get(id);
  const data = validate(body, RULES);
  const farm = await settingsService.get();
  const price = data.date === existing.date ? existing.price_per_litre : await priceForDate(data.date);
  const revenue = round2(data.litres * price);
  const description = saleDescription(data.litres, price, farm.milk_unit);

  await db.transaction(async (tx) => {
    let transactionId = existing.transaction_id;

    if (transactionId) {
      const linked = await tx.get('SELECT id FROM transactions WHERE id = ? AND farm_id = ?', [
        transactionId,
        FARM_ID
      ]);
      if (linked) {
        await tx.run(
          `UPDATE transactions SET date = ?, amount = ?, description = ?, updated_at = ?
           WHERE id = ? AND farm_id = ?`,
          [data.date, revenue, description, db.now(), transactionId, FARM_ID]
        );
      } else {
        transactionId = null;
      }
    }

    if (!transactionId) {
      const txInfo = await tx.run(
        `INSERT INTO transactions (farm_id, animal_id, date, type, category, amount, description)
         VALUES (?, NULL, ?, 'income', 'milk_sale', ?, ?)`,
        [FARM_ID, data.date, revenue, description]
      );
      transactionId = txInfo.lastInsertRowid;
    }

    await tx.run(
      `UPDATE milk_sales SET
         date = ?, litres = ?, price_per_litre = ?, revenue = ?, notes = ?, transaction_id = ?, updated_at = ?
       WHERE id = ? AND farm_id = ?`,
      [data.date, data.litres, price, revenue, data.notes, transactionId, db.now(), id, FARM_ID]
    );
  });

  return get(id);
}

async function remove(id) {
  const existing = await get(id);

  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM milk_sales WHERE id = ? AND farm_id = ?', [id, FARM_ID]);
    if (existing.transaction_id) {
      const linked = await tx.get('SELECT id FROM transactions WHERE id = ? AND farm_id = ?', [
        existing.transaction_id,
        FARM_ID
      ]);
      if (linked) {
        await tx.run('DELETE FROM transactions WHERE id = ? AND farm_id = ?', [existing.transaction_id, FARM_ID]);
      }
    }
  });

  return { ok: true };
}

module.exports = { list, get, summary, create, update, remove };
