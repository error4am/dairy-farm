CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  role TEXT,
  joining_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  pay_type TEXT NOT NULL DEFAULT 'monthly' CHECK (pay_type IN ('monthly', 'daily')),
  salary REAL NOT NULL DEFAULT 0 CHECK (salary >= 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (farm_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_employees_farm_status ON employees(farm_id, status);
CREATE INDEX IF NOT EXISTS idx_employees_farm_role ON employees(farm_id, role);
CREATE INDEX IF NOT EXISTS idx_employees_farm_code ON employees(farm_id, employee_id);

CREATE TABLE IF NOT EXISTS employee_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('salary', 'advance', 'bonus', 'other')),
  amount REAL NOT NULL CHECK (amount > 0),
  description TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_emp_pay_farm_date ON employee_payments(farm_id, date);
CREATE INDEX IF NOT EXISTS idx_emp_pay_employee_date ON employee_payments(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_emp_pay_farm_type ON employee_payments(farm_id, type);
