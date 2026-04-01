# MMR Admin API Sync — CLI Usage Guide

## Overview

`mmr-admin/api_sync.py` can now be run as a **standalone CLI tool** that executes the three-step NYRR data sync and exits with appropriate status codes.

## Usage

```bash
cd /path/to/trailhead
source load-env.sh
python3 mmr-admin/api_sync.py --event <event_code> [--force] [--debug]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `--event EVENT_CODE` | ✅ Yes | Event code to sync (e.g., `H2026`) |
| `--force` | ❌ No | Delete and reload all runners (default: update only) |
| `--debug` | ❌ No | Enable DEBUG-level logging (default: INFO) |
| `--help` | ❌ No | Show help message |

### Examples

**Basic sync:**
```bash
python3 mmr-admin/api_sync.py --event H2026
```

**Force reload (delete + resync):**
```bash
python3 mmr-admin/api_sync.py --event H2026 --force
```

**With full debug logging:**
```bash
python3 mmr-admin/api_sync.py --event H2026 --debug
```

**Debug + Force:**
```bash
python3 mmr-admin/api_sync.py --event H2026 --force --debug
```

---

## Output Example

### Success Case

```
INFO     - 🚀 Starting NYRR sync CLI: event=H2026, force=False
INFO     - ✅ Event found: id=42, code=H2026

INFO     - ⏱️  STEP 1: Starting finishers fetch...
DEBUG    -   └─ Calling client.get_event_finishers(event_code=H2026)...
DEBUG    -   └─ Progress: 100/500 finishers
DEBUG    -   └─ Progress: 500/500 finishers
INFO     - ✅ STEP 1 complete: 500 runners fetched in 3.45s

INFO     - ⏱️  PHASE 1b: Upserting runners to database...
DEBUG    -   └─ DB connection acquired
DEBUG    -   └─ Starting batch upsert: BATCH_SIZE=500, total_runners=500
DEBUG    -   └─ Batch 1: 500 rows in 1.234s, total=500/500
INFO     - ✅ PHASE 1b complete: Upserted 500 rows in 2.15s (232.6 rows/sec)

INFO     - ⏱️  STEP 2: Fetching team list...
DEBUG    -   └─ Calling client.search_teams(event_code=H2026)...
INFO     - ✅ STEP 2 complete: 584 teams found in 2.12s

INFO     - ⏱️  STEP 3: Backfilling team_code for each team...
DEBUG    -   └─ DB connection acquired for backfill
DEBUG    -   └─ Team 1/584: fetching runners for team_code=TC001...
DEBUG    -     └─ Got 12 runners for TC001
DEBUG    -     └─ TC001: 12 updates, 0.045s
[... 582 more teams ...]
INFO     - ✅ STEP 3 complete: 584 teams, 487 runner-team assignments in 28.34s

INFO     - ⏱️  Finalizing: updating nyrr_events status...
INFO     - ✅ FINALIZE complete: 500 total runners in DB, 0.12s
INFO     - 🎉 FULL SYNC COMPLETE in 33.97s (0.6m)
INFO     -    Summary: 500 runners fetched, 584 teams, 487 assignments

======================================================================
✅ SYNC SUCCEEDED
======================================================================
Runners fetched: 500
Teams processed: 584
Assignments: 487
Final count: 500
Total time: 33.97s
======================================================================
```

### Error Case

```
INFO     - 🚀 Starting NYRR sync CLI: event=H2026, force=False
ERROR    - ❌ Event not found: H2026

======================================================================
❌ SYNC FAILED
======================================================================
Error: Event not found
Type: DatabaseError
Elapsed: 0.02s
======================================================================
```

---

## Exit Codes

| Code | Meaning | When |
|------|---------|------|
| `0` | ✅ Success | Sync completed without errors |
| `1` | ❌ Failure | Event not found, API error, or DB error |
| `130` | ⚠️ Interrupted | User pressed Ctrl+C |

### Using Exit Codes in Scripts

```bash
#!/bin/bash

source load-env.sh
python3 mmr-admin/api_sync.py --event H2026 --debug

if [ $? -eq 0 ]; then
  echo "✅ Sync succeeded, proceeding with next step..."
  # do something
else
  echo "❌ Sync failed, aborting"
  exit 1
fi
```

---

## Logging Levels

### INFO (default)
Shows high-level progress: step entry/exit, counts, timing

```bash
python3 mmr-admin/api_sync.py --event H2026
```

Output is concise and suitable for monitoring:
```
INFO - 🚀 Starting NYRR sync CLI: event=H2026, force=False
INFO - ✅ Event found: id=42, code=H2026
INFO - ⏱️  STEP 1: Starting finishers fetch...
INFO - ✅ STEP 1 complete: 500 runners fetched in 3.45s
...
```

### DEBUG
Shows all details: API calls, DB operations, batch progress, row counts

```bash
python3 mmr-admin/api_sync.py --event H2026 --debug
```

Output is verbose — use for troubleshooting:
```
DEBUG -   └─ Calling client.get_event_finishers(event_code=H2026)...
DEBUG -   └─ Progress: 100/500 finishers
DEBUG -   └─ Batch 1: 500 rows in 1.234s, total=500/500
...
```

---

## Monitoring and Automation

### Real-Time Tail

```bash
python3 mmr-admin/api_sync.py --event H2026 --debug 2>&1 | tee sync-h2026.log
```

### Cron / Scheduled Task

```bash
# /etc/cron.d/mmr-sync (run daily at 2 AM)
0 2 * * * /home/admin/mmr/run-sync.sh H2026 >> /var/log/mmr-sync.log 2>&1
```

Where `run-sync.sh`:
```bash
#!/bin/bash
set -e
cd /home/admin/mmr/trailhead
source load-env.sh
python3 mmr-admin/api_sync.py --event "$1" --debug
```

---

## Troubleshooting

### "Event not found"
**Cause:** Event code doesn't exist in `nyrr_events` table.
**Fix:** Check event code spelling, verify event is in DB via Flask admin panel.

### Database connection error
**Cause:** Azure MySQL unreachable or credentials wrong.
**Fix:** Check `DATABASE_URL` in environment, verify network connectivity.

### NYRR API error
**Cause:** API call failed (timeout, invalid credentials, rate limit).
**Fix:** Check logs with `--debug`, verify NYRR API key is set, wait before retrying.

### Slow performance (Step 3 takes >1 hour)
**Cause:** Many teams (large event) or slow DB connection.
**Fix:** Normal behavior for events with 500+ teams. Optimize DB if persistent.

---

## Integrating with Flask App

The `api_sync.py` file remains fully compatible with Flask. You can still:

1. **Import as module** (Flask routes):
   ```python
   from api_sync import sync_bp
   app.register_blueprint(sync_bp)
   ```

2. **Run as CLI** (standalone):
   ```bash
   python3 mmr-admin/api_sync.py --event H2026
   ```

Both use the same `_sync_worker()` function, so CLI and API behavior is identical.

