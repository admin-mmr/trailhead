-- ============================================================
-- MMR Database Migration Script v3.0 — Email & Renewal Tracking
-- Run after: mmr_migration_v1.sql, mmr_migration_v2.sql
--
-- HOW TO RUN:
--   mysql -h mmr-mysql.mysql.database.azure.com -u mmradmin -p \
--         --ssl-mode=REQUIRED mmrdb < mmr_migration_v3.sql
--
-- SAFE TO RE-RUN: Uses CREATE TABLE IF NOT EXISTS
-- ============================================================

SET NAMES utf8mb4;

-- ============================================================
-- 1. RENEWAL_REMINDERS
--    Tracks each renewal reminder email sent per member.
--    Used by sendRenewalReminders() to enforce the 3-per-9-month cap.
--    Query pattern: COUNT(*) WHERE member_id = ? AND sent_at > NOW() - 9 months
-- ============================================================
CREATE TABLE IF NOT EXISTS renewal_reminders (
    id          BIGINT      NOT NULL AUTO_INCREMENT,
    member_id   VARCHAR(20) NOT NULL,
    sent_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    INDEX idx_rr_member_sent (member_id, sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Verification
-- ============================================================
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'mmrdb' AND table_name = 'renewal_reminders';
