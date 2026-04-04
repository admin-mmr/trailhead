# Improved Error Messaging System

## Overview

This migration (`MIGRATION_V007_improve_error_messages.sql`) enhances the database with structured error tracking and validation. Every constraint violation now produces a detailed, actionable error message with contextual information.

---

## What's Included

### 1. Enhanced `activity_log` Table
New columns capture structured error information:

```sql
-- New columns in activity_log:
ErrorContext     json         -- {field, value, constraint, suggestion}
ErrorSeverity    enum(...)    -- INFO, WARNING, ERROR, CRITICAL
StackTrace       text         -- Python/Node traceback if available
```

**Usage in Code:**
```python
# Python example
import json
from datetime import datetime

activity_log_entry = {
    'LogID': str(uuid4()),
    'Timestamp': datetime.utcnow(),
    'MemberID': member_id,
    'Action': 'SUBMISSION_CREATE_FAILED',
    'ErrorCode': 'SUBM_FK_INVALID_MEMBER',
    'ErrorMessage': 'MemberID "M999" does not exist in members table',
    'ErrorContext': json.dumps({
        'field': 'MemberID',
        'value': 'M999',
        'constraint': 'fk_submissions_members',
        'suggestion': 'Verify MemberID exists before creating submission'
    }),
    'ErrorSeverity': 'ERROR',
    'StackTrace': traceback.format_exc()
}
```

---

### 2. New `error_context` Table

Centralized error tracking with rich metadata:

| Column | Purpose |
|--------|---------|
| `ErrorContextID` | UUID for cross-referencing between tables |
| `ErrorCode` | Consistent error identifier (e.g., `SUBM_NULL_ID`) |
| `ErrorMessage` | User-friendly message |
| `TechnicalMessage` | Developer debugging details |
| `SuggestedFix` | Actionable resolution |
| `TableName`, `ColumnName` | Pinpoint exact location |
| `ProblematicValue` | The actual bad value |
| `ValidValueExamples` | JSON array of correct values |
| `AllowedRange` | Min-max or enum list |
| `OffendingRowID` | Row identifier (compound keys as JSON) |
| `OffendingRowContext` | Full row data (sensitive fields masked) |
| `Severity` | INFO \| WARNING \| ERROR \| CRITICAL |
| `Status` | NEW \| ACKNOWLEDGED \| IN_PROGRESS \| RESOLVED |
| `AssignedTo` | Admin email responsible for fix |
| `OccurrenceCount` | How many times this specific error happened |

---

### 3. CHECK Constraints with Clear Error Messages

All major constraints now have descriptive names and validation rules:

#### Status Fields
```sql
-- submissions.Status must be one of:
chk_submissions_status_valid
  → 'pending' | 'approved' | 'cancelled' | 'expired'

-- members.Status must be one of:
chk_members_status_valid
  → 'active' | 'expired' | 'inactive' | 'pending'
```

#### Amount Fields
```sql
-- All payment amounts must be >= 0
chk_payments_amount_nonnegative
chk_submissions_amount_nonnegative
chk_gmail_amount_nonnegative
```

#### Time Fields
```sql
-- ExpiresAt must be after CreatedAt
chk_submissions_expires_after_created

-- PaymentDate must be recent (±1 year/30 days)
chk_submissions_payment_date_reasonable
```

#### Email Validation
```sql
-- Email must contain @ if provided
chk_members_email_valid
chk_actlog_email_valid
```

---

### 4. Validation Triggers

Automatic triggers intercept constraint violations BEFORE they hit the database:

#### `trg_submissions_insert_validate`
Validates on every submission INSERT:
- ✓ SubmissionID is not NULL
- ✓ MemberID exists in members table
- ✓ Status is valid enum value
- ✓ Amount is non-negative
- ✓ ExpiresAt > CreatedAt

**Example Error:**
```
MemberID "M999" does not exist in members table.
Error: 3fa85f64-5717-4562-b3fc-2c963f66afa6

--- ERROR CONTEXT ---
Table: submissions
Column: MemberID
Constraint: fk_submissions_members
Problematic Value: M999
Valid Examples: ["M001", "M002", "M123"]
Suggested Fix: Verify MemberID exists in members table before creating submission
```

#### `trg_members_insert_validate`
Validates on every member INSERT:
- ✓ Email is valid format (contains @)
- ✓ Status is valid enum value

#### `trg_payments_insert_validate`
Validates on every payment INSERT:
- ✓ Amount is non-negative
- ✓ SubmissionID (if provided) exists

---

## Error Codes Reference

