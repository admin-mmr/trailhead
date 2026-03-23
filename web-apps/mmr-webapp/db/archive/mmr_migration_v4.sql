-- ============================================================
-- MMR Database Migration Script v4.0 — Schema alignment with canonical header
-- Canonical header (March 2026):
--   MemberID,Status,Created,Expiration,Email,First Name,Last Name,Type,
--   FamilyID,Gender,WeChatID,District,WebApp,Payment Check,Info,Last Updated,
--   Membership Fee Paid,Payment Date,Payment Transaction,JoinYear,PhoneNumber,
--   LastLoginDate,Notes,NYRRRunnerName,YearBorn
--
-- Changes vs previous schema:
--   1. DROP   NYRRMemberID  — removed from Google Sheets and no longer tracked
--   2. RENAME NYRRMemberName → NYRRRunnerName (member-set name for NYRR lookup)
--   3. ADD    YearBorn SMALLINT  — used to disambiguate NYRR bib lookups
--              Logic: Age = EventYear - YearBorn  (or Age-1 for races early in year)
--
-- HOW TO RUN:
--   mysql -h mmr-mysql.mysql.database.azure.com -u mmradmin -p \
--         --ssl-mode=REQUIRED mmrdb < mmr_migration_v4.sql
--
-- SAFE TO RE-RUN: uses IF EXISTS / IF NOT EXISTS guards where possible
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;


-- ============================================================
-- 1. DROP NYRRMemberID
--    No longer in Google Sheets canonical header.
--    Removed from members.ts and Member type.
-- ============================================================
ALTER TABLE members
    DROP COLUMN IF EXISTS NYRRMemberID;

-- Also drop snake_case variant if webapp schema was used locally
ALTER TABLE members
    DROP COLUMN IF EXISTS nyrr_id;


-- ============================================================
-- 2. RENAME NYRRMemberName → NYRRRunnerName
--    Member-provided name as it appears on NYRR.
--    Used to look up bib numbers in NYRR race results.
--    If multiple runners share the same name, YearBorn is used to pick the right one.
-- ============================================================

-- PascalCase (migration v1 / production schema)
ALTER TABLE members
    RENAME COLUMN NYRRMemberName TO NYRRRunnerName;

-- NOTE: If your local DB uses snake_case instead, run this instead of the above:
-- ALTER TABLE members RENAME COLUMN nyrr_member_name TO nyrr_runner_name;


-- ============================================================
-- 3. ADD YearBorn SMALLINT
--    Birth year (e.g. 1990). Used to disambiguate NYRR results:
--      Age at race  =  EventYear - YearBorn
--      (or Age - 1  for races before the member's birthday that year)
-- ============================================================
ALTER TABLE members
    ADD COLUMN IF NOT EXISTS YearBorn SMALLINT NULL
    COMMENT 'Birth year (YYYY). Used for NYRR bib disambig: Age = EventYear - YearBorn'
    AFTER Notes;

-- NOTE: If your local DB uses snake_case instead:
-- ALTER TABLE members ADD COLUMN IF NOT EXISTS year_born SMALLINT NULL AFTER notes;


-- ============================================================
-- Record migration
-- ============================================================
INSERT INTO schema_migrations (version, description) VALUES
('0004', 'Drop NYRRMemberID, rename NYRRMemberName→NYRRRunnerName, add YearBorn')
ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;


SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- Verification
-- ============================================================
-- SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
-- FROM information_schema.COLUMNS
-- WHERE TABLE_SCHEMA = 'mmrdb'
--   AND TABLE_NAME = 'members'
--   AND COLUMN_NAME IN ('NYRRMemberID', 'nyrr_id',
--                       'NYRRRunnerName', 'nyrr_runner_name',
--                       'YearBorn', 'year_born');
--
-- Expected: NYRRMemberID and nyrr_id absent; NYRRRunnerName (or nyrr_runner_name) present; YearBorn (or year_born) present.
