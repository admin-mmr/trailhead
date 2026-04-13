-- ============================================================
-- MIGRATION V015: Fix sp_revert_admin_override audit INSERT + Sheets sync note
-- ============================================================
-- Root cause of 0 REVERT records:
--   The audit INSERT at the end of the SP aborts the procedure before the
--   SELECT result is returned. Members are updated (auto-committed) but the
--   SP exits with an error, no audit record is created, and idempotency never
--   activates. Each new call re-runs the revert → Sheets sync overwrites again.
--
-- Fix: capture any SQL exception from the audit INSERT into v_AuditError.
--   The SELECT always runs and now includes audit_error so the caller can see
--   what (if anything) went wrong with the audit INSERT.
--
-- Workflow note (not a code bug):
--   After running the revert, export members to Google Sheets immediately
--   so the corrected status replaces the stale inactive data in Sheets.
--   Without this, the next Sheets import sync will overwrite the revert.
-- ============================================================

DROP PROCEDURE IF EXISTS sp_revert_admin_override;

DELIMITER $$

CREATE PROCEDURE sp_revert_admin_override(
    IN p_OverrideID INT
)
proc_body: BEGIN
    DECLARE v_Done              TINYINT DEFAULT 0;
    DECLARE v_MemberID          VARCHAR(10);
    DECLARE v_PreStatus         VARCHAR(50);
    DECLARE v_PreExpiration     DATE;
    DECLARE v_OverrideTS        DATETIME;
    DECLARE v_ImpactedIDs       TEXT;
    DECLARE v_OriginalTarget    VARCHAR(10);
    DECLARE v_RevertedCount     INT DEFAULT 0;
    DECLARE v_AuditError        TEXT DEFAULT NULL;

    -- FIND_IN_SET: collation-neutral, no derived-column mismatch (V012)
    DECLARE cur CURSOR FOR
        SELECT MemberID FROM members
        WHERE FIND_IN_SET(MemberID, (
            SELECT ImpactedMemberIDs
            FROM admin_member_overrides
            WHERE OverrideID = p_OverrideID
        )) > 0;

    -- Catch audit INSERT failures without aborting the SP.
    -- Members are already updated at this point; we don't want to lose
    -- the SELECT result just because the audit record has a constraint issue.
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN
        GET DIAGNOSTICS CONDITION 1 v_AuditError = MESSAGE_TEXT;
    END;

    -- NOT FOUND handler must be declared after SQLEXCEPTION handler.
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_Done = 1;

    -- Look up override metadata (TargetMemberID reused in audit INSERT for FK, V013)
    SELECT Timestamp, ImpactedMemberIDs, TargetMemberID
    INTO v_OverrideTS, v_ImpactedIDs, v_OriginalTarget
    FROM admin_member_overrides
    WHERE OverrideID = p_OverrideID;

    IF v_OverrideTS IS NULL THEN
        SELECT
            NULL  AS reverted_override_id,
            0     AS members_restored,
            NULL  AS impacted_member_ids,
            NULL  AS original_override_time,
            NULL  AS audit_error;
        LEAVE proc_body;
    END IF;

    -- Idempotency guard: skip if already reverted
    IF EXISTS (
        SELECT 1 FROM admin_member_overrides
        WHERE ActionType = 'REVERT'
          AND OldValue = CONCAT('override_', p_OverrideID)
    ) THEN
        SELECT
            p_OverrideID            AS reverted_override_id,
            0                       AS members_restored,
            v_ImpactedIDs           AS impacted_member_ids,
            v_OverrideTS            AS original_override_time,
            'already_reverted'      AS audit_error;
        LEAVE proc_body;
    END IF;

    -- Allow Expiration updates inside this procedure (V014).
    -- The members_before_update trigger checks @internal_proc = 1.
    SET @internal_proc = 1;

    -- Cursor-based restore: one member at a time
    OPEN cur;

    read_loop: LOOP
        FETCH cur INTO v_MemberID;
        IF v_Done THEN LEAVE read_loop; END IF;

        -- Skip NULL-Status rows written by Sheets sync (V011).
        SELECT Status, Expiration INTO v_PreStatus, v_PreExpiration
        FROM member_log
        WHERE MemberID = v_MemberID
          AND LoggingTime < v_OverrideTS
          AND Status IS NOT NULL
        ORDER BY LoggingTime DESC LIMIT 1;

        IF v_PreStatus IS NOT NULL THEN
            UPDATE members
            SET Status     = v_PreStatus,
                Expiration = v_PreExpiration,
                UpdatedAt  = NOW()
            WHERE MemberID = v_MemberID;

            SET v_RevertedCount = v_RevertedCount + 1;
        END IF;

        -- Reset for next iteration
        SET v_PreStatus = NULL;
        SET v_PreExpiration = NULL;
        SET v_Done = 0;
    END LOOP;

    CLOSE cur;

    -- Restore trigger guard
    SET @internal_proc = NULL;

    -- Audit record: reuse original TargetMemberID so fk_override_member is satisfied.
    -- SQLEXCEPTION handler above captures any failure into v_AuditError without aborting.
    INSERT INTO admin_member_overrides
        (AdminEmail, TargetMemberID, ImpactedMemberIDs, ActionType,
         OldValue, NewValue, AdminNotes, Timestamp)
    VALUES
        ('system', v_OriginalTarget, v_ImpactedIDs, 'REVERT',
         CONCAT('override_', p_OverrideID), 'pre_override_snapshot',
         CONCAT('Reverted override #', p_OverrideID), NOW());

    -- Always return a result, even if audit INSERT failed.
    -- audit_error = NULL means success; non-NULL means the audit record was
    -- not written (but members were updated — check and export to Sheets).
    SELECT
        p_OverrideID    AS reverted_override_id,
        v_RevertedCount AS members_restored,
        v_ImpactedIDs   AS impacted_member_ids,
        v_OverrideTS    AS original_override_time,
        v_AuditError    AS audit_error;

END$$

DELIMITER ;

-- Self-registration
INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V015', 'Fix sp_revert_admin_override: SQLEXCEPTION handler prevents audit INSERT from aborting SP', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
