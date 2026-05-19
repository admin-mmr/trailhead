# trailhead Monorepo Guide

How the five services in this repo fit together. For Claude-specific working notes see [`CLAUDE.md`](CLAUDE.md); for session diary see [`_context.md`](_context.md).

---

## The Big Picture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        trailhead Monorepo                              │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌──────────────────────┐  ┌──────────────────┐  ┌──────────────────┐ │
│  │  web-apps/           │  │  photo-manager/  │  │  mmr-admin/      │ │
│  │    mmr-webapp        │  │                  │  │                  │ │
│  │  Next.js 14 + NextAuth│  │  Python 3.9     │  │  Flask + React   │ │
│  │  Member-facing portal│  │  cv2 / dlib OCR  │  │  Ops dashboard   │ │
│  │  Azure Static Web App│  │  Race photo tool │  │  api_*.py blueprints│
│  │  GAS scripts (gas/)  │  │  Drive ↔ Blob    │  │  Azure App Service│ │
│  └─────────┬────────────┘  └────────┬─────────┘  └────────┬─────────┘ │
│            │                        │                     │           │
│            └────────────┬───────────┴─────────────────────┘           │
│                         │                                              │
│            ┌────────────▼────────────┐    ┌──────────────────────┐    │
│            │     basecamp/python/    │    │        db/           │    │
│            │  Shared Python modules  │    │  Schema + migrations │    │
│            │  sync_engine.py         │    │  schema_snapshot.sql │    │
│            │  nyrr_api.py            │    │  MIGRATION_V*.sql    │    │
│            │  sync_config / batch /  │    │  validate_schema.py  │    │
│            │  jobs / models / types  │    │  test_procedure_*.py │    │
│            └─────────────┬───────────┘    └──────────┬───────────┘    │
│                          │                           │                 │
│                          └──────────┬────────────────┘                 │
│                                     ▼                                  │
│                       Azure MySQL 5.7 (mmr-mysql-v4)                   │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

**Source of truth:**
- Database schema → `db/schema_snapshot.sql` (migrations in `db/MIGRATION_V*.sql`)
- Shared Python (sync engine, NYRR client) → `basecamp/python/` — CI auto-copies into `mmr-admin/` on push to main
- Web app routes/auth → `web-apps/mmr-webapp/`

---

## Directory Layout

