# Claude Project Instructions for Trailhead

**Repo:** MMR Trailhead — multi-service monorepo (running club management system).
**Services:** `web-apps/mmr-webapp/` (Next.js+Auth), `photo-manager/` (Python+Flask), `basecamp/` (Sheets sync), `db/` (MySQL), `mmr-admin/` (Flask admin).
**Stack:** Frontend: Next.js 14+, TypeScript, Tailwind, NextAuth | Backend: Python 3.9+, Flask, pandas, cv2, dlib | DB: MySQL 5.7+ (Azure) | APIs: Sheets, Drive, NYRR | Deploy: Azure Static Web Apps, GitHub Actions.

**⚠️ MySQL 5.7+ constraint:** No `IF NOT EXISTS` in ALTER TABLE, CREATE INDEX; no multi-clause ALTERs. Use simple single-operation statements only. Check INFORMATION_SCHEMA before conditional ops.

**_context.md:** Format: `### MM-DD HH:MM UTC — title` + 3 lines max (`Changed: X. Status: Y. Next: Z.`). Insert at top (newest first). Trim to 3 sessions; move excess to `_context_archive.md`.
## ROLE: Code architect for this monorepo
- Review code, debug (GitHub Actions, deployments, configs), design schemas/APIs, optimize Python pipelines, refactor.
- **Do NOT:** `git push`, commit without explicit request, destructive git ops, unvetted architectural suggestions.

## WORKING STYLE
- **Before major work:** Clarify ambiguities → AskUserQuestion + TodoWrite + read SKILL.md files.
- **Code reviews:** Strengths + issues + diffs. **Debugging:** Error message first → git status/log → config → test.
- **File creation:** Save to `/sessions/zen-vibrant-galileo/mnt/trailhead/` (workspace). No standalone .md docs; update CLAUDE.md or _context.md instead. **NEVER create standalone docs automatically—ask first.**

## CODE HEALTH
**Hard rule:** Flag files >400 lines (Python >400, TS/React >300, SQL >200). At task end: `📏 file.py is now N lines — recommend splitting. Want me to do it?` Then split with todo list + test via `test_imports.py`.
**Naming:** `api_<domain>.py` (routes), `helpers.py`/`db.py` (utils). Thin orchestrator (`app.py`).

## SHARED PYTHON MODULES
Edit in `basecamp/python/` FIRST (source of truth): `sync_engine.py`, `nyrr_api.py`. CI auto-copies to `mmr-admin/`. Local: sync via `./scripts/sync-shared-modules.sh`, test via `python3 mmr-admin/test_imports.py`, commit source file.

## ENV & SECRETS
**macOS Keychain only** (not `.env`). Retrieve: `security find-generic-password -s <service> -w`. Run Python: `source load-env.sh && python3 script.py`. Debug: check Keychain entry exists before creating .env files.

## BUILD VERIFICATION
Run: `npm run build 2>&1 | tail -n 50`. Announce attempt → Show raw error (not paraphrased) + diagnosis + fix. Apply → retest. **Max 5 attempts:** Print summary table, then ask "How to proceed?"

## SHEETS SYNC ARCHITECTURE (04-04 cleanup complete)
**Current Implementation:** Batched UPSERT via `sync_config.py` + `sync_engine.py` (source of truth in `basecamp/python/`).
- Routes: `api_sheets_sync_routes.py` (Flask endpoints, `/api/sync/*`)
- Job management: `sync_jobs.py` (in-memory + MySQL fallback for persistence)
- Runners: `sync_runners.py` (6 export/import operations + full_sync orchestration)
- GAS integration: `api_sheets_diags.py` (webhook wrapper with retry logic)

**MySQL Procedures (all active):**
- `generate_member_id()` — Auto-generate sequential IDs on member create
- `sp_admin_update_member_status()` — Admin override with audit trail
- `sp_error_summary_report(days_back)` — Error dashboard trends
- `sp_link_transaction(tx, memberID, type, amount, submissionID)` — Creates payment + updates gmail_transactions (5 params, no admin)

## PAYMENT API (api_payments.py) — REBUILT 04-04
**Architecture:** Pure MySQL, no Sheets sync. Three action modes: autoguess, manual approval, admin operations.
- `GET /api/payments/dashboard` — Counts (pending submissions, unmatched gmail, approved/rejected/errors)
- `GET /api/payments/pending-submissions` — List pending submissions (with search)
- `GET /api/payments/unmatched-gmail` — List unmatched Gmail transactions
- `POST /api/payments/autoguess-all` — Scan unmatched → attempt auto-match (membership renewal logic)
- `POST /api/payments/manual-approve` — Admin picks memberID + gmail_tx → create payment
- `GET /api/payments/submissions-for-member/<memberID>` — Pending submissions for member
- `GET /api/payments/gmail-matching-candidates/<memberID>` — Filtered gmail matches by name
- `GET /api/payments/search-members?q=` — Search members by name/email/ID

