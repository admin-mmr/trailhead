-- ============================================================
-- REVERT: admin_member_overrides batch 2026-04-13 ~02:10
-- Calls sp_revert_admin_override() for each unreverting override.
-- Run Step 1 to preview, then Step 2 to execute.
-- ============================================================

-- ============================================================
-- STEP 1: PREVIEW — which overrides will be reverted?
-- ============================================================
SELECT
    o.OverrideID,
    o.AdminEmail,
    o.TargetMemberID,
    o.ActionType,
    o.OldValue,
    o.NewValue,
    o.Timestamp,
    o.ImpactedMemberIDs,
    IF(r.OverrideID IS NOT NULL, 'YES', 'NO') AS already_reverted
FROM admin_member_overrides o
LEFT JOIN admin_member_overrides r
    ON r.ActionType = 'REVERT'
    AND r.OldValue = CONCAT('override_', o.OverrideID)
WHERE o.ActionType != 'REVERT'
  AND o.Timestamp BETWEEN '2026-04-13 02:09:00' AND '2026-04-13 02:11:00'
ORDER BY o.OverrideID;


-- ============================================================
-- STEP 2: EXECUTE REVERTS
-- Calls sp_revert_admin_override for each non-reverted override
-- in the bad batch window. The SP is idempotent — safe to re-run.
-- ============================================================

-- Revert each OverrideID found in the window above.
-- Add/remove CALL lines to match the OverrideIDs from Step 1.
-- Format: CALL sp_revert_admin_override(<OverrideID>);

-- ⚠️  Replace the IDs below with the actual OverrideIDs from Step 1:
-- CALL sp_revert_admin_override(14);
-- CALL sp_revert_admin_override(15);
-- ...

-- ============================================================
-- STEP 3: CONFIRM — check each call returned members_restored > 0
-- and audit_error = NULL
-- ============================================================
SELECT
    o.OverrideID,
    o.ActionType,
    o.OldValue,
    o.Timestamp   AS reverted_at,
    o.ImpactedMemberIDs
FROM admin_member_overrides o
WHERE o.ActionType = 'REVERT'
  AND o.Timestamp >= '2026-04-13 02:09:00'
ORDER BY o.OverrideID;
