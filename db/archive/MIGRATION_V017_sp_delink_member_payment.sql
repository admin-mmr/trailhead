-- MIGRATION V017: Add sp_delink_member_payment
-- Purpose: Fix members whose PaymentTransaction/MembershipFeePaid/PaymentDate were
--          stamped with a transaction that legitimately belongs to a different member.
--          Restores member fields from member_log BEFORE the bad stamp, without
--          touching payments, submissions, or gmail_transactions.
-- Usage:
--   CALL sp_delink_member_payment('A0622', 1);  -- dry run (preview only)
--   CALL sp_delink_member_payment('A0622', 0);  -- execute

DROP PROCEDURE IF EXISTS sp_delink_member_payment;

DELIMITER $$

CREATE PROCEDURE sp_delink_member_payment(
    IN p_member_id  VARCHAR(10),
    IN p_dry_run    TINYINT   -- 1 = preview only, 0 = execute
)
BEGIN
    DECLARE v_current_tx        VARCHAR(100);
    DECLARE v_tx_first_set_at   DATETIME;
    DECLARE v_prev_status       VARCHAR(50);
    DECLARE v_prev_expiration   DATE;
    DECLARE v_prev_fee_paid     DECIMAL(10,2);
    DECLARE v_prev_pay_date     DATE;
    DECLARE v_prev_pay_tx       VARCHAR(100);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        IF p_dry_run = 0 THEN ROLLBACK; END IF;
        RESIGNAL;
    END;

    -- 1. Validate member exists and has a PaymentTransaction set
    SELECT PaymentTransaction
    INTO v_current_tx
    FROM members
    WHERE MemberID = p_member_id
    LIMIT 1;

    IF v_current_tx IS NULL OR v_current_tx = '' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Member has no PaymentTransaction to delink.';
    END IF;

    -- 2. Find when PaymentTransaction was first set to the current value in member_log
    SELECT MIN(LoggingTime)
    INTO v_tx_first_set_at
    FROM member_log
    WHERE MemberID = p_member_id
      AND PaymentTransaction = v_current_tx;

    IF v_tx_first_set_at IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'No member_log entry found where PaymentTransaction matches current value. Cannot safely determine restore point.';
    END IF;

    -- 3. Get the member_log snapshot just BEFORE the bad stamp
    --    If no prior entry exists (member was new when stamped), all v_prev_* stay NULL —
    --    payment fields will be cleared to NULL, status falls back to 'inactive'.
    SELECT Status, Expiration, MembershipFeePaid, PaymentDate, PaymentTransaction
    INTO v_prev_status, v_prev_expiration, v_prev_fee_paid, v_prev_pay_date, v_prev_pay_tx
    FROM member_log
    WHERE MemberID = p_member_id
      AND LoggingTime < v_tx_first_set_at
    ORDER BY LoggingTime DESC
    LIMIT 1;

    -- 4. Validate restored Status against members ENUM; fall back to 'inactive' if invalid/null
    SET v_prev_status = CASE
        WHEN v_prev_status IN ('active','expired','inactive','pending','pending_upgrade','lifetime')
        THEN v_prev_status
        ELSE 'inactive'
    END;

    -- =========================================================
    -- DRY RUN — preview only
    -- =========================================================
    IF p_dry_run = 1 THEN

        SELECT
            p_member_id                             AS MemberID,
            v_current_tx                            AS current_PaymentTransaction,
            v_tx_first_set_at                       AS bad_stamp_first_logged_at,
            (SELECT Status      FROM members WHERE MemberID = p_member_id) AS current_Status,
            v_prev_status                           AS restore_Status,
            (SELECT Expiration  FROM members WHERE MemberID = p_member_id) AS current_Expiration,
            v_prev_expiration                       AS restore_Expiration,
            (SELECT MembershipFeePaid FROM members WHERE MemberID = p_member_id) AS current_FeePaid,
            v_prev_fee_paid                         AS restore_FeePaid,
            (SELECT PaymentDate FROM members WHERE MemberID = p_member_id) AS current_PaymentDate,
            v_prev_pay_date                         AS restore_PaymentDate,
            v_prev_pay_tx                           AS restore_PaymentTransaction,
            IF(v_prev_pay_tx IS NULL, 'NOTE: no prior log entry — payment fields will be cleared to NULL', 'DRY RUN — no changes made') AS note;

    -- =========================================================
    -- EXECUTE
    -- =========================================================
    ELSE
        START TRANSACTION;

        SET @internal_proc = 1;
        UPDATE members
        SET
            Status             = v_prev_status,
            Expiration         = v_prev_expiration,
            MembershipFeePaid  = v_prev_fee_paid,
            PaymentDate        = v_prev_pay_date,
            PaymentTransaction = v_prev_pay_tx,
            UpdatedAt          = NOW()
        WHERE MemberID = p_member_id;
        SET @internal_proc = NULL;

        INSERT INTO activity_log (LogID, Timestamp, MemberID, Action, State, ErrorSeverity)
        VALUES (
            UUID(), NOW(), p_member_id,
            'PAYMENT_DELINKED',
            CONCAT('tx=', v_current_tx, ' restored_from=', v_tx_first_set_at),
            'INFO'
        );

        COMMIT;

        SELECT CONCAT('Member ', p_member_id, ' successfully delinked from transaction ', v_current_tx) AS result;

    END IF;

END$$

DELIMITER ;

-- Self-register migration
INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V017', 'Add sp_delink_member_payment procedure', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
