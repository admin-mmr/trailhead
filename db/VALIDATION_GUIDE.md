# Schema Validation & Improvement Guide

## Overview

This guide explains the schema validation tools and improvements created to identify and fix data quality issues in the MMR database.

## Files Created

### 1. `validate_schema.py` — Automated Schema Validator
**Purpose:** Scans the entire database for constraint violations and data quality issues.

**Error Types Detected:**
- ✗ Missing PRIMARY KEYs
- ✗ NULL values in NOT NULL columns
- ✗ FOREIGN KEY violations (orphaned records)
- ✗ Duplicate values in UNIQUE columns
- ✗ Invalid ENUM values
- ✗ DATETIME columns without DEFAULT values

**Usage:**
```bash
source load-env.sh
python3 db/validate_schema.py
```

**Sample Output:**
```
================================================================================
SCHEMA VALIDATION REPORT — 2026-04-03T21:30:45.123456
================================================================================

❌ ERRORS (3):

1. TABLE 'submissions' COLUMN 'PaymentID': Foreign key violation — 8 orphaned
   record(s) referencing non-existent `payments`.`PaymentID`. Examples:
   ['pay_12345', 'pay_67890', 'pay_11111']

2. TABLE 'members' COLUMN 'Email': Constraint violation — 2 NULL value(s) found
   in NOT NULL column. Sample rows: [{'MemberID': 'M001', 'Email': None, ...}]

3. TABLE 'submissions' COLUMN 'Status': 1 invalid ENUM value(s). Examples:
   ['invalid_status']
```

---

### 2. `SCHEMA_IMPROVEMENTS.sql` — Comprehensive Schema Hardening

**What It Does:**

#### Section 1: Error Logging Table
Creates `schema_error_log` table to permanently track all validation errors:
```sql
CREATE TABLE `schema_error_log` (
  `ErrorLogID` varchar(50),           -- Unique identifier
  `TableName` varchar(100),           -- Which table
  `ColumnName` varchar(100),          -- Which column (if applicable)
  `ErrorType` enum(...),              -- Type of error
  `ErrorMessage` text,                -- Full error description
  `ProblematicValue` text,            -- The actual bad value
  `OffendingRowID` varchar(255),      -- Row identifier
  `DetectedAt` datetime,              -- When found
  `ResolvedAt` datetime,              -- When fixed
  `Status` enum('open','resolved'),   -- Current status
  ...
);
```

#### Section 2: DATETIME Column Fixes
Adds `DEFAULT CURRENT_TIMESTAMP` to all DATETIME columns:
```sql
-- Before:
ALTER TABLE `submissions` MODIFY `CreatedAt` datetime;

-- After:
ALTER TABLE `submissions`
MODIFY `CreatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP;
```

**Affected Columns:**
- `submissions`: CreatedAt, UpdatedAt
- `members`: CreatedAt, UpdatedAt
- `admin_member_overrides`: CreatedAt, UpdatedAt
- `member_log`: CreatedAt, UpdatedAt
- `payments`: CreatedAt, UpdatedAt
- `gmail_transactions`: ImportedAt, UpdatedAt

#### Section 3: CHECK Constraints for ENUMs
Prevents invalid enum values at the database level:
```sql
ALTER TABLE `submissions`
ADD CONSTRAINT chk_submissions_status CHECK (
  `Status` IN ('pending', 'approved', 'cancelled', 'expired')
);
```

#### Section 4: Performance Indices
Adds indices for:
- Foreign key columns (faster JOINs)
- Frequently filtered columns (Status, Email, etc.)
- Large text searches (Subject)

#### Section 5: Validation Triggers
Automatically logs constraint violations when they occur:
```sql
CREATE TRIGGER trg_submissions_null_check
BEFORE INSERT ON `submissions`
FOR EACH ROW
BEGIN
  IF NEW.`SubmissionID` IS NULL THEN
    INSERT INTO `schema_error_log` (...) VALUES (...);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '...';
  END IF;
END
```

#### Section 6: Scanning Procedure
```sql
CALL sp_scan_schema_violations();
```
Scans entire database for existing violations and logs them.

#### Section 7: Repair Script
Commented-out SQL for fixing known issues:
```sql
-- Fix NULL SubmissionIDs
UPDATE `submissions`
SET `SubmissionID` = UUID()
WHERE `SubmissionID` IS NULL;

-- Fix invalid Status values
UPDATE `submissions`
SET `Status` = 'pending'
WHERE `Status` NOT IN ('pending', 'approved', 'cancelled', 'expired');
```

#### Section 8: Monitoring Queries
```sql
-- View all open errors
SELECT * FROM `schema_error_log` WHERE `Status` = 'open';

-- Count errors by type
SELECT `ErrorType`, COUNT(*) FROM `schema_error_log` GROUP BY `ErrorType`;
```

---

## Implementation Steps

### Step 1: Run Baseline Validation
```bash
source load-env.sh
python3 db/validate_schema.py > validation_baseline.log
```

### Step 2: Apply Improvements (MySQL 5.7 compatible)
Each statement must run separately. Run in order:

```bash
# Section 1: Create error log table
mysql-mmr < db/SCHEMA_IMPROVEMENTS.sql  # (paste Section 1 only)

