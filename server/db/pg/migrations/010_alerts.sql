CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY,
  farm_id INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('pregnancy_check', 'calving', 'treatment_followup', 'vaccination', 'milk_withdrawal', 'low_stock', 'out_of_stock')),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('breeding', 'health', 'inventory_item')),
  source_id INTEGER NOT NULL,
  trigger_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'resolved')),
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  read_at TEXT,
  resolved_at TEXT,
  UNIQUE (farm_id, trigger_key)
);

CREATE INDEX IF NOT EXISTS idx_alerts_farm_status ON alerts(farm_id, status);
CREATE INDEX IF NOT EXISTS idx_alerts_farm_created ON alerts(farm_id, created_at);
CREATE INDEX IF NOT EXISTS idx_alerts_source ON alerts(source_type, source_id);