**Autoguess Logic:**
1. Extract memberID from gmail memo (regex: `\bA\d{4}\b`)
2. If found: Check renewal period (config table) + amount matches ($30 indiv, $50 family) + pending membership submission exists
3. If no memberID: Try partial name match against all pending membership submissions
4. Create payment via `sp_link_transaction(tx, memberID, 'Membership', amount, submissionID|NULL)`
5. Triggers auto-update: members (status→active, expiration+1yr), submissions (status→approved), gmail_transactions (notes synced)

**Manual Approval:** Admin enters memberID + select gmail_tx → create payment with auto-linked submission (if pending membership exists)

**Renewal Period:** Stored in config table (`renewal_start_date`, `renewal_end_date`). Set before running autoguess.

**Batch Sizing:** BATCH_SIZE=300 (MySQL inserts, GAS API calls). Configurable in `sync_config.py` line 26.

## STRIPE PAYMENTS (webapp) — shipped 07-20, TEST MODE
**Flow:** `/join` + `/donate` card option → `POST /api/payments/stripe/checkout` (amount from config: `IndividualPrice`/`FamilyPrice`/`FamilyUpgradePrice`; donations from submission) → hosted Checkout → `POST /api/payments/stripe/webhook` (signature-verified) → `stripe_events` idempotency guard → `gmail_transactions` ledger row (`TransactionNumber`=payment_intent) → `sp_link_transaction` (anonymous donations: direct `payments` insert) — one DB transaction.
**Test vs live (V035):** mode = Stripe `event.livemode`, stamped everywhere: `PaymentMethod` = `'Stripe'` (live) vs `'Stripe (TEST)'`, memo prefixed `TEST —`, `stripe_events.livemode` 1/0. Reports/reconciliation MUST filter `PaymentMethod != 'Stripe (TEST)'` — use `payment_helpers.exclude_test_payments(alias)` in Python (wired into `api_sync_membership`, `api_audit_members`); `sp_reconcile_member_payments` + `sp_renewal_audit` filter it in SQL as of V036. Per-transaction lookups (`payment_matching`, autoguess, listings) deliberately do NOT filter — they resolve a specific tx and the admin panels label the mode. Members see amber test-mode banner (driven by `GET /api/payments/stripe/mode` ← key prefix) on join/donate/success pages — disappears automatically with live keys.
**Fulfillment emails (07-29):** webhook calls `lib/payments/fulfillment-email.ts` AFTER commit — new member (active, no `password_hash`/`google_sub`/`microsoft_sub`) → welcome email w/ member ID + expiration + receipt + **Set My Password** link (`/auth/forgot-password?email=…`, deliberately tokenless: welcome mail CCs admin@mmrunners.org); renewal/upgrade + donations → `sendPaymentConfirmationEmail`. Never throws — a mail failure must not 500 the webhook and make Stripe retry a banked payment. Test-mode money gets a `[TEST]` subject prefix + amber in-email banner. ⚠️ Email dates MUST go through `formatLongDate()` (lib/date.ts) — `new Date('2027-03-31')` is UTC midnight and renders a day early west of Greenwich.
**Fulfillment gate:** test events are acknowledged but IGNORED (`stripe_events.status='ignored_test_mode'`) unless SWA setting `STRIPE_ALLOW_TEST_FULFILLMENT=1` (pilot only — REMOVE at go-live).
**Go-live runbook:** 1) Stripe dashboard → live mode → create webhook endpoint for `checkout.session.completed` at `<site>/api/payments/stripe/webhook` → copy live `whsec_`. 2) `az staticwebapp appsettings set --name mmr-webapp --resource-group mmr-resources --setting-names STRIPE_SECRET_KEY=<real sk_live_ value> STRIPE_WEBHOOK_SECRET=<real whsec_ value>` — ⚠️ paste the ACTUAL values; the `…` placeholders in this runbook have twice been pasted literally into Azure (07-28 `sk_live_?`, 07-29 7-char `whsec_…`), which silently breaks signature verification with no error until a real payment fails. After setting, re-read with `az staticwebapp appsettings list` and check the value LENGTHS (sk ≈107, whsec ≈38+). 3) `az staticwebapp appsettings delete --name mmr-webapp --resource-group mmr-resources --setting-names STRIPE_ALLOW_TEST_FULFILLMENT` 4) Verify `GET /api/payments/stripe/mode` returns `{"testMode":false}` and banner is gone. Local dev keys in Keychain: `MMR_STRIPE_SECRET_KEY`/`MMR_STRIPE_WEBHOOK_SECRET` (see `start-dev.sh`).

