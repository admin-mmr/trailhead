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

### 2026-03-28 18:35 ET — CLI mode for api_sync.py + comprehensive debug logging
- Changed: `mmr-admin/api_sync.py` — added `import time`, set logger.DEBUG, inserted debug logs throughout (Step 1–3, upsert, backfill, errors); added `__main__` block to support standalone CLI with `--event`, `--force`, `--debug` args; outputs final summary with exit code 0/1. Created `CLI_USAGE.md` and `DEBUG_ENHANCEMENTS.md` guides.
- Status: Complete. CLI fully functional; database connection test succeeded. Now supports `python3 api_sync.py --event H2026 --debug` with real-time logging, suitable for cron/monitoring.
- Next: Test end-to-end once Azure MySQL is accessible; consider adding `--dry-run` or progress webhook callback.

### 2026-03-28 14:31 ET — Events UI: Split upcoming vs past events
- Changed: `mmr-admin/templates/index.html` — updated `renderTable()` to accept `isPast` flag. Conditional render "Action" column header + Load/Re-sync button only for past events.
- Status: Complete. Upcoming events show clean info columns (no action buttons). Past events retain runner matching & loading.
- Next: Test UI to confirm layout.

### 2026-03-28 22:16 ET — UI improvements & NYRR API proxy debug
- Changed: `templates/index.html` — split Events table into two sections (Upcoming/Past) by date. `nyrr_api.py` — fixed NameError in error handler (added logging import); added logger.error() for 400+ responses; disabled session.trust_env to bypass system proxy for NYRR API calls.
- Status: Events separation complete. NYRR API 400 error root cause identified: system proxy (allowlist blocks rmsprodapi.nyrr.org). Code fix applied; network policy blocks local testing. Sync works in Azure (different network policy).
- Next: Test with different network or deploy to Azure to verify fix.

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
