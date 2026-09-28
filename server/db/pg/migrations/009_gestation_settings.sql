ALTER TABLE farms ADD COLUMN cow_gestation_days INTEGER NOT NULL DEFAULT 283;
ALTER TABLE farms ADD COLUMN buffalo_gestation_days INTEGER NOT NULL DEFAULT 310;

UPDATE farms SET cow_gestation_days = gestation_days;