# Section 2-4: Fix columns, add constraints, add indices
# ... (paste each section separately due to MySQL 5.7 limitations)
```

**⚠️ MySQL 5.7 Constraint:** Cannot combine multiple ALTER TABLE statements.

### Step 3: Scan for Existing Violations
```sql
CALL sp_scan_schema_violations();
```

### Step 4: Review Errors
```sql
SELECT * FROM `schema_error_log` ORDER BY `ErrorType`, `DetectedAt` DESC;
```

### Step 5: Fix Known Issues
Uncomment and run relevant repair scripts from Section 7:

```bash
# Fix NULL SubmissionIDs
mysql-mmr << 'SQL'
UPDATE `submissions`
SET `SubmissionID` = UUID()
WHERE `SubmissionID` IS NULL;
SQL

# Fix invalid Status values
mysql-mmr << 'SQL'
UPDATE `submissions`
SET `Status` = 'pending'
WHERE `Status` NOT IN ('pending', 'approved', 'cancelled', 'expired');
SQL
```

### Step 6: Verify Fixes
```bash
source load-env.sh
python3 db/validate_schema.py
```

---

## Monitoring & Maintenance

### Daily Check
```sql
SELECT COUNT(*) as open_errors
FROM `schema_error_log`
WHERE `Status` = 'open' AND `DetectedAt` > NOW() - INTERVAL 1 DAY;
```

### Weekly Report
```sql
SELECT
  `ErrorType`,
  COUNT(*) as count,
  GROUP_CONCAT(DISTINCT `TableName`) as tables_affected,
  MIN(`DetectedAt`) as first_detected,
  MAX(`DetectedAt`) as last_detected
FROM `schema_error_log`
WHERE `Status` = 'open'
GROUP BY `ErrorType`
ORDER BY count DESC;
```

### Auto-Cleanup Old Errors
```sql
DELETE FROM `schema_error_log`
WHERE `Status` = 'resolved' AND `ResolvedAt` < NOW() - INTERVAL 30 DAY;
```

---

## Example: Fixing a Specific Issue

**Scenario:** Validator detects 8 orphaned submissions referencing deleted payments.

1. **Find the records:**
   ```sql
   SELECT s.SubmissionID, s.PaymentID, s.Status
   FROM `submissions` s
   LEFT JOIN `payments` p ON s.PaymentID = p.PaymentID
   WHERE s.PaymentID IS NOT NULL AND p.PaymentID IS NULL;
   ```

2. **Choose a fix strategy:**
   - Option A: Set PaymentID to NULL (treat as unpaid)
   - Option B: Delete the submissions
   - Option C: Create matching payment records

3. **Apply the fix:**
   ```sql
   UPDATE `submissions`
   SET `PaymentID` = NULL, `Status` = 'pending'
   WHERE `PaymentID` IN (
     SELECT s.PaymentID FROM `submissions` s
     WHERE s.PaymentID IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM `payments` p WHERE p.PaymentID = s.PaymentID)
   );
   ```

4. **Mark as resolved:**
   ```sql
   UPDATE `schema_error_log`
   SET `Status` = 'resolved',
       `ResolvedAt` = NOW(),
       `ResolvedBy` = 'admin-name',
       `ResolutionNotes` = 'Set PaymentID to NULL for orphaned records'
   WHERE `ErrorType` = 'FOREIGN_KEY_VIOLATION'
     AND `TableName` = 'submissions'
     AND `ColumnName` = 'PaymentID'
     AND `Status` = 'open';
   ```

5. **Verify:**
   ```sql
   SELECT * FROM `schema_error_log`
   WHERE `TableName` = 'submissions'
     AND `ColumnName` = 'PaymentID'
   ORDER BY `DetectedAt` DESC;
   ```

---

## Common Issues & Fixes

| Issue | Detection | Fix |
|-------|-----------|-----|
| NULL in NOT NULL column | `validate_schema.py` | `UPDATE table SET col = DEFAULT WHERE col IS NULL` |
| Orphaned FK reference | `schema_error_log` | `UPDATE table SET fk_col = NULL` or delete row |
| Invalid ENUM value | CHECK constraint | `UPDATE table SET enum_col = 'valid_value' WHERE ...` |
| Missing PRIMARY KEY | `validate_schema.py` | Add PRIMARY KEY constraint |
| Duplicate UNIQUE value | `schema_error_log` | Review data, choose canonical value, delete duplicates |

---

## Integration with CI/CD

Add to GitHub Actions workflow:

```yaml
- name: Validate Database Schema
  run: |
    source load-env.sh
    python3 db/validate_schema.py | tee schema_validation.log
    if grep -q "ERRORS" schema_validation.log; then
      echo "Schema validation failed!"
      exit 1
    fi
```

---

## Key Takeaways

✅ **Before Improvements:**
- No centralized error logging
- DATETIME columns could receive NULL
- No database-level ENUM validation
- Orphaned records went undetected
- Hard to trace data quality issues

✅ **After Improvements:**
- All errors logged to `schema_error_log`
- DATETIME columns always have valid timestamps
- ENUM violations caught at INSERT time
- FK violations logged with specific examples
- Complete audit trail for debugging

---

## Questions?

Refer to the comments in `SCHEMA_IMPROVEMENTS.sql` for detailed implementation notes.
