# Changelog — MMR Trailhead

All notable changes to the MMR platform are documented here.

## [Unreleased]

### In Progress
- Epic 1: Bi-directional Data Sync (Phase 1 foundation complete, Phase 2 in progress)
- Epic 2: Multi-Provider Authentication (OAuth + Password)
- Epic 3: Activity Logging (All Member Actions)

---

## [v0.3.0] — 2026-03-22

### Sync Pipeline: Production-Ready

#### Fixed
- 🐛 **Snapshot storage broken** — `_get_previous_snapshot()` was returning `None` on every run, treating every sync as "first run." Fixed by storing snapshot JSON directly in MySQL (`sync_snapshots.snapshot_data_url` column, changed from `VARCHAR(500)` → `LONGTEXT`). Change detection now works correctly.
- 🐛 **Azure Blob container missing** — `ContainerNotFound` 404 error on snapshot uploads. Root cause: `mmr-snapshots` container did not exist. Created the container; uploads now succeed.
- 🐛 **Hardcoded sync engine** — Sync script was written specifically for the `members` table; all other tables hung indefinitely. Rewrote as a generic `SheetSyncer` class that reads schema dynamically from `information_schema.COLUMNS` and works with any table.
- 🐛 **NOT NULL field crashes** — `ERROR 1364: Field 'TimeStamp' doesn't have a default value` caused INSERT failures. Fixed with new `get_required_columns()` pre-insert validation; rows with missing required fields are now skipped with a warning instead of crashing.
- 🐛 **ENUM truncation errors** — `ERROR 1265: Data truncated for column 'Source'` from invalid ENUM values. Fixed with new `validate_enum_value()` helper; `Source` column changed from `ENUM('Zelle','Venmo','Other')` → `VARCHAR(50)` for flexibility.
- 🐛 **Date parsing failures** — Sync only handled 2–3 date formats; Google Sheets sends 15+. Added comprehensive `convert_datetime_to_mysql()` with 7 parsing strategies (ISO 8601 with/without Z, Google Sheets serial numbers, JavaScript Date.toString(), named months, US slash, reverse slash) plus `python-dateutil` fallback.
- 🐛 **SMTP / Azure env vars not loading** — Special characters (`+`, `/`, `=`) in `.env.local` values were breaking shell exports. Fixed `load-env.sh` to use `set -a` / `set +a` for proper variable export.
- 🐛 **Conflict handling skipping updates** — When a row existed, sync logged a warning and skipped it without checking for field changes. Added proper upsert logic: check for changes, update if any field differs.
- 🐛 **Column name mapping with spaces** — `sync_sheets_to_mysql.py` used column names with spaces (e.g., `'First Name'`) that didn't match PascalCase Google Sheets headers. Fixed all mappings.
- 🐛 **run-sync.sh key field errors** — Key field was `TransactionID` for `gmail_transactions` but schema uses `MessageId`. Corrected all 4 table key field mappings.
- 🐛 **GitHub Actions simultaneous FK violations** — Running 4 syncs in parallel caused foreign key constraint failures. Created `sync-all-sheets-ordered.yml` with sequential `needs` chaining: `gmail_transactions → payments → payment_events → members`.

#### Added
- `ProfileLastUpdated DATETIME NULL` column in `members` table (migration v5)
- `PaymentIntent VARCHAR(100) NULL` column in `payments` table (migration v5)
- `python-dateutil>=2.8` dependency for robust date fallback parsing
- Sequential GitHub Actions workflow `.github/workflows/sync-all-sheets-ordered.yml`

#### Changed
- `Source` column in `payments`: `ENUM('Zelle','Venmo','Other')` → `VARCHAR(50) NULL`
- `sync_snapshots.snapshot_data_url`: `VARCHAR(500)` → `LONGTEXT`
- Removed `NYRRMemberID` and `NYRRMemberName` from verification script expected headers (superseded by v0.2.0 schema)

### Verification
✅ All 4 syncs operational: `gmail_transactions` (323), `payments` (97), `payment_events` (104), `members` (617)
✅ Change detection working (snapshots stored in DB)
✅ Sequential GitHub Actions workflow created

---

## [v0.2.0] — 2026-03-21

### Member Schema Refactor

