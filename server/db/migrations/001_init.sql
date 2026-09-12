CREATE TABLE IF NOT EXISTS farms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PKR',
  milk_unit TEXT NOT NULL DEFAULT 'L',
  week_start TEXT NOT NULL DEFAULT 'monday' CHECK (week_start IN ('monday', 'sunday')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_farm ON users(farm_id);

CREATE TABLE IF NOT EXISTS animals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  tag_number TEXT NOT NULL,
  name TEXT,
  type TEXT NOT NULL CHECK (type IN ('cow', 'buffalo', 'other')),
  breed TEXT,
  gender TEXT NOT NULL CHECK (gender IN ('female', 'male')),
  date_of_birth TEXT,
  purchase_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sold', 'deceased')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (farm_id, tag_number)
);

CREATE INDEX IF NOT EXISTS idx_animals_farm_status ON animals(farm_id, status);
CREATE INDEX IF NOT EXISTS idx_animals_farm_tag ON animals(farm_id, tag_number);

CREATE TABLE IF NOT EXISTS milk_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  animal_id INTEGER NOT NULL REFERENCES animals(id) ON DELETE RESTRICT,
  date TEXT NOT NULL,
  session TEXT NOT NULL CHECK (session IN ('morning', 'evening')),
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL DEFAULT 'L',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (farm_id, animal_id, date, session)
);

CREATE INDEX IF NOT EXISTS idx_milk_farm_date ON milk_records(farm_id, date);
CREATE INDEX IF NOT EXISTS idx_milk_animal_date ON milk_records(animal_id, date);
CREATE INDEX IF NOT EXISTS idx_milk_farm_session ON milk_records(farm_id, session);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  animal_id INTEGER REFERENCES animals(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  category TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tx_farm_date ON transactions(farm_id, date);
CREATE INDEX IF NOT EXISTS idx_tx_farm_type ON transactions(farm_id, type);
CREATE INDEX IF NOT EXISTS idx_tx_animal ON transactions(animal_id);
