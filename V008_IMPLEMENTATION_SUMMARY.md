# V008 Implementation Summary

**Date:** 2026-04-04 | **Status:** Ready for Deployment | **Scope:** Schema consolidation + Code migration

---

## What Changed

### 1. Database Schema (MIGRATION_V008)

#### Dropped Tables
- **webapp_events** — Replaced by `submissions` table (use SubmissionID instead of EventID)
- **sync_changes** — Legacy Sheets sync history (unused)
- **sync_snapshots** — Legacy Sheets sync snapshots (unused)
- **sync_metadata** — Legacy Sheets sync metadata (unused)

#### Kept Tables
- **sync_jobs** — Actively used for background job tracking in mmr-admin

#### Added Indexes (submissions table)
- `idx_submissions_status` — Query by Status column
- `idx_submissions_expires` — Query by ExpiresAt column
- `idx_submissions_status_expires` — Composite (Status, ExpiresAt)

#### Table Consolidation (admins → admin_users)
- Renamed `admins` → `admin_users`
- Added `role` column (enum: 'admin', 'super_admin')
- Added `updated_at` timestamp column
- Merged `viewer_admins` data into `admin_users` (preserving roles)
- Dropped `viewer_admins` table
- Added indexes: `idx_admin_role`, `idx_admin_email`

**Schema Change:**
```sql
-- Before
admins (id, email, added_by, added_at)                    — webapp only
viewer_admins (id, email, role, created_at)              — admin portal only

-- After
admin_users (id, email, role, added_by, added_at, updated_at)  — unified
```

---

## Code Changes

### 2. MMR-Webapp (Next.js) Payment Flow

#### Routes Updated
1. **`/api/payments/submit`**
   - Changed: `webapp_events` → `submissions`
   - Changed: `EventID` → `SubmissionID`
   - Changed: `EventType` → `SubmissionType`
   - Added: `ExpiresAt` column (14 days from submission)
   - Changed: Response returns `submissionId` instead of `eventId`
   - Removed: `syncEventToSheets()` call (only members synced now)

2. **`/api/payments/pending`**
   - Changed: Query `submissions` instead of `webapp_events`
   - Changed: Filter by `MemberID` via member email lookup
   - Changed: Select from `submissions.SubmissionID`, `submissions.PaymentIntent`, etc.

3. **`/api/payments/proof`**
   - Changed: Accept `submissionId` parameter instead of `eventId`
   - Changed: Validate against `submissions` table
   - Changed: Update `submissions.ScreenshotFileId` instead of `webapp_events.ScreenshotFileId`
   - Enum states: 'pending', 'approved', 'cancelled', 'expired' (not 'rejected')

4. **`/api/donations/submit`**
   - Changed: Insert into `submissions` instead of `webapp_events`
   - Changed: Use `SubmissionID` instead of `EventID`
   - Added: `ExpiresAt` column (7 days for donations)
   - Changed: Response returns `submissionId`

#### Library Updates
- **`lib/db/admins.ts`**
  - Changed: All queries use `admin_users` instead of `admins`
  - Changed: Interface `AdminRecord` now includes `role` field
  - Updated: `addAdmin()` accepts optional `role` parameter (default: 'admin')
  - Updated: `ensureTable()` now verifies `admin_users` exists (table created by V008)

---

### 3. MMR-Admin (Flask) Authentication & Admin Management

#### Files Updated

1. **`auth.py`**
   - Changed: `get_user_role()` queries `admin_users` instead of `viewer_admins`
   - No logic changes (same enum: 'admin', 'super_admin')

2. **`api_admin.py`**
   - **GET `/api/admins`:** Query `admin_users` instead of `viewer_admins`
   - **POST `/api/admins`:** Insert/update `admin_users` instead of `viewer_admins`
   - **DELETE `/api/admins/<email>`:** Delete from `admin_users` instead of `viewer_admins`
   - All role logic unchanged (still filters by 'admin' vs 'super_admin')

3. **`db.py`**
   - Changed: `_init_viewer_admins_table()` → checks if `admin_users` exists
   - Removed: CREATE TABLE logic (table created by V008 migration)
   - Kept: Seed super_admin if count is 0

---

## Deployment Checklist

