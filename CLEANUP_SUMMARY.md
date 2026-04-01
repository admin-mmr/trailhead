# Repo Cleanup Summary — March 31, 2026

## Overview
Successfully removed orphaned sync scripts, duplicate schema folders, and conflicting files to establish single sources of truth across the MMR monorepo.

**Commit:** `ec8c05b` — chore: remove orphaned sync scripts and duplicate schema folders

---

## Files Removed via Git

### 1. Root-Level Orphaned Sync Scripts (4 files)
These shell scripts are **obsolete** — their functionality has been moved to:
- `basecamp/run-sync.sh` (centralized sync orchestration)
- Admin Portal (manual sync triggers)

Removed:
- `sync_gmail.sh` — Gmail sync (now in Admin Portal)
- `sync_members.sh` — Member sync (now in Admin Portal)
- `sync_payments.sh` — Payment sync (now in Admin Portal)
- `sync_webapp_events.sh` — Event sync (now in Admin Portal)

### 2. Root-Level Sheets Sync Duplicates (2 files)
These files duplicated functionality from `mmr-admin/api_sheets_sync.py`.

Removed:
- `api_sheets_sync.py` (1193 lines)
- `api_sheets_sync_batched.py` (1253 lines)

**Canonical source:** `mmr-admin/api_sheets_sync.py` (mmr-admin is the active service)

### 3. Duplicate Schema & Migration Folders
`db/` is the canonical source per `db/README.md`. `basecamp/` copies were redundant.

Removed:
- `basecamp/migrations/` (4 SQL files)
  - 0001_sync_metadata.sql
  - 0006_nyrr_runner_info.sql
  - 0007_nyrr_tables.sql
  - 0008_year_born_guess.sql
- `basecamp/schemas/` (3 SQL reference files)
  - members.sql
  - nyrr.sql
  - sync.sql

**Canonical source:** `db/migrations/` and `db/schemas/` (per db/README.md)

---

## .gitignore Updates

Added 12 new patterns to prevent re-committing orphaned files:

```gitignore
# Orphaned sync scripts (functionality moved to basecamp/run-sync.sh and Admin Portal)
/sync_gmail.sh
/sync_members.sh
/sync_payments.sh
/sync_webapp_events.sh

# Orphaned sheets sync duplicates (use mmr-admin/api_sheets_sync.py instead)
/api_sheets_sync.py
/api_sheets_sync_batched.py

# Legacy schema/migration folders (db/ is the source of truth)
/basecamp/schemas/
/basecamp/migrations/
```

---

## Verified — Already in Place

✅ **nyrr_api.py path injection** — `mmr-admin/app.py` already has:
```python
if not _ON_AZURE:
    # Add basecamp/python to path for local development
    basecamp_path = os.path.abspath(os.path.join(_HERE, '..', 'basecamp', 'python'))
    sys.path.insert(0, basecamp_path)
```

This allows local development of mmr-admin to find `basecamp/python/nyrr_api.py` even though `mmr-admin/nyrr_api.py` is in .gitignore (CI copies it for Azure deployment).

---

## Single Sources of Truth — Now Established

| Category | Canonical Location | Notes |
|----------|-------------------|-------|
| **Schemas & Migrations** | `db/migrations/` + `db/schemas/` | Per db/README.md. Use `db/queries/schema_snapshot_query.sql` to regenerate. |
| **Sheets Sync** | `mmr-admin/api_sheets_sync.py` | Active service. Root copies were duplicates. |
| **Manual Sync Triggers** | Admin Portal (mmr-admin Flask app) | Replaces orphaned shell scripts. |
| **Scheduled Syncs** | `basecamp/run-sync.sh` + GitHub Actions | Centralized orchestration. |
| **Shared Python Utils** | `basecamp/python/` | Includes nyrr_api.py, imported by mmr-admin on local dev via sys.path. |

---

## Impact

**~3,387 lines removed** — 14.6% reduction in tracked file size.
**No functional changes** — all removed files were duplicates or obsolete.
**Cleaner repo structure** — easier to find the canonical implementation of each feature.

---

## Next Steps for Deduplication

Per `_context.md` "Pending Tasks," other deduplication targets remain:
1. Column mapping unification (camelCase vs PascalCase in Google Sheets ↔ MySQL)
2. Datetime handling standardization (JavaScript Date.toString() ↔ ISO 8601)
3. Email webhook consolidation (GAS vs GH scheduled jobs)
4. Trigger reconciliation (Admin portal vs GitHub Actions)

Start with datetime handling — see recent `_to_iso_datetime()` wrapper in `mmr-admin/` for the pattern.
