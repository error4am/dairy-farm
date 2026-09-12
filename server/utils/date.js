function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayLocal() {
  return formatDate(new Date());
}

function parseLocal(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(dateStr, n) {
  const d = parseLocal(dateStr);
  d.setDate(d.getDate() + n);
  return formatDate(d);
}

function startOfWeek(dateStr, weekStart = 'monday') {
  const d = parseLocal(dateStr);
  const day = d.getDay();
  const offset = weekStart === 'sunday' ? day : (day + 6) % 7;
  d.setDate(d.getDate() - offset);
  return formatDate(d);
}

function startOfMonth(dateStr) {
  return String(dateStr).slice(0, 7) + '-01';
}

function lastNDates(n, endDate) {
  const dates = [];
  for (let i = n - 1; i >= 0; i--) {
    dates.push(addDays(endDate, -i));
  }
  return dates;
}

module.exports = { todayLocal, parseLocal, addDays, startOfWeek, startOfMonth, lastNDates, formatDate };