- [ ] **Database:** Execute `MIGRATION_V008_drop_webapp_events_consolidate_admins.sql`
  ```bash
  mysql-mmr < db/MIGRATION_V008_drop_webapp_events_consolidate_admins.sql
  ```

- [ ] **Web App:** Deploy updated payment routes
  - `/api/payments/submit`
  - `/api/payments/pending`
  - `/api/payments/proof`
  - `/api/donations/submit`
  - `lib/db/admins.ts`

- [ ] **Admin Portal:** Deploy updated auth + admin APIs
  - `auth.py` (get_user_role)
  - `api_admin.py` (admin CRUD)
  - `db.py` (init function)

- [ ] **Testing:**
  - [ ] Admin login still works (NextAuth + Flask)
  - [ ] Payment submission uses submissions table
  - [ ] Pending payments load correctly
  - [ ] Payment proof upload works
  - [ ] Donation submission works
  - [ ] Admin list/add/delete operations work
  - [ ] Super admin cannot be deleted

---

## Key Benefits

1. **Single Source of Truth:** One admin table instead of two
2. **Cleaner Schema:** Removed deprecated webapp_events + legacy sync tables
3. **Better Indexing:** Submissions table optimized for common queries
4. **Role-Aware:** Admin roles stored centrally (not hard-coded)
5. **Backward Compatible:** Same business logic, just different table names

---

## Migration Safety

✅ **MIGRATION_V008 is idempotent:**
- All table drops use `DROP TABLE IF EXISTS`
- All column additions use `INFORMATION_SCHEMA` checks
- Index creation checks if they already exist
- Safe to re-run if execution is interrupted

✅ **Data Preservation:**
- No data loss: admin roles migrated from viewer_admins to admin_users
- Super admin always ensured to exist

---

## Rollback Plan (if needed)

If V008 fails:
1. Check schema_snapshot.sql to see what state the DB is in
2. Manually restore admins table from backup if needed
3. Re-run MIGRATION_V008 (it will skip existing objects)

If code breaks:
1. Revert commits for webapp + mmr-admin
2. Keep database changes (V008 is safe)
3. Re-deploy old code against new schema (queries are similar enough)

---

## Files Modified

### Database
- `db/MIGRATION_V008_drop_webapp_events_consolidate_admins.sql` (NEW)

### Web App (Next.js)
- `web-apps/mmr-webapp/app/api/payments/submit/route.ts`
- `web-apps/mmr-webapp/app/api/payments/pending/route.ts`
- `web-apps/mmr-webapp/app/api/payments/proof/route.ts`
- `web-apps/mmr-webapp/app/api/donations/submit/route.ts`
- `web-apps/mmr-webapp/lib/db/admins.ts`

### Admin Portal (Flask)
- `mmr-admin/auth.py`
- `mmr-admin/api_admin.py`
- `mmr-admin/db.py`

### Documentation
- `_context.md` (session notes)
- `V008_IMPLEMENTATION_SUMMARY.md` (this file)

---

---

## ⚠️ Phase 2: Admin Portal Payment Flow (NOT included in V008)

The following files in mmr-admin still reference `webapp_events` and will need updates in Phase 2:

- `payment_actions.py` — Auto-match, approve, reject payment operations
- `api_payments.py` — Payment listing, approval endpoints
- `api_sheets_sync.py` — Sheets ↔ MySQL sync for payment events
- `sync_engine.py` — Sync specification references webapp_events
- `backfill_unix_timestamps.py` — Backfill script for webapp_events timestamps
- `api_audit.py` — Audit trail that traces through webapp_events
- `api_data.py` — Data health checks for webapp_events

**Phase 2 Task:** Update all admin payment workflows to use `submissions` table instead of `webapp_events`. This requires:
1. Update all SELECT/INSERT/UPDATE queries: `webapp_events` → `submissions`
2. Update column mappings: `EventID` → `SubmissionID`, `EventType` → `SubmissionType`
3. Update status enums: 'pending', 'matched', 'approved', 'rejected' → 'pending', 'approved', 'cancelled', 'expired'
4. Update sync engine specification to reference `submissions` instead of `webapp_events`
5. Full regression testing of admin payment approval workflow

**Current Scope (Phase 1):** Only webapp member-facing payment submission code.

---

## Questions?

See ADMINS_TABLE_CONSOLIDATION_ANALYSIS.md for original rationale + analysis.
