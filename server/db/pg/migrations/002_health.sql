CREATE TABLE IF NOT EXISTS health_records (
  id SERIAL PRIMARY KEY,
  farm_id INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  animal_id INTEGER NOT NULL REFERENCES animals(id) ON DELETE RESTRICT,
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('vaccination', 'treatment', 'illness', 'checkup', 'deworming', 'other')),
  condition TEXT,
  medicine TEXT,
  dosage TEXT,
  vet_name TEXT,
  withdrawal_until TEXT,
  next_due_date TEXT,
  notes TEXT,
  transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE INDEX IF NOT EXISTS idx_health_farm_date ON health_records(farm_id, date);
CREATE INDEX IF NOT EXISTS idx_health_animal_date ON health_records(animal_id, date);
CREATE INDEX IF NOT EXISTS idx_health_withdrawal ON health_records(farm_id, withdrawal_until);
CREATE INDEX IF NOT EXISTS idx_health_due ON health_records(farm_id, next_due_date);
