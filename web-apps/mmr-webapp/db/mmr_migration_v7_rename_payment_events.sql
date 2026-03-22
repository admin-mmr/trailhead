-- ============================================================
-- MMR Database Migration Script v7
-- Target: mmr-mysql.mysql.database.azure.com / mmrdb
-- Run as: mmradmin
-- Date: 2026-03-22
--
-- HOW TO RUN:
--   mysql-mmr < db/mmr_migration_v7_rename_payment_events.sql
--
--   or manually:
--   mysql -h mmr-mysql.mysql.database.azure.com -u mmradmin -p \
--         --ssl-mode=REQUIRED mmrdb < db/mmr_migration_v7_rename_payment_events.sql
--
-- WHAT THIS DOES:
--   1. Verifies webapp_events is empty (safe to drop)
--   2. Drops the empty webapp_events table
--   3. Renames payment_events → webapp_events (atomic, preserves all data/indexes/FKs)
--   4. Also drops the unused otp_tokens table (replaced by otp_codes from v6)
--   5. Verifies final state
--
-- BEFORE RUNNING — check row counts yourself:
--   mysql-mmr -e "SELECT COUNT(*) FROM webapp_events; SELECT COUNT(*) FROM payment_events;"
--
-- If webapp_events has data you want to keep, DO NOT run this script — merge manually first.
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- Safety check: abort if webapp_events has rows
-- (MySQL doesn't support IF-ABORT natively, so we use a trick:
--  the procedure will signal an error if rows > 0)
-- ============================================================
DROP PROCEDURE IF EXISTS safe_rename_payment_events;

DELIMITER //
CREATE PROCEDURE safe_rename_payment_events()
BEGIN
    DECLARE row_count INT DEFAULT 0;

    -- Count rows in webapp_events
    SELECT COUNT(*) INTO row_count FROM webapp_events;

    IF row_count > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'ABORT: webapp_events is not empty. Check its data before dropping. Row count > 0.';
    END IF;

    -- Safe to proceed: drop empty webapp_events
    DROP TABLE IF EXISTS webapp_events;

    -- Rename payment_events → webapp_events (atomic)
    RENAME TABLE payment_events TO webapp_events;

    -- Drop unused otp_tokens (superseded by otp_codes from v6 migration)
    DROP TABLE IF EXISTS otp_tokens;

    SELECT 'Migration v7 complete: payment_events renamed to webapp_events, otp_tokens dropped.' AS result;
END //
DELIMITER ;

CALL safe_rename_payment_events();
DROP PROCEDURE IF EXISTS safe_rename_payment_events;


-- ============================================================
-- Verify final state
-- ============================================================
SELECT TABLE_NAME, TABLE_ROWS, ENGINE
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME;

-- Expected: webapp_events present, payment_events and otp_tokens absent

SET FOREIGN_KEY_CHECKS = 1;

-- End of migration v7