```
trailhead/
├── README.md                                ← Start here
├── CLAUDE.md                                ← Working agreement + active backlog
├── MONOREPO.md                              ← You are here
├── _context.md / _context_archive.md        ← Rolling session diary
├── load-env.sh                              ← Pulls secrets from macOS Keychain
│
├── .github/workflows/                       ← CI/CD
│   ├── azure-static-web-apps-*.yml          ← web-apps deploy
│   ├── deploy-mmr-admin.yml                 ← mmr-admin deploy (copies basecamp/python → mmr-admin/)
│   ├── run-db-migrations.yml                ← Runs db/MIGRATION_V*.sql on push to main
│   ├── db-schema-drift.yml / db-sql-lint.yml← Schema guardrails
│   ├── sync-all-sheets-ordered.yml          ← MySQL ↔ Google Sheets nightly batch
│   ├── sync-nyrr-weekly.yml                 ← NYRR ingest (cron currently disabled — P0 item)
│   └── manual-mysql-operations.yml          ← One-off SQL via GH Actions
│
├── .githooks/                               ← Shared git hooks
│   └── pre-commit                           ← Runs mmr-admin/test_imports.py
│
├── scripts/                                 ← Repo utilities (e.g. sync-shared-modules.sh)
│
├── web-apps/                                ← Member-facing surface
│   ├── README.md
│   ├── mmr-webapp/                          ← Next.js 14 + NextAuth + Tailwind
│   │   ├── DEVELOPMENT.md
│   │   ├── app/                             ← App Router (/, /login, /join, /faq,
│   │   │                                       /portal/*, /payment-proof, /admin/*)
│   │   ├── lib/
│   │   │   ├── auth/                        ← NextAuth: session.ts, password.ts
│   │   │   └── db/                          ← MySQL connection + queries
│   │   └── middleware.ts
│   └── gas/                                 ← Google Apps Script projects (clasp)
│       ├── membership/                      ← Membership Master Sheet ↔ webhook
│       └── nyrr/                            ← NYRR results sheets
│           └── SHEETS_SETUP_CHECKLIST.md
│
├── photo-manager/                           ← Race photo pipeline (Python)
│   ├── README.md
│   ├── process_photos.py                    ← Orchestrator (Drive → process → output.json)
│   ├── bib_analyzer.py                      ← Bib OCR (Azure Vision)
│   ├── phase1-plan.md / round2-plan.md      ← Long-lived design notes
│   ├── member-photo-instructions.md         ← Bilingual user-facing guide
│   ├── member-data-collection-spec.md
│   └── partner/                             ← Partner nonprofit collab
│
├── mmr-admin/                               ← Ops dashboard (Flask + embedded React)
│   ├── README.md / DEPLOY_AZURE.md / TESTING.md
│   ├── app.py                               ← Thin orchestrator: registers ~25 blueprints
│   ├── db.py / helpers.py / auth.py         ← Connection, JSON encoder, OAuth
│   ├── api_<domain>.py                      ← Route modules (members, payments, events,
│   │                                           runners, sync, audit, admin, query, …)
│   ├── sync_runners.py                      ← 6 export/import ops + full_sync orchestration
│   ├── sync_jobs.py                         ← In-memory job state + MySQL fallback
│   ├── activity_logger.py                   ← Writes to activity_log table
│   ├── test_imports.py                      ← Circular import detector (pre-commit)
│   ├── templates/                           ← React components (.html) loaded by Babel
│   │   ├── index.html                       ← App shell (370 LOC)
│   │   ├── dashboard-panel.html, sync-panel.html, … (9 component files)
│   │   └── styles.css, component-loader.js
│   └── tests/                               ← pytest contract tests
│
├── basecamp/                                ← Shared Python + ops scripts
│   ├── README.md
│   ├── python/                              ← Source of truth for shared modules
│   │   ├── sync_engine.py                   ← Batched UPSERT engine
│   │   ├── sync_config.py / sync_batch.py / sync_compare.py / sync_diff.py
│   │   ├── sync_audit.py / sync_datetime.py / sync_jobs.py
│   │   ├── sync_models.py / sync_types.py
│   │   ├── nyrr_api.py (+ _endpoints.py + _models.py — split per HARD RULE)
│   │   └── __init__.py
│   └── ops/                                 ← Cron-driven scripts
│       ├── sync_nyrr_events.py              ← Entry point (288 LOC orchestrator)
│       ├── sync_nyrr_discovery.py / _ingest.py / _matching.py / _helpers.py
│       ├── schema_inspector.py
│       └── verify_sheets_structure.py
│
└── db/                                      ← Database source of truth
    ├── README.md
    ├── schema_snapshot.sql                  ← Canonical schema (regenerated via /api/export-schema)
    ├── schema_integration.sql
    ├── MIGRATION_V015…V025.sql              ← Versioned, idempotent, self-registering
    ├── validate_schema.py                   ← NULL/FK/ENUM/PK linter
    ├── test_procedure_enum_safety.py
    ├── REVERT_*.sql                         ← Roll-back scripts (manual use only)
    ├── schemas/ / queries/                  ← Per-table fragments + adhoc reports
    └── test_procedure_enum_safety.py
```

---

## Data Flow

### 1. Member signup → MySQL

```
Visitor → /join (Next.js) → POST /api/auth/register
       → NextAuth sets session cookie
       → INSERT into members (status='pending', generate_member_id() trigger)
       → Redirect /portal
```

### 2. Payment proof → autoguess → status flip

```
Member uploads receipt at /payment-proof
       → row in submissions (Status='pending')
Gmail listener (GAS) → rows in gmail_transactions (unmatched)
Admin clicks "Autoguess" in mmr-admin Payments panel
       → POST /api/payments/autoguess-all
       → For each gmail row: regex Axxxx → match member + renewal window + $ amount
       → sp_link_transaction(tx, memberID, 'Membership', amount, submissionID)
       → Triggers cascade: members.Status='active', expiration+=1yr,
                          submissions.Status='approved', gmail.notes synced
```

### 3. Google Sheets ↔ MySQL (batched UPSERT)

```
sync-all-sheets-ordered.yml (GH Action, nightly)
       → mmr-admin/sync_runners.py → 6 export/import ops
       → basecamp/python/sync_engine.py (batch size 300)
       → Google Sheets API (GAS webhook) ↕ MySQL UPSERT
       → sync_jobs table records start/end/rows/status
       → mmr-admin "Sync with Google" panel polls job status
```

### 4. NYRR results pipeline

```
sync-nyrr-weekly.yml (cron — currently manual-only; P0)
       → basecamp/ops/sync_nyrr_events.py (orchestrator)
       → Stage 1-3: discover_events → promote_completed → refresh_upcoming  (discovery.py)
       → Stage 4: ingest_event_runners + upsert  (ingest.py)
       → Stage 5: run_auto_matcher Tier 1/2/3 + Tier 4 fuzzy (matching.py)
       → Unmatched rows surface in mmr-admin "🏃 Match Queue" sub-tab
```

