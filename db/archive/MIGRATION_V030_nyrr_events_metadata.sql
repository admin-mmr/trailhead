-- ── MIGRATION_V030: nyrr_events metadata columns ────────────────────────────
-- Adds fields now captured from the NYRR events/search + events/details API:
--   distance_km            DECIMAL(6,3)  — distanceDimension (km float, e.g. 21.0824)
--   weather                VARCHAR(500)  — weather string at race time
--   photo_url              VARCHAR(500)  — marathonfoto / photo partner URL
--   teams_count            INT           — teamsCount (gates HOF display)
--   has_age_graded_results TINYINT(1)    — hasAgeGradedResults flag
--
-- MySQL 5.7 constraint: no IF NOT EXISTS in ALTER TABLE — each ADD is separate.
-- Safe to re-run: guarded by INFORMATION_SCHEMA checks.
-- ----------------------------------------------------------------------------

-- distance_km
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nyrr_events'
            AND COLUMN_NAME = 'distance_km');
SET @sql = IF(@col = 0,
    'ALTER TABLE nyrr_events ADD COLUMN distance_km DECIMAL(6,3) NULL COMMENT ''Canonical race distance in km from NYRR distanceDimension'' AFTER distance',
    'SELECT ''distance_km already exists'' AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- weather
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nyrr_events'
            AND COLUMN_NAME = 'weather');
SET @sql = IF(@col = 0,
    'ALTER TABLE nyrr_events ADD COLUMN weather VARCHAR(500) NULL COMMENT ''Weather conditions at race time from NYRR API'' AFTER distance_km',
    'SELECT ''weather already exists'' AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- photo_url
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nyrr_events'
            AND COLUMN_NAME = 'photo_url');
SET @sql = IF(@col = 0,
    'ALTER TABLE nyrr_events ADD COLUMN photo_url VARCHAR(500) NULL COMMENT ''Photo partner URL (e.g. marathonfoto) from NYRR API'' AFTER weather',
    'SELECT ''photo_url already exists'' AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- teams_count
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nyrr_events'
            AND COLUMN_NAME = 'teams_count');
SET @sql = IF(@col = 0,
    'ALTER TABLE nyrr_events ADD COLUMN teams_count INT NOT NULL DEFAULT 0 COMMENT ''teamsCount from NYRR API — number of teams with finishers'' AFTER photo_url',
    'SELECT ''teams_count already exists'' AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- has_age_graded_results
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nyrr_events'
            AND COLUMN_NAME = 'has_age_graded_results');
SET @sql = IF(@col = 0,
    'ALTER TABLE nyrr_events ADD COLUMN has_age_graded_results TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''hasAgeGradedResults from NYRR API'' AFTER teams_count',
    'SELECT ''has_age_graded_results already exists'' AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Self-registration (required by CLAUDE.md — prevents re-runs, provides audit trail)
INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V030', 'nyrr_events metadata: distance_km, weather, photo_url, teams_count, has_age_graded_results', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
