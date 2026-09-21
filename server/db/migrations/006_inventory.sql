CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('concentrate', 'silage', 'fodder', 'mineral', 'supply', 'other')),
  unit TEXT NOT NULL,
  minimum_stock REAL CHECK (minimum_stock IS NULL OR minimum_stock >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (farm_id, name)
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_farm_active ON inventory_items(farm_id, active);
CREATE INDEX IF NOT EXISTS idx_inventory_items_farm_category ON inventory_items(farm_id, category);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('opening', 'purchase', 'consumption', 'waste', 'adjustment')),
  quantity REAL NOT NULL CHECK (quantity <> 0),
  unit TEXT NOT NULL,
  unit_cost REAL CHECK (unit_cost IS NULL OR unit_cost >= 0),
  total_cost REAL CHECK (total_cost IS NULL OR total_cost >= 0),
  supplier TEXT,
  notes TEXT,
  transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_farm_date ON inventory_movements(farm_id, date);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_item_date ON inventory_movements(item_id, date);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_farm_type ON inventory_movements(farm_id, type);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_transaction ON inventory_movements(transaction_id);
