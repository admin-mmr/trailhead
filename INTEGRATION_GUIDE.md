# Integration Guide — Activating New Sync Routes

## Quick Start (5 minutes)

### Step 1: Register the Blueprint

Edit `mmr-admin/app.py` around line 162 and add:

```python
# After the existing sheets_sync import:
from api_sheets_sync import sheets_sync_bp
app.register_blueprint(sheets_sync_bp)

# ADD THIS:
from api_sheets_sync_routes import sheets_sync_bp as sheets_sync_routes_bp
app.register_blueprint(sheets_sync_routes_bp)
```

### Step 2: Restart Flask

```bash
# From mmr-admin directory
source venv/bin/activate
python3 app.py
# or if using a management script:
mmr-admin
```

### Step 3: Test One Route

```bash
# Export members (should queue a job)
curl -X POST http://localhost:5000/api/sync/export/members \
  -H "Authorization: Bearer test-token" \
  -H "Content-Type: application/json"

# Expected response:
# {
#   "ok": true,
#   "job_id": "abc123def456..."
# }
```

### Step 4: Check Job Status

```bash
curl http://localhost:5000/api/sync/status/abc123def456 \
  -H "Authorization: Bearer test-token"

# Expected response:
# {
#   "ok": true,
#   "job": {
#     "id": "abc123def456",
#     "status": "running" | "completed" | "error",
#     "message": "Exporting members...",
#     "progress": 50,
#     ...
#   }
# }
```

Done! Routes are now live.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│ Flask Routes (api_sheets_sync_routes.py)                    │
│  POST /api/sync/export/{members,payments,submissions,...}   │
│  POST /api/sync/import/transactions                         │
│  GET  /api/sync/jobs, /api/sync/status/<job_id>            │
└────────────────┬────────────────────────────────────────────┘
                 │ launch_job(worker)
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ Job Wrappers (sync_runners.py)                              │
│  sync_export_members(job_id)                                │
│  sync_export_payments(job_id)                               │
│  sync_import_transactions(job_id)                           │
│  ... etc                                                     │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ Generic Runner (sync_config.py → generic_sync_runner)       │
│  Handles BOTH directions (MySQL→Sheets, Sheets→MySQL)      │
│  UPSERT logic, field mapping, error handling                │
│  Returns: {status, inserted, updated, skipped, message}    │
└────────────────┬────────────────────────────────────────────┘
                 │
        ┌────────┴─────────┐
        │                  │
        ▼                  ▼
   MySQL (db)         Google Sheets (GAS webhook)
```

---

## File Locations & Purposes

### Source of Truth
- **basecamp/python/sync_config.py** — SYNC_CONFIG dict + generic_sync_runner()
  - Edit here first for new sync patterns
  - Auto-synced to mmr-admin/ by `scripts/sync-shared-modules.sh`

### mmr-admin Service Files
- **mmr-admin/sync_config.py** — Auto-synced copy (don't edit directly)
- **mmr-admin/sync_runners.py** — Job wrapper functions
- **mmr-admin/api_sheets_sync_routes.py** — Flask routes
- **mmr-admin/app.py** — Register blueprint here (line ~162)

### Documentation
- **SYNC_REFACTOR_SUMMARY.md** — Full before/after architecture
- **mmr-admin/ROUTES_REFERENCE.md** — Quick route lookup table
- **INTEGRATION_GUIDE.md** — This file

---

## Adding a New Sync Pattern (e.g., export_events)

### 1. Edit basecamp/python/sync_config.py

```python
SYNC_CONFIG['export_events'] = {
    'table': 'events',
    'sheet': 'Events',
    'key': 'EventID',
    'direction': 'mysql_to_sheet',
    'columns': [
        'EventID', 'Name', 'Date', 'Location', 'Organizer',
        'Capacity', 'Status', 'CreatedAt', 'UpdatedAt'
    ]
}
```

### 2. Edit mmr-admin/sync_runners.py

Add import and wrapper:

```python
def sync_export_events(job_id: str):
    """Sync events: MySQL → Google Sheets."""
    logger.info(f"[{job_id}] Starting export_events")
    result = generic_sync_runner(
        job_id=job_id,
        config_key='export_events',
        db_query=query,
        db_execute=execute,
        gas_webhook=_call_gas_webhook,
        update_job=update_job,
        direction='mysql_to_sheet'
    )
    logger.info(f"[{job_id}] Result: {result}")
    update_job(job_id, status='completed', **result)
```

### 3. Edit mmr-admin/api_sheets_sync_routes.py

Add route:

```python
@sheets_sync_bp.route('/api/sync/export/events', methods=['POST'])
@login_required
def api_export_events():
    """Export events from MySQL to Google Sheets."""
    job_id = launch_job(sync_export_events, initial_message='Exporting events...')
    return json_response({'ok': True, 'job_id': job_id})