## COMMON TASKS
**GitHub Actions:** Check `.github/workflows/` + `git status/diff/log` → identify issues → suggest fixes + commit.
**Photo Manager:** Check `process_photos.py`/`bib_analyzer.py` → data flow (Drive → download → process → output.json → Blob) → optimize.
**Database:** `db/schema_snapshot.sql` = source of truth. **Migrations MUST use `MIGRATION_V*.sql` format.** ⚠️ They do NOT auto-run on push — `run-db-migrations.yml` has its push trigger commented out and is `workflow_dispatch`-only. Merging a PR deploys the code but NOT the SQL. Apply explicitly: `gh workflow run run-db-migrations.yml --ref main -f migration_version=V###` (the run then archives the file to `db/archive/` and pushes a `[skip ci]` commit), or run it locally via `mysql-mmr`. Verify against the DB afterward — never trust the workflow's exit code alone. **`db/schema_snapshot.sql` goes stale the moment a migration lands** — regenerate via `/api/export-schema`. Rename any `MIGRATION_*.sql` files that don't match pattern. Use `mysql-mmr` alias. Schema export via `/api/export-schema` endpoint. **CRITICAL:** Each migration MUST END with self-registration in schema_migrations table: `INSERT INTO schema_migrations (version, description, executed_at) VALUES ('V###', 'description', NOW()) ON DUPLICATE KEY UPDATE executed_at=NOW();` (ensures audit trail + prevents re-runs). **MIGRATION NUMBERING HARD RULE:** Migration files are deleted after deploy, so the filesystem is NOT reliable. Before creating any migration file, query the DB: `mysql-mmr -e "SELECT version FROM schema_migrations ORDER BY executed_at DESC LIMIT 5;"` — this is the only source of truth. New file MUST be `max + 1`. Never rely on CLAUDE.md action-plan numbers or `ls db/MIGRATION_*.sql` — both go stale.
**Web App:** `web-apps/mmr-webapp/` (Next.js) → review TS types, API routes, UI, NextAuth, i18n.

## DATABASE SCHEMA & VALIDATION
**Schema Validation Tools:**
- `validate_schema.py`: Automated validator detects NULL violations, FK orphans, ENUM mismatches, missing PKs, duplicate uniques. Run: `python3 db/validate_schema.py`

**Error Messaging System:** V007 + V008 deployed. `error_context` table, 3 validation triggers, 10 CHECK constraints, `v_unresolved_errors` view, `sp_error_summary_report(days)` procedure.

**Monitoring & Debugging:**
```sql
SELECT * FROM v_unresolved_errors;  -- Unresolved errors (priority-sorted)
CALL sp_error_summary_report(7);    -- Error trends (last 7 days)
SELECT Severity, COUNT(*) FROM error_context WHERE DetectedAt > NOW() - INTERVAL 24 HOUR GROUP BY Severity;
```

## MMR ADMIN UI — ARCHITECTURE
**Tabs:** 1. Payments | 2. Members (Members, Members by District, 🔍 Renewal Audit) | 3. Sync with Google | 4. Admins (Admins, Sync Log, Python Exec, Data Query) | 5. Data Browser | 6. NYRR Todos

**Components** (`mmr-admin/templates/`): `dashboard-panel.html`, `python-code-editor.html`, `python-exec-panel.html`, `table-browser.html`, `match-modal.html`, `admin-panel.html`, `settings-panel.html`, `sync-panel.html`, `processing-log.html` + `styles.css` (static/).

**File pattern:** Components use `initComponent('Name', () => { ... })` via `/static/component-loader.js`. React hooks exported globally — no redeclaration needed. CSS: `<link rel="stylesheet" href="/static/styles.css">`. Components rendered via `window.Component && React.createElement(window.Component, props)`.

## NYRR SYNC — KEY FILES (all bugs resolved 2026-05-25)
- `sync_worker.py` (344 LOC) + `sync_worker_fetch.py` (FinisherFetcher, pace bisection with `pace_min`/`pace_max`) + `sync_worker_backfill.py` (TeamBackfiller) + `sync_worker_reconcile.py` (slug→canonical + `event_url` fix)
- `basecamp/ops/sync_nyrr_reconcile.py` — `reconcile_slug_event_codes()`, also wired as `POST /api/discover/reconcile-slugs` and daily/weekly pipeline steps
- `api_events.py` (398 LOC) — 3-tier matcher; gender normalized M/W/X→Male/Female/Other; Tier 3 requires birth year; `_backfill_member_name_and_year()` helper
- `fuzzy_worker.py` + `api_events_fuzzy.py` — Tier 4 background thread (`POST /api/events/<id>/fuzzy-match`, `GET /status`)
- `api_events_discovery.py` — scans current + prior year via `year=` kwarg

## ACTION PLAN (active — July 2026)
Sequenced backlog. P0=operational (this week), P1=features remaining, P2=code health.
Shipped since May plan (all on main): P1a staleness gate, P1b duplicate detection, P1c match queue + Tier-4 fuzzy, P1e mmr-only backfill (V029 `load_mode`, `run_backfill_mmr_only`), P1f HOF backend (`api_hof.py`), P1g HOF admin tab (`hof-panel.html`). Also: security audit (auth gaps/SQLi/secrets, `test_auth_matrix.py`), Payments Gmail auto-import on load, in-app NYRR scheduler (`nyrr_scheduler.py` replaces deleted `sync-nyrr-weekly.yml` workflow), pytest suite repaired (1348 pass / 0 fail).

