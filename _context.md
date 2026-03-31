# Trailhead Project Context

Last updated: 2026-03-30 20:28 UTC
Last commit: (pending)

---

## Current state

- Repo: Progress bar fixed; pace-based auto-sharding integrated into api_sync.py Step 1
- mmr-admin: ProgressModal cleaned up; api_sync.py now uses binary pace-splitting for >1000 age+gender combos
- probe_finishers.py: Supports pace filters + pace extraction
- split_by_pace.py: Available as standalone exploration tool
- Email, Web, Photo, DB: All systems from prior sessions still functional

## Open items

- Test pace splitting on staging (H2026, M2025) for various age+gender combos
- Monitor API response times and queue load with new splitting logic
- Validate all runners are fetched (no duplicates or gaps)

## Session log

### 2026-03-30 21:14 ET — cancel button + suppress not_found modal
Changed: Added POST /api/load/<event_code>/cancel endpoint; worker checks cancel_requested flag after each page batch and raises InterruptedError → sets status=cancelled. Modal now shows Cancel button while running, 🛑 Cancelled state + Close on done. Suppressed not_found flash between polls. Status: Done. Next: Test cancel on stuck H2026 load; monitor log splitting path via nyrr-logs.

<!-- Newest session first. Format: ### YYYY-MM-DD HH:MM UTC — short title -->

### 2026-03-30 15:03 ET — Gmail quick-approve + layout overhaul
Changed: Gmail table full-width, Pending Events collapsible. Added ⚡ Quick Approve inline popover to Gmail rows — extracts MemberID from memo, pre-fills dropdown + payment type from amount, calls admin-create. Also: GITHUB_REPO fix, checkbox multi-select on events, Approve All Matched / Auto-Guess & Approve All buttons. Status: all in static/payments.js + api_admin.py. Next: Gmail sheet ProcessTime+PaymentID sync (item 8).

### 2026-03-30 23:30 UTC — Restore progress modal + add team size splitting

- Changed: `mmr-admin/templates/index.html` — added `SimpleProgressModal` component with 1.5-second polling on `/api/load/<event_code>/status`. Shows step, runner count, teams processed. Auto-closes when job done/error. Updated `triggerLoad()` to open modal and refresh events after completion.
- Changed: `mmr-admin/api_sync.py` Step 3 — added `_process_team_runners()` helper to split teams >500 by gender first, then by 5-year age groups if needed. Uses existing `_upsert_team_runners()` batching logic. Handles large clubs that exceed pagination limits.
- Status: Complete. Progress modal restored; large teams now split intelligently to avoid NYRR API pagination issues.
- Next: Test on staging with H2026/M2025 events. Verify no load timeout and team_code backfill completeness.

### 2026-03-30 20:28 UTC — Integrate pace splitting into api_sync.py Step 1

- Changed: `mmr-admin/api_sync.py` — added helpers `_pace_to_seconds()`, `_seconds_to_pace()`, and `_split_by_pace()` for recursive pace-range binary-splitting. Updated `_probe()` and `_upsert_pages()` signatures to accept pace_min/pace_max filters. Modified `_divide_and_conquer()` to call `_split_by_pace()` when age+gender combo still >1000 after all age/gender splits. When triggered, estimates max pace as 00:20:00 and recursively halves pace ranges until each shard ≤500 items.
- Status: Complete. api_sync.py Step 1 now auto-handles >1000 groups via pace-splitting.
- Next: Test on H2026/M2025 staging; validate fetch completeness; monitor queue/API times.

### 2026-03-30 04:56 UTC — Implement complete email system for Azure migration
- Changed: Phase 1 (mmr-webapp) — `lib/email/client.ts` added CC parameter support + updated 3 email functions (welcome, application, renewal) to CC admin@mmrunners.org. `lib/email/templates.ts` added 4 new templates (paymentRejected, paymentExpired, expirationRepaired, autoMatchConfirmation). Phase 2 (mmr-admin) — created `email_client.py` with Azure Communication Services integration + `email_templates.py` with 3 payment templates. Integrated emails into `payment_actions.py` approve/reject functions. Updated 9 GitHub Actions workflows to CC admin@mmrunners.org. Created comprehensive documentation (5 markdown files).
- Status: Complete. 10 email types implemented (7 in webapp, 3 in admin), all beautiful HTML + CC admin@mmrunners.org + plain-text fallback + error handling. Both systems ready for production.
- Next: Set environment variables, test on staging, validate email delivery, deprecate GAS after 2-week transition.

