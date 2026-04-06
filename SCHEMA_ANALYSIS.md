# Schema Analysis: sheets_sync_log vs activity_log Consolidation

## Current State

### `activity_log` (18 columns)
- **Purpose:** General audit trail for user actions, member changes, errors
- **Scope:** Session-level, member-level, event-level actions
- **Data:** WHO (SessionID, MemberID, Email, EventID), WHAT (Action, State), ERRORS (ErrorCode, ErrorMessage, ErrorContext, ErrorSeverity, StackTrace)
- **Rows:** ~One per user action or error event
- **Indexes:** SessionID, Timestamp, Action, ErrorCode, ErrorSeverity

### `sheets_sync_log` (15 columns)
- **Purpose:** Sync operation tracking with resume capability
- **Scope:** Batch-level Google Sheets ↔ MySQL sync operations
- **Data:** Job tracking (JobID, ConfigKey, Direction), Batch details (BatchNumber, BatchSize, TotalRows), Results (Status, RowsInserted/Updated/Skipped, ErrorMessage)
- **Rows:** ~One per batch (typically 300 rows per batch → 5-10 rows per sync job)
- **Indexes:** JobID, ConfigKey, Status, StartedAt
- **FK:** JobID → sync_jobs.JobID (for job coordination)

---

## Option 1: Keep Separate (Current Approach) ✅ RECOMMENDED

### Pros
| Aspect | Benefit |
|--------|---------|
| **Query Speed** | Smaller tables (sheets_sync_log ~15KB vs activity_log ~500KB). Faster scans on sync operations. |
| **Indexing** | Separate indexes for sync-specific queries (JobID, ConfigKey). No index bloat from unrelated queries. |
| **Data Semantics** | `sheets_sync_log` is 100% technical/operational. `activity_log` is 50% user action, 50% error. Different domains. |
| **Resume Logic** | FK to `sync_jobs` enables cascading deletes, job-level tracking. Hard to replicate in unified table. |
| **Batch Tracking** | `UNIQUE KEY (JobID, BatchNumber)` ensures exactly-once batch logging. Different from user session model. |
| **Filtering** | `WHERE ConfigKey='export_members' AND Status='success'` is fast and clear. Adding sync columns to activity_log makes queries complex. |
| **Retention Policy** | Could expire old sync logs separately from user actions (compliance vs operational). |

### Cons
- Two places to look for "what happened today"
- Slight schema complexity (two related log tables)
- Small code overhead (sync_config logs to sheets_sync_log, app logs to activity_log)

**Query Examples:**
```sql
-- Fast: Get last successful export_members sync
SELECT * FROM sheets_sync_log
WHERE ConfigKey='export_members' AND Status='success'
ORDER BY CompletedAt DESC LIMIT 1;

-- Would be messy in unified table:
SELECT * FROM activity_log
WHERE Action LIKE 'SYNC:%' AND State='export_members' AND ErrorCode IS NULL
ORDER BY Timestamp DESC LIMIT 1;
```

---

## Option 2: Merge into activity_log ⚠️ NOT RECOMMENDED

### Pros
- Single table for audit trail
- One query language for all logs
- Fewer tables to manage

