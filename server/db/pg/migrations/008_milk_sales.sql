CREATE TABLE IF NOT EXISTS milk_prices (
  id SERIAL PRIMARY KEY,
  farm_id INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  price_per_litre DOUBLE PRECISION NOT NULL CHECK (price_per_litre > 0),
  effective_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE (farm_id, effective_date)
);

CREATE INDEX IF NOT EXISTS idx_milk_prices_farm_date ON milk_prices(farm_id, effective_date);

CREATE TABLE IF NOT EXISTS milk_sales (
  id SERIAL PRIMARY KEY,
  farm_id INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  litres DOUBLE PRECISION NOT NULL CHECK (litres > 0),
  price_per_litre DOUBLE PRECISION NOT NULL CHECK (price_per_litre > 0),
  revenue DOUBLE PRECISION NOT NULL CHECK (revenue >= 0),
  notes TEXT,
  transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE INDEX IF NOT EXISTS idx_milk_sales_farm_date ON milk_sales(farm_id, date);
CREATE INDEX IF NOT EXISTS idx_milk_sales_transaction ON milk_sales(transaction_id);
