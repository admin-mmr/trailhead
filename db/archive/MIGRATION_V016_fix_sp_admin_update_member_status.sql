-- MIGRATION_V016_fix_sp_admin_update_member_status.sql
-- Fixes sp_admin_update_member_status so that p_NewExpiration is actually applied
-- to the members table (previously it was only written to member_log but never
-- applied to the live row, leaving Expiration stale after mark-active / mark-inactive).
--
-- Changes:
--   1. Wrap UPDATE with SET @internal_proc = 1 / NULL so Expiration can be changed.
--   2. Add Expiration = CASE ... to both UPDATE branches (individual + family cascade).
--      - p_NewExpiration IS NOT NULL → use the supplied value
--      - p_NewStatus = 'lifetime'    → auto-set sentinel date (replaces old trigger path)
--      - otherwise                   → keep existing Expiration unchanged
--   3. Make ActionType dynamic ('MARK_ACTIVE' vs 'INACTIVE_SET' vs 'LIFETIME_SET')
--      instead of the previous hardcoded 'INACTIVE_SET' for every call.

DROP PROCEDURE IF EXISTS sp_admin_update_member_status;

DELIMITER $$

CREATE PROCEDURE sp_admin_update_member_status(
    IN p_MemberID    VARCHAR(10),
    IN p_AdminEmail  VARCHAR(255),
    IN p_NewStatus   VARCHAR(50),
    IN p_NewExpiration DATE,
    IN p_NewNotes    TEXT
)
BEGIN
    DECLARE v_OldStatus     VARCHAR(50);
    DECLARE v_OldExpiration DATE;
    DECLARE v_OldNotes      TEXT;
    DECLARE v_FamilyID      VARCHAR(20);
    DECLARE v_ActionType    VARCHAR(50);

    -- If the audit INSERT into admin_member_overrides fails (FK, constraint, etc.),
    -- continue so the members table changes are not rolled back and the SP still
    -- returns normally (idempotency preserved; Sheets sync cannot overwrite changes).
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN END;

    -- Snapshot current state
    SELECT Status, Expiration, Notes, FamilyID
    INTO v_OldStatus, v_OldExpiration, v_OldNotes, v_FamilyID
    FROM members
    WHERE MemberID = p_MemberID;

    -- Dynamic ActionType for audit trail
    SET v_ActionType = CASE p_NewStatus
        WHEN 'active'   THEN 'MARK_ACTIVE'
        WHEN 'lifetime' THEN 'LIFETIME_SET'
        ELSE                 'INACTIVE_SET'
    END;

    -- Allow Expiration changes (members_before_update trigger guard)
    SET @internal_proc = 1;

    IF v_FamilyID IS NOT NULL AND v_FamilyID != '' THEN
        UPDATE members
        SET Status     = p_NewStatus,
            Expiration = CASE
                WHEN p_NewExpiration IS NOT NULL THEN p_NewExpiration
                WHEN p_NewStatus = 'lifetime'    THEN '2126-03-31'
                ELSE Expiration
            END,
            Notes      = CONCAT(IFNULL(Notes, ''), '\n', p_NewNotes),
            UpdatedAt  = NOW()
        WHERE FamilyID = v_FamilyID
           OR MemberID = p_MemberID;
    ELSE
        UPDATE members
        SET Status     = p_NewStatus,
            Expiration = CASE
                WHEN p_NewExpiration IS NOT NULL THEN p_NewExpiration
                WHEN p_NewStatus = 'lifetime'    THEN '2126-03-31'
                ELSE Expiration
            END,
            Notes      = CONCAT(IFNULL(Notes, ''), '\n', p_NewNotes),
            UpdatedAt  = NOW()
        WHERE MemberID = p_MemberID;
    END IF;

    SET @internal_proc = NULL;

    -- Log to member_log (ChangeType reflects the actual action)
    INSERT INTO member_log (LogID, MemberID, ChangeType, Status, Expiration, LoggingTime)
    VALUES (UUID(), p_MemberID, v_ActionType, p_NewStatus, p_NewExpiration, NOW());

    -- Build impacted member ID list for audit
    SET @impacted_ids = p_MemberID;
    IF v_FamilyID IS NOT NULL AND v_FamilyID != '' THEN
        SELECT GROUP_CONCAT(MemberID ORDER BY MemberID SEPARATOR ',')
        INTO @impacted_ids
        FROM members
        WHERE FamilyID = v_FamilyID;
    END IF;

    -- Audit trail
    INSERT INTO admin_member_overrides
        (AdminEmail, TargetMemberID, ImpactedMemberIDs, ActionType,
         OldValue, NewValue, AdminNotes, Timestamp)
    VALUES
        (p_AdminEmail, p_MemberID, @impacted_ids,
         v_ActionType, v_OldStatus, p_NewStatus, p_NewNotes, NOW());

END$$

DELIMITER ;

INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V016', 'fix_sp_admin_update_member_status: apply p_NewExpiration to members table, dynamic ActionType', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