**P0 — Operational** (ALL DONE 07-18)
1. ~~Scheduler flag~~ DONE 07-18: `ENABLE_NYRR_SCHEDULER=1` set on `mmr-nyrr-viewer`; logs confirm `[scheduler] started — discovery '0 6 1 * *', finisher '0 2 * * 2'` (discovery: 1st of month 06:00 UTC; finishers: Tue 02:00 UTC).
2. ~~Payments auto-import browser test~~ DONE 07-18: verified live on prod — auto-runs once per load, banner clears.
3. ~~Repo-root `.venv`~~ DONE 07-18: recreated; `mmr` alias works again.
4. ~~Stray root docs~~ RESOLVED 07-18: all three kept as sanctioned standing docs (see Docs discipline).
5. ~~Verify V031~~ DONE 07-18: confirmed via Data Query — V031 applied 2026-05-28; current latest migration is **V032** (nyrr_event_series FK). Next migration = V033.

**P1i — CI test gate — ✅ DONE (shipped across PRs #9–#13 + coverage ratchet)**
- `.github/workflows/ci.yml` runs on push/PR: pytest `mmr-admin/tests` (+ import parity), jest `web-apps/mmr-webapp`, jest `web-apps/gas/membership`, eslint `mmr-admin/static/`. Green.
- SWA deploy (`azure-static-web-apps-orange-tree-…yml`) push-triggered w/ `web-apps/mmr-webapp/**` path filter, gated by jest+typecheck test_job. `db-sql-lint.yml` push/PR on `db/**`. `web-apps/.husky/pre-commit` runs `lint && npm test && build`.
- Coverage ratchet: pytest `--cov-fail-under=48` (baseline ~52%, synced basecamp copies omitted via `mmr-admin/.coveragerc`); jest `coverageThreshold` in `jest.config.ts` (stmts/lines 30, branches 75, funcs 43 — baseline 33/79/47). CI runs `pytest --cov` and `npm test -- --coverage`. GAS: `collectCoverage`+`coverageThreshold` in `web-apps/gas/membership/jest.config.js` (stmts/funcs/lines 35, branches 25; baseline 39/39/39/29) — enforced via the existing `npm test` CI step, no workflow edit. **Raise all floors as coverage improves.**

**P1j — Tests where money & members live (~2-3 days)**
- Webapp API route tests (all 41 `app/api/**/route.ts` handlers untested): `payments/submit`, `donations/submit`, `members/enroll`, `members/register`, auth reset flows — contract tests with mocked mysql2 pool.
- Shared `withApiHandler` wrapper mapping thrown `err.status` → 401/403: ~12 photo/bib routes have no try/catch, so `requireActiveMember()` throws surface as 500s. One wrapper + mechanical adoption + test.
- Flask: dedicated tests for `api_payments_{actions,listings,lookups,debug}` (autoguess criteria matrix, manual-approve orphan patching).
- ESLint over `mmr-admin/static/` (33 JS files, zero lint/test infra) wired into CI; unit tests deferred until P2 splits.

**P1k — Stripe membership payments (~4-5 days) — approved 07-18**
All Stripe code lives in the Next.js webapp (owns `/join`, direct MySQL; Flask has no public-endpoint infra). Flask admin unchanged — Stripe payments surface in existing panels automatically. Key insight: every payments insert is validated against a `gmail_transactions` row (`sp_link_transaction` + `trg_payments_auto_fill`), and `trg_payments_sync_membership_only` handles the full activation cascade — so Stripe writes a ledger row and reuses the proc.
1. Migration (query `schema_migrations` for next number first — hard rule): `stripe_events` idempotency table (`event_id` PK, `payment_intent_id`, `status`, `payload_hash`, `processed_at`) + config keys `IndividualPrice=30`, `FamilyPrice=50`, `FamilyUpgradePrice=20`. Self-registering INSERT at end.
2. Pricing consolidation: `payment_matching.py:~380` + `api_payments_debug.py:~93` hardcode $30/$50 — point both at config table (fallback to literals); webapp reads same keys server-side.
3. `POST /api/payments/stripe/checkout` — Stripe Checkout Session (price from config, `metadata: {memberID, submissionID, plan}`); "Pay by card" option in `/join` step 3 (Zelle/Venmo unchanged). Server recomputes amount.
4. `POST /api/payments/stripe/webhook` — raw-body signature verify; `checkout.session.completed` → idempotency check vs `stripe_events` → verify `amount_total` vs config → insert `gmail_transactions` row (`TransactionNumber`=PaymentIntent id, `PaymentMethod='Stripe'`, `MessageId`=event id) → `CALL sp_link_transaction(...)`. Triggers approve submission + activate member/family.
5. UX: success returns to `/join` done-step polling `/api/members/me` for `status='active'`; cancel returns to payment step with Zelle fallback.
6. Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (Keychain local, Azure SWA settings prod). No publishable key needed — hosted Checkout is a server-side redirect, so `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is referenced nowhere in the webapp (verified 07-29).
7. Tests: signature rejection, duplicate-event idempotency, amount-mismatch rejection, checkout amount derivation; one testcontainers integration test (synthetic Stripe ledger row + `sp_link_transaction` activates pending member). `stripe listen` for local manual verify.

**P1L — Member portal: NYRR calendar + RSVP, race photos link, My Results (~4-5 sessions) — planned 07-29**
Product decisions (07-29): RSVP roster is **shared** (all members see who's running/volunteering, with a per-member opt-out); calendar is **NYRR events only** (no club_events table this round); gallery URL lives in the **config table** (admin-editable, not an env var).
Ground truth already in place — do NOT rebuild: `members.NYRRRunnerName` + `members.YearBorn` columns exist (exactly the two fields the link form collects); `nyrr_event_runners.mmr_member_id` + `match_method` enum already contains `'manual'` (no enum change → no migration for linking); `nyrr_events` has `event_date`/`is_upcoming`/`distance_km`/`event_url`. Both target pages are placeholders today: `app/(member)/portal/events/page.tsx` (32 LOC "coming soon") and `app/(member)/portal/nyrr/page.tsx` (28 LOC). `portal/nyrr/NyrrClient.tsx` (232 LOC) is **orphaned** — imported nowhere; repurpose it in Phase 4 or delete it, don't leave it. All 13 existing `/api/nyrr/*` routes are `requireAdmin()` — members need new routes, do not loosen the admin ones. Sidebar entries for `/portal/nyrr` and `/portal/photos` exist with `disabled: true` in `components/member/PortalSidebar.tsx:14-15` — flip as each phase lands.

*Session 1 — migration + data reality check.* ✅ DONE 07-29 (migration written, NOT yet applied).
- **`db/MIGRATION_V037.sql`** written: `nyrr_event_rsvps` (`id` PK, `nyrr_event_id` FK→`nyrr_events(id)` CASCADE, `MemberID` FK→`members(MemberID)` CASCADE, `intent` enum('running','volunteering','interested','not_going'), `note` varchar(280), timestamps, **UNIQUE (`nyrr_event_id`,`MemberID`)** so a change is an UPSERT) + `members.ShowRsvpPublicly` tinyint(1) NOT NULL DEFAULT 1 + config `PhotoGalleryUrl`. Every step INFORMATION_SCHEMA-guarded, safe to re-run; the config seed uses **INSERT IGNORE** so a re-run can't stomp an admin-edited URL. All three objects verified absent before writing.
- **⚠️ NOT APPLIED YET** — apply after merge with `gh workflow run run-db-migrations.yml --ref main -f migration_version=V037`, then verify against the DB. Session 2 is blocked on this. Note the workflow's loop iterates **every** `db/MIGRATION_V*.sql` regardless of the `migration_version` input; harmless here (V037 is the only file, and all migrations self-register + are guarded).
- **The DB is MySQL 8.4.8-azure, not 5.7** (this file's header rule is stale but conservative — keep writing guarded single-operation DDL, since `ALTER TABLE … ADD COLUMN IF NOT EXISTS` has never existed in any MySQL).
- **Data reality — the calendar will be legitimately short.** Only **8** future-dated events exist (2026-08-05 → 2026-11-01); Sept and Oct 2026 are **completely empty**, and the sole Nov row is the marathon (discovered back in March). Cause is not a bug: NYRR publishes its calendar only ~8 weeks out — the 07-06 discovery run found nothing past 08-26. Fixed in the same commit by moving `DISCOVERY_CRON` in `mmr-admin/nyrr_scheduler.py` from monthly (`0 6 1 * *`) to **weekly (`0 6 * * 1`)**; an `NYRR_DISCOVERY_CRON` app setting on `mmr-nyrr-viewer` would override the default, so check Azure config if the cadence doesn't change after deploy. Session 2's calendar must therefore **default to ~1 month back → 3 months forward** so it never renders empty, and the empty-state copy should say "NYRR hasn't published races beyond X yet" rather than implying a failure.

*Session 2 — calendar.* ✅ DONE 07-29. V037 verified applied in prod (table + `uq_rsvp_event_member` + both FKs + column + config row all match the migration).
- `GET /api/events/calendar?from=&to=` (`requireActiveMember`) → `lib/db/events.ts` (`getCalendarEvents`, `getLatestKnownEventDate`) + `lib/events-range.ts` (pure civil-date math, default −1/+3 months, `MAX_RANGE_DAYS=400` clamp, 400 on from>to). UI: `portal/events/EventsCalendarClient.tsx` + `_components/{MonthGrid,EventList,eventMeta}` — month grid ≥lg, list below, EN/中文. `{ prefix: '/api/events', tier: 'active' }` added to `lib/access.ts`; sidebar gained a **Race Calendar** entry (it had none for `/portal/events` at all).
- **⚠️ NEW LANDMINE for sessions 3-5 — never `import` a *value* from `lib/db/*` into a client component.** The calendar client pulled range constants from `lib/db/events.ts`, which dragged mysql2 into the browser bundle and failed the build with `Can't resolve 'net'/'tls'`. `import type` is fine (erased at compile time); values are not. Constants now live in `lib/events-range.ts`, which stays server-import-free. `npm run build` catches this — `tsc --noEmit` and jest do NOT.
- Verified beyond the unit tests: the calendar SQL was executed against prod (9 rows in the default window, `DATE_FORMAT` returns clean `YYYY-MM-DD`), and the live dev server confirms `/api/events/calendar` 307s to `/login` for an anonymous caller exactly like `/api/photos`, while public `/api/hof/series` still 200s.
- Two data facts the UI now handles: **every** currently-listed upcoming event has `distance` AND `distance_km` NULL (so the field hides entirely — `distanceLabel()` returns null, never "null"/"0 km"), and an empty window is normal, so the empty state names the latest known race instead of implying failure.
- Note gated API routes 307-redirect to `/login` at the edge rather than returning 401 JSON. A client `fetch` follows that redirect and gets HTML, so `res.ok` can be true while `json()` throws — session 3's RSVP mutations need the same try/catch the calendar client has.
- ⚠️ This worktree had no `node_modules`; `npm ci` in `web-apps/mmr-webapp` is step one of any webapp session here.

*Session 3 — RSVP + roster.* ✅ DONE 07-29.
- `POST /api/events/[id]/rsvp` `{intent, note?}` → `upsertRsvp()` (`INSERT … ON DUPLICATE KEY UPDATE`, values passed **twice** as explicit params — `VALUES()` in the UPDATE clause is deprecated as of MySQL 8.0.20 and the row-alias form needs 8.0.19+). `DELETE` clears it and is idempotent (clearing a missing RSVP is a 200, not a 404 — the caller's end state is already true). Member always comes from the session; a `memberId` in the body is ignored. Status codes: 400 bad id/intent/note>280/bad JSON, 404 unknown event (checked *before* the write so the FK can't surface as a 500), **409 for a race that already happened** (race day itself is still open, compared in NY time).
- `GET /api/events/[id]/roster` → names grouped by intent. **The `ShowRsvpPublicly` filter lives in `getEventRoster()`, not the route**, so no future caller can leak a name by forgetting to filter; opted-out members are counted via `hiddenCount` but their name *and note* never enter the payload. `not_going` is counted, never listed. A member with no name falls back to their MemberID, never their email.
- Profile opt-out toggle wired through `Member.showRsvpPublicly` → `rowToMember` (absent/NULL ⇒ **true**, matching the DB default — failing closed would silently unlist everyone) → `updateMemberProfile` (writes 1/0, never a JS boolean) → `PATCH /api/members/me` (`z.boolean()`, so `"false"`/`0` are rejected rather than coerced).
- UI: `_components/{RsvpControls,RosterPanel,EventCard}`; tapping the selected intent again clears it. **Month nav moved out of `MonthGrid` into the container** — the grid is `hidden` below `lg`, so nav nested inside it was unreachable on mobile; the card list now also renders in month view, since RSVP lives in the cards and a desktop member looking only at the grid could not respond.
- Live-verified against prod with cleanup: 3 upserts on one key → 1 row, intent updated, `updated_at` advanced past `created_at`, table returned to 0 rows.
- Admin-side volunteer-coverage view remains out of scope (queryable via the Data Browser).

*Session 4 — race photos link.* Server-side `getConfigValue('PhotoGalleryUrl', 'https://mmr-data-pipeline.web.app/')` (`lib/db/config.ts` already does exactly this). New sidebar item + dashboard card, `target="_blank" rel="noopener noreferrer"`. Leave the existing `/portal/photos` route alone — that's the internal photo/bib service, a different thing. **Validate the scheme is http(s) before rendering**: the value is admin-editable, so an unvalidated config string is a stored-XSS vector via `javascript:`.

*Session 5 — My Results.* Replace the `/portal/nyrr` placeholder. `GET /api/members/me/nyrr-results` — `nyrr_event_runners` JOIN `nyrr_events` WHERE `mmr_member_id` = session member, newest first (finish_time, pace, overall/gender place, age_grade_percent, distance, event name/date/url). ⚠️ Add the rule **above** the existing `/api/members/me` entry in `access.ts` if these need `active` rather than `member` — first prefix match wins. Zero linked rows → show the link form (NYRR name + birth year). `POST /api/members/me/nyrr-link` writes `NYRRRunnerName` + `YearBorn`, then returns **candidate** runner rows for the member to confirm — do not blind-write `mmr_member_id`. Mirror the admin 3-tier logic in `api_events.py` (gender normalized M/W/X→Male/Female/Other; birth-year required for the loosest tier); runners store `age` at race time, not birth year, so compare `event_year - YearBorn` with ±1 tolerance. On confirm: set `mmr_member_id`, `match_method='manual'`, `matched_by='member:<MemberID>'`, `matched_at=NOW()` — audit trail preserved and admins can still override in the match queue.

*Cross-cutting.* Tests per P1j: jest route contract tests with a mocked mysql2 pool — RSVP upsert idempotency, roster respects opt-out, **results are scoped to the session member (member A must not read member B)**, link-form validation (year range, name length), gallery URL scheme rejection, calendar range clamping. Run `mmr-check` + `npm run build`; coverage floors in `jest.config.ts` must not regress. ⚠️ **Local dev has no local DB — `mmr-web` writes to the production database**, so RSVP/link testing creates real rows; use a disposable test member and clean up.

**P1h — Hall of Fame public page — ✅ SHIPPED (07-20)**
- Page `app/(public)/hall-of-fame/page.tsx` (App Router, no auth); navbar link (`nav.hof`, EN/中文); same-origin Next.js routes `app/api/hof/series/route.ts` + `app/api/hof/series/[slug]/route.ts` (direct MySQL, mirror Flask `api_hof.py`).
- Product call (0fc2e8f): shows record holder per category only (top-1), API still returns full 3-person podium if 2nd/3rd wanted back.
- 07-20 fix (4796b47): detail route now selects `events_completed` (was undefined in "Across N race editions").

**P1d — NYRR phases 3-5 (optional) — NOT shipped**
Member backfill report (members never matched), race-history in member tooltip, annual MMR finishes summary. Defer until match-queue usage shows signal.

**P2 — Code health (background)**
All prior mmr-admin offenders split (07-20): every `mmr-admin/*.py` now ≤389 and every `static/*.js` now ≤300 — mmr-admin is CLEAN vs hard-rule (py 400, JS 300). Remaining offenders are all in the Next.js webapp (TS/React limit 300):
| File | LOC | Limit | Status |
|---|---|---|---|
| `app/(public)/join/page.tsx` | ~~870~~ 117 | 300 | ✅ split 07-20 → `join/_components/` (useJoinFlow + step components) |
| `app/(public)/donate/page.tsx` | ~~532~~ 97 | 300 | ✅ split 07-20 → `donate/_components/` (useDonateFlow + step components) |
| `lib/email/templates.ts` | ~~505~~ 28 | 300 | ✅ split 07-21 → `_layout.ts` (wrap+constants) + `templates/{membership,payments,auth}.ts`; `templates.ts` now a barrel (zero caller churn) |
| `app/(public)/faq/page.tsx` | 471 | 300 | open |
| `lib/db/photos.ts` | 456 | 300 | open |
| `components/photos/PhotoDetailOverlay.tsx` | 353 | 300 | open |
| `app/(member)/portal/photos/references/page.tsx` | 318 | 300 | open |
| `app/login/page.tsx` | 312 | 300 | open |
(rerun `find web-apps/mmr-webapp \( -name '*.ts' -o -name '*.tsx' \) -not -path '*/node_modules/*' -not -path '*/.next/*' -exec wc -l {} + | sort -rn` before picking; excludes `__tests__`.)

**P3 — Open questions**
NYRR backfill depth (recommend 2024+). Add `validate_schema.py` to CI? Include NYRR registrants in match queue? Member-merge tool (deferred — FK risk; revisit if dupes accumulate).

## QUICK REFS
**Key files:** `db/schema_snapshot.sql`, `load-env.sh`, `mmr-admin/api_*.py`, `mmr-admin/test_imports.py`.
**Azure:** `mmr-mysql-v4` (Sweden Central), use `mysql-mmr` alias. App Service `mmr-nyrr-viewer`, resource group `mmr-resources` (see `adm-logs`/`adm-status` aliases).

**Shell shortcuts (defined in `~/.zshrc`):**
| Command | What it does |
|---|---|
| `mmr` | `cd ~/github/mmr/trailhead` + activate `.venv` + `source load-env.sh` — **always run first** |
| `mysql-mmr` | `mysql --login-path=mmr -D mmrdb` — direct DB shell |
| `mmr-web` | Start Next.js webapp dev server (`web-apps/mmr-webapp/start-dev.sh`) |
| `mmr-check` | TypeScript typecheck (`npx tsc --noEmit`), no full build |
| `mmr-log` | `git log --oneline -15` |
| `nyrr` | Start Flask admin **locally** (`mmr-admin/app.py`) at http://localhost:5050 |
| `adm-test` | Run `mmr-admin/test_imports.py` (import parity check) |
| `adm-logs` | Stream **Azure** webapp logs live |
| `adm-restart` | Restart **Azure** webapp (not local) |
| `adm-status` | Check Azure webapp state |
| `adm-debug <code>` | Debug single NYRR event locally (e.g. `adm-debug 26WASH`) |
| `runner-summary <code>` | MySQL summary for one event's runners (e.g. `runner-summary 26WASH`) |

**Data Query Quick Reference:**

Count MMR vs. other teams for an event:
```sql
SELECT 
  COUNT(*) AS total_loaded, 
  SUM(team_code = 'MMR') AS mmr_runners, 
  SUM(team_code IS NULL OR team_code != 'MMR') AS other_teams 
FROM nyrr_event_runners ner 
JOIN nyrr_events ne ON ne.id = ner.nyrr_event_id 
WHERE ne.event_code = 'B2026';
```

## LOCAL DEV — NYRR RUNNER DATA
**Quick DB state check** (run after `mmr`):
```bash
python3 - <<'EOF'
import sys; sys.path.insert(0, 'mmr-admin')
from db import query
for r in query("SELECT processing_status, COUNT(*) as n FROM nyrr_events GROUP BY processing_status"): print(f"  {r['processing_status']}: {r['n']}")
print(f"Total runners: {query('SELECT COUNT(*) as n FROM nyrr_event_runners')[0]['n']}")
print(f"Matched:       {query('SELECT COUNT(*) as n FROM nyrr_event_runners WHERE mmr_member_id IS NOT NULL')[0]['n']}")
EOF
```

**Populate runner data locally (CLI — no deploy needed):**
```bash
mmr   # loads venv + env

# Test run: process 10 pending events
python3 basecamp/ops/sync_nyrr_events.py --mode daily --batch-size 10

# Full backlog: process all pending (same as weekly GitHub Action)
python3 basecamp/ops/sync_nyrr_events.py --mode weekly

# Reprocess one event by code
python3 basecamp/ops/sync_nyrr_events.py --mode single --event-code 26WASH
```

**Via admin UI locally:**
```bash
mmr && nyrr   # start Flask admin at http://localhost:5050
# → NYRR Todos tab → filter by "Pending" → click ▶ Load per event
# → "Discover New Events" to pull current year from NYRR API first
```

**GitHub Actions (remote, no local setup):**
Go to repo → Actions → "NYRR Weekly Sync & Finisher Audit (Tuesday)" → Run workflow (supports `workflow_dispatch`).

## SELF-CHECKING (before marking any task done)
Run this mental checklist — catches the class of bugs that appeared in the polling saga:

**Cross-boundary vocabulary:** When a string crosses any boundary (backend→frontend, Python→JS, DB→API), write a contract test that reads both sides. Key pairs to check: `status='done'` vs `=== 'done'`, camelCase vs snake_case field names, `operation` field present in every dict that reaches the frontend.

**Every async loop must have:**
- `!r.ok` / non-200 handler → `clearInterval` / stop
- `try/catch` around the fetch → stop on network error
- Max-retry cap (e.g. `maxPolls`) → stop if job hangs
- Cleanup return value or ref → cancel on unmount

**Every dict that crosses Python→JS:** Verify every field the frontend reads is explicitly mapped in the Python dict. Missing fields (`operation`, `completedAt`) silently become `undefined` and break filter/sort logic with no error.

**Polling pattern — use `window.pollUntilDone`** (defined in `index.html`). Never write a raw `setInterval` for job status polling. `pollUntilDone` handles all stop conditions and returns a cleanup function.

**Test file for this pattern:** `mmr-admin/tests/test_sync_jobs_contract.py` — add a test whenever a new status string, field name, or polling consumer is added.

## GIT DISCIPLINE
**Main only** (no long-lived branches). Semantic commits (feat:, fix:, chore:, docs:). **Before commit:** `git status`, `git diff`, `git log -1`. **Avoid:** force push, rewrite history, secrets, large binaries. **Ask first:** destructive ops. **Important:** Commit code + `_context.md` together in one commit (avoids race conditions).

## TOKEN DISCIPLINE
**Model routing:** Simple tasks (rename, typo, grep) → Haiku. Complex (refactor, schema, multi-service) → Opus. Suggest disabling extended thinking for non-chain-of-thought tasks.
**Response caps:** Simple ≤10 lines. Code change ≤30 lines. Architecture ≤60 lines (ask before more). Never >80 lines without user asking.
**Tool discipline:** Max 1 file read per cycle (state WHY/WHAT first). Don't re-read unless edited. Chain shell commands: `cd && cat && grep` = 1 call.
**Output discipline:** No preamble/recap/unsolicited suggestions. Show ONLY changed lines. The edit tool shows your changes.
**Docs discipline:** Sanctioned standing docs (maintained, tracked): `MONOREPO.md` (human onboarding/architecture), `NYRR_OPS.md` (NYRR data policy), `PUBLIC_SITE_PLAN.md` (active public-site/Stripe plan, partially shipped), `WeChat_Member_Matching_Agent_Prompt.md` (runbook for root `wechat_member_matcher.py`). HARD RULE — Do NOT create any OTHER standalone .md files. All documentation goes into CLAUDE.md (permanent notes) or _context.md (session notes). One-off analyses → inline (no .md). Never create: REFACTOR_SUMMARY.md, INTEGRATION_GUIDE.md, ROUTES_REFERENCE.md, etc. Consolidate instead. Examples: ❌ Create 3 .md docs ✅ Add 1-2 sections to CLAUDE.md + entry in _context.md.
**Context updates:** 3 lines max (`### MM-DD HH:MM UTC — title` + `Changed: X. Status: Y. Next: Z.`). Insert at top. No re-reads; use str_replace. Trim to 3 sessions; move excess to `_context_archive.md`.
**Efficiency:** Don't read files you don't need. Batch edits. Use grep/glob, not bash find. Cache knowledge. Never cat large files; use `head`/`sed`/`grep`. Error message first before source code. Diff-first edits. Chain shell commands. Always `python3`/`pip3`.

**Last updated:** July 18, 2026
