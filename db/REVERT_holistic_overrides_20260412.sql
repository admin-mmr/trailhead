-- ============================================================
-- HOLISTIC REVERT: Override chain 3→4→8→9→10→13→21
-- Restores 500+ members to state before override #3
-- Anchor: 2026-04-12 01:05:12 (earliest corruption)
--
-- Root cause: ImpactedMemberIDs bug captured ALL members instead
-- of just the target + family for overrides 3,4,8,9,10,13.
-- Override 21 (revert of #13) was incomplete — restored members
-- to post-override-10 state (active/2027), not true pre-incident state.
--
-- Legitimate overrides preserved (excluded from revert):
--   Override 11: A0611, A0615  ("unused due to dup")
--   Override 12: A0347, A0393  ("confirmed not to renew")
--
-- A0022 is included in the revert (will redo that override manually later).
-- ============================================================

-- Steps 1 & 2 (preview/sanity checks) already verified — skipped for final run.


-- ============================================================
-- STEP 3: EXECUTE REVERT
-- Only run after reviewing Steps 1 + 2 output.
--
-- Uses a temp table to pre-load restore targets BEFORE the UPDATE.
-- This avoids ERROR 1442: the members_before_update trigger writes
-- to member_log, which MySQL forbids if member_log is still being
-- read by the triggering statement's JOIN. Temp table breaks that cycle.
-- ============================================================
START TRANSACTION;

-- 3a. Pre-load restore targets into temp table (reads member_log, no trigger)
CREATE TEMPORARY TABLE IF NOT EXISTS _restore_targets AS
SELECT ml.MemberID, ml.Status, ml.Expiration
FROM member_log ml
WHERE ml.LoggingTime < '2026-04-12 01:05:12'
  AND ml.Status IS NOT NULL
  AND (ml.MemberID, ml.LoggingTime) IN (
      SELECT MemberID, MAX(LoggingTime)
      FROM member_log
      WHERE LoggingTime < '2026-04-12 01:05:12'
        AND Status IS NOT NULL
      GROUP BY MemberID
  );

-- 3b. Update members from temp table — member_log no longer in scope,
--     so trigger can write to it freely.
SET @internal_proc = 1;

UPDATE members m
JOIN _restore_targets rt ON rt.MemberID = m.MemberID
SET
    m.Status     = rt.Status,
    m.Expiration = rt.Expiration,
    m.UpdatedAt  = NOW()
WHERE FIND_IN_SET(m.MemberID, (
        SELECT ImpactedMemberIDs FROM admin_member_overrides WHERE OverrideID = 3
    )) > 0
  AND m.MemberID NOT IN ('A0611', 'A0615', 'A0347', 'A0393');

SELECT ROW_COUNT() AS rows_reverted;

SET @internal_proc = NULL;

-- Audit record
INSERT INTO admin_member_overrides
    (AdminEmail, TargetMemberID, ImpactedMemberIDs, ActionType,
     OldValue, NewValue, AdminNotes, Timestamp)
SELECT
    'admin@mmrunners.org',
    TargetMemberID,
    ImpactedMemberIDs,
    'REVERT',
    'override_3,4,8,9,10,13,21',
    'pre_override_snapshot_2026-04-12',
    'Holistic revert: overrides 3/4/8/9/10/13/21 — anchor 2026-04-12 01:05:12. Excluded: A0611,A0615,A0347,A0393 (legit overrides 11/12). All others including A0022 restored to pre-Apr-12 state.',
    NOW()
FROM admin_member_overrides WHERE OverrideID = 3;

-- Confirm rows before committing
SELECT OverrideID, ActionType, OldValue, AdminNotes, Timestamp
FROM admin_member_overrides
ORDER BY OverrideID DESC LIMIT 1;

COMMIT;
DROP TEMPORARY TABLE IF EXISTS _restore_targets;
