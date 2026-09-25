CREATE TABLE IF NOT EXISTS milk_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  price_per_litre REAL NOT NULL CHECK (price_per_litre > 0),
  effective_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (farm_id, effective_date)
);

CREATE INDEX IF NOT EXISTS idx_milk_prices_farm_date ON milk_prices(farm_id, effective_date);

CREATE TABLE IF NOT EXISTS milk_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  litres REAL NOT NULL CHECK (litres > 0),
  price_per_litre REAL NOT NULL CHECK (price_per_litre > 0),
  revenue REAL NOT NULL CHECK (revenue >= 0),
  notes TEXT,
  transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_milk_sales_farm_date ON milk_sales(farm_id, date);
CREATE INDEX IF NOT EXISTS idx_milk_sales_transaction ON milk_sales(transaction_id);
