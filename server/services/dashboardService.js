const db = require('../db/connection');
const { FARM_ID } = require('../config');
const settingsService = require('./settingsService');
const financeService = require('./financeService');
const healthService = require('./healthService');
const breedingService = require('./breedingService');
const { INCOME_CATEGORIES, EXPENSE_CATEGORIES } = require('../constants/categories');
const { todayLocal, startOfWeek, lastNDates } = require('../utils/date');

function categoryLabel(type, value) {
  const list = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const found = list.find((c) => c.value === value);
  return found ? found.label : value;
}

function get() {
  const farm = settingsService.get();
  const today = todayLocal();
  const weekStart = startOfWeek(today, farm.week_start);

  const activeAnimals = db
    .prepare("SELECT COUNT(*) AS n FROM animals WHERE farm_id = ? AND status = 'active'")
    .get(FARM_ID).n;

  const todayMilk = db
    .prepare(
      `SELECT
         COALESCE(SUM(quantity), 0) AS total,
         COALESCE(SUM(CASE WHEN session = 'morning' THEN quantity END), 0) AS morning,
         COALESCE(SUM(CASE WHEN session = 'evening' THEN quantity END), 0) AS evening
       FROM milk_records WHERE farm_id = ? AND date = ?`
    )
    .get(FARM_ID, today);

  const weekMilk = db
    .prepare('SELECT COALESCE(SUM(quantity), 0) AS total FROM milk_records WHERE farm_id = ? AND date >= ? AND date <= ?')
    .get(FARM_ID, weekStart, today).total;

  const finance = financeService.totals();
  const health = healthService.summary();
  const breeding = breedingService.summary();

  const milk = db
    .prepare(
      `SELECT r.id, r.date, r.session, r.quantity, r.unit, r.created_at,
              a.id AS animal_id, a.tag_number, a.name
       FROM milk_records r JOIN animals a ON a.id = r.animal_id
       WHERE r.farm_id = ? ORDER BY r.id DESC LIMIT 6`
    )
    .all(FARM_ID);

  const transactions = db
    .prepare(
      `SELECT t.id, t.date, t.type, t.category, t.amount, t.description, t.created_at,
              a.id AS animal_id, a.tag_number, a.name
       FROM transactions t LEFT JOIN animals a ON a.id = t.animal_id
       WHERE t.farm_id = ? ORDER BY t.id DESC LIMIT 6`
    )
    .all(FARM_ID);

  const animals = db
    .prepare(
      `SELECT id, tag_number, name, type, status, created_at, updated_at
       FROM animals WHERE farm_id = ? ORDER BY id DESC LIMIT 6`
    )
    .all(FARM_ID);

  const activity = [
    ...milk.map((r) => ({
      kind: 'milk',
      id: r.id,
      at: r.created_at,
      title: `${r.quantity} ${r.unit} · ${r.session === 'morning' ? 'Morning' : 'Evening'}`,
      subtitle: `Animal #${r.tag_number}${r.name ? ' · ' + r.name : ''}`,
      tone: 'green'
    })),
    ...transactions.map((t) => ({
      kind: 'transaction',
      id: t.id,
      at: t.created_at,
      title: `${t.type === 'income' ? 'Income' : 'Expense'} · ${categoryLabel(t.type, t.category)}`,
      subtitle: `${t.description || 'No description'}${t.tag_number ? ' · #' + t.tag_number : ''}`,
      tone: t.type === 'income' ? 'green' : 'red'
    })),
    ...animals.map((a) => ({
      kind: 'animal',
      id: a.id,
      at: a.updated_at,
      title: `${a.created_at === a.updated_at ? 'Added' : 'Updated'} animal #${a.tag_number}`,
      subtitle: `${a.type.charAt(0).toUpperCase() + a.type.slice(1)}${a.name ? ' · ' + a.name : ''} · ${a.status}`,
      tone: 'gray'
    }))
  ]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id - a.id))
    .slice(0, 8);

  const dates = lastNDates(7, today);
  const rows = db
    .prepare(
      `SELECT date, SUM(quantity) AS total FROM milk_records
       WHERE farm_id = ? AND date >= ? AND date <= ?
       GROUP BY date`
    )
    .all(FARM_ID, dates[0], today);
  const byDate = new Map(rows.map((r) => [r.date, r.total]));

  return {
    farm,
    today,
    metrics: {
      active_animals: activeAnimals,
      milk_today: todayMilk.total,
      milk_today_morning: todayMilk.morning,
      milk_today_evening: todayMilk.evening,
      milk_week: weekMilk,
      revenue_all_time: finance.income,
      expenses_all_time: finance.expenses,
      net_all_time: finance.net,
      unit: farm.milk_unit,
      health: {
        withdrawal_count: health.withdrawal_count,
        due_soon_count: health.due_soon_count,
        events_this_month: health.events_this_month
      },
      breeding: {
        currently_pregnant: breeding.currently_pregnant_count,
        calving_soon: breeding.calving_soon_count,
        pending_checks: breeding.pending_checks_count
      }
    },
    recent_activity: activity,
    milk_last_7_days: dates.map((date) => ({ date, total: byDate.get(date) || 0 }))
  };
}

module.exports = { get };
