# Changelog — MMR Trailhead

All notable changes to the MMR platform are documented here.

## [Unreleased]

### In Progress
- Epic 1: Bi-directional Data Sync (Phase 1 foundation complete, Phase 2 in progress)
- Epic 2: Multi-Provider Authentication (OAuth + Password)
- Epic 3: Activity Logging (All Member Actions)

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
