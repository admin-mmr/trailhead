-- MIGRATION_V010: Fix sp_link_transaction procedure
-- Issue: Old version of procedure references non-existent PaymentDate column
-- Fix: Replace with correct version that only uses existing columns
-- Status: Safe to re-run (DROP PROCEDURE IF EXISTS)

DROP PROCEDURE IF EXISTS sp_link_transaction;

DELIMITER $$

CREATE PROCEDURE `sp_link_transaction`(
    IN p_TxNum VARCHAR(100),
    IN p_MemID VARCHAR(10),
    IN p_Type VARCHAR(50),
    IN p_Amt DECIMAL(10,2),
    IN p_Admin VARCHAR(255),
    IN p_SubID VARCHAR(50)
)
BEGIN
    INSERT INTO payments (PaymentID, MemberID, TransactionNumber, Amount, SubmissionID, PaymentType, ProcessedBy)
    VALUES (UUID(), p_MemID, p_TxNum, p_Amt, p_SubID, p_Type, p_Admin);

    UPDATE gmail_transactions
    SET
        UpdatedAt = NOW(),
        Notes = CONCAT(IFNULL(Notes, ''), '\n[', NOW(), '] Linked: ', p_MemID, ' (', p_Type, ') $', p_Amt)
    WHERE TransactionNumber = p_TxNum;
END$$

DELIMITER ;

-- Register migration in schema_migrations table
INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V010', 'Fix sp_link_transaction procedure - remove PaymentDate reference', NOW())
ON DUPLICATE KEY UPDATE executed_at=NOW();
