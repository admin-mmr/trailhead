-- MIGRATION_V011: Fix trg_payments_auto_fill trigger
-- Issue: Trigger references non-existent PaymentDate column in gmail_transactions
-- Correct column name: TransactionDate
-- This is why autoguess was failing with "Unknown column 'PaymentDate'"

DROP TRIGGER IF EXISTS trg_payments_auto_fill;

DELIMITER $$

CREATE TRIGGER `trg_payments_auto_fill` BEFORE INSERT ON `payments` FOR EACH ROW BEGIN
    IF NEW.TransactionNumber IS NOT NULL THEN
        SELECT TransactionDate, PaymentMethod, Sender, Memo
        INTO @d, @m, @p, @memo
        FROM gmail_transactions
        WHERE TransactionNumber = NEW.TransactionNumber
        LIMIT 1;
        SET NEW.PaymentDate = @d;
        SET NEW.PaymentMethod = @m;
        SET NEW.PayerName = @p;
        SET NEW.MemoField = @memo;
    END IF;
END$$

DELIMITER ;

-- Register migration in schema_migrations table
INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V011', 'Fix trg_payments_auto_fill trigger - use TransactionDate not PaymentDate', NOW())
ON DUPLICATE KEY UPDATE executed_at=NOW();
