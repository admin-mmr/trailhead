-- ============================================================
-- MMR Database Migration Script v5.0 — Add missing sync fields
-- ============================================================
-- Changes:
--   1. ADD ProfileLastUpdated to members table (tracks profile updates from Google Sheets)
--   2. ADD PaymentIntent to payments table (tracks payment intent from webapp_events)
--
-- HOW TO RUN:
--   mysql -h mmr-mysql.mysql.database.azure.com -u mmradmin -p \
--         --ssl-mode=REQUIRED mmrdb < mmr_migration_v5.sql
--
-- SAFE TO RE-RUN: uses IF EXISTS / IF NOT EXISTS guards
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;


-- ============================================================
-- 1. ADD ProfileLastUpdated to members table
--    Tracks when member profile was last updated in Google Sheets
--    Maps from: Google Sheets "ProfileLastUpdated" column
-- ============================================================
SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'members'
    AND COLUMN_NAME = 'ProfileLastUpdated'
);

SET @sql := IF(@col_exists = 0,
    'ALTER TABLE members ADD COLUMN ProfileLastUpdated DATETIME NULL COMMENT "When member profile was last updated (from Google Sheets)" AFTER LastLoginDate',
    'SELECT "ProfileLastUpdated column already exists"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- ============================================================
-- 2. ADD PaymentIntent to payments table
--    Tracks the payment intent from webapp_events
--    Maps from: Google Sheets "WebApp-Events" PaymentIntent column
-- ============================================================
SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'payments'
    AND COLUMN_NAME = 'PaymentIntent'
);

SET @sql := IF(@col_exists = 0,
    'ALTER TABLE payments ADD COLUMN PaymentIntent VARCHAR(100) NULL COMMENT "Payment intent ID (from webapp_events)" AFTER Amount',
    'SELECT "PaymentIntent column already exists"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- ============================================================
-- Record migration
-- ============================================================
INSERT INTO schema_migrations (version, description) VALUES
('0005', 'Add ProfileLastUpdated to members, PaymentIntent to payments')
ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;


SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- Verification
-- ============================================================
-- SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_COMMENT
-- FROM information_schema.COLUMNS
-- WHERE TABLE_SCHEMA = 'mmrdb'
--   AND TABLE_NAME IN ('members', 'payments')
--   AND COLUMN_NAME IN ('ProfileLastUpdated', 'PaymentIntent');
--
-- Expected: ProfileLastUpdated in members; PaymentIntent in payments