```

### 4. Sync to mmr-admin

```bash
bash scripts/sync-shared-modules.sh
```

### 5. Test

```bash
curl -X POST http://localhost:5000/api/sync/export/events \
  -H "Authorization: Bearer test-token"
```

---

## Backward Compatibility

The old `api_sheets_sync.py` endpoints can run **alongside** the new routes:

```python
# In app.py, KEEP both:
from api_sheets_sync import sheets_sync_bp  # Old routes
app.register_blueprint(sheets_sync_bp)

from api_sheets_sync_routes import sheets_sync_bp as sheets_sync_routes_bp  # New routes
app.register_blueprint(sheets_sync_routes_bp)
```

### Old Routes (still work)
- `POST /api/sync/mysql-to-google/members` → `api_sync_members()`
- `POST /api/sync/mysql-to-google/payments` → `api_sync_payments()`
- `POST /api/sync/import-transactions` → `api_import_transactions()`
- etc.

### New Routes (preferred)
- `POST /api/sync/export/members` → `api_export_members()`
- `POST /api/sync/export/payments` → `api_export_payments()`
- `POST /api/sync/import/transactions` → `api_import_transactions()`
- etc.

**Migration Strategy:**
1. **Week 1-2:** Register new routes alongside old ones; frontend uses new routes
2. **Week 3-4:** Monitor logs; ensure no errors with new routes
3. **Week 5+:** Deprecate old routes; remove old endpoints

---

## Environment Setup

### Local Development

```bash
# 1. Copy .env or set up Keychain
source load-env.sh

# 2. Sync shared modules (includes sync_config.py)
bash scripts/sync-shared-modules.sh

# 3. Start Flask (auto-imports blueprints)
cd mmr-admin
python3 app.py
```

### CI/CD (GitHub Actions)

The sync script is already called in `.github/workflows/` at build time:

```yaml
- name: Sync shared Python modules
  run: bash scripts/sync-shared-modules.sh
```

New file `basecamp/python/sync_config.py` will automatically sync to `mmr-admin/sync_config.py` on every push.

---

## Testing Checklist

- [ ] Routes compile without syntax errors
- [ ] Blueprint registered in app.py
- [ ] Flask server starts: `python3 app.py`
- [ ] Can POST to `/api/sync/export/members` (gets job_id)
- [ ] Can GET `/api/sync/jobs` (lists jobs)
- [ ] Can GET `/api/sync/status/<job_id>` (shows job status)
- [ ] Job runs to completion (check logs)
- [ ] New + updated counts appear in job message
- [ ] Old routes still work (if keeping both)
- [ ] Frontend updated to use new endpoints

---

## Troubleshooting

### Issue: "ModuleNotFoundError: No module named 'sync_config'"

**Fix:** Run `bash scripts/sync-shared-modules.sh` to copy `sync_config.py` from basecamp/ to mmr-admin/

### Issue: "No such route: /api/sync/export/members"

**Fix:** Ensure `api_sheets_sync_routes` blueprint is registered in app.py:
```python
from api_sheets_sync_routes import sheets_sync_bp as sheets_sync_routes_bp
app.register_blueprint(sheets_sync_routes_bp)
```

### Issue: Job status shows "error" with empty message

**Fix:** Check Flask logs for details:
```bash
grep "sync_export_members\|generic_sync_runner" mmr-admin.log
```

### Issue: "GAS webhook timeout"

**Fix:** Check `SheetsWebhookUrl` in config:
```bash
security find-generic-password -s SheetsWebhookUrl -w
```

---

## FAQ

**Q: Do I need to modify the old api_sheets_sync.py?**
A: No. The new routes are entirely separate. The old file can stay as-is for backward compatibility.

**Q: Can I test the routes without a real Google Sheets webhook?**
A: Yes. Mock the webhook in sync_runners.py:
```python
def _call_gas_webhook(payload):
    return {'ok': True, 'data': {'inserted': 0, 'updated': 0}}  # Mock response
```

**Q: What's the difference between "inserted" and "updated"?**
A:
- **inserted** = new rows added to the destination (ON DUPLICATE KEY returned 1)
- **updated** = existing rows modified (ON DUPLICATE KEY returned 0)
- In MySQL, both are counted as successful UPSERT operations

**Q: Can I run multiple syncs in parallel?**
A: Yes. Each sync_* function gets its own `job_id` and runs in a separate thread via `launch_job()`.

**Q: What happens if the GAS webhook is down?**
A: The job completes with `status: 'error'` and a message indicating the webhook timeout. No data is written.

---

## Support

For issues or questions:
1. Check **SYNC_REFACTOR_SUMMARY.md** for architecture details
2. Check **mmr-admin/ROUTES_REFERENCE.md** for route signatures
3. Review **basecamp/python/sync_config.py** for field mappings
4. Check Flask logs: `grep -i "sync\|error" mmr-admin.log`