### 5. Photo pipeline

```
Member photos in Google Drive folder
       → photo-manager/process_photos.py
       → bib_analyzer.py (Azure Vision OCR) + face detect + quality score
       → output.json + cropped images → Azure Blob Storage
       → Member views at /portal/photos/{bibs,references}
```

---

## Shared Python: `basecamp/python/`

**This is the source of truth.** Edit here FIRST. CI (`deploy-mmr-admin.yml`) auto-copies these files into `mmr-admin/` before each Azure deploy so admin imports work in production. For local parity:

```bash
./scripts/sync-shared-modules.sh        # mirrors basecamp/python → mmr-admin
python3 mmr-admin/test_imports.py       # circular-import + parity check
```

Modules:

| File | Role |
|---|---|
| `sync_engine.py` | Batched UPSERT MySQL ↔ Sheets (BATCH_SIZE=300) |
| `sync_config.py` | Field maps, table → sheet routing |
| `sync_batch.py` / `sync_diff.py` / `sync_compare.py` | Diff + batch helpers |
| `sync_jobs.py` | Job lifecycle (in-memory + MySQL fallback) |
| `sync_audit.py` | Writes audit rows |
| `sync_datetime.py` | Timezone-safe datetime parsing |
| `sync_models.py` / `sync_types.py` | Pydantic-ish row models |
| `nyrr_api.py` (+ `_endpoints.py`, `_models.py`) | NYRR HTTP client, split per HARD RULE |

---

## Database: `db/`

`db/schema_snapshot.sql` is the canonical schema. Regenerate it from production via:

```bash
curl https://<mmr-admin-host>/api/export-schema -H "Authorization: …" > db/schema_snapshot.sql
```

**Migrations — strict rules:**

1. Filename pattern: `MIGRATION_V<NNN>_<description>.sql` (e.g. `MIGRATION_V026_add_runner_notes.sql`). GitHub Actions (`run-db-migrations.yml`) runs anything matching this on push to `main`.
2. **MySQL 5.7+ constraint:** no `IF NOT EXISTS` on ALTER TABLE / CREATE INDEX, no multi-clause ALTERs. Check `INFORMATION_SCHEMA` for idempotency.
3. **Every migration MUST self-register** at the bottom:
   ```sql
   INSERT INTO schema_migrations (version, description, executed_at)
   VALUES ('V026', 'Add runner notes column', NOW())
   ON DUPLICATE KEY UPDATE executed_at = NOW();
   ```
4. Validate before committing: `python3 db/validate_schema.py` (detects NULL violations, FK orphans, ENUM mismatches, duplicate uniques).

**Active stored procedures:** `generate_member_id()`, `sp_admin_update_member_status()`, `sp_link_transaction()`, `sp_error_summary_report(days_back)`. See CLAUDE.md for signatures.

---

## Environment & Secrets

**macOS local dev — Keychain only (no `.env` files):**

```bash
# Retrieve one secret
security find-generic-password -s mmr-mysql-host -w

# Load all into the shell, then run something
source load-env.sh && python3 mmr-admin/app.py
```

**Azure production:** App Service "Application settings" / Static Web App configuration. `mmr-admin/app.py` auto-loads `web-apps/mmr-webapp/.env.local` on dev only (skipped when `WEBSITE_SITE_NAME` is set).

**Required keys** (names are illustrative — see Keychain for the canonical service-name list):