| Code | Table | Issue | Severity | Fix |
|------|-------|-------|----------|-----|
| `SUBM_NULL_ID` | submissions | Missing SubmissionID | CRITICAL | Ensure UUID generated before INSERT |
| `SUBM_FK_INVALID_MEMBER` | submissions | Invalid MemberID reference | ERROR | Verify MemberID exists in members |
| `SUBM_INVALID_STATUS` | submissions | Bad Status value | ERROR | Use: pending\|approved\|cancelled\|expired |
| `SUBM_NEGATIVE_AMOUNT` | submissions | Amount < 0 | WARNING | Check calculation logic |
| `SUBM_EXPIRY_BEFORE_CREATED` | submissions | ExpiresAt ≤ CreatedAt | ERROR | Set ExpiresAt after creation time |
| `MEM_INVALID_EMAIL` | members | Email missing @ | WARNING | Use valid format: user@domain.com |
| `MEM_INVALID_STATUS` | members | Bad Status value | ERROR | Use: active\|expired\|inactive\|pending |
| `PAY_NEGATIVE_AMOUNT` | payments | Amount < 0 | WARNING | Check calculation logic |
| `PAY_FK_INVALID_SUBMISSION` | payments | Invalid SubmissionID | WARNING | Verify submission exists or leave NULL |

---

## Using the Error Tracking System

### For Developers

**1. Catch errors programmatically:**
```python
from mysql.connector import Error as MySQLError

try:
    cursor.execute(submission_insert_sql, values)
    conn.commit()
except MySQLError as e:
    error_code = e.errno  # 1452 = FK violation, 1406 = data too long, etc.
    error_message = str(e)

    # Log to activity_log with error context
    log_error(
        action='SUBMISSION_CREATE_FAILED',
        error_code='SUBM_FK_INVALID_MEMBER',
        error_message=error_message,
        error_context={
            'field': 'MemberID',
            'value': submission.member_id,
            'suggestion': 'Verify member exists'
        }
    )

    # Return to user
    return {
        'error': 'Cannot create submission for non-existent member',
        'errorId': error_context_id,  # User can reference this for support
        'suggestion': 'Check that the member ID is correct'
    }, 400
```

**2. View errors in database:**
```sql
-- All unresolved errors (high priority first)
SELECT * FROM v_unresolved_errors;

-- Errors in last 7 days
CALL sp_error_summary_report(7);

-- Find specific error type
SELECT * FROM error_context
WHERE ErrorCode = 'SUBM_FK_INVALID_MEMBER'
  AND Status = 'NEW'
ORDER BY OccurrenceCount DESC;
```

### For Operations

**1. Monitor error trends:**
```sql
-- Count errors by severity
SELECT Severity, COUNT(*) as count
FROM error_context
WHERE DetectedAt > NOW() - INTERVAL 24 HOUR
GROUP BY Severity;

-- Most frequent errors today
SELECT ErrorCode, OccurrenceCount, SuggestedFix
FROM error_context
WHERE DetectedAt > NOW() - INTERVAL 24 HOUR
  AND Status IN ('NEW', 'ACKNOWLEDGED')
ORDER BY OccurrenceCount DESC
LIMIT 10;
```

**2. Acknowledge errors:**
```sql
-- Mark all instances of an error as seen
UPDATE error_context
SET Status = 'ACKNOWLEDGED'
WHERE ErrorCode = 'SUBM_FK_INVALID_MEMBER'
  AND Status = 'NEW';
```

**3. Track resolution:**
```sql
-- Mark error as fixed with explanation
UPDATE error_context
SET Status = 'RESOLVED',
    ResolvedAt = NOW(),
    AssignedTo = 'admin@example.com',
    ResolutionNotes = 'Fixed user input validation in web app v2.1.0'
WHERE ErrorCode = 'MEM_INVALID_EMAIL'
  AND Status = 'IN_PROGRESS';
```

### For Support/Admin

**1. User reports error:**
> "I got error ID 3fa85f64-5717-4562-b3fc-2c963f66afa6 when trying to add a submission"

**2. Look up error details:**
```sql
SELECT
  `ErrorMessage`,
  `TechnicalMessage`,
  `ProblematicValue`,
  `SuggestedFix`,
  `OffendingRowContext`
FROM error_context
WHERE ErrorContextID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
```

**3. Provide user-friendly response:**
> "Your submission couldn't be created because the member ID 'M999' doesn't exist in our system. Please verify the member ID is correct and try again. If you need help, contact support with error ID 3fa85f64-5717..."

---

## Error Message Best Practices

