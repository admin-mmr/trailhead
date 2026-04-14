-- MIGRATION V018: Update sp_delink_member_payment
-- Purpose: Extend V017 proc to also:
--   1. DELETE the bad payments record (if one exists for member+tx)
--   2. Recompute gmail_transactions.Notes after deletion (no DELETE trigger exists on payments)
--   3. Improve dry_run preview to show payments record + current Notes
--
-- Usage:
--   CALL sp_delink_member_payment('A0305', 1);  -- dry run (preview, no changes)
--   CALL sp_delink_member_payment('A0305', 0);  -- execute (fixes members + payments + Notes)

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
    DECLARE v_payment_id        VARCHAR(100) DEFAULT NULL;
    DECLARE v_recomputed_notes  TEXT DEFAULT NULL;

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

    -- 5. Check whether a payments record exists for this member+transaction
    SELECT PaymentID INTO v_payment_id
    FROM payments
    WHERE MemberID = p_member_id
      AND TransactionNumber = v_current_tx
    LIMIT 1;

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
            v_payment_id                            AS payments_record_to_delete,
            (SELECT Notes FROM gmail_transactions WHERE TransactionNumber = v_current_tx LIMIT 1)
                                                    AS current_gmail_Notes,
            IF(v_payment_id IS NOT NULL,
                'payments record will be deleted + Notes recomputed',
                'no payments record found for this member+tx'
            )                                       AS payments_action,
            IF(v_prev_pay_tx IS NULL,
                'NOTE: no prior log entry — payment fields will be cleared to NULL',
                'DRY RUN — no changes made'
            )                                       AS note;

    -- =========================================================
    -- EXECUTE
    -- =========================================================
    ELSE
        START TRANSACTION;

        -- A. Restore members fields to pre-mismatch state
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

        -- B. Delete the bad payments record if one exists for this member+tx.
        --    No DELETE trigger on payments updates gmail_transactions.Notes,
        --    so we recompute it manually below.
        IF v_payment_id IS NOT NULL THEN
            DELETE FROM payments
            WHERE PaymentID = v_payment_id;
        END IF;

        -- C. Recompute gmail_transactions.Notes based on remaining payments for this tx.
        --    Uses the same GROUP_CONCAT logic as trg_payments_sync_to_gmail_on_change_after_payment_insert.
        SELECT GROUP_CONCAT(
                   CONCAT('(', MemberID, ', ', IFNULL(PaymentType, 'N/A'), ', ', Amount, ')')
                   SEPARATOR '; '
               )
        INTO v_recomputed_notes
        FROM payments
        WHERE TransactionNumber = v_current_tx;

        UPDATE gmail_transactions
        SET
            Notes     = v_recomputed_notes,
            UpdatedAt = NOW()
        WHERE TransactionNumber = v_current_tx;

        -- D. Audit log
        INSERT INTO activity_log (LogID, Timestamp, MemberID, Action, State, ErrorSeverity)
        VALUES (
            UUID(), NOW(), p_member_id,
            'PAYMENT_DELINKED',
            LEFT(CONCAT('tx=', v_current_tx, IF(v_payment_id IS NOT NULL, ' +del', '')), 50),
            'INFO'
        );

        COMMIT;

        SELECT
            CONCAT('Member ', p_member_id, ' delinked from tx ', v_current_tx) AS result,
            IF(v_payment_id IS NOT NULL, 'deleted', 'none found')               AS payments_record,
            v_recomputed_notes                                                   AS new_gmail_Notes;

    END IF;

END$$

DELIMITER ;

-- Self-register migration
INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V018', 'sp_delink_member_payment: also delete payments record + recompute gmail Notes', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
