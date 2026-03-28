# Trailhead Project Context

Last updated: 2026-03-28 16:30 ET
Last commit: pending (NYRR widget API fix)

---

## Current state

- Repo cleaned up: .gitignore, markdown conversion, review-app committed
- Web app: Next.js 14, NextAuth, Tailwind, i18n — deployable
- Photo manager: process_photos.py + bib_analyzer.py functional, review-app Flask running
- Database: Azure MySQL, schemas in db/schemas/
- NYRR viewer: Flask app, stable

## Open items

- [ ] (add open tasks here)

## Session log

<!-- Newest session first. Format: ### YYYY-MM-DD HH:MM ET — short title -->

### 2026-03-28 17:57 ET — NYRR Viewer: Final Simplified Design (Three-Step Sync)
- Changed: `db/migrations/0011_rebuild_nyrr_event_runners.sql` — simplified schema (removed `sync_source` ENUM, added `age_grade_*`). `mmr-admin/api_sync.py` — complete rewrite for three-step workflow: (1) finishers-filter paginate all runners, (2) teams/search enumerate all teams, (3) teams/teamRunners backfill team_code by bib. Single upsert path. `templates/index.html` — removed MMR/All toggle, now just "Sync all runners + teams" button.
- Status: Ready to test. Run migration 0011, deploy api_sync.py + UI. Test H2026 (30K runners, 584 teams).
- Next: Delete api_sync_old.py, run migration, test sync.

### 2026-03-28 17:18 ET — nyrr_event_runners: full schema rebuild
- Changed: `db/migrations/0011_rebuild_nyrr_event_runners.sql` — DROP + recreate with bib as dedup key, `nyrr_runner_id` NULL-able, added `city`, `sync_source ENUM('finishers','mmr_team','both')`, removed old `uq_event_runner`. `db/schemas/nyrr.sql` updated. `mmr-admin/api_sync.py` — split upsert into two SQL paths; `sync_source` transitions to `'both'` when both have run. 0010 superseded by 0011.
- Status: Must run migration 0011 (`mysql-mmr < db/migrations/0011_rebuild_nyrr_event_runners.sql`). 0010 no longer needed.
- Next: Test sync on a small event then NYC Half. Verify `sync_source='both'` for MMR runners after two-pass load.

### 2026-03-28 17:06 ET — NYRR viewer: filter debounce, dedup, pagination, cleanup
- Changed: `templates/index.html` — DB table filter debounce 400→800ms + fire on Enter/Tab; added "Clear all runners" dropdown item. `api_sync.py` — upsert deduplicates on `(event_id, bib_number)`; only `sync_source='all'` updates `nyrr_runner_id`; new `DELETE /api/events/<id>/runners` endpoint. `nyrr_api.py` — `DEFAULT_PAGE_SIZE` 51→500; added `total`-based stop condition + `progress_cb`. New migration: `db/migrations/0010_nyrr_runner_bib_unique.sql`.
- Status: Migration not yet run. Must run `mysql-mmr < db/migrations/0010_nyrr_runner_bib_unique.sql` before deploying.
- Next: Run migration, test sync on NYC Half, verify no duplicates after MMR+all sync.