### Cons
| Issue | Impact |
|-------|--------|
| **Table Bloat** | activity_log would grow to 30+ columns. ~40% of rows would have NULL sync columns (user actions don't need JobID, ConfigKey, etc.). |
| **Null Proliferation** | Each user action row would NULL out: JobID, ConfigKey, Direction, BatchNumber, BatchSize, TotalRows, RowsInserted, RowsUpdated, RowsSkipped. Each sync row would NULL out: SessionID, MemberID, Email, EventID, Action, State (user-facing columns). |
| **Index Strategy Breaks** | `UNIQUE KEY (JobID, BatchNumber)` can't exist on a table with nullable JobID. Resume capability breaks. |
| **FK Constraint** | Current `UNIQUE KEY uk_job_batch` enforces exactly-once per batch. Would need to add check constraint instead. |
| **Query Clarity** | `WHERE (Action='SYNC_BATCH' AND ConfigKey='export_members') OR (Action='MEMBER_UPDATE' AND MemberID=?)` is ambiguous. |
| **Performance** | Scanning for sync logs requires filtering 10+ null columns. Index on (ConfigKey, Status) would skip non-sync rows, making it less effective. |
| **Storage** | Estimated 50% more disk space due to NULL columns and index bloat. |

**Merged Table Would Look Like:**
```sql
CREATE TABLE activity_log (
  LogID, Timestamp, SessionID, MemberID, Email, EventID, Action, State,
  ErrorCode, ErrorMessage, ErrorContext, ErrorSeverity, StackTrace,
  -- SYNC columns (NULL for user actions)
  JobID, ConfigKey, Direction, BatchNumber, BatchSize, TotalRows,
  RowsInserted, RowsUpdated, RowsSkipped, StartedAt, CompletedAt
);
```

**Problem Query:**
```sql
-- Ambiguous: Is this a user action or a sync batch?
SELECT * FROM activity_log WHERE Status='success';
-- Need to add: AND ConfigKey IS NOT NULL AND JobID IS NOT NULL
```

---

## Option 3: Hybrid Approach (Compromise)

Create a **single `operation_log` table** that's the parent of both user and sync operations:

```sql
CREATE TABLE operation_log (
  OperationID, Timestamp, Type ENUM('USER_ACTION','SYNC_BATCH'), Status,
  -- User action fields (nullable)
  SessionID, MemberID, Email, EventID, Action,
  -- Sync fields (nullable)
  JobID, ConfigKey, Direction, BatchNumber, RowsInserted,
  -- Shared error fields
  ErrorCode, ErrorMessage, ErrorSeverity
);
```

**Pros:** Single audit trail, can correlate user actions with sync operations
**Cons:** Still has 50% NULL columns, still breaks unique constraints

---

## Recommendation: **Keep Both Tables Separate** ✅

### Why
1. **Technical vs. Operational Split** — activity_log is about user/system actions; sheets_sync_log is purely operational. Different data models.
2. **Performance** — Sync queries stay fast. No cross-domain filtering overhead.
3. **Constraints** — The `UNIQUE KEY (JobID, BatchNumber)` and FK to `sync_jobs` are essential for resume logic.
4. **Schema Evolution** — If you later need to track other sync types (Stripe, NYRR, Slack), you have a proven pattern.

### Schema Health Check
- ✅ `sheets_sync_log` is well-designed: focused, indexed, constrained
- ✅ `activity_log` serves its purpose: user/system audit trail
- ✅ No overlap: no row appears in both tables
- ✅ Separation of concerns: clean data model

### If You Want Unified Querying
Instead of merging tables, create a **view or stored procedure**:

```sql
-- View for "all important events today"
CREATE VIEW v_all_logs AS
SELECT
  'USER_ACTION' AS LogType, LogID, Timestamp, MemberID, Action AS Description,
  Status, ErrorCode, NULL AS JobID
FROM activity_log
UNION ALL
SELECT
  'SYNC_BATCH', SyncLogID, StartedAt, NULL,
  CONCAT(ConfigKey, ' (', Direction, ')'), Status,
  NULL, JobID
FROM sheets_sync_log;
```

Then query unified: `SELECT * FROM v_all_logs WHERE Timestamp > DATE_SUB(NOW(), INTERVAL 1 DAY);`

---

## Migration Path (If You Change Your Mind)

If you ever want to consolidate, the migration would be:
1. Add sync columns to activity_log (nullable)
2. Copy sheets_sync_log data to activity_log (with Type='SYNC_BATCH')
3. Migrate sync_config.py to write to activity_log instead
4. Drop sheets_sync_log
5. Add CHECK constraints to replace the UNIQUE KEY

**Estimated effort:** 2-3 hours + testing. But not recommended.

---

## Final Verdict

**Status:** sheets_sync_log is appropriately separate.
**Action:** No change needed. Both tables serve their purpose well.
