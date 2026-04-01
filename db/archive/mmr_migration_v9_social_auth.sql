-- ============================================================
-- MMR Database Migration Script v9
-- Target: mmr-mysql-v4.mysql.database.azure.com / mmrdb
-- Run as: mmradmin
-- Date: 2026-03-22
--
-- HOW TO RUN:
--   mysql-mmr < db/mmr_migration_v9_social_auth.sql
--
-- WHAT THIS DOES:
--   1. Adds facebook_sub column to members (snake_case, consistent
--      with other OAuth sub columns: google_sub, apple_sub, etc.)
--   2. Drops the otp_codes table (OTP auth replaced by social login
--      + email/password via NextAuth v5)
--   3. Records migration in schema_migrations
--
-- SAFE TO RE-RUN: uses IF NOT EXISTS / IF EXISTS guards
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;


-- ============================================================
-- 1. Add facebook_sub + index to members
--    Consistent with existing: google_sub, microsoft_sub,
--    apple_sub, yahoo_sub (all snake_case, from v1 migration)
--
--    NOTE: ADD COLUMN IF NOT EXISTS is MariaDB syntax only.
--    MySQL requires a procedure guard to achieve idempotency.
-- ============================================================
DROP PROCEDURE IF EXISTS mmr_v9_migration;
DELIMITER //
CREATE PROCEDURE mmr_v9_migration()
BEGIN
    -- Add facebook_sub column if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'members'
          AND COLUMN_NAME  = 'facebook_sub'
    ) THEN
        ALTER TABLE members
            ADD COLUMN facebook_sub VARCHAR(255) NULL
            COMMENT 'Facebook user ID (sub) for Sign in with Facebook'
            AFTER yahoo_sub;
    END IF;

    -- Add unique index if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'members'
          AND INDEX_NAME   = 'uq_members_facebook'
    ) THEN
        ALTER TABLE members ADD UNIQUE KEY uq_members_facebook (facebook_sub);
    END IF;
END //
DELIMITER ;
CALL mmr_v9_migration();
DROP PROCEDURE IF EXISTS mmr_v9_migration;


-- ============================================================
-- 2. Drop otp_codes table
--    OTP email auth is replaced by social login + password auth.
--    The password_reset_tokens table (from v1) is still used for
--    the forgot-password flow.
-- ============================================================
DROP TABLE IF EXISTS otp_codes;


-- ============================================================
-- 3. Record migration
-- ============================================================
INSERT INTO schema_migrations (version, description) VALUES
    ('0009', 'Add facebook_sub to members; drop otp_codes (OTP replaced by NextAuth)')
ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;


-- ============================================================
-- Verify
-- ============================================================
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME   = 'members'
  AND COLUMN_NAME  = 'facebook_sub';

SELECT TABLE_NAME FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('otp_codes', 'otp_tokens');
-- Expected: no rows (both tables gone)


SET FOREIGN_KEY_CHECKS = 1;

-- End of migration v9
