-- MIGRATION_V023: Fix sp_clear_transaction infinite loop in member_loop
--
-- Bug: DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1
--      The second cursor loop (member_loop) exits on `done2`, but the NOT FOUND
--      handler only sets `done`. When tmp_tx_members is empty (transaction has no
--      membership payments), the first FETCH in member_loop fires NOT FOUND,
--      sets done=1, but done2 stays 0 — the loop never exits (infinite loop /
--      300s timeout).
--
-- Fix: extend the handler to set both done and done2.

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_clear_transaction`$$

CREATE PROCEDURE `sp_clear_transaction`(
    IN  p_tx_number   VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
    IN  p_dry_run     TINYINT(1),
    IN  p_cleared_by  VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
)
BEGIN
    DECLARE done         INT DEFAULT 0;
    DECLARE v_payment_id VARCHAR(50)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    DECLARE v_member_id  VARCHAR(10)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    DECLARE v_pay_type   VARCHAR(50)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    DECLARE v_sub_id     VARCHAR(50)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    DECLARE v_family_id  VARCHAR(10)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    DECLARE v_prev_status    VARCHAR(50)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    DECLARE v_prev_pay_tx    VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    DECLARE v_prev_expiration DATE;
    DECLARE v_prev_fee_paid   DECIMAL(10,2);
    DECLARE v_prev_pay_date   DATE;
    DECLARE v_pay_created_at  DATETIME;
    DECLARE done2 INT DEFAULT 0;

    -- Cursor 1: payments → submission revert
    DECLARE cur_payments CURSOR FOR
        SELECT PaymentID, MemberID, PaymentType, SubmissionID, CreatedAt
        FROM payments
        WHERE TransactionNumber = p_tx_number;

    -- Cursor 2: membership members snapshot (populated into temp table before any deletes)
    DECLARE cur_members CURSOR FOR
        SELECT member_id, min_created_at FROM tmp_tx_members;

    -- Fix V023: handler sets BOTH done and done2 so member_loop exits correctly
    -- when tmp_tx_members is empty (no membership payments for the transaction).
    DECLARE CONTINUE HANDLER FOR NOT FOUND BEGIN SET done = 1; SET done2 = 1; END;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        IF p_dry_run = 0 THEN ROLLBACK; END IF;
        DROP TEMPORARY TABLE IF EXISTS tmp_tx_members;
        RESIGNAL;
    END;

    -- Validate
    IF NOT EXISTS (SELECT 1 FROM gmail_transactions WHERE TransactionNumber = p_tx_number) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'TransactionNumber not found in gmail_transactions.';
    END IF;

    -- =========================================================================
    -- DRY RUN — preview only, no writes
    -- =========================================================================
    IF p_dry_run = 1 THEN

        SELECT
            'gmail_transactions' AS target_table,
            p_tx_number          AS TransactionNumber,
            Notes                AS current_Notes,
            'NULL'               AS new_Notes,
            UpdatedAt            AS current_UpdatedAt,
            'NULL'               AS new_UpdatedAt
        FROM gmail_transactions
        WHERE TransactionNumber = p_tx_number;

        SELECT
            'payments' AS target_table,
            PaymentID, MemberID, PaymentType, Amount, SubmissionID,
            'DELETE'   AS action
        FROM payments
        WHERE TransactionNumber = p_tx_number;

        SELECT
            'submissions'    AS target_table,
            s.SubmissionID,
            s.Status         AS current_status,
            'pending'        AS new_status,
            s.PaymentID      AS current_PaymentID,
            'NULL'           AS new_PaymentID
        FROM submissions s
        INNER JOIN payments p ON s.SubmissionID = p.SubmissionID
        WHERE p.TransactionNumber = p_tx_number;

        SELECT
            'members'              AS target_table,
            p.MemberID,
            m.Status               AS current_status,
            ml.Status              AS restore_status,
            m.Expiration           AS current_expiration,
            ml.Expiration          AS restore_expiration,
            m.MembershipFeePaid    AS current_fee_paid,
            ml.MembershipFeePaid   AS restore_fee_paid,
            m.PaymentDate          AS current_pay_date,
            ml.PaymentDate         AS restore_pay_date,
            m.PaymentTransaction   AS current_pay_tx,
            ml.PaymentTransaction  AS restore_pay_tx
        FROM payments p
        INNER JOIN members m ON p.MemberID = m.MemberID
        LEFT JOIN member_log ml ON ml.MemberID = p.MemberID
            AND ml.LoggingTime = (
                SELECT MAX(LoggingTime) FROM member_log
                WHERE MemberID = p.MemberID
                  AND LoggingTime < p.CreatedAt
            )
        WHERE p.TransactionNumber = p_tx_number
          AND LOWER(p.PaymentType) LIKE '%membership%';

    -- =========================================================================
    -- EXECUTE
    -- =========================================================================
    ELSE
        START TRANSACTION;

        -- Step 0: Snapshot affected membership members BEFORE any deletes
        DROP TEMPORARY TABLE IF EXISTS tmp_tx_members;
        CREATE TEMPORARY TABLE tmp_tx_members AS
            SELECT MemberID AS member_id, MIN(CreatedAt) AS min_created_at
            FROM payments
            WHERE TransactionNumber = p_tx_number
              AND LOWER(PaymentType) LIKE '%membership%'
            GROUP BY MemberID;

        -- Step 1: Revert linked submissions → pending
        OPEN cur_payments;
        sub_loop: LOOP
            FETCH cur_payments INTO v_payment_id, v_member_id, v_pay_type, v_sub_id, v_pay_created_at;
            IF done THEN LEAVE sub_loop; END IF;
            IF v_sub_id IS NOT NULL THEN
                UPDATE submissions
                SET Status = 'pending', PaymentID = NULL
                WHERE SubmissionID = v_sub_id;
            END IF;
        END LOOP;
        CLOSE cur_payments;

        -- Step 2: Delete all payments for this transaction
        DELETE FROM payments WHERE TransactionNumber = p_tx_number;

        -- Step 3: Clear gmail_transactions payment-link columns
        UPDATE gmail_transactions
        SET Notes = NULL, UpdatedAt = NULL
        WHERE TransactionNumber = p_tx_number;

        -- Step 4: Revert members independently (runs even if no submissions/payments remain)
        SET done2 = 0;
        OPEN cur_members;
        member_loop: LOOP
            FETCH cur_members INTO v_member_id, v_pay_created_at;
            IF done2 THEN LEAVE member_loop; END IF;

            SELECT FamilyID INTO v_family_id
            FROM members WHERE MemberID = v_member_id LIMIT 1;

            SELECT Status, Expiration, MembershipFeePaid, PaymentDate, PaymentTransaction
            INTO v_prev_status, v_prev_expiration, v_prev_fee_paid, v_prev_pay_date, v_prev_pay_tx
            FROM member_log
            WHERE MemberID = v_member_id
              AND LoggingTime < v_pay_created_at
            ORDER BY LoggingTime DESC
            LIMIT 1;

            SET v_prev_status = CASE
                WHEN v_prev_status IN ('active','expired','inactive','pending','pending_upgrade','lifetime')
                THEN v_prev_status
                ELSE 'inactive'
            END;

            SET @internal_proc = 1;
            UPDATE members
            SET
                Status             = v_prev_status,
                Expiration         = v_prev_expiration,
                MembershipFeePaid  = v_prev_fee_paid,
                PaymentDate        = v_prev_pay_date,
                PaymentTransaction = v_prev_pay_tx,
                UpdatedAt          = NOW()
            WHERE MemberID = v_member_id
               OR (v_family_id IS NOT NULL AND v_family_id <> ''
                   AND FamilyID = v_family_id);
            SET @internal_proc = NULL;

        END LOOP;
        CLOSE cur_members;

        DROP TEMPORARY TABLE IF EXISTS tmp_tx_members;

        -- Step 5: Audit log
        INSERT INTO activity_log (LogID, Timestamp, Action, State, ErrorSeverity)
        VALUES (UUID(), NOW(), 'TRANSACTION_CLEARED', p_tx_number, 'INFO');

        COMMIT;

        SELECT CONCAT('Transaction ', p_tx_number, ' cleared successfully.') AS result;

    END IF;

END$$

DELIMITER ;

INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V023', 'Fix sp_clear_transaction infinite loop when no membership payments (done2 never set)', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
