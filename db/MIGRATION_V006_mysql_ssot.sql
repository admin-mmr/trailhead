-- MIGRATION_V006: MySQL as Source of Truth (SSOT)
-- Minimal, clean version - no complex conditionals
-- Migrate webapp_events → submissions, restructure gmail_transactions

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================================
-- STEP 1: CREATE submissions TABLE (from webapp_events)
-- ============================================================================

CREATE TABLE IF NOT EXISTS `submissions` (
  `CreatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Timestamp when the user hits submit button',
  `SubmissionID` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'auto gen unique identifier',
  `Status` enum('pending','approved','cancelled','expired') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT 'Logic: once submitted=pending; matched payment=approved; past ExpiresAt=expired; user action=cancelled',
  `MemberID` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'submitter MemberID from members table',
  `SubmissionType` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'set at creation time',
  `ExpiresAt` datetime DEFAULT NULL COMMENT 'set at creation time',
  `PaymentIntent` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'set at creation time',
  `Amount` decimal(10,2) DEFAULT NULL COMMENT 'set at creation time',
  `PaymentMethod` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'user input',
  `PayerName` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'user input',
  `PaymentDate` date DEFAULT NULL COMMENT 'user input',
  `MemoField` text COLLATE utf8mb4_unicode_ci COMMENT 'user input',
  `Last4Digits` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'user input',
  `PaymentID` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'added when approved; links to payments table',
  `UpdatedByID` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'ID who updated this record the last time',
  `UpdatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'trigger at update',
  PRIMARY KEY (`SubmissionID`),
  CONSTRAINT `fk_submission_member` FOREIGN KEY (`MemberID`) REFERENCES `members` (`MemberID`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- STEP 1b: MIGRATE DATA FROM webapp_events → submissions (skip duplicates)
-- ============================================================================

INSERT IGNORE INTO `submissions` (CreatedAt, SubmissionID, Status, MemberID, SubmissionType, ExpiresAt, PaymentIntent, Amount, PaymentMethod, PayerName, PaymentDate, MemoField, Last4Digits, PaymentID, UpdatedByID, UpdatedAt)
SELECT we.CreatedAt, we.EventID, CASE WHEN we.Status = 'matched' THEN 'approved' WHEN we.Status IN ('rejected', 'error') THEN 'cancelled' WHEN we.Status = 'expired' THEN 'expired' ELSE 'pending' END, we.MemberID, we.EventType, we.ExpiresAt, we.PaymentIntent, we.Amount, we.PaymentMethod, we.PayerName, we.PaymentDate, we.Notes, we.Last4Digits, NULL, we.AdminApprover, we.UpdatedAt
FROM `webapp_events` we;

-- ============================================================================
-- STEP 2: CREATE admin_member_overrides TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS `admin_member_overrides` (
  `OverrideID` int NOT NULL AUTO_INCREMENT,
  `AdminEmail` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Admin who performed the manual change',
  `TargetMemberID` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ImpactedMemberIDs` text COLLATE utf8mb4_unicode_ci COMMENT 'Family members affected',
  `ActionType` enum('STATUS_CHANGE','EXPIRATION_OVERRIDE','LIFETIME_SET','INACTIVE_SET') NOT NULL,
  `OldValue` varchar(255) DEFAULT NULL,
  `NewValue` varchar(255) DEFAULT NULL,
  `AdminNotes` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `Timestamp` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`OverrideID`),
  CONSTRAINT `fk_override_member` FOREIGN KEY (`TargetMemberID`) REFERENCES `members` (`MemberID`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- STEP 3: ADD TransactionNumber COLUMN to payments (if not exists)
-- ============================================================================

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'payments' AND COLUMN_NAME = 'TransactionNumber');

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `payments` ADD COLUMN `TransactionNumber` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL',
  'SELECT "Column TransactionNumber already exists"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_NAME = 'payments' AND INDEX_NAME = 'idx_pay_tx');

SET @sql_idx = IF(@idx_exists = 0,
  'CREATE INDEX `idx_pay_tx` ON `payments`(`TransactionNumber`)',
  'SELECT "Index idx_pay_tx already exists"'
);

PREPARE stmt_idx FROM @sql_idx;
EXECUTE stmt_idx;
DEALLOCATE PREPARE stmt_idx;

-- ============================================================================
-- STEP 4: RESTRUCTURE gmail_transactions TABLE
-- ============================================================================

-- Only rename if table exists and backup doesn't
SET @table_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'gmail_transactions' AND TABLE_SCHEMA = DATABASE());
SET @backup_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'gmail_transactions_backup' AND TABLE_SCHEMA = DATABASE());

SET @sql = IF(@table_exists > 0 AND @backup_exists = 0,
  'RENAME TABLE `gmail_transactions` TO `gmail_transactions_backup`',
  'SELECT "Skipping RENAME (table already processed or backup exists)"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

DROP TABLE IF EXISTS `gmail_transactions_backup`;

CREATE TABLE IF NOT EXISTS `gmail_transactions` (
  `TransactionNumber` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Timestamp` datetime DEFAULT NULL COMMENT 'From Sheets/GAS',
  `Sender` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Amount` decimal(10,2) DEFAULT NULL COMMENT 'Total original amount',
  `Memo` text COLLATE utf8mb4_unicode_ci,
  `TransactionDate` date DEFAULT NULL,
  `PaymentMethod` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Zelle, Venmo, etc.',
  `MessageId` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `OriginalMemo` text COLLATE utf8mb4_unicode_ci,
  `Notes` text COLLATE utf8mb4_unicode_ci COMMENT 'User friendly split summary',
  `UpdatedAt` datetime DEFAULT NULL COMMENT 'Last linked time',
  PRIMARY KEY (`TransactionNumber`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Only migrate if backup exists (first-time run)
SET @backup_exists_for_migrate = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'gmail_transactions_backup' AND TABLE_SCHEMA = DATABASE());

SET @sql_migrate = IF(@backup_exists_for_migrate > 0,
  'INSERT IGNORE INTO `gmail_transactions` (TransactionNumber, Timestamp, Sender, Amount, Memo, TransactionDate, PaymentMethod, MessageId, OriginalMemo, Notes, UpdatedAt) SELECT TransactionNumber, TimeStamp, Sender, Amount, Memo, TransactionDate, COALESCE(PaymentMethod, NULL), MessageId, OriginalMemo, COALESCE(Notes, NULL), NOW() FROM `gmail_transactions_backup`',
  'SELECT "Backup table does not exist, skipping migrate"'
);

PREPARE stmt_migrate FROM @sql_migrate;
EXECUTE stmt_migrate;
DEALLOCATE PREPARE stmt_migrate;

-- ============================================================================
-- STEP 5: CREATE VIEWS
-- ============================================================================

CREATE VIEW IF NOT EXISTS `v_payment_details` AS
SELECT
    p.PaymentID,
    p.CreatedAt,
    m.MemberID,
    CONCAT(m.FirstName, ' ', m.LastName) AS MemberFullName,
    m.FamilyID,
    p.PaymentType,
    p.Amount,
    p.PaymentDate,
    p.TransactionNumber,
    s.SubmissionType,
    p.ProcessedBy,
    p.Source
FROM payments p
JOIN members m ON p.MemberID = m.MemberID
LEFT JOIN submissions s ON p.SubmissionID = s.SubmissionID;

CREATE VIEW IF NOT EXISTS `v_payment_splits` AS
SELECT
    gt.TransactionNumber,
    gt.Amount AS OriginalTotal,
    (SELECT SUM(p.Amount) FROM payments p WHERE p.TransactionNumber = gt.TransactionNumber) AS TotalAllocated,
    gt.Amount - (SELECT IFNULL(SUM(p.Amount), 0) FROM payments p WHERE p.TransactionNumber = gt.TransactionNumber) AS RemainingBalance
FROM gmail_transactions gt;

CREATE VIEW IF NOT EXISTS `v_gmail_split_audit` AS
SELECT
    gt.TransactionNumber,
    gt.Amount AS Total,
    IFNULL(SUM(p.Amount), 0) AS Allocated,
    (gt.Amount - IFNULL(SUM(p.Amount), 0)) AS Balance,
    gt.Notes AS SplitHistory
FROM gmail_transactions gt
LEFT JOIN payments p ON gt.TransactionNumber = p.TransactionNumber
GROUP BY gt.TransactionNumber;

-- ============================================================================
-- STEP 6: CREATE TRIGGERS
-- ============================================================================

DELIMITER //

CREATE TRIGGER IF NOT EXISTS `trg_payments_sync_membership_only`
AFTER INSERT ON payments
FOR EACH ROW
BEGIN
    DECLARE v_FamilyID VARCHAR(10);

    IF NEW.PaymentType LIKE '%Membership%' THEN
        SELECT FamilyID INTO v_FamilyID FROM members WHERE MemberID = NEW.MemberID;
        SET @internal_proc = 1;
        UPDATE members
        SET
            Status = 'active',
            PaymentDate = NEW.PaymentDate,
            PaymentTransaction = NEW.TransactionNumber,
            MembershipFeePaid = NEW.Amount,
            Expiration = DATE_ADD(NEW.PaymentDate, INTERVAL 1 YEAR)
        WHERE (v_FamilyID IS NOT NULL AND FamilyID = v_FamilyID)
           OR MemberID = NEW.MemberID;
        SET @internal_proc = NULL;
    END IF;
END; //

CREATE TRIGGER IF NOT EXISTS `trg_payments_approve_submission`
AFTER INSERT ON payments
FOR EACH ROW
BEGIN
    IF NEW.SubmissionID IS NOT NULL THEN
        UPDATE submissions
        SET
            Status = 'approved',
            PaymentID = NEW.PaymentID,
            UpdatedByID = NEW.ProcessedBy
        WHERE SubmissionID = NEW.SubmissionID;
    END IF;
END; //

CREATE TRIGGER IF NOT EXISTS `trg_payments_auto_fill`
BEFORE INSERT ON payments
FOR EACH ROW
BEGIN
    IF NEW.TransactionNumber IS NOT NULL THEN
        SELECT PaymentDate, PaymentMethod, Sender, Memo
        INTO @d, @m, @p, @memo
        FROM gmail_transactions
        WHERE TransactionNumber = NEW.TransactionNumber
        LIMIT 1;
        SET NEW.PaymentDate = @d;
        SET NEW.PaymentMethod = @m;
        SET NEW.PayerName = @p;
        SET NEW.MemoField = @memo;
    END IF;
END; //

CREATE TRIGGER IF NOT EXISTS `trg_payments_limit_check_insert`
BEFORE INSERT ON payments
FOR EACH ROW
BEGIN
    DECLARE v_max DECIMAL(10,2);
    DECLARE v_used DECIMAL(10,2);
    SELECT Amount INTO v_max FROM gmail_transactions WHERE TransactionNumber = NEW.TransactionNumber LIMIT 1;
    SELECT IFNULL(SUM(Amount), 0) INTO v_used FROM payments WHERE TransactionNumber = NEW.TransactionNumber;
    IF (v_used + NEW.Amount) > v_max THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Split Error: Total payments exceed Gmail Transaction amount.';
    END IF;
END; //

CREATE TRIGGER IF NOT EXISTS `trg_payments_limit_check_update`
BEFORE UPDATE ON payments
FOR EACH ROW
BEGIN
    DECLARE v_max DECIMAL(10,2);
    DECLARE v_used_by_others DECIMAL(10,2);
    SELECT Amount INTO v_max FROM gmail_transactions WHERE TransactionNumber = NEW.TransactionNumber LIMIT 1;
    SELECT IFNULL(SUM(Amount), 0) INTO v_used_by_others
    FROM payments
    WHERE TransactionNumber = NEW.TransactionNumber AND PaymentID <> OLD.PaymentID;
    IF (v_used_by_others + NEW.Amount) > v_max THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Update Error: New amount exceeds remaining Gmail Transaction balance.';
    END IF;
END; //

CREATE TRIGGER IF NOT EXISTS `members_before_update`
BEFORE UPDATE ON members
FOR EACH ROW
BEGIN
    IF NEW.Expiration <> OLD.Expiration THEN
        IF @internal_proc IS NULL OR @internal_proc <> 1 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Direct update to Expiration column is not allowed. Use the approved Procedure.';
        END IF;
    END IF;
END; //

CREATE TRIGGER IF NOT EXISTS `trg_members_after_insert`
AFTER INSERT ON members FOR EACH ROW
BEGIN
  INSERT INTO member_log (
    LogID, LoggingTime, MemberID, ChangeType, Status, Created, Expiration,
    Email, FirstName, LastName, Type, FamilyID, Gender, WeChatID, District,
    MembershipFeePaid, PaymentDate, PaymentTransaction, JoinYear, PhoneNumber, Notes,
    NYRRRunnerName, YearBorn
  )
  VALUES (
    UUID(), NOW(), NEW.MemberID, 'INSERT', NEW.Status, NEW.Created, NEW.Expiration,
    NEW.Email, NEW.FirstName, NEW.LastName, NEW.Type, NEW.FamilyID, NEW.Gender, NEW.WeChatID, NEW.District,
    NEW.MembershipFeePaid, NEW.PaymentDate, NEW.PaymentTransaction, NEW.JoinYear, NEW.PhoneNumber, NEW.Notes,
    NEW.NYRRRunnerName, NEW.YearBorn
  );
END; //

CREATE TRIGGER IF NOT EXISTS `trg_members_after_update`
AFTER UPDATE ON members FOR EACH ROW
BEGIN
  INSERT INTO member_log (
    LogID, LoggingTime, MemberID, ChangeType, Status, Created, Expiration,
    Email, FirstName, LastName, Type, FamilyID, Gender, WeChatID, District,
    MembershipFeePaid, PaymentDate, PaymentTransaction, JoinYear, PhoneNumber, Notes,
    NYRRRunnerName, YearBorn
  )
  VALUES (
    UUID(), NOW(), NEW.MemberID, 'UPDATE', NEW.Status, NEW.Created, NEW.Expiration,
    NEW.Email, NEW.FirstName, NEW.LastName, NEW.Type, NEW.FamilyID, NEW.Gender, NEW.WeChatID, NEW.District,
    NEW.MembershipFeePaid, NEW.PaymentDate, NEW.PaymentTransaction, NEW.JoinYear, NEW.PhoneNumber, NEW.Notes,
    NEW.NYRRRunnerName, NEW.YearBorn
  );
END; //

DELIMITER ;

-- ============================================================================
-- STEP 7: CREATE PROCEDURES
-- ============================================================================

DELIMITER //

CREATE PROCEDURE IF NOT EXISTS `sp_admin_update_member_status`(
    IN p_AdminEmail VARCHAR(255),
    IN p_MemberID VARCHAR(10),
    IN p_NewStatus VARCHAR(20),
    IN p_NewExpiration DATE,
    IN p_NewNotes TEXT
)
BEGIN
    DECLARE v_FamilyID VARCHAR(10);
    DECLARE v_OldStatus VARCHAR(20);
    DECLARE v_ImpactedIDs TEXT;
    DECLARE v_CalculatedAction VARCHAR(50);

    SELECT Status, FamilyID INTO v_OldStatus, v_FamilyID FROM members WHERE MemberID = p_MemberID;

    SET v_CalculatedAction = CASE
        WHEN p_NewStatus = 'lifetime' THEN 'LIFETIME_SET'
        WHEN v_OldStatus = 'expired' AND p_NewStatus = 'inactive' THEN 'INACTIVE_SET'
        WHEN p_NewExpiration IS NOT NULL THEN 'EXPIRATION_OVERRIDE'
        ELSE 'STATUS_CHANGE'
    END;

    IF v_FamilyID IS NOT NULL THEN
        SELECT GROUP_CONCAT(MemberID) INTO v_ImpactedIDs FROM members WHERE FamilyID = v_FamilyID;
    ELSE
        SET v_ImpactedIDs = p_MemberID;
    END IF;

    SET @internal_proc = 1;

    UPDATE members
    SET
        Status = IFNULL(p_NewStatus, Status),
        Expiration = IFNULL(p_NewExpiration, Expiration),
        Notes = CONCAT(IFNULL(Notes, ''), '\n--- Admin Override (', p_AdminEmail, ' ', NOW(), ') ---\n', p_NewNotes)
    WHERE (v_FamilyID IS NOT NULL AND FamilyID = v_FamilyID) OR MemberID = p_MemberID;

    SET @internal_proc = NULL;

    INSERT INTO admin_member_overrides (
        AdminEmail, TargetMemberID, ImpactedMemberIDs, ActionType, OldValue, NewValue, AdminNotes
    )
    VALUES (
        p_AdminEmail, p_MemberID, v_ImpactedIDs, v_CalculatedAction, v_OldStatus, IFNULL(p_NewStatus, v_OldStatus), p_NewNotes
    );
END //

CREATE PROCEDURE IF NOT EXISTS `sp_link_transaction`(
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
END //

DELIMITER ;

-- ============================================================================
-- STEP 6: RECORD MIGRATION
-- ============================================================================

INSERT INTO `schema_migrations` (version, description, executed_at)
VALUES ('006', 'MySQL SSOT: submissions (from webapp_events), admin_member_overrides, gmail_transactions restructure, TransactionNumber added to payments, views, triggers, procedures', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();

SET FOREIGN_KEY_CHECKS = 1;