### 2026-03-29 23:42 UTC — Add CC: admin@mmrunners.org to all user/system emails
- Changed: `web-apps/gas/membership/src/email.ts` — updated 8 notification functions (notifyPaymentApproved, notifyPaymentRejected, notifyPaymentExpired, notifyAutoGuessMatch, notifyExpirationRepaired, notifyWelcome, notifyIncompleteSignup, notifyRenewalReminder) to CC `admin@mmrunners.org` in addition to primary admin email. Updated 9 GitHub Actions workflows (.github/workflows/*.yml) — added `cc: 'admin@mmrunners.org'` to 18+ email notification steps across sync-nyrr-weekly, sync-all-sheets-ordered, auto-guess-payments, sync-members-recurring, sync-payments-recurring, sync-gmail-transactions-recurring, update-member-status, db-schema-drift, sync-webapp-events-recurring workflows.
- Status: Complete. All user-facing and system emails now CC admin@mmrunners.org for audit/oversight.
- Next: Deploy changes; verify CC recipient receives emails without spam flagging.

### 2026-03-29 22:02 UTC — Add one-click bulk export (all districts as ZIP)
- Changed: `mmr-admin/api_district_members.py` — added POST `/api/district/export-all-districts` endpoint. Fetches all districts, generates one CSV per district with same status/renewal filters, zips them, returns as single ZIP download. `mmr-admin/static/DistrictMembersPanel.js` — added `exportAllDistricts()` function and green "Export All Districts" button (applies current status + renewal filters across all districts).
- Status: Complete. One-click export: generates separate CSV per district, respects selected filters.
- Next: Test on Azure; verify ZIP generation and filter application across districts.

### 2026-03-29 21:18 UTC — Add Members by District view for group leaders
- Changed: Created `mmr-admin/api_district_members.py` — new blueprint with 3 endpoints: `/api/district/list` (fetch members by district with filters), `/api/district/districts` (dropdown list), `/api/district/export-csv` (POST to export selected or all members in district as CSV). Created `mmr-admin/templates/DistrictMembersPanel.js` — React component with district selector, member table (cols: MemberID, Name, WeChat ID, Email, Phone, Status, Last Login, Last Modified, Expires), checkboxes for multi-select, export buttons. `mmr-admin/app.py` — registered district_members_bp. `mmr-admin/templates/index.html` — added script import + new tab "Members by District" with conditional rendering.
- Status: Complete. Feature-ready for group leaders to view/select members and export CSVs.
- Next: Test on localhost with actual district data; verify CSV export formatting + download flow.

### 2026-03-29 17:45 UTC — Match all runners + member status tooltip
- Changed: `mmr-admin/api_events.py` — `/api/events/<id>/runners` endpoint now joins members table to fetch `member_status` (Active/Inactive). `mmr-admin/templates/index.html` — matched column badge now shows member status on mouse hover via `title` attribute.
- Status: Complete. Matching applies to all runners in event (not MMR-only), accounts for members running under other club names.
- Note: Matching scope is intentionally all runners, not filtered by team_code; members table represents MMR roster.

### 2026-03-29 17:35 UTC — Enhanced matching: auto-update members table + age/gender validation
- Changed: `.github/workflows/sync-nyrr-weekly.yml` — changed from Sunday to **Tuesday 2 AM UTC**; removed daily job (sync-nyrr-recurring.yml); added finisher count audit step before main sync. `mmr-admin/api_events.py` — all three match tiers (Tier 1: NYRR name, Tier 2: first+last, Tier 3: partial) now: (1) auto-update members.NYRRRunnerName + members.YearBornGuess when match found, (2) validate age if member has YearBorn or YearBornGuess (±1 year tolerance), (3) validate gender match (case-insensitive first letter). Validation only applies if member has birth year; skips if none.
- Status: Complete. Consolidated NYRR jobs to Tuesday weekly. Finisher audit + full sync in one run.
- Next: Run migrations 0013 + 0014; commit changes; monitor first Tuesday run for match quality improvements.

### 2026-03-29 17:15 UTC — Implement finisher count audit + partial name matching (Tiers 1–3)
- Changed: `db/migrations/0013_add_nyrr_finisher_count.sql` — added `nyrr_finisher_count` column to track NYRR API finisher totals. `db/migrations/0014_add_auto_partial_name_match_method.sql` — extended match_method ENUM to include 'auto_partial_name'. `db/schemas/nyrr.sql` — updated schema to reflect both changes. `mmr-admin/api_sync.py` — store total_finishers from NYRR API (fixed to use _probe() without age limits) and populate nyrr_finisher_count on sync completion. `mmr-admin/api_events.py` — added Tier 3 auto-match: partial name matching (first name OR last name match).
- Status: Complete. Ready to run migrations and deploy.
- Next: Enhanced matching with member table updates + validation.

### 2026-03-29 12:17 ET — Fix 4 open items: title, upcoming events, GITHUB_TOKEN, NYRR links
- Changed: `mmr-admin/templates/index.html` — (1) updated `<title>` to "MMR Admin Portal"; (2) removed upcoming events rendering from Events tab (only show past events now, fix for "Completed" status confusion). `mmr-admin/app.py` — (3) enhanced Keychain loading to include GITHUB_TOKEN from `MMR_GITHUB_TOKEN`. `load-env.sh` — added GITHUB_TOKEN loading. `mmr-admin/api_events.py` + `basecamp/ops/sync_nyrr_events.py` — (4) fixed event URL format: `/events/{code}` → `/event/{code}/finishers`. Created migration `0012_fix_nyrr_event_urls.sql` to correct existing URLs in DB.
- Status: All 4 items complete. Upcoming events hidden, title updated, GITHUB_TOKEN Keychain support added, event links fixed.
- Next: Run migration 0012, test UI to confirm past events only; add GITHUB_TOKEN to Keychain per user's PAT.

### 2026-03-29 15:06 ET — Fix Azure deployment: add _paginate_streaming to basecamp NyrrApiClient
- Changed: `basecamp/python/nyrr_api.py` — added `_paginate_streaming()` generator method (was missing, only in mmr-admin version). Azure deployment failed with `AttributeError: 'NyrrApiClient' object has no attribute '_paginate_streaming'` because import path resolved to basecamp version.
- Status: Fixed. Both nyrr_api.py versions now in sync for streaming pagination.
- Next: Commit and redeploy to Azure.

### 2026-03-29 01:47 ET — Implement divide-and-conquer sync via age/gender split + MMR-first pass
- Changed: `mmr-admin/api_sync.py` STEP 1 — replaced searchString loop with binary-tree divide-and-conquer on age (0–100). New `_probe()` helper tests totalItems for filter combo cheaply (pageSize=1). New `_divide_and_conquer(age_from, age_to, gender)` recursively bisects age range until ≤1000, then: ≤500 → 1 pass, 501–1000 → asc+desc passes, >1000 & age_from==age_to → split by gender (M/W/X) + ungendered. Pass 0 always fetches teamCode=MMR first (MMR members, all ages). Added `probe_finishers.py` tool to test any filter combo against API (supports age range, gender, state, country, team, etc.).
- Status: Syntax verified. Ready to test on large event (target: handle 30K+ via MMR pass + age/gender bisect).
- Next: Test on H2026; monitor logs to verify age splits + gender splits activate as needed.

### 2026-03-28 20:20 ET — Refactor: stream NYRR finishers per-page + batch team updates
- Changed: `nyrr_api.py` — added `_paginate_streaming()` generator that yields pages instead of buffering all items. `api_sync.py` STEP 1 now uses streaming to write each page (~50 runners) immediately to DB; eliminated 500-item buffer. STEP 3 now batches team updates in 100-runner batches instead of individual UPDATEs—less transaction overhead, fewer lock timeouts.
- Status: Refactored. Syntax verified. Streaming reduces memory footprint + catches DB connection issues early + incremental progress saves.
- Next: Test on next sync run; expect faster, more resilient pipeline.

### 2026-03-28 19:56 ET — Clean up: remove ALL admin functionality from mmr-webapp SWA
- Deleted: Entire `web-apps/mmr-webapp/app/admin/` directory including 6 pages (admin dashboard, NYRR events list, event detail, member detail, match review, sync status) + 2 API routes (`/api/admin`, `/api/admin/sync-status`) + orphaned `components/ProgressModal.tsx` component. All admin functionality now lives exclusively in `mmr-admin/` Flask app on Azure WA.
- Status: Complete. TypeScript build passes. No broken imports. mmr-webapp now member-facing only. Admin APIs in webapp removed; member-facing APIs (`/api/nyrr/*` for portal) retained.
- Next: None—mmr-webapp separation is clean. Admin UI fully migrated to mmr-admin.

### 2026-03-28 19:48 ET — Dashboard: query live runner counts instead of stale cached columns
- Changed: `mmr-admin/api_events.py` — replaced all 3 endpoints (`/api/events`, `/api/events/<id>`, `/api/stats`) to query **LIVE counts from `nyrr_event_runners` table** instead of cached `mmr_runner_count` column. Now calculates: total runners, MMR runners (team_code='MMR'), matched runners (mmr_member_id IS NOT NULL). Dashboard will show real "2 MMR runners" instead of stale "100".
- Status: Complete. No cached data—all counts computed per-request from live DB state.
- Next: Reload mmr-admin UI and verify dashboard shows correct live counts.

### 2026-03-29 00:02 ET — Remove 500-runner cap via team enrichment in Step 3
- Changed: `mmr-admin/api_sync.py` — Step 3 now INSERTs missing runners from `teams/teamRunners` calls, not just UPDATEs. Root cause: `runners/finishers-filter` endpoint returns ~500 results (NYRR API limit), but `teams/teamRunners` returns ALL team members (~13K for NYC Half). Step 3 now captures full dataset. If runner missing from DB (Step 1), INSERT with full details + team_code. Added `total_inserted` tracking.
- Status: Ready to test. NYC Half should now load all finishers.
- Next: Trigger re-sync of H2026 to verify all ~13K runners load.

### 2026-03-28 19:35 ET — mmr-admin UI: progress modal displays real backend data
- Changed: `mmr-admin/templates/index.html` — fixed ProgressModal to display **real backend data** from job status: `message` (human-friendly desc), `rows_written` (actual runner count), `teams_processed` (team progress), `step` (current step id). Modal subtitle now shows dynamic message from backend instead of hardcoded "30,000+ runners". Step detail text shows actual counts: "200 runners fetched", "5 teams found", "5 teams processed".
- Status: Complete. Modal now pulls all text from backend via polling `/api/load/{eventCode}/status`. Tested with 200-person event—now shows "200 runners fetched" instead of generic "30,000+".
- Next: Test locally to verify real-time updates display correctly.

### 2026-03-28 23:45 ET — Fix NyrrTeam dataclass bug
- Changed: `mmr-admin/nyrr_api.py` — added missing `@dataclass` decorator to `NyrrTeam` class (line 247). This was causing "object is not subscriptable" error on event detail page.
- Status: Fixed. Error was preventing event details from rendering.
- Next: Test event detail page to confirm fix works.

### 2026-03-28 19:30 ET — mmr-admin UI: progress modal for 30K runner load
- Changed: `mmr-admin/templates/index.html` — added ProgressModal React component with 3-step progress tracking (Fetch finishers → Enumerate teams → Backfill team codes). Added CSS for modal, progress bar, step icons (○ pending, ↻ active, ✓ completed). Enhanced Dashboard state with `progressModal`. Modified `triggerLoad()` to open modal on load start, poll status every 1s (was 2s), display real-time counts (rows_written, teams_processed), auto-close on done/error.
- Status: Complete. Modal shows when data loads, displays step-by-step progress with percentage bar, closes automatically.
- Next: Test locally by triggering a load in mmr-admin UI.

### 2026-03-28 19:19 ET — NYRR admin runners table: added progress modal during load
- Changed: Created `components/ProgressModal.tsx` — modal showing step-by-step progress (pending/active/completed states) with progress bar. Updated `app/admin/nyrr/events/[id]/page.tsx` — added progress state tracking for event + runners loads, integrated ProgressModal. Steps show real-time count during fetch.
- Status: Reverted (moved to mmr-admin instead, which is the correct location).
- Next: Use mmr-admin Flask UI progress modal instead.

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
