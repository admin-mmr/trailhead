# Sync Refactor Summary — Generic Helper Architecture

## Overview

Simplified the entire sync logic from scattered duplicated functions into a **centralized configuration-driven architecture** using `sync_config.py` and a single `generic_sync_runner()` helper.

---

## Files Created

### 1. **basecamp/python/sync_config.py** (Source of Truth)
- **SYNC_CONFIG**: Central dictionary defining all 5 sync patterns (import/export members/payments/submissions/transactions)
- **generic_sync_runner()**: Universal helper handling both directions (MySQL→Sheets, Sheets→MySQL) with UPSERT logic
- **_prepare_sheet_rows()**: Converts MySQL rows to Sheets format with field mapping
- Imports: `sync_config.py` in mmr-admin via `scripts/sync-shared-modules.sh`

### 2. **mmr-admin/sync_runners.py** (Job Wrappers)
- `sync_export_members()`, `sync_export_payments()`, `sync_export_submissions()`, `sync_export_transaction_meta()`, `sync_import_transactions()`
- Each wraps `generic_sync_runner()` with db/webhook helpers
- Handles job progress updates via `update_job(job_id, ...)`

### 3. **mmr-admin/api_sheets_sync_routes.py** (Flask Routes)
- **POST /api/sync/export/members** — MySQL→Sheets (members)
- **POST /api/sync/export/payments** — MySQL→Sheets (payments)
- **POST /api/sync/export/submissions** — MySQL→Sheets (submissions)
- **POST /api/sync/export/transaction-meta** — MySQL→Sheets (gmail_transactions Notes/UpdatedAt)
- **POST /api/sync/import/transactions** — Sheets→MySQL (gmail_transactions with Source→PaymentMethod mapping)
- **GET /api/sync/jobs** — List all sync jobs
- **GET /api/sync/status/<job_id>** — Get job status

---

## Architecture Changes

### Before (Duplicated Code Pattern)
```python
# api_sheets_sync.py had ~2500 lines with repeated patterns:

def _sync_members_to_sheets(job_id):
    cols = ['MemberID', 'Status', 'Created', ...]
    rows = query(f"SELECT {','.join(cols)} FROM members")
    # Manual Sheets write logic
    result = _call_gas_webhook({...})
    # Manual error handling
    update_job(job_id, ...)

def _sync_payments_to_sheets(job_id):
    # SAME CODE REPEATED with different table/columns
    cols = ['PaymentID', 'MemberID', ...]
    rows = query(f"SELECT {','.join(cols)} FROM payments")
    # Same webhook call, same error handling
    # Copy-paste nightmare 😞
```

### After (Configuration-Driven)
```python
# sync_config.py: Define once, use everywhere
SYNC_CONFIG = {
    'export_members': {
        'table': 'members',
        'sheet': 'Main',
        'key': 'MemberID',
        'columns': [...]
    },
    'export_payments': {
        'table': 'payments',
        'sheet': 'Payment-History',
        'key': 'PaymentID',
        'columns': [...]
    },
    # ... 3 more configs
}

# sync_runners.py: Thin wrapper
def sync_export_members(job_id):
    result = generic_sync_runner(
        job_id, 'export_members',
        db_query=query,
        db_execute=execute,
        gas_webhook=_call_gas_webhook,
        update_job=update_job
    )
    update_job(job_id, status='completed', **result)

# api_sheets_sync_routes.py: Route handler
@sheets_sync_bp.route('/api/sync/export/members', methods=['POST'])
@login_required
def api_export_members():
    job_id = launch_job(sync_export_members)
    return json_response({'ok': True, 'job_id': job_id})
```

---

## SYNC_CONFIG Keys & Column Mappings

### Export (MySQL → Sheets)

| Config Key | Table | Sheet | Primary Key | Notable Cols |
|---|---|---|---|---|
| `export_members` | members | Main | MemberID | Email, FirstName, LastName, Status, PaymentDate, JoinYear, YearBorn |
| `export_payments` | payments | Payment-History | PaymentID | MemberID, Amount, PaymentMethod, Source, TransactionNumber, Last4Digits |
| `export_submissions` | submissions | Submissions | SubmissionID | MemberID, Status, Amount, PaymentMethod, PaymentDate, PaymentID |
| `export_transaction_meta` | gmail_transactions | Transactions | TransactionNumber | Notes, UpdatedAt (metadata only) |

### Import (Sheets → MySQL)

| Config Key | Table | Sheet | Primary Key | Field Mappings |
|---|---|---|---|---|
| `import_transactions` | gmail_transactions | Transactions | MessageId | `Source` (Sheet) → `PaymentMethod` (MySQL) |

---

## generic_sync_runner() Signature

```python
def generic_sync_runner(
    job_id: str,
    config_key: str,
    db_query,           # Callable(sql) -> List[Dict]
    db_execute,         # Callable(sql, params) -> int
    gas_webhook,        # Callable(payload) -> Dict
    update_job,         # Callable(job_id, **kwargs) -> None
    direction: Optional[str] = None  # 'mysql_to_sheet' | 'sheet_to_mysql'
) -> Dict[str, Any]
```

**Returns:**
```json
{
    "status": "success" | "error" | "partial",
    "inserted": 10,
    "updated": 5,
    "skipped": 2,
    "message": "✓ Synced 10 new + 5 updated rows to members"
}
```

