-- ============================================================
-- MMR Database Migration Script v8
-- Target: mmr-mysql-v4.mysql.database.azure.com / mmrdb
-- Run as: mmradmin
-- Date: 2026-03-22
--
-- HOW TO RUN:
--   mysql-mmr < db/mmr_migration_v8_drop_families.sql
--
-- WHAT THIS DOES:
--   1. Drops the families table (never queried by any code;
--      FK constraint confirmed absent from actual DB)
--   2. Creates view v_family_members to replace it:
--      derives family groups directly from members.FamilyID
--
-- WHY:
--   The families table was a header/lookup table that no code ever
--   JOINs or queries. The FamilyID column on members is sufficient
--   to group family members together. The view makes this explicit.
--
-- SAFE TO RE-RUN: DROP TABLE IF EXISTS + CREATE OR REPLACE VIEW
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- 1. Drop the unused families table
--    (FK constraint was never applied to this DB — confirmed via
--     information_schema query returning empty result)
-- ============================================================
DROP TABLE IF EXISTS families;

-- ============================================================
-- 2. Create view: family groups derived from members.FamilyID
--
--    Usage examples:
--      SELECT * FROM v_family_members WHERE FamilyID = 'F0001';
--      SELECT * FROM v_family_members WHERE primary_member_id = 'A0042';
-- ============================================================
CREATE OR REPLACE VIEW v_family_members AS
SELECT
    m.FamilyID,

    -- Primary member = whichever family member has the lowest MemberID
    -- (approximation; update if you track primary explicitly elsewhere)
    MIN(m.MemberID) OVER (PARTITION BY m.FamilyID) AS primary_member_id,

    m.MemberID      AS member_id,
    m.FirstName,
    m.LastName,
    m.Email,
    m.Status,
    m.Expiration,
    m.Type

FROM members m
WHERE m.FamilyID IS NOT NULL;


-- ============================================================
-- 4. Verify
-- ============================================================
SELECT TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('families', 'v_family_members')
ORDER BY TABLE_NAME;

-- Expected:
--   v_family_members  (VIEW — newly created)
--   families          should NOT appear

SELECT
    TABLE_NAME, TABLE_TYPE
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'v_family_members';

-- Should show: TABLE_TYPE = VIEW

SET FOREIGN_KEY_CHECKS = 1;

-- End of migration v8
