-- ============================================================
-- REVERT: Unexplained expiration drift — members with no payments
-- Restores Expiration to first member_log entry for any member
-- whose expiration changed but has no payment and no admin override.
--
-- Covers:
--   Individual: Type='Individual', no FamilyID, no payments
--   Family:     All members in families where ZERO members have payments
--
-- Run Step 1 (dry run) first. Verify output, then run Step 2.
-- ============================================================


-- ============================================================
-- STEP 1: PREVIEW — what would be reverted?
-- ============================================================
SELECT
    m.MemberID,
    CONCAT(m.FirstName, ' ', m.LastName) AS member_name,
    m.Type,
    m.FamilyID,
    m.Status,
    first_log.Expiration    AS revert_to_expiration,
    m.Expiration            AS current_expiration,
    first_log.LoggingTime   AS baseline_log_time
FROM members m
INNER JOIN (
    SELECT ml.MemberID, ml.Expiration, ml.LoggingTime
    FROM member_log ml
    WHERE ml.LoggingTime = (
        SELECT MIN(ml2.LoggingTime)
        FROM member_log ml2
        WHERE ml2.MemberID = ml.MemberID
    )
) first_log ON first_log.MemberID = m.MemberID
LEFT JOIN payments p ON p.MemberID = m.MemberID
WHERE p.MemberID IS NULL                          -- no payment record
  AND first_log.Expiration IS NOT NULL
  AND first_log.Expiration <> m.Expiration        -- expiration changed
  AND NOT EXISTS (                                 -- no override to justify it
      SELECT 1 FROM admin_member_overrides ao
      WHERE ao.ActionType != 'REVERT'
        AND (
          ao.TargetMemberID = m.MemberID
          OR FIND_IN_SET(m.MemberID, ao.ImpactedMemberIDs) > 0
        )
  )
  AND (
      -- Individual: no family
      (m.Type = 'Individual' AND (m.FamilyID IS NULL OR m.FamilyID = ''))
      OR
      -- Family group: entire family has no payments
      (m.FamilyID IS NOT NULL AND m.FamilyID <> ''
       AND m.FamilyID NOT IN (
           SELECT DISTINCT m2.FamilyID
           FROM members m2
           INNER JOIN payments p2 ON p2.MemberID = m2.MemberID
           WHERE m2.FamilyID IS NOT NULL AND m2.FamilyID <> ''
       ))
  )
ORDER BY m.FamilyID, m.MemberID;


-- ============================================================
-- STEP 2: EXECUTE REVERT
-- Only run after reviewing Step 1 output.
--
-- Uses temp table to avoid ERROR 1093: MySQL 5.7 cannot reference
-- the target table (members) in a subquery within the same UPDATE.
-- Pre-loading into a temp table breaks the self-reference cycle.
-- ============================================================

-- 2a. Pre-load revert targets (reads members freely, no trigger)
DROP TEMPORARY TABLE IF EXISTS _drift_targets;
CREATE TEMPORARY TABLE _drift_targets AS
SELECT
    m.MemberID,
    first_log.Expiration AS revert_expiration
FROM members m
INNER JOIN (
    SELECT ml.MemberID, ml.Expiration
    FROM member_log ml
    WHERE ml.LoggingTime = (
        SELECT MIN(ml2.LoggingTime)
        FROM member_log ml2
        WHERE ml2.MemberID = ml.MemberID
    )
) first_log ON first_log.MemberID = m.MemberID
LEFT JOIN payments p ON p.MemberID = m.MemberID
WHERE p.MemberID IS NULL
  AND first_log.Expiration IS NOT NULL
  AND first_log.Expiration <> m.Expiration
  AND NOT EXISTS (
      SELECT 1 FROM admin_member_overrides ao
      WHERE ao.ActionType != 'REVERT'
        AND (
          ao.TargetMemberID = m.MemberID
          OR FIND_IN_SET(m.MemberID, ao.ImpactedMemberIDs) > 0
        )
  )
  AND (
      (m.Type = 'Individual' AND (m.FamilyID IS NULL OR m.FamilyID = ''))
      OR
      (m.FamilyID IS NOT NULL AND m.FamilyID <> ''
       AND m.FamilyID NOT IN (
           SELECT DISTINCT fam.FamilyID
           FROM members fam
           INNER JOIN payments fp ON fp.MemberID = fam.MemberID
           WHERE fam.FamilyID IS NOT NULL AND fam.FamilyID <> ''
       ))
  );

-- Sanity check before committing
SELECT MemberID, revert_expiration FROM _drift_targets ORDER BY MemberID;

START TRANSACTION;

SET @internal_proc = 1;

-- 2b. Update from temp table — members no longer in scope, trigger safe
UPDATE members m
INNER JOIN _drift_targets t ON t.MemberID = m.MemberID
SET
    m.Expiration = t.revert_expiration,
    m.UpdatedAt  = NOW();

SELECT ROW_COUNT() AS rows_reverted;

SET @internal_proc = NULL;

-- Audit record — TargetMemberID FK requires a real MemberID; use MIN() from
-- the batch. Full affected list stored in ImpactedMemberIDs via GROUP_CONCAT.
INSERT INTO admin_member_overrides
    (AdminEmail, TargetMemberID, ImpactedMemberIDs, ActionType,
     OldValue, NewValue, AdminNotes, Timestamp)
SELECT
    'admin@mmrunners.org',
    MIN(MemberID),
    GROUP_CONCAT(MemberID ORDER BY MemberID),
    'REVERT',
    'drifted_expiration',
    'first_member_log_expiration',
    'Batch revert: unexplained expiration drift — no payments, no override. Restored to first member_log Expiration.',
    NOW()
FROM _drift_targets;

-- If rows_reverted looks correct: COMMIT
-- If something looks wrong:       ROLLBACK
-- COMMIT;
-- ROLLBACK;