| Key | Used by |
|---|---|
| `DATABASE_URL`, MySQL host/user/pass | All services |
| `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | web-apps |
| Google OAuth client ID/secret | web-apps + mmr-admin (shared) |
| Microsoft OAuth client ID/secret | mmr-admin |
| `AZURE_STORAGE_CONNECTION_STRING` | web-apps + photo-manager |
| `AZURE_VISION_KEY` / `AZURE_VISION_ENDPOINT` | photo-manager |
| `AZURE_COMM_CONNECTION_STRING` | web-apps (transactional email) |
| Google service-account JSON path | basecamp/photo-manager |

**Never commit secrets.** Pre-commit hook does not currently scan for leaks — rely on Keychain discipline.

---

## Git Hooks

Enable once after cloning:

```bash
git config core.hooksPath .githooks
```

Currently active:
- **pre-commit** → when any `mmr-admin/*.py` file is staged, runs `python3 mmr-admin/test_imports.py` to catch circular/broken imports before they land. Bypass in emergencies with `git commit --no-verify`.

---

## Local Development

### Web app
```bash
cd web-apps/mmr-webapp
npm install
source ../../load-env.sh
npm run dev                            # http://localhost:3000
npm run build 2>&1 | tail -n 50        # before pushing
```

### mmr-admin (Flask)
```bash
source load-env.sh
cd mmr-admin
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python3 app.py                         # http://localhost:5050
# shortcuts: adm-restart / adm-status / adm-logs / adm-test
```

### Photo pipeline
```bash
cd photo-manager
pip install -r requirements.txt
python3 process_photos.py --event "20260315-nyc-half" --dry-run
```

### Google Apps Script
```bash
cd web-apps/gas/membership   # or gas/nyrr
npm run build:copy && npm run push
```

---

## Deployment

All deploys flow through `.github/workflows/`:

| Workflow | Trigger | What it does |
|---|---|---|
| `azure-static-web-apps-*.yml` | push to `main` touching `web-apps/` | Builds Next.js → Azure SWA |
| `deploy-mmr-admin.yml` | push to `main` touching `mmr-admin/` or `basecamp/python/` | Syncs `basecamp/python/` → `mmr-admin/`, deploys to Azure App Service |
| `run-db-migrations.yml` | push to `main` touching `db/MIGRATION_V*.sql` | Runs new migrations against prod MySQL |
| `sync-all-sheets-ordered.yml` | scheduled | Batched MySQL ↔ Sheets sync |
| `sync-nyrr-weekly.yml` | scheduled (currently manual-only) | NYRR ingest + matching |
| `manual-mysql-operations.yml` | workflow_dispatch | One-off SQL with input form |

**Never `git push --force` to main.** Commit code + `_context.md` together to avoid race conditions.

---

## Common Tasks

### Add a member field
1. `db/MIGRATION_V<next>_add_<field>.sql` — single ALTER + self-register insert.
2. Update `db/schema_snapshot.sql` to match (or regenerate via `/api/export-schema` post-deploy).
3. Add column to read paths: `web-apps/mmr-webapp/lib/db/`, `mmr-admin/api_members.py`.
4. If exposed in sheets, extend the field map in `basecamp/python/sync_config.py`.
5. `python3 db/validate_schema.py` → expect clean. Commit, push, watch `run-db-migrations.yml`.

### Add an mmr-admin API endpoint
1. Add route to existing `api_<domain>.py` (or create a new `api_<newdomain>.py` blueprint).
2. Register blueprint in `mmr-admin/app.py`.
3. Add contract test in `mmr-admin/tests/`.
4. Wire up UI in the relevant `mmr-admin/templates/*.html` component.
5. `python3 mmr-admin/test_imports.py` must pass.

### Force a re-sync
- UI: mmr-admin → "Sync with Google" → pick operation → "Run".
- CLI: see `mmr-admin/sync_runners.py` for the 6 ops + `run_full_sync`.

### Inspect recent errors
```sql
SELECT * FROM v_unresolved_errors;       -- priority-sorted
CALL sp_error_summary_report(7);          -- trend last 7 days
```

---

## Troubleshooting

| Symptom | Where to look |
|---|---|
| MySQL connection refused | Azure firewall allowlist + `mysql-mmr` CLI alias |
| NextAuth session not persisting | `NEXTAUTH_SECRET` + `NEXTAUTH_URL` in env |
| `mmr-admin` import error on Azure but works locally | `./scripts/sync-shared-modules.sh` not run before commit; CI re-syncs but local parity drift causes confusion |
| Migration ran but `schema_migrations` not updated | Migration missing the self-register INSERT — fix in next migration |
| Sync job stuck "running" | `sync_jobs` table; mmr-admin Admin → Sync Log shows last 50 |
| GAS push fails | `clasp` version mismatch — `npm install` in the gas project first |
| NYRR matcher missing recent finishers | Cron is manual-only (P0 #1); trigger via Actions tab |

---

## Service-level READMEs

- [`web-apps/README.md`](web-apps/README.md) + [`web-apps/mmr-webapp/DEVELOPMENT.md`](web-apps/mmr-webapp/DEVELOPMENT.md)
- [`photo-manager/README.md`](photo-manager/README.md)
- [`mmr-admin/README.md`](mmr-admin/README.md) + [`mmr-admin/DEPLOY_AZURE.md`](mmr-admin/DEPLOY_AZURE.md) + [`mmr-admin/TESTING.md`](mmr-admin/TESTING.md)
- [`basecamp/README.md`](basecamp/README.md)
- [`db/README.md`](db/README.md)

---

## License

MIT — see [`LICENSE`](LICENSE).
