-- ============================================================
-- MMR Database Migration Script v6
-- Target: mmr-mysql.mysql.database.azure.com / mmrdb
-- Run as: mmradmin
-- Date: 2026-03-22
--
-- HOW TO RUN:
--   mysql-mmr < db/mmr_migration_v6_otp_codes.sql
--
--   or manually:
--   mysql -h mmr-mysql.mysql.database.azure.com -u mmradmin -p \
--         --ssl-mode=REQUIRED mmrdb < db/mmr_migration_v6_otp_codes.sql
--
-- WHAT THIS FIXES:
--   v1 migration created `otp_tokens` but app code (lib/auth/otp.ts)
--   queries `otp_codes`. This mismatch caused "Failed to send code"
--   on the login page. This migration creates the correct table.
--
-- SAFE TO RE-RUN: Uses CREATE TABLE IF NOT EXISTS
-- ============================================================

SET NAMES utf8mb4;

-- ============================================================
-- Create otp_codes (the table name the app actually uses)
-- ============================================================
CREATE TABLE IF NOT EXISTS otp_codes (
    id          BIGINT          NOT NULL AUTO_INCREMENT,
    email       VARCHAR(255)    NOT NULL,
    code        VARCHAR(10)     NOT NULL,
    expires_at  DATETIME        NOT NULL,
    used        BOOLEAN         NOT NULL DEFAULT FALSE,
    created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_otp_email (email),      -- one active code per email (supports ON DUPLICATE KEY UPDATE)
    INDEX idx_otp_expires_at (expires_at) -- fast cleanup of expired codes
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- Verify
-- ============================================================
SELECT
    TABLE_NAME,
    ENGINE,
    TABLE_COLLATION,
    TABLE_ROWS
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('otp_codes', 'otp_tokens')
ORDER BY TABLE_NAME;

-- Expected output:
--   otp_codes   | InnoDB | utf8mb4_unicode_ci | 0
--   otp_tokens  | InnoDB | utf8mb4_unicode_ci | 0   (from v1 — unused, harmless)

-- End of migration v6
