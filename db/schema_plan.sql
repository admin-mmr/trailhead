CREATE TABLE `submissions` (
  `CreatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP 
    COMMENT 'Timestamp when the user hits submit button',
  
  `SubmissionID` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL 
    COMMENT 'auto gen unique identifier',
  
  `Status` enum('pending','approved','cancelled','expired') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' 
    COMMENT 'Logic: once submitted=pending; matched payment=approved; past ExpiresAt=expired; user action=cancelled',
  
  `MemberID` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL 
    COMMENT 'submitter MemberID from members table',
  
  `SubmissionType` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL 
    COMMENT 'set at creation time',
  
  `ExpiresAt` datetime DEFAULT NULL 
    COMMENT 'set at creation time',
    
  `PaymentIntent` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL 
    COMMENT 'set at creation time',
    
  `Amount` decimal(10,2) DEFAULT NULL 
    COMMENT 'set at creation time',
  
  `PaymentMethod` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL 
    COMMENT 'user input',
    
  `PayerName` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL 
    COMMENT 'user input',
    
  `PaymentDate` date DEFAULT NULL 
    COMMENT 'user input',
    
  `MemoField` text COLLATE utf8mb4_unicode_ci 
    COMMENT 'user input',
    
  `Last4Digits` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL 
    COMMENT 'user input',
  
  `PaymentID` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL 
    COMMENT 'added when approved; links to payments table',
  
  `UpdatedByID` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL 
    COMMENT 'ID who updated this record the last time',
  
  `UpdatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP 
    COMMENT 'trigger at update',

  PRIMARY KEY (`SubmissionID`),
  CONSTRAINT `fk_submission_member` FOREIGN KEY (`MemberID`) REFERENCES `members` (`MemberID`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER //

CREATE TRIGGER members_before_update
BEFORE UPDATE ON members
FOR EACH ROW
BEGIN
    -- Check if the 'Expiration' is being changed
    IF NEW.Expiration <> OLD.Expiration THEN
        -- If our special session variable @internal_proc is NOT set, block the update
        IF @internal_proc IS NULL OR @internal_proc <> 1 THEN
            SIGNAL SQLSTATE '45000' 
            SET MESSAGE_TEXT = 'Direct update to Expiration column is not allowed. Use the approved Procedure.';
        END IF;
    END IF;
END;

DELIMITER //

CREATE TABLE `members` (
  `MemberID` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL 
    COMMENT 'Use special MemberID creation rule (e.g., M-001)',
    
  `Status` enum('pending','active','inactive','expired','lifetime') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' 
    COMMENT 'Workflow: pending -> active (on payment) or expired (if no payment by ExpiresAt). Manual: lifetime/inactive.',
    
  `Created` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP 
    COMMENT 'External input at creation; immutable on update',
    
  `Expiration` date DEFAULT NULL 
    COMMENT 'Restricted: Only updated via payment trigger or admin procedure',
    
  `Email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'User input',
  `FirstName` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'User input',
  `LastName` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'User input',
  `Type` enum('Individual','Family') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Individual' COMMENT 'User input',
  
  `FamilyID` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL 
    COMMENT 'Use special FamilyID creation rule. Ties multiple MemberIDs together.',
    
  `Gender` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'User input',
  `WeChatID` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'User input',
  `District` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'User input',
  
  `Notes` text COLLATE utf8mb4_unicode_ci 
    COMMENT 'Admin comments. Required for manual status/expiration changes.',
    
  `MembershipFeePaid` decimal(10,2) DEFAULT NULL COMMENT 'Set by payment trigger',
  `PaymentDate` date DEFAULT NULL COMMENT 'Set by payment trigger',
  `PaymentTransaction` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Set by payment trigger',
  
  `JoinYear` smallint DEFAULT NULL COMMENT 'User input',
  `PhoneNumber` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'User input',
  `NYRRRunnerName` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'User or system confirmed',
  `YearBorn` smallint DEFAULT NULL COMMENT 'User or system confirmed',
  `YearBornGuess` smallint DEFAULT NULL COMMENT 'System-inferred birth year from NYRR age data',
  
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `google_sub` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `microsoft_sub` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  
  `UpdatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Auto update trigger',
  
  PRIMARY KEY (`MemberID`),
  UNIQUE KEY `uq_members_email` (`Email`),
  KEY `idx_family` (`FamilyID`),
  KEY `idx_status` (`Status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER //

CREATE PROCEDURE sp_admin_update_member_status(
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

    -- START UNLOCK BLOCK
    SET @internal_proc = 1; 

    UPDATE members 
    SET 
        Status = IFNULL(p_NewStatus, Status),
        Expiration = IFNULL(p_NewExpiration, Expiration),
        Notes = CONCAT(IFNULL(Notes, ''), '\n--- Admin Override (', p_AdminEmail, ' ', NOW(), ') ---\n', p_NewNotes)
    WHERE (v_FamilyID IS NOT NULL AND FamilyID = v_FamilyID) OR MemberID = p_MemberID;

    SET @internal_proc = NULL; 
    -- END UNLOCK BLOCK

    INSERT INTO admin_member_overrides (
        AdminEmail, TargetMemberID, ImpactedMemberIDs, ActionType, OldValue, NewValue, AdminNotes
    )
    VALUES (
        p_AdminEmail, p_MemberID, v_ImpactedIDs, v_CalculatedAction, v_OldStatus, IFNULL(p_NewStatus, v_OldStatus), p_NewNotes
    );
END //

DELIMITER ;
DELIMITER //

CREATE TABLE `admin_member_overrides` (
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

DELIMITER //

CREATE TRIGGER trg_payments_sync_membership_only
AFTER INSERT ON payments
FOR EACH ROW
BEGIN
    DECLARE v_FamilyID VARCHAR(10);
    
    -- Only run this for Membership types
    IF NEW.PaymentType LIKE '%Membership%' THEN
        
        -- Fetch the payer's FamilyID to support split/family updates
        SELECT FamilyID INTO v_FamilyID FROM members WHERE MemberID = NEW.MemberID;

        -- Unlock the Expiration column for this session
        SET @internal_proc = 1;

        UPDATE members
        SET 
            Status = 'active',
            PaymentDate = NEW.PaymentDate,
            PaymentTransaction = NEW.TransactionNumber,
            MembershipFeePaid = NEW.Amount,
            -- Expiration is 1 year from the Gmail Transaction date
            Expiration = DATE_ADD(NEW.PaymentDate, INTERVAL 1 YEAR)
        WHERE (v_FamilyID IS NOT NULL AND FamilyID = v_FamilyID) 
           OR MemberID = NEW.MemberID;

        SET @internal_proc = NULL;
    END IF;
END; //
DELIMITER ;

CREATE TRIGGER trg_payments_approve_submission
AFTER INSERT ON payments
FOR EACH ROW
BEGIN
    -- If this payment was generated from a web submission, approve it
    IF NEW.SubmissionID IS NOT NULL THEN
        UPDATE submissions 
        SET 
            Status = 'approved', 
            PaymentID = NEW.PaymentID,
            UpdatedByID = NEW.ProcessedBy
        WHERE SubmissionID = NEW.SubmissionID;
    END IF;
END; //

DELIMITER //

CREATE TABLE `member_log` (
  `LogID` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `LoggingTime` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `MemberID` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ChangeType` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'INSERT, UPDATE, or DELETE',
  `Status` enum('active','expired','inactive','pending','lifetime') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Created` datetime DEFAULT NULL,
  `Expiration` date DEFAULT NULL,
  `Email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `FirstName` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `LastName` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `FamilyID` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Gender` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `WeChatID` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `District` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Info` text COLLATE utf8mb4_unicode_ci,
  `LastUpdated` datetime DEFAULT NULL,
  `MembershipFeePaid` decimal(10,2) DEFAULT NULL,
  `PaymentDate` date DEFAULT NULL,
  `PaymentTransaction` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `JoinYear` smallint DEFAULT NULL,
  `PhoneNumber` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Notes` text COLLATE utf8mb4_unicode_ci COMMENT 'Captures the combined history including Admin Overrides',
  `NYRRRunnerName` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `YearBorn` smallint DEFAULT NULL,
  PRIMARY KEY (`LogID`),
  KEY `idx_log_memberid` (`MemberID`),
  KEY `idx_log_time` (`LoggingTime`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER //

CREATE TRIGGER `trg_members_after_update` AFTER UPDATE ON `members` FOR EACH ROW 
BEGIN
  INSERT INTO member_log (
    LogID, LoggingTime, MemberID, ChangeType, Status, Expiration, Notes -- and all other fields
  )
  VALUES (
    UUID(), NOW(), NEW.MemberID, 'UPDATE', NEW.Status, NEW.Expiration, NEW.Notes
  );
END; //

DELIMITER ;

CREATE TABLE `payments` (
  `CreatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP 
    COMMENT 'Timestamp when the payment record was created',
    
  `PaymentID` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL 
    COMMENT 'Auto-generated unique ID',
    
  `MemberID` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL 
    COMMENT 'The member receiving credit for this payment',
    
  `TransactionNumber` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL 
    COMMENT 'Linked to gmail_transactions.TransactionNumber',
    
  `Amount` decimal(10,2) DEFAULT NULL COMMENT 'set at creation time',

  `SubmissionID` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL 
    COMMENT 'Optional: Link to the user submission that started this',
    
  `PaymentType` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL 
    COMMENT 'Set at creation (e.g., Membership, Donation)',
    
  `ProcessedBy` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT 'system' 
    COMMENT 'System or Admin email',
    
  `Source` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL 
    COMMENT 'Process identifier name (e.g., GmailParser_v1)',

  -- The "Gmail Data" columns (Stored here for historical permanence)
  `PaymentDate` date DEFAULT NULL COMMENT 'Captured from Gmail Transactions',
  `PaymentMethod` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Captured from Gmail Transactions',
  `PayerName` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Captured from Gmail Transactions',
  `MemoField` text COLLATE utf8mb4_unicode_ci COMMENT 'Captured from Gmail Transactions',

  PRIMARY KEY (`PaymentID`),
  KEY `idx_pay_member` (`MemberID`),
  KEY `idx_pay_tx` (`TransactionNumber`),
  CONSTRAINT `fk_pay_member` FOREIGN KEY (`MemberID`) REFERENCES `members` (`MemberID`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE VIEW v_payment_details AS
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

CREATE TRIGGER trg_payments_auto_fill
BEFORE INSERT ON payments
FOR EACH ROW
BEGIN
    IF NEW.TransactionNumber IS NOT NULL THEN
        -- Matches exactly 4 columns to 4 variables
        SELECT PaymentDate, PaymentMethod, PayerName, MemoField 
        INTO @d, @m, @p, @memo
        FROM gmail_transactions 
        WHERE TransactionNumber = NEW.TransactionNumber
        LIMIT 1;

        SET NEW.PaymentDate = @d;
        SET NEW.PaymentMethod = @m;
        SET NEW.PayerName = @p;
        SET NEW.MemoField = @memo;
    END IF;
END;
//

CREATE VIEW v_payment_splits AS
SELECT 
    gt.TransactionNumber,
    gt.Amount AS OriginalTotal,
    (SELECT SUM(p.Amount) FROM payments p WHERE p.TransactionNumber = gt.TransactionNumber) AS TotalAllocated,
    gt.Amount - (SELECT IFNULL(SUM(p.Amount), 0) FROM payments p WHERE p.TransactionNumber = gt.TransactionNumber) AS RemainingBalance
FROM gmail_transactions gt;

DELIMITER //

CREATE TRIGGER trg_payments_validate_amount
BEFORE INSERT ON payments
FOR EACH ROW
BEGIN
    DECLARE v_total_available DECIMAL(10,2);
    DECLARE v_already_used    DECIMAL(10,2);

    -- 1. Get the total original amount from the source transaction
    SELECT Amount INTO v_total_available 
    FROM gmail_transactions 
    WHERE TransactionNumber = NEW.TransactionNumber
    LIMIT 1;

    -- 2. Get the sum of all payments already attributed to this TransactionNumber
    SELECT IFNULL(SUM(Amount), 0) INTO v_already_used 
    FROM payments 
    WHERE TransactionNumber = NEW.TransactionNumber;

    -- 3. Validation Logic
    IF (v_already_used + NEW.Amount) > v_total_available THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Payment exceeds available balance of the Gmail Transaction. Split not allowed.';
    END IF;
END;
//

DELIMITER ;

-- VERSION FOR NEW PAYMENTS
CREATE TRIGGER trg_payments_limit_check_insert
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

-- VERSION FOR UPDATING EXISTING PAYMENTS
CREATE TRIGGER trg_payments_limit_check_update
BEFORE UPDATE ON payments
FOR EACH ROW
BEGIN
    DECLARE v_max DECIMAL(10,2);
    DECLARE v_used_by_others DECIMAL(10,2);

    -- Get max allowed
    SELECT Amount INTO v_max FROM gmail_transactions WHERE TransactionNumber = NEW.TransactionNumber LIMIT 1;
    
    -- Sum all OTHER rows for this transaction (excluding the one we are currently editing)
    SELECT IFNULL(SUM(Amount), 0) INTO v_used_by_others 
    FROM payments 
    WHERE TransactionNumber = NEW.TransactionNumber AND PaymentID <> OLD.PaymentID;

    IF (v_used_by_others + NEW.Amount) > v_max THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Update Error: New amount exceeds remaining Gmail Transaction balance.';
    END IF;
END; //

-- AFTER INSERT: Capture the initial state
CREATE TRIGGER trg_members_after_insert 
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

-- AFTER UPDATE: Capture every change
CREATE TRIGGER trg_members_after_update 
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

CREATE TABLE `gmail_transactions` (
  `TransactionNumber` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Timestamp` datetime DEFAULT NULL COMMENT 'From Sheets/GAS',
  `Sender` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Amount` decimal(10,2) DEFAULT NULL COMMENT 'Total original amount',
  `Memo` text COLLATE utf8mb4_unicode_ci,
  `TransactionDate` date DEFAULT NULL,
  `PaymentMethod` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Zelle, Venmo, etc.',
  `MessageId` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `OriginalMemo` text COLLATE utf8mb4_unicode_ci,
  `Notes` text COLLATE utf8mb4_unicode_ci COMMENT 'User friendly split summary: <MemberID> <Type> <Amt>',
  `UpdatedAt` datetime DEFAULT NULL COMMENT 'Last linked time',
  PRIMARY KEY (`TransactionNumber`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER //

-- BLOCK DIRECT EXPIRATION UPDATES
CREATE TRIGGER members_before_update
BEFORE UPDATE ON members
FOR EACH ROW
BEGIN
    IF NEW.Expiration <> OLD.Expiration THEN
        IF @internal_proc IS NULL OR @internal_proc <> 1 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Direct update to Expiration blocked. Use Stored Procedure.';
        END IF;
    END IF;
END; //

-- AUTO-FILL PAYMENT DETAILS FROM GMAIL
CREATE TRIGGER trg_payments_auto_fill
BEFORE INSERT ON payments
FOR EACH ROW
BEGIN
    SELECT TransactionDate, PaymentMethod, Sender, Memo 
    INTO @d, @m, @p, @memo
    FROM gmail_transactions WHERE TransactionNumber = NEW.TransactionNumber LIMIT 1;
    
    SET NEW.PaymentDate = @d, NEW.PaymentMethod = @m, NEW.PayerName = @p, NEW.MemoField = @memo;
END; //

-- PREVENT OVER-SPENDING GMAIL BALANCES (SPLIT CHECK)
CREATE TRIGGER trg_payments_limit_check_insert
BEFORE INSERT ON payments
FOR EACH ROW
BEGIN
    DECLARE v_max DECIMAL(10,2);
    DECLARE v_used DECIMAL(10,2);
    SELECT Amount INTO v_max FROM gmail_transactions WHERE TransactionNumber = NEW.TransactionNumber;
    SELECT IFNULL(SUM(Amount), 0) INTO v_used FROM payments WHERE TransactionNumber = NEW.TransactionNumber;
    IF (v_used + NEW.Amount) > v_max THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Total split exceeds Gmail Transaction amount.';
    END IF;
END; //

-- SYNC MEMBERSHIP STATUS & APPROVE SUBMISSIONS
CREATE TRIGGER trg_payments_post_process
AFTER INSERT ON payments
FOR EACH ROW
BEGIN
    -- 1. Update Member if it is a Membership payment
    IF NEW.PaymentType LIKE '%Membership%' THEN
        SET @internal_proc = 1;
        UPDATE members SET 
            Status = 'active', 
            Expiration = DATE_ADD(NEW.PaymentDate, INTERVAL 1 YEAR),
            PaymentTransaction = NEW.TransactionNumber,
            MembershipFeePaid = NEW.Amount
        WHERE MemberID = NEW.MemberID OR FamilyID = (SELECT FamilyID FROM (SELECT FamilyID FROM members WHERE MemberID = NEW.MemberID) as t);
        SET @internal_proc = NULL;
    END IF;

    -- 2. Approve Submission
    IF NEW.SubmissionID IS NOT NULL THEN
        UPDATE submissions SET Status = 'approved', PaymentID = NEW.PaymentID WHERE SubmissionID = NEW.SubmissionID;
    END IF;
END; //

DELIMITER ;

DELIMITER //

CREATE PROCEDURE sp_link_transaction(
    IN p_TxNum VARCHAR(100),
    IN p_MemID VARCHAR(10),
    IN p_Type VARCHAR(50),
    IN p_Amt DECIMAL(10,2),
    IN p_Admin VARCHAR(255),
    IN p_SubID VARCHAR(50)
)
BEGIN
    -- 1. Create the split payment
    INSERT INTO payments (PaymentID, MemberID, TransactionNumber, Amount, SubmissionID, PaymentType, ProcessedBy)
    VALUES (UUID(), p_MemID, p_TxNum, p_Amt, p_SubID, p_Type, p_Admin);

    -- 2. Update Gmail Notes with clean text summary
    UPDATE gmail_transactions
    SET 
        UpdatedAt = NOW(),
        Notes = CONCAT(IFNULL(Notes, ''), '\n[', NOW(), '] Linked: ', p_MemID, ' (', p_Type, ') $', p_Amt)
    WHERE TransactionNumber = p_TxNum;
END //

DELIMITER ;

-- View to see remaining split balances
CREATE VIEW v_gmail_split_audit AS
SELECT 
    gt.TransactionNumber,
    gt.Amount AS Total,
    IFNULL(SUM(p.Amount), 0) AS Allocated,
    (gt.Amount - IFNULL(SUM(p.Amount), 0)) AS Balance,
    gt.Notes AS SplitHistory
FROM gmail_transactions gt
LEFT JOIN payments p ON gt.TransactionNumber = p.TransactionNumber
GROUP BY gt.TransactionNumber;

