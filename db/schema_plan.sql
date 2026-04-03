CREATE TABLE `submissions` (CREATE TABLE `submissions` (
  `CreatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP 
    COMMENT 'Timestamptime the user hits submit button',
  
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