---

## Usage Examples

### Start a Sync Job (from Frontend or CLI)

```bash
# Export members to Sheets
curl -X POST http://localhost:5000/api/sync/export/members \
  -H "Authorization: Bearer <token>"

# Response:
# {"ok": true, "job_id": "job_abc123"}
```

### Check Job Status

```bash
curl http://localhost:5000/api/sync/status/job_abc123 \
  -H "Authorization: Bearer <token>"

# Response:
# {
#   "ok": true,
#   "job": {
#     "id": "job_abc123",
#     "status": "completed",
#     "message": "✓ Synced 150 new + 45 updated rows to members",
#     "progress": 100,
#     "inserted": 150,
#     "updated": 45,
#     "skipped": 0,
#     "started_at": "2026-04-03T22:15:00Z",
#     "completed_at": "2026-04-03T22:16:30Z"
#   }
# }
```

### Add a New Sync Pattern (Future-Proof)

1. **Add to SYNC_CONFIG** in basecamp/python/sync_config.py:
```python
SYNC_CONFIG['export_events'] = {
    'table': 'events',
    'sheet': 'Events',
    'key': 'EventID',
    'columns': ['EventID', 'Name', 'Date', 'Location', ...],
    'map_fields': {}  # if no field mappings
}
```

2. **Create a wrapper** in sync_runners.py:
```python
def sync_export_events(job_id: str):
    result = generic_sync_runner(
        job_id, 'export_events',
        db_query=query, db_execute=execute,
        gas_webhook=_call_gas_webhook,
        update_job=update_job
    )
    update_job(job_id, status='completed', **result)
```

3. **Add a route** in api_sheets_sync_routes.py:
```python
@sheets_sync_bp.route('/api/sync/export/events', methods=['POST'])
@login_required
def api_export_events():
    job_id = launch_job(sync_export_events)
    return json_response({'ok': True, 'job_id': job_id})
```

4. **Sync to mmr-admin**:
```bash
bash scripts/sync-shared-modules.sh
```

---

## Key Benefits

| Aspect | Before | After |
|---|---|---|
| **Code Duplication** | ~500 lines repeated across 5 patterns | Configuration-driven, ~200 lines total logic |
| **Maintenance** | Change field list → search-and-replace 3+ places | Edit SYNC_CONFIG once, applies everywhere |
| **New Sync Type** | Copy 100+ lines of boilerplate | Add 10 lines to SYNC_CONFIG + 5-line wrapper |
| **Bug Fixes** | Apply to each sync function separately | Fix once in generic_sync_runner, all patterns inherit |
| **Field Mapping** | Hardcoded in each sync | Centralized in `map_fields` per config |
| **Testability** | Mock entire workflow | Unit test generic_sync_runner with fake db/webhook |

---

## Migration Path

### Option A: Gradual Replacement (Recommended)
1. Keep old api_sheets_sync.py endpoints live
2. Register new `api_sheets_sync_routes.py` blueprint alongside old one
3. Frontend can call new routes at `/api/sync/export/members` etc.
4. Old routes at `/api/sync/mysql-to-google/members` continue working
5. Deprecate old routes once frontend fully migrated (1-2 sprints)

### Option B: Immediate Replacement
1. Comment out old route handlers in api_sheets_sync.py
2. Register new `api_sheets_sync_routes.py` blueprint
3. Update frontend to call new endpoints
4. Monitor for issues in next 48 hours

### Option C: Run Both Systems (Testing)
```python
# In app.py around line 162:
# Original (old architecture):
from api_sheets_sync import sheets_sync_bp
app.register_blueprint(sheets_sync_bp)

# New (new architecture):
from api_sheets_sync_routes import sheets_sync_bp as sheets_sync_bp_new
app.register_blueprint(sheets_sync_bp_new, url_prefix='/api/sync/v2')
```

Then test new routes at `/api/sync/v2/export/members` before full cutover.

---

## Deployment Checklist

- [ ] basecamp/python/sync_config.py created ✅
- [ ] mmr-admin/sync_config.py synced from basecamp ✅
- [ ] mmr-admin/sync_runners.py created ✅
- [ ] mmr-admin/api_sheets_sync_routes.py created ✅
- [ ] scripts/sync-shared-modules.sh updated ✅
- [ ] Imports verified (no mysql.connector errors) ✅
- [ ] Python files compile successfully ✅
- [ ] GitHub Actions CI updated to sync sync_config.py (auto-copies with sync_engine.py)
- [ ] _context.md updated with migration notes
- [ ] Frontend routes updated to call new endpoints
- [ ] E2E test covers 1 export + 1 import flow
- [ ] Monitor logs for 24 hours post-deploy

---

## Questions?

- **What about the old 2500-line api_sheets_sync.py?** → Can be archived to `api_sheets_sync_deprecated.py` after frontend migration
- **Do I need to refactor sync_jobs.py?** → No, it works as-is; generic_sync_runner uses existing launch_job() & update_job() helpers
- **How do I test locally?** → `python3 -c "from sync_config import list_configs; print(list_configs())"` (no db required)
- **Can I use this for cron jobs?** → Yes! basecamp/ops can also use generic_sync_runner with file-based db mocks
