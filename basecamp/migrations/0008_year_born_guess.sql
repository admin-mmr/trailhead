-- ============================================================
-- Migration 0008: Add YearBornGuess column to members
-- Purpose: System-inferred birth year from NYRR age data to help
--          disambiguate same-surname members in the admin match UI.
--          NYRR age + event_year → one of two possible birth years.
-- Date: 2026-03-26
-- Depends on: 0007 (nyrr_tables)
--
-- HOW TO RUN:
--   mysql -h mmr-mysql.mysql.database.azure.com -u mmradmin -p mmrdb < 0008_year_born_guess.sql
--
-- SAFE TO RE-RUN: Uses IF NOT EXISTS / IF EXISTS checks
-- ============================================================

SET NAMES utf8mb4;

-- ============================================================
-- 1. ADD YearBornGuess TO MEMBERS
--    - YearBorn (existing, col 26) is member-entered.
--    - YearBornGuess is system-inferred from NYRR age data.
--    - Helps disambiguate same-surname members in the admin
--      annotation UI when match_method = 'unmatched'.
-- ============================================================

-- Guard: only add if column does not already exist
SET @col_exists = (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'members'
      AND COLUMN_NAME  = 'YearBornGuess'
);

SET @sql = IF(@col_exists = 0,
    'ALTER TABLE members ADD COLUMN YearBornGuess SMALLINT NULL COMMENT ''System-inferred birth year from NYRR age data'' AFTER YearBorn',
    'SELECT ''Column YearBornGuess already exists — skipping'' AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- ============================================================
-- Record migration in schema_migrations
-- ============================================================
INSERT INTO schema_migrations (version, description) VALUES
('0008', 'Add YearBornGuess column to members table')
ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;

-- End of migration 0008