#### Added
- `NYRRRunnerName VARCHAR(100)` — Member-provided name for NYRR bib lookup
- `YearBorn SMALLINT` — Birth year for age disambiguation in NYRR bib matching

#### Removed
- `NYRRMemberID` column (deprecated, no longer in Google Sheets canonical header)

#### Changed
- Renamed `NYRRMemberName` → `NYRRRunnerName` for clarity
- Updated TypeScript Member interface with new fields
- Updated database functions to handle new NYRR identification approach

### Sync Pipeline Improvements

#### Fixed
- 🐛 **Bug #1 (Critical)**: MemberID generation
  - Issue: UUID() generated 36-char strings for VARCHAR(10) column
  - Fix: Changed to MySQL stored procedure `CALL generate_member_id()`

- 🐛 **Bug #2 (Critical)**: Snapshot comparison
  - Issue: Blob data never loaded, all rows shown as "added"
  - Fix: Modified `get_last_snapshot()` to select `snapshot_data_url` and load blob content

- 🐛 **Bug #3 (Moderate)**: Sync metadata initialization
  - Issue: UPDATE matched 0 rows on first run (no pre-existing row)
  - Fix: Changed to `INSERT...ON DUPLICATE KEY UPDATE` pattern

#### Enhanced
- Expanded `column_mapping` with full canonical Google Sheets header (26 fields)
- Added `YearBorn` int coercion for proper data type handling
- Improved sync logging and error handling

### Code Quality

#### Performance
- Replaced 7 native `<img>` elements with Next.js `<Image />` component
- Files updated:
  - `app/(member)/portal/photos/references/page.tsx`
  - `app/(public)/blog/editor/page.tsx`
  - `components/editor/BlockEditor.tsx`
  - `components/photos/PhotoCard.tsx`
  - `components/photos/PhotoDetailOverlay.tsx`

#### Linting & TypeScript
- Achieved **0 ESLint warnings** (was 7 LCP warnings)
- Achieved **0 TypeScript errors**
- Fixed `'use client'` directive placement in PhotoCard.tsx
- Added ESLint suppression for editor preview `<img>` (justified use case)

### Verification
✅ `npm run typecheck` — 0 errors
✅ `npm run lint` — 0 warnings
✅ `npm run build` — successful (Full production build)

### Commits
- `eeccd71` — schema: remove NYRRMemberID, add NYRRRunnerName + YearBorn
- `2a03d61` — fix: 'use client' directive placement and ESLint suppression

### Related Documentation
- Updated `PROJECT_PLAN.md` — Added completed work section, updated timeline
- Updated `basecamp/README.md` — Documented migration v4, updated procedures

---

## [v0.1.0] — 2026-02-21

### Initial Release
- Next.js 14 member portal with OTP auth
- Google Sheets to MySQL sync pipeline
- Payment tracking (Zelle/Venmo)
- Bilingual support (EN/ZH)
- Photo album framework
- NYRR results integration

---

## Migration Guide

### From v0.1.0 to v0.2.0

**Database**:
```bash
# Apply migration v4
mysql -u mmradmin -p mmrdb < basecamp/migrations/mmr_migration_v4.sql
```

**Environment**:
- No new environment variables required
- Existing sync scripts updated automatically

**Code**:
- If referencing `member.nyrrId`, change to `member.nyrrRunnerName`
- If reading from `nyrr_id` column, change to `nyrr_runner_name`
- TypeScript types automatically updated in types/index.ts

---

## Roadmap

See [`PROJECT_PLAN.md`](PROJECT_PLAN.md) for detailed epic planning and timeline.

### Next Quarter (April-June 2026)
1. **Epic 1 Phase 2**: Activity log + bi-directional sync
2. **Epic 2**: Google OAuth + Email/Password authentication
3. **Epic 3**: Activity logging dashboard

---

## Performance Metrics

| Metric | Target | Current |
|--------|--------|---------|
| ESLint Warnings | 0 | 0 ✅ |
| TypeScript Errors | 0 | 0 ✅ |
| Build Time (dev) | < 5s | ~3s ✅ |
| Sync Latency | < 1h | (testing) |
| Member Login Success | 95%+ | (monitoring) |

---

## License

MIT — see [`LICENSE`](LICENSE)
