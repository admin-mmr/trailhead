-- MIGRATION_V034: allow anonymous donations — submissions.MemberID nullable
-- Prod smoke test of Stripe donations (PR #8/#9) surfaced that anonymous
-- donations could never be stored: MemberID was NOT NULL and
-- trg_submissions_insert_validate required an existing member (a NULL
-- MemberID also failed its NOT EXISTS check). /donate collects donor
-- name/email for non-members, so NULL MemberID is a legitimate state —
-- payments.MemberID is already nullable for exactly this reason.

ALTER TABLE submissions MODIFY MemberID VARCHAR(10) NULL COMMENT 'submitter MemberID from members table; NULL for anonymous donations';

DROP TRIGGER IF EXISTS trg_submissions_insert_validate;

DELIMITER $$
CREATE TRIGGER trg_submissions_insert_validate
BEFORE INSERT ON submissions
FOR EACH ROW
BEGIN
  DECLARE error_context_id VARCHAR(50);
  DECLARE error_msg TEXT;
  DECLARE error_code VARCHAR(50);

  SET error_context_id = UUID();

  IF NEW.`SubmissionID` IS NULL THEN
    SET error_code = 'SUBM_NULL_ID';
    SET error_msg = CONCAT(
      'Submission ID cannot be NULL. ',
      'Error: ', error_context_id
    );
    INSERT INTO `error_context` (
      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
      `TableName`, `ColumnName`, `ProblematicValue`,
      `ValidValueExamples`, `SuggestedFix`, `Severity`
    ) VALUES (
      error_context_id, error_code,
      'Cannot create submission without unique ID',
      'SubmissionID column received NULL value on INSERT',
      'submissions', 'SubmissionID', 'NULL',
      '["sub_abc123xyz", "sub_2026_001"]',
      'Ensure UUID is generated before INSERT. Check application code.',
      'CRITICAL'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
  END IF;

  -- V034: NULL MemberID is allowed (anonymous donation); validate only when set
  IF NEW.`MemberID` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `members` WHERE `MemberID` = NEW.`MemberID`) THEN
    SET error_code = 'SUBM_FK_INVALID_MEMBER';
    SET error_msg = CONCAT(
      'MemberID "', NEW.`MemberID`, '" does not exist in members table. ',
      'Error: ', error_context_id
    );
    INSERT INTO `error_context` (
      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
      `TableName`, `ColumnName`, `ConstraintName`, `ProblematicValue`,
      `SuggestedFix`, `Severity`
    ) VALUES (
      error_context_id, error_code,
      CONCAT('Invalid MemberID: ', NEW.`MemberID`),
      'Foreign key validation failed: referenced member does not exist',
      'submissions', 'MemberID', 'fk_submissions_members',
      NEW.`MemberID`,
      'Verify MemberID exists in members table before creating submission',
      'ERROR'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
  END IF;

  IF NEW.`Status` NOT IN ('pending','approved','cancelled','expired') THEN
    SET error_code = 'SUBM_INVALID_STATUS';
    SET error_msg = CONCAT(
      'Invalid Status value: "', NEW.`Status`, '". ',
      'Allowed: pending, approved, cancelled, expired. ',
      'Error: ', error_context_id
    );
    INSERT INTO `error_context` (
      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
      `TableName`, `ColumnName`, `ProblematicValue`,
      `AllowedRange`, `ValidValueExamples`, `SuggestedFix`, `Severity`
    ) VALUES (
      error_context_id, error_code,
      CONCAT('Invalid submission status: ', NEW.`Status`),
      'Status enum constraint violated',
      'submissions', 'Status', NEW.`Status`,
      'pending | approved | cancelled | expired',
      '["pending", "approved"]',
      'Use one of the allowed status values. Default is "pending".',
      'ERROR'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
  END IF;

  IF NEW.`Amount` IS NOT NULL AND NEW.`Amount` < 0 THEN
    SET error_code = 'SUBM_NEGATIVE_AMOUNT';
    SET error_msg = CONCAT(
      'Amount cannot be negative: ', NEW.`Amount`, '. ',
      'Error: ', error_context_id
    );
    INSERT INTO `error_context` (
      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
      `TableName`, `ColumnName`, `ProblematicValue`,
      `AllowedRange`, `SuggestedFix`, `Severity`
    ) VALUES (
      error_context_id, error_code,
      'Submission amount is negative',
      'Amount validation failed: received negative value',
      'submissions', 'Amount', CAST(NEW.`Amount` AS CHAR),
      '>= 0',
      'Ensure amount is positive. Use absolute value or check calculation logic.',
      'WARNING'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
  END IF;
END$$
DELIMITER ;

INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V034', 'submissions.MemberID nullable + NULL-tolerant insert trigger (anonymous donations)', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
