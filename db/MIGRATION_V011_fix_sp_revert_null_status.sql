-- ============================================================
-- MIGRATION V011: Fix revert-override NULL-Status bug
-- ============================================================
-- Consolidates V009 (FamilyID empty-string guard) + V010 (revert override SP)
-- + V011 fix: skip NULL-Status member_log rows written by Sheets sync.
--
-- Root cause: member_log rows from Sheets sync have Status = NULL.
-- COALESCE(NULL, Status) returns current (wrong) value → revert silently does nothing.
-- Fix: AND Status IS NOT NULL in the member_log SELECT inside the cursor loop.
-- ============================================================

-- ============================================================
-- Part 1: Fix sp_admin_update_member_status (FamilyID empty-string guard)
-- ============================================================

DROP PROCEDURE IF EXISTS sp_admin_update_member_status;

DELIMITER $$

CREATE PROCEDURE sp_admin_update_member_status(
    IN p_MemberID       VARCHAR(10),
    IN p_AdminEmail     VARCHAR(255),
    IN p_NewStatus      VARCHAR(50),
    IN p_NewExpiration  DATE,
    IN p_NewNotes       TEXT
)
BEGIN
    DECLARE v_OldStatus     VARCHAR(50);
    DECLARE v_OldExpiration DATE;
    DECLARE v_OldNotes      TEXT;
    DECLARE v_FamilyID      VARCHAR(20);

    -- Snapshot current state
    SELECT Status, Expiration, Notes, FamilyID
    INTO v_OldStatus, v_OldExpiration, v_OldNotes, v_FamilyID
    FROM members
    WHERE MemberID = p_MemberID;

    -- Update the target member and family members (if applicable)
    -- CRITICAL FIX: guard against empty-string FamilyID (would cascade to ALL members)
    IF v_FamilyID IS NOT NULL AND v_FamilyID != '' THEN
        UPDATE members
        SET Status  = p_NewStatus,
            Notes   = CONCAT(IFNULL(Notes, ''), '\n', p_NewNotes),
            UpdatedAt = NOW()
        WHERE (v_FamilyID IS NOT NULL AND v_FamilyID != '' AND FamilyID = v_FamilyID)
           OR MemberID = p_MemberID;
    ELSE
        UPDATE members
        SET Status  = p_NewStatus,
            Notes   = CONCAT(IFNULL(Notes, ''), '\n', p_NewNotes),
            UpdatedAt = NOW()
        WHERE MemberID = p_MemberID;
    END IF;

    -- Log to member_log
    INSERT INTO member_log (MemberID, ChangeType, Status, Expiration, LoggingTime)
    VALUES (p_MemberID, 'ADMIN_OVERRIDE', p_NewStatus, p_NewExpiration, NOW());

    -- Audit trail: record impacted member IDs
    SET @impacted_ids = p_MemberID;
    IF v_FamilyID IS NOT NULL AND v_FamilyID != '' THEN
        SELECT GROUP_CONCAT(MemberID ORDER BY MemberID SEPARATOR ',')
        INTO @impacted_ids
        FROM members
        WHERE FamilyID = v_FamilyID;
    END IF;

    INSERT INTO admin_member_overrides
        (AdminEmail, TargetMemberID, ImpactedMemberIDs, ActionType,
         OldValue, NewValue, AdminNotes, Timestamp)
    VALUES
        (p_AdminEmail, p_MemberID, @impacted_ids, 'OVERRIDE',
         v_OldStatus, p_NewStatus, p_NewNotes, NOW());

END$$

DELIMITER ;

-- ============================================================
-- Part 2: Revert override procedure (NULL-Status fix inside cursor loop)
-- ============================================================

DROP PROCEDURE IF EXISTS sp_revert_admin_override;

DELIMITER $$

CREATE PROCEDURE sp_revert_admin_override(
    IN p_OverrideID INT
)
BEGIN
    DECLARE v_Done              TINYINT DEFAULT 0;
    DECLARE v_MemberID          VARCHAR(10);
    DECLARE v_PreStatus         VARCHAR(50);
    DECLARE v_PreExpiration     DATE;
    DECLARE v_OverrideTS        DATETIME;
    DECLARE v_ImpactedIDs       TEXT;
    DECLARE v_RevertedCount     INT DEFAULT 0;

    DECLARE cur CURSOR FOR
        SELECT MemberID FROM members WHERE MemberID IN (
            SELECT TRIM(j.MemberID)
            FROM (SELECT ImpactedMemberIDs FROM admin_member_overrides WHERE OverrideID = p_OverrideID) t
            JOIN JSON_TABLE(
                CONCAT('["', REPLACE(t.ImpactedMemberIDs, ',', '","'), '"]'),
                '$[*]' COLUMNS (MemberID VARCHAR(10) PATH '$')
            ) j
        );

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_Done = 1;

    -- Look up override metadata
    SELECT Timestamp, ImpactedMemberIDs
    INTO v_OverrideTS, v_ImpactedIDs
    FROM admin_member_overrides
    WHERE OverrideID = p_OverrideID;

    IF v_OverrideTS IS NULL THEN
        SELECT
            NULL  AS reverted_override_id,
            0     AS members_restored,
            NULL  AS impacted_member_ids,
            NULL  AS original_override_time;
        LEAVE sp_revert_admin_override;
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
        LEAVE sp_revert_admin_override;
    END IF;

    -- Cursor-based restore: one member at a time
    OPEN cur;

    read_loop: LOOP
        FETCH cur INTO v_MemberID;
        IF v_Done THEN LEAVE read_loop; END IF;

        -- KEY FIX: skip NULL-Status rows (written by Sheets sync)
        -- Without AND Status IS NOT NULL, COALESCE(NULL, current_status) returns
        -- the current wrong value and the UPDATE silently does nothing.
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

    -- Audit: record this revert (idempotency key = 'override_<ID>')
    INSERT INTO admin_member_overrides
        (AdminEmail, TargetMemberID, ImpactedMemberIDs, ActionType,
         OldValue, NewValue, AdminNotes, Timestamp)
    VALUES
        ('system', 'REVERT', v_ImpactedIDs, 'REVERT',
         CONCAT('override_', p_OverrideID), 'pre_override_snapshot',
         CONCAT('Reverted override #', p_OverrideID), NOW());

    SELECT
        p_OverrideID    AS reverted_override_id,
        v_RevertedCount AS members_restored,
        v_ImpactedIDs   AS impacted_member_ids,
        v_OverrideTS    AS original_override_time;

END$$

DELIMITER ;

-- ============================================================
-- Self-registration (idempotent)
-- ============================================================

INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V011', 'Fix sp_revert_admin_override: skip NULL-Status member_log rows from Sheets sync', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
