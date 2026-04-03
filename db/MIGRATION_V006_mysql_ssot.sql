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
-- STEP 1b: MIGRATE DATA FROM webapp_events → submissions
-- ============================================================================

INSERT INTO `submissions` (CreatedAt, SubmissionID, Status, MemberID, SubmissionType, ExpiresAt, PaymentIntent, Amount, PaymentMethod, PayerName, PaymentDate, MemoField, Last4Digits, PaymentID, UpdatedByID, UpdatedAt)
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
-- STEP 3: ADD TransactionNumber COLUMN to payments
-- ============================================================================

ALTER TABLE `payments` ADD COLUMN `TransactionNumber` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL;
CREATE INDEX `idx_pay_tx` ON `payments`(`TransactionNumber`);

-- ============================================================================
-- STEP 4: RESTRUCTURE gmail_transactions TABLE
-- ============================================================================

-- Only rename if table exists (if not, skip restructure)
-- For idempotency, check before renaming
SET @table_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'gmail_transactions' AND TABLE_SCHEMA = DATABASE());

SET @sql = IF(@table_exists > 0,
  'RENAME TABLE `gmail_transactions` TO `gmail_transactions_backup`',
  'SELECT "gmail_transactions does not exist, skipping rename"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

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

INSERT INTO `gmail_transactions` (TransactionNumber, Timestamp, Sender, Amount, Memo, TransactionDate, PaymentMethod, MessageId, OriginalMemo, Notes, UpdatedAt)
SELECT TransactionNumber, TimeStamp, Sender, Amount, Memo, TransactionDate, PaymentMethod, MessageId, OriginalMemo, Notes, SyncedAt FROM `gmail_transactions_backup`;

DROP TABLE `gmail_transactions_backup`;

-- ============================================================================
-- STEP 5: RECORD MIGRATION
-- ============================================================================

INSERT INTO `schema_migrations` (version, description, executed_at)
VALUES ('006', 'MySQL SSOT: submissions (from webapp_events), admin_member_overrides, gmail_transactions restructure, TransactionNumber added to payments', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();

SET FOREIGN_KEY_CHECKS = 1;
