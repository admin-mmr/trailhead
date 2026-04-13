-- ============================================================
-- MIGRATION V013: Fix FK violation in sp_revert_admin_override audit INSERT
-- ============================================================
-- V012 inserted TargetMemberID = 'REVERT' into admin_member_overrides,
-- which violates fk_override_member (TargetMemberID must reference members.MemberID).
-- Fix: read TargetMemberID from the original override row and reuse it.
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

    -- FIND_IN_SET: collation-neutral, no derived-column mismatch
    DECLARE cur CURSOR FOR
        SELECT MemberID FROM members
        WHERE FIND_IN_SET(MemberID, (
            SELECT ImpactedMemberIDs
            FROM admin_member_overrides
            WHERE OverrideID = p_OverrideID
        )) > 0;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_Done = 1;

    -- Look up override metadata (including original TargetMemberID for audit FK)
    SELECT Timestamp, ImpactedMemberIDs, TargetMemberID
    INTO v_OverrideTS, v_ImpactedIDs, v_OriginalTarget
    FROM admin_member_overrides
    WHERE OverrideID = p_OverrideID;

    IF v_OverrideTS IS NULL THEN
        SELECT
            NULL  AS reverted_override_id,
            0     AS members_restored,
            NULL  AS impacted_member_ids,
            NULL  AS original_override_time;
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
            v_OverrideTS            AS original_override_time;
        LEAVE proc_body;
    END IF;

    -- Cursor-based restore: one member at a time
    OPEN cur;

    read_loop: LOOP
        FETCH cur INTO v_MemberID;
        IF v_Done THEN LEAVE read_loop; END IF;

        -- Skip NULL-Status rows written by Sheets sync.
        -- Without this filter, COALESCE(NULL, current_status) returns the
        -- current wrong value and the UPDATE silently does nothing.
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

    -- Audit record: reuse original TargetMemberID so FK constraint is satisfied.
    -- OldValue = 'override_<ID>' is the idempotency key checked above.
    INSERT INTO admin_member_overrides
        (AdminEmail, TargetMemberID, ImpactedMemberIDs, ActionType,
         OldValue, NewValue, AdminNotes, Timestamp)
    VALUES
        ('system', v_OriginalTarget, v_ImpactedIDs, 'REVERT',
         CONCAT('override_', p_OverrideID), 'pre_override_snapshot',
         CONCAT('Reverted override #', p_OverrideID), NOW());

    SELECT
        p_OverrideID    AS reverted_override_id,
        v_RevertedCount AS members_restored,
        v_ImpactedIDs   AS impacted_member_ids,
        v_OverrideTS    AS original_override_time;

END$$

DELIMITER ;

-- Self-registration
INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V013', 'Fix FK violation in sp_revert_admin_override audit INSERT: use original TargetMemberID', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
