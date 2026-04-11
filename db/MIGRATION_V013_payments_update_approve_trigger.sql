-- MIGRATION V013: Add AFTER UPDATE trigger on payments to approve linked submissions
--
-- Problem: trg_payments_approve_submission only fires on INSERT.
-- When an orphaned payment (SubmissionID = NULL/empty) is patched via UPDATE
-- to add a SubmissionID, no trigger fires and the submission stays 'pending'.
--
-- Fix: Add trg_payments_update_approve_submission that fires AFTER UPDATE,
-- syncing the submission to 'approved' whenever SubmissionID transitions
-- from blank to a real value.

DROP TRIGGER IF EXISTS trg_payments_update_approve_submission;

DELIMITER $$

CREATE TRIGGER trg_payments_update_approve_submission
AFTER UPDATE ON payments
FOR EACH ROW
BEGIN
    -- Only fire when SubmissionID transitions from blank/null → a real value
    IF (NEW.SubmissionID IS NOT NULL AND NEW.SubmissionID != '')
       AND (OLD.SubmissionID IS NULL OR OLD.SubmissionID = '')
    THEN
        UPDATE submissions
        SET
            Status      = 'approved',
            PaymentID   = NEW.PaymentID,
            UpdatedByID = NEW.ProcessedBy
        WHERE SubmissionID = NEW.SubmissionID
          AND Status = 'pending';
    END IF;
END$$

DELIMITER ;

INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V013', 'Add AFTER UPDATE trigger on payments to approve linked submissions', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