### In Database Triggers
```sql
-- Good: Specific, actionable
SET error_msg = CONCAT(
  'Invalid MemberID: "', NEW.MemberID, '". ',
  'Member does not exist. ',
  'Valid example: M001, M123. ',
  'Error ID: ', error_context_id
);

-- Bad: Generic
SET error_msg = 'Foreign key error';
```

### In Application Code
```python
# Good: Detailed context
return {
    'success': False,
    'error': 'Cannot create submission',
    'reason': 'The member you selected does not exist',
    'errorId': error_context_id,
    'action': 'Please verify the member ID and try again'
}, 400

# Bad: Vague
return {'error': 'Error creating submission'}, 500
```

### In Activity Log
```json
{
  "LogID": "act_123",
  "Action": "PAYMENT_CREATE_FAILED",
  "ErrorCode": "PAY_FK_INVALID_SUBMISSION",
  "ErrorMessage": "SubmissionID 'sub_999' does not exist",
  "ErrorContext": {
    "field": "SubmissionID",
    "value": "sub_999",
    "constraint": "fk_payments_submissions",
    "suggestion": "Verify submission exists before creating payment"
  },
  "ErrorSeverity": "ERROR"
}
```

---

## Monitoring Queries

### Daily Health Check
```sql
SELECT
  Severity,
  COUNT(*) as count,
  MAX(LastOccurrence) as most_recent
FROM error_context
WHERE DetectedAt > NOW() - INTERVAL 24 HOUR
  AND Status != 'RESOLVED'
GROUP BY Severity
ORDER BY FIELD(Severity, 'CRITICAL', 'ERROR', 'WARNING', 'INFO');
```

### Critical Issues
```sql
SELECT
  ErrorCode,
  ErrorMessage,
  OccurrenceCount,
  AssignedTo,
  SuggestedFix
FROM error_context
WHERE Severity = 'CRITICAL'
  AND Status IN ('NEW', 'ACKNOWLEDGED');
```

### Resolution Rate
```sql
SELECT
  COUNT(CASE WHEN Status = 'RESOLVED' THEN 1 END) as resolved,
  COUNT(CASE WHEN Status != 'RESOLVED' THEN 1 END) as unresolved,
  ROUND(
    COUNT(CASE WHEN Status = 'RESOLVED' THEN 1 END) /
    COUNT(*) * 100, 2
  ) as resolution_rate_pct
FROM error_context
WHERE DetectedAt > NOW() - INTERVAL 30 DAY;
```

---

## Integration with CI/CD

Add to post-deployment checks:

```bash
#!/bin/bash

# Check for unresolved CRITICAL errors
CRITICAL_ERRORS=$(mysql -e "
  SELECT COUNT(*) FROM error_context
  WHERE Severity = 'CRITICAL' AND Status != 'RESOLVED'
" | tail -1)

if [ $CRITICAL_ERRORS -gt 0 ]; then
  echo "❌ DEPLOYMENT BLOCKED: $CRITICAL_ERRORS unresolved critical errors"
  exit 1
fi

echo "✅ Error checks passed"
```

---

## FAQ

**Q: Can I suppress certain errors?**
A: Yes, set `Status = 'WONTFIX'` with `ResolutionNotes` explaining why.

**Q: What triggers should I use for my own tables?**
A: Follow the pattern in `trg_submissions_insert_validate`:
1. Generate error context ID
2. Validate constraint
3. Insert into error_context table
4. SIGNAL with detailed message

**Q: How do I clean up old errors?**
A: Archive resolved errors older than 30 days:
```sql
INSERT INTO error_context_archive SELECT * FROM error_context
WHERE Status = 'RESOLVED' AND ResolvedAt < NOW() - INTERVAL 30 DAY;

DELETE FROM error_context
WHERE Status = 'RESOLVED' AND ResolvedAt < NOW() - INTERVAL 30 DAY;
```

**Q: What's the performance impact?**
A: Triggers add ~5-10ms per INSERT. Acceptable for most use cases. Monitor with:
```sql
EXPLAIN ANALYZE INSERT INTO submissions ...
```

---

## Next Steps

1. **Apply migration:** Run MIGRATION_V007 sequentially on Azure MySQL
2. **Test triggers:** Attempt constraint violations and verify error messages
3. **Update error handlers:** Modify Python/Node code to use new error_context table
4. **Monitor:** Set up daily error report alerts
5. **Document:** Update API documentation with error codes

---

## References

- [Error Code List](#error-codes-reference)
- [Unresolved Errors View](../db/MIGRATION_V007_improve_error_messages.sql#L280)
- [Error Summary Procedure](../db/MIGRATION_V007_improve_error_messages.sql#L298)
