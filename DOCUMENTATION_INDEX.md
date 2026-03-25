# 📚 Documentation Index & Architecture Guide

**Last Updated**: March 25, 2026
**Purpose**: Single source of truth for project documentation structure
**Audience**: Developers, operations, new team members

---

## 🧠 MMR Webapp — Claude Cowork Context
> Paste this section into **Claude Cowork → New Task → Context** to skip re-reading the repo.
> Updated automatically each session with new discoveries.

### Project Identity
| Field | Value |
|---|---|
| Club | 岚山跑团 / Misty Mountain Runners (MMR) |
| Repo path | `./web-apps/mmr-webapp` (Next.js 14.2.5, TypeScript, Tailwind) |
| **Production URL** | https://orange-tree-0d70d110f.4.azurestaticapps.net/login |
| Database | Azure MySQL — `mmr-mysql-v4.mysql.database.azure.com / mmrdb` |
| Email service | Azure Communication Services |
| Payments | Zelle/Venmo records reconciling with WebApp events and payment proof to change status from Pending to Approved |
| Auth | **NextAuth.js v5** for OAuth dance only → bridges to custom `mmr_session` JWT cookie at `/auth/complete`. Providers: Google, Microsoft (EntraId). Also: email + bcrypt password. No OTP. |

### Secrets & Credentials — Rules
- **No passwords or secrets in the repo, ever.**
- `.env.local` lives in **Basecamp** (not committed). Copy from there when setting up locally.
- Sensitive values (DB password, Azure keys) are stored in **macOS Keychain**.
- Template: `web-apps/mmr-webapp/.env.local.example`

### Database Shortcut
Interactive shell:
```bash
mysql-mmr
```
Run a SQL file:
```bash
mysql-mmr < path/to/file.sql
```
Run an inline query:
```bash
mysql-mmr -e "SHOW TABLES;"
```
Manual fallback (if alias unavailable):
```bash
mysql -h mmr-mysql-v4.mysql.database.azure.com -u mmradmin -p --ssl-mode=REQUIRED mmrdb
```
```bash
mysql -h mmr-mysql-v4.mysql.database.azure.com -u mmradmin -p --ssl-mode=REQUIRED mmrdb < file.sql
```
> ⚠️ `mysql-mmr` is a **macOS alias** (`.zshrc`/`.bashrc`) — Claude's VM cannot run it directly. The alias already includes the DB name and pulls the password from macOS Keychain. Do **not** add `mmrdb` as an argument — it's already embedded in the alias.

### Inspect / Dump Live DB
Show all tables:
```bash
mysql-mmr -e "SELECT table_name, table_rows FROM information_schema.tables WHERE table_schema='mmrdb' ORDER BY table_name;"
```
Show schema for one table:
```bash
mysql-mmr -e "SHOW CREATE TABLE members\G"
```
Full schema dump (all tables, no data) — run from your terminal (needs password):
```bash
mysqldump -h mmr-mysql-v4.mysql.database.azure.com -u mmradmin -p --ssl-mode=REQUIRED --no-data mmrdb > mmrdb_schema_$(date +%Y%m%d).sql
```
Full data dump:
```bash
mysqldump -h mmr-mysql-v4.mysql.database.azure.com -u mmradmin -p --ssl-mode=REQUIRED mmrdb > mmrdb_dump_$(date +%Y%m%d).sql
```

### Local Dev
Start dev server (http://localhost:3000):
```bash
cd web-apps/mmr-webapp && bash start-dev.sh
```
Build check (catches TS/lint errors):
```bash
cd web-apps/mmr-webapp && npm run build
```
Server-side (API) logs print to the terminal running `start-dev.sh`. Client-side errors appear in browser DevTools → Console.

### DB Tables (current — after v9 migrations)
`members`, `member_log`, `webapp_events`, `payments`, `password_reset_tokens`, `gmail_transactions`, `activity_log`, `config`, `schema_migrations`

View: `v_family_members` — derives family groups from `members.FamilyID` (replaces `families` table)

Dropped: `otp_codes` (v9), `otp_tokens` (v7), `payment_events` (v7 rename → `webapp_events`), `families` (v8)

### Auth Architecture (implemented 2026-03-22)
OTP login is **fully removed**. New auth stack:

1. **Social login** — NextAuth.js v5 (`next-auth`) handles the OAuth dance. After success, the callback URL is `/auth/complete`.
2. **Email + password** — bcrypt (cost 12, via `bcryptjs`) stored in `members.password_hash`. NextAuth Credentials provider.
3. **`/auth/complete` bridge** — Route Handler that reads the NextAuth session via `export const GET = auth(async (req) => { req.auth ... })` (wrapped form). **Do NOT use `await auth()` without args** — in NextAuth v5 beta, calling `auth()` bare in a Route Handler can silently return null even when a session exists. The wrapped form receives `req.auth` directly.
4. **`mmr_session`** JWT cookie (custom, `lib/auth/session.ts`) — unchanged. All existing middleware and API routes work as before.
5. **Forgot / reset password** — `/auth/forgot-password` → email with token → `/auth/reset-password`. Token hashed as SHA-256 in `password_reset_tokens` (PascalCase columns: `TokenID`, `TokenHash`, `ExpiresAt`, `Used`).

**⚠️ DB column naming trap**: `password_reset_tokens` uses PascalCase (from v1 migration). Always use `AS` aliases in SELECT for consistent snake_case result keys. DML uses PascalCase directly.

**⚠️ First-time password setup**: New accounts have no `password_hash`. Email/password login silently fails until you set one. To set a test password:
```bash
cd web-apps/mmr-webapp   # ← MUST be webapp dir so bcryptjs resolves
node -e "const b=require('bcryptjs'); b.hash('YourPassword', 12).then(h => console.log(h))"
mysql-mmr -e "UPDATE members SET password_hash='\$2b\$12\$...' WHERE Email='you@example.com';"
```

**Env vars needed** (see `.env.local.example`): `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET`

### Google Sheets Sync
**Google Sheets is the SSOT** for four tables. GitHub Actions sync Sheets → MySQL on a schedule:

| Table | Sheet | Direction |
|---|---|---|
| `members` | Members sheet | Sheets → MySQL |
| `gmail_transactions` | Gmail Transactions sheet | Sheets → MySQL |
| `webapp_events` | WebApp Events sheet | Sheets → MySQL |
| `payments` | Payments sheet | Sheets → MySQL |

See `.github/workflows/sync-all-sheets-ordered.yml` for the sync schedule and order.
Manual sync runner: `bash basecamp/run-sync.sh`

### Key Files
| File | Purpose |
|---|---|
| `app/login/page.tsx` | Login UI — email+password form + Google and Microsoft social login buttons; links to forgot-password and setup-password |
| `app/auth/complete/route.ts` | NextAuth→mmr_session bridge; detects expired-active memberships at login time |
| `app/auth/forgot-password/page.tsx` | Forgot password page |
| `app/auth/reset-password/page.tsx` | Reset password page (reads `?token=`) |
| `app/auth/setup-password/page.tsx` | **NEW** First-time password setup for existing members (reuses forgot-password API, different UI copy) |
| `app/(public)/faq/page.tsx` | **NEW** FAQ page — 9 bilingual accordion items covering login, setup, renewal, status, contacts |
| `app/(public)/page.tsx` | Homepage — official website section uses a link button (no iframe) |
| `app/(public)/join/page.tsx` | Join/renew page — pre-fills form from `/api/members/me` for logged-in members |
| `app/(member)/layout.tsx` | Portal layout — expired members get slim layout + amber banner; non-active redirected to `/membership/inactive` |
| `app/membership/inactive/page.tsx` | Inactive/pending/expired holding page — fetches and displays member info (name, email, MemberID) |
| `app/api/auth/[...nextauth]/route.ts` | NextAuth v5 catch-all handler |
| `app/api/auth/forgot-password/route.ts` | POST: generate token, send reset email (also used by setup-password) |
| `app/api/auth/reset-password/route.ts` | POST: validate token, save new bcrypt password |
| `app/api/auth/logout/route.ts` | GET: clears `mmr_session` cookie, redirects to `/` using `req.url` origin |
| `app/api/auth/refresh-session/route.ts` | POST: re-reads DB, re-issues JWT with fresh status (detects expiry) |
| `app/api/members/me/route.ts` | GET: returns member profile; accessible to any logged-in member including expired/pending |
| `app/api/payments/submit/route.ts` | POST: submit payment event → `webapp_events` |
| `app/api/payments/pending/route.ts` | GET: pending events for logged-in member |
| `app/api/payments/proof/route.ts` | POST: upload payment proof screenshot |
| `auth.ts` | NextAuth v5 config (all providers + Credentials) |
| `lib/auth/password.ts` | `hashPassword` / `verifyPassword` (bcryptjs, cost 12) |
| `lib/auth/session.ts` | Custom JWT create/validate, cookie management |
| `lib/db/connection.ts` | MySQL pool (reads `DATABASE_URL`) |
| `lib/db/members.ts` | Member CRUD; `rowToMember` normalizes status/membershipType to lowercase |
| `lib/email/client.ts` | Azure Communication Services `sendEmail()` |
| `lib/email/templates.ts` | HTML templates (bilingual EN/ZH); contact email `admin@mmrunners.org` |
| `lib/access.ts` | Route tiers: `/portal/profile` → `'member'` (before `/portal` → `'active'`); `/auth/setup-password` → `'public'` |
| `middleware.ts` | JWT validation (edge runtime); sets `x-pathname` header for server-component layouts |
| `components/layout/Navbar.tsx` | Shows `UserCircle` icon + first name when logged in; login button when not |
| `components/layout/Footer.tsx` | Founding year 2015; improved text contrast; contact `admin@mmrunners.org` |
| `types/index.ts` | `MemberStatus`: `'active' \| 'inactive' \| 'pending' \| 'expired'` |
| `types/next-auth.d.ts` | Augments Session + JWT with `provider`, `providerAccountId` |
| `db/mmr_migration_v*.sql` | Schema migrations (v1–v9) |
| `basecamp/run-sync.sh` | Manual sheet→MySQL sync runner |
| `.github/workflows/sync-all-sheets-ordered.yml` | Automated CI sync |

### Known Bugs Fixed in Code
| Bug | File | Fix |
|---|---|---|
| `families` table queried nowhere — FK only | v8 migration | Drop table, create `v_family_members` view |
| `payment_history` table doesn't exist | `lib/db/members.ts` | Fixed to query `payments` table |
| `familyId` typed as `number` but DB is `VARCHAR(10)` | `types/index.ts` | Fixed to `string` |
| `password_reset_tokens` uses PascalCase columns — routes used lowercase | `api/auth/forgot-password` + `reset-password` routes | Fixed to PascalCase in DML, snake_case aliases in SELECT |
| `fk_members_family` FK listed in v1 migration but never applied to live DB | v8 migration | Removed `DROP FOREIGN KEY` statement entirely |
| Logout redirected to `localhost` in production | `api/auth/logout/route.ts` | Use `new URL('/', req.url)` to derive origin from request |
| Active members showing "Pending" in portal | `lib/db/members.ts` | Google Sheets syncs `'Active'` (capital); normalized `.toLowerCase()` in `rowToMember` |
| Expired members fully locked out | `lib/access.ts`, `app/(member)/layout.tsx`, `middleware.ts` | Added `'expired'` status; `/portal/profile` accessible to 'member' tier; expiry detected at JWT-issue time |
| Homepage iframe blank (official website blocks embedding) | `app/(public)/page.tsx` | Removed iframe; replaced with link button |

### Session Log
| Datetime (EDT) | Discovery |
|---|---|
| 2026-03-22 | Identified `otp_codes` vs `otp_tokens` schema mismatch as root cause of login failure |
| 2026-03-22 | Confirmed social login scaffolded in DB but not implemented in code |
| 2026-03-22 | Confirmed `.env.local` is in Basecamp; secrets in macOS Keychain; `mysql-mmr` alias exists |
| 2026-03-22 | `mysql-mmr` alias does NOT take `mmrdb` as arg — DB already embedded in alias |
| 2026-03-22 | `payment_events` renamed to `webapp_events` across all code, scripts, GH Actions (v7 migration written) |
| 2026-03-22 | `schema_inspector.py` updated: expects `otp_codes` + `webapp_events`, removed `otp_tokens` + `payment_events` |
| 2026-03-22 | DB hostname confirmed: `mmr-mysql-v4.mysql.database.azure.com` (not `mmr-mysql`) |
| 2026-03-22 | `families` table never queried in code — dropped in v8, replaced by `v_family_members` view |
| 2026-03-22 | `lib/db/members.ts:getPaymentHistory` queried non-existent `payment_history` — fixed to `payments` |
| 2026-03-22 | `familyId` type was `number` in TypeScript but `VARCHAR(10)` in DB — fixed to `string` |
| 2026-03-22 | Social login implemented: NextAuth.js v5, Google + Microsoft OAuth + email/password, `/auth/complete` bridge. Apple/Facebook/Yahoo removed (no test accounts). |
| 2026-03-22 | OTP auth fully removed: deleted `lib/auth/otp.ts`, `api/auth/login/`, `api/auth/verify-otp/` |
| 2026-03-22 | Forgot/reset password added: SHA-256 token in `password_reset_tokens`, bilingual email template |
| 2026-03-22 | `password_reset_tokens` PascalCase columns confirmed — routes fixed to use correct casing |
| 2026-03-22 | Migration v9: adds `facebook_sub` to `members`, drops `otp_codes` table |
| 2026-03-22 | `lib/access.ts`: added explicit public rules for `/auth/forgot-password`, `/auth/reset-password`, `/auth/complete` |
| 2026-03-22 | `webapp_events` INSERT was missing `EventType` (NOT NULL, no default) — caused silent payment failure |
| 2026-03-22 | `webapp_events` has no `proof_url` column — correct column is `ScreenshotFileId VARCHAR(255)` |
| 2026-03-22 | `webapp_events` status enum is lowercase: `'pending'` / `'approved'` / `'rejected'` (code was using Title Case) |
| 2026-03-22 | `rowToMember` crash: DB column is `CreatedAt` not `created_at` — entire `members.ts` rewritten to use PascalCase |
| 2026-03-22 | `DATABASE_URL` never goes in `.env.local`. Use `start-dev.sh` which injects it from macOS Keychain at startup |
| 2026-03-22 | `start-dev.sh` reads `MMR_DATABASE_URL` Keychain entry (full URL) or falls back to password-only entry |
| 2026-03-22 | `auth()` bare call in a Route Handler can return null in NextAuth v5 beta — fixed to wrapped `auth(handler)` form |
| 2026-03-22 | Email/password `CredentialsSignin`: accounts have no `password_hash` by default — must be set manually first time |
| 2026-03-22 | Google Sheets confirmed as SSOT for members, gmail_transactions, webapp_events, payments — sync section updated |
| 2026-03-22 | `/auth/complete` redirect loop: NextAuth v5 `auth()` wrapper silently drops `Set-Cookie` on `NextResponse` redirect — root cause of OAuth + credentials login not reaching /portal |
| 2026-03-22 | Attempted fix: `cookies()` from `next/headers` inside `auth()` wrapper — loop persists; added debug logging to `auth/complete`, `middleware.ts`, `login/page.tsx` to pinpoint exact failure point |
| 2026-03-22 | DOCUMENTATION_INDEX.md updated: single-line commands, Table Renames section removed, Google Sheets Sync corrected, session log → datetime (EDT) |
| 2026-03-22 | Portal bug fixes (Session 1): logout redirect fixed; `/membership/inactive` shows member info; `/join` pre-fills for logged-in members; navbar shows member icon; `'expired'` status added with grace access to `/portal/profile` |
| 2026-03-23 | Portal bug fixes (Session 2): footer year→2015, contrast improved; FAQ page at `/faq` (9 items, bilingual); `/auth/setup-password` for first-time password creation; all contact emails audited→`admin@`/`web@mmrunners.org`; Google Sheets status case mismatch fixed in `rowToMember`; `MemberStatus` type extended with `'expired'`; `x-pathname` header forwarded by middleware for server-component path detection |
| 2026-03-23 | Homepage official website section: iframe removed (blank due to X-Frame-Options); replaced with plain link button to `www.mmrunners.org` |
| 2026-03-23 | TypeScript check (`npx tsc --noEmit`) passes clean (zero errors in app source; pre-existing test file errors are in `__tests__/` only and don't affect build) |

### ⏭️ Next Session — Pending Tasks
Copy this block into the new session context:

```
Portal code is committed and type-checks cleanly. Next steps before going live:

1. GOOGLE OAUTH TEST (local)
   - Run: cd web-apps/mmr-webapp && bash start-dev.sh
   - Go to http://localhost:3000/login
   - Click "Continue with Google"
   - Expected: Google consent → /portal
   - If redirect loops, check /auth/complete (uses wrapped auth handler form)

2. EMAIL/PASSWORD TEST (local)
   First, set a password on a test account (run from web-apps/mmr-webapp/):
     node -e "const b=require('bcryptjs'); b.hash('TestPassword123!', 12).then(h => console.log(h))"
     mysql-mmr -e "UPDATE members SET password_hash='\$2b\$12\$...' WHERE Email='cathylin@gmail.com';"
   Then sign in at /login with email + that password.
   Expected: redirects to /portal

3. FIRST-TIME SETUP TEST
   Go to /auth/setup-password, enter your email.
   Expected: receive email with link to /auth/reset-password?token=...
   Follow link, set a password, confirm it redirects to /login.

4. EXPIRED MEMBER TEST
   Update a test member's ExpiresAt to a past date in DB.
   Log in — should see /portal/profile with amber expiry banner and "Renew now" link.
   Attempting to go to /portal/photos should redirect to /membership/inactive.

5. RUN MIGRATION V9 ON PRODUCTION (if not already done)
     mysql-mmr < web-apps/mmr-webapp/db/mmr_migration_v9_social_auth.sql
   Adds facebook_sub column to members, drops otp_codes table.

6. PUSH TO TRIGGER AZURE DEPLOY
     git push origin main
   GitHub Actions will build and deploy to Azure Static Web Apps.
   Production URL: https://orange-tree-0d70d110f.4.azurestaticapps.net
```

---

## Quick Navigation

### 🚀 **Getting Started (First Time?)**
1. [`README.md`](README.md) — Project overview and monorepo structure
2. [`MONOREPO.md`](MONOREPO.md) — How all services integrate together
3. [`docs/LOCAL_SETUP.md`](docs/LOCAL_SETUP.md) — Local setup: env vars, MySQL alias, credential storage

### 🔄 **Data Sync & Automation**
1. [`docs/GITHUB_ACTIONS.md`](docs/GITHUB_ACTIONS.md) — Workflows, secrets setup, schedules, and debugging
2. [`docs/GOOGLE_SHEETS_REFERENCE.md`](docs/GOOGLE_SHEETS_REFERENCE.md) — Sheet names, column schemas, validation
3. [`basecamp/LOCAL_SETUP.md`](basecamp/LOCAL_SETUP.md) — Local testing of sync scripts

### 🌐 **Deployment & Infrastructure**
1. [`DEPLOYMENT.md`](DEPLOYMENT.md) — Production deployment checklist
2. [`docs/AZURE.md`](docs/AZURE.md) — Azure resources, connection strings, staging environments
3. [`web-apps/mmr-webapp/AZURE_PROTOTYPE_DEPLOY.md`](web-apps/mmr-webapp/AZURE_PROTOTYPE_DEPLOY.md) — Web app deployment
4. [`web-apps/README.md`](web-apps/README.md) — Web app architecture

### 📖 **Component Documentation**
1. [`basecamp/README.md`](basecamp/README.md) — Shared library, schemas, utilities
2. [`basecamp/SETUP.md`](basecamp/SETUP.md) — Basecamp local setup
3. [`basecamp/TEST_INDIVIDUAL_COMPONENTS.md`](basecamp/TEST_INDIVIDUAL_COMPONENTS.md) — Component testing guide
4. [`photo-manager/README.md`](photo-manager/README.md) — Photo CV pipeline
5. [`web-apps/mmr-webapp/DEVELOPMENT.md`](web-apps/mmr-webapp/DEVELOPMENT.md) — Web app development guide

### 📋 **Planning & Status**
1. [`PROJECT_PLAN.md`](PROJECT_PLAN.md) — Features roadmap and timeline
2. [`BUGS_AND_FEATURES.md`](BUGS_AND_FEATURES.md) — Quick bug/feature reference
3. [`CHANGELOG.md`](CHANGELOG.md) — Release notes and version history (v0.1.0 → v0.3.0)

### 🔧 **Technical Reference**
1. [`docs/GOOGLE_SHEETS_REFERENCE.md`](docs/GOOGLE_SHEETS_REFERENCE.md) — Authoritative sheet + column schemas
2. [`docs/LOCAL_SETUP.md`](docs/LOCAL_SETUP.md) — MySQL alias, credential storage (Keychain)
3. [`docs/DATABASE_SCHEMA_CHECKS.md`](docs/DATABASE_SCHEMA_CHECKS.md) — Schema inspection tools, daily checks, data integrity validation

### 🐛 **Troubleshooting**
1. [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) — Live log locations, sync checklist, common errors
2. [`docs/GITHUB_ACTIONS.md`](docs/GITHUB_ACTIONS.md) — GitHub Actions specific debugging

### 📅 **Session History**
1. [`docs/SESSION_HISTORY.md`](docs/SESSION_HISTORY.md) — March 22, 2026 session summary

### 🎯 **Product Documentation**
1. [`web-apps/docs/prd-archive/`](web-apps/docs/prd-archive/) — Product requirement docs (archived versions)
2. [`photo-manager/member-data-collection-spec.md`](photo-manager/member-data-collection-spec.md) — Data spec
3. [`photo-manager/member-photo-instructions.md`](photo-manager/member-photo-instructions.md) — Photo workflow
4. [`web-apps/gas/nyrr/SHEETS_SETUP_CHECKLIST.md`](web-apps/gas/nyrr/SHEETS_SETUP_CHECKLIST.md) — NYRR sheet setup

---

## Documentation by Purpose

### For Operations/DevOps
**"How do I...?"**
- Deploy to production? → [`DEPLOYMENT.md`](DEPLOYMENT.md)
- Set up GitHub Actions? → [`docs/GITHUB_ACTIONS.md`](docs/GITHUB_ACTIONS.md)
- Configure Azure? → [`docs/AZURE.md`](docs/AZURE.md)
- Sync data on schedule? → [`docs/GITHUB_ACTIONS.md`](docs/GITHUB_ACTIONS.md)
- Debug a failed sync? → [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)
- Manage MySQL credentials? → [`docs/LOCAL_SETUP.md`](docs/LOCAL_SETUP.md)
- Check database schema and integrity? → [`docs/DATABASE_SCHEMA_CHECKS.md`](docs/DATABASE_SCHEMA_CHECKS.md)

### For Developers
**"How does...?"**
- The whole system work? → [`MONOREPO.md`](MONOREPO.md)
- Data flow from Sheets to MySQL? → [`docs/SESSION_HISTORY.md`](docs/SESSION_HISTORY.md) (March 22 session)
- The web app work? → [`web-apps/README.md`](web-apps/README.md) + [`web-apps/mmr-webapp/DEVELOPMENT.md`](web-apps/mmr-webapp/DEVELOPMENT.md)
- The photo pipeline work? → [`photo-manager/README.md`](photo-manager/README.md)
- The shared library work? → [`basecamp/README.md`](basecamp/README.md)
- Local testing happen? → [`basecamp/LOCAL_SETUP.md`](basecamp/LOCAL_SETUP.md) + [`basecamp/TEST_INDIVIDUAL_COMPONENTS.md`](basecamp/TEST_INDIVIDUAL_COMPONENTS.md)

### For Team/Project Managers
**"What's the status?"**
- Where are we in the roadmap? → [`PROJECT_PLAN.md`](PROJECT_PLAN.md)
- What are the latest changes? → [`CHANGELOG.md`](CHANGELOG.md)
- What was done in the last session? → [`docs/SESSION_HISTORY.md`](docs/SESSION_HISTORY.md)

### For New Team Members
**"Where do I start?"**
1. [`README.md`](README.md) — Understand the project
2. [`MONOREPO.md`](MONOREPO.md) — Understand how it's organized
3. [`docs/LOCAL_SETUP.md`](docs/LOCAL_SETUP.md) — Set up locally
4. Pick your component and read its README
5. [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) — Common gotchas

---

## Active File Map

### 🟢 Root-Level Files (Keep Updated)

| File | Purpose | Update Frequency |
|------|---------|-----------------|
| `README.md` | Project entry point | As needed |
| `MONOREPO.md` | Architecture overview | As needed |
| `PROJECT_PLAN.md` | Roadmap | Quarterly |
| `CHANGELOG.md` | Release notes | Per release |
| `DEPLOYMENT.md` | Deployment checklist | As needed |
| `DOCUMENTATION_INDEX.md` | This file + Claude context | Each session |
| `BUGS_AND_FEATURES.md` | Active issue tracker | Ongoing |

### 🟢 docs/ Folder (Consolidated Reference)

| File | Contents |
|------|---------|
| `docs/LOCAL_SETUP.md` | Env vars, MySQL alias, Keychain credential storage |
| `docs/GOOGLE_SHEETS_REFERENCE.md` | Authoritative sheet names + column schemas |
| `docs/GITHUB_ACTIONS.md` | Setup, secrets, schedules, debugging |
| `docs/AZURE.md` | Resources, connection strings, staging environments |
| `docs/TROUBLESHOOTING.md` | Live logs, error messages, sync checklist |
| `docs/DATABASE_SCHEMA_CHECKS.md` | Schema inspection tools, daily checks, data integrity validation |
| `docs/SESSION_HISTORY.md` | Historical session summaries |

---

## Recommended Reading Paths

### Path 1: New Developer (Full System Understanding)
```
1. README.md (5 min)
   ↓
2. MONOREPO.md (15 min)
   ↓
3. docs/LOCAL_SETUP.md (10 min — setup)
   ↓
4. Component-specific README (basecamp, web-apps, photo-manager)
   ↓
5. docs/TROUBLESHOOTING.md (reference)
```
**Total**: ~1 hour

### Path 2: Operations Engineer (Deployment & Monitoring)
```
1. README.md (5 min)
   ↓
2. DEPLOYMENT.md (15 min)
   ↓
3. docs/AZURE.md (10 min)
   ↓
4. docs/GITHUB_ACTIONS.md (20 min)
   ↓
5. docs/DATABASE_SCHEMA_CHECKS.md (15 min — daily/weekly checks)
   ↓
6. docs/TROUBLESHOOTING.md (reference)
```
**Total**: ~1 hour

### Path 3: Data Integration Engineer (Sync System)
```
1. README.md (5 min)
   ↓
2. docs/SESSION_HISTORY.md (20 min — how the pipeline was built)
   ↓
3. docs/GOOGLE_SHEETS_REFERENCE.md (10 min)
   ↓
4. basecamp/LOCAL_SETUP.md (15 min)
   ↓
5. basecamp/TEST_INDIVIDUAL_COMPONENTS.md (15 min)
   ↓
6. docs/TROUBLESHOOTING.md (reference)
```
**Total**: ~1.5 hours

### Path 4: Product Manager (Status & Roadmap)
```
1. README.md (5 min)
   ↓
2. PROJECT_PLAN.md (15 min)
   ↓
3. WORK_COMPLETED.md (10 min)
   ↓
4. CHANGELOG.md (5 min)
   ↓
5. SYNC_PIPELINE_COMPLETION.md (10 min — current status)
```
**Total**: ~45 min

---

## Documentation Maintenance Schedule

### Weekly
- [ ] Update `NEXT_SESSION.md` with current status
- [ ] Check for broken links in navigation files

### Monthly (End of Sprint)
- [ ] Update `PROJECT_PLAN.md` with completed/blocked items
- [ ] Add entry to `CHANGELOG.md` if releases occurred
- [ ] Review `docs/TROUBLESHOOTING.md` for new issues

### Quarterly
- [ ] Full review of README files (all components)
- [ ] Archive outdated session notes
- [ ] Update status badges and emoji accuracy
- [ ] Check that all links are still valid

### As Needed
- Create new documentation when:
  - A major feature is completed
  - A significant bug/fix occurs
  - A new process/workflow is established
  - A team member asks "where is...?"

---

## Current File Structure (Post-Consolidation, March 2026)

```
trailhead/
├── README.md
├── MONOREPO.md
├── PROJECT_PLAN.md
├── CHANGELOG.md
├── DEPLOYMENT.md
├── DOCUMENTATION_INDEX.md     ← this file
├── BUGS_AND_FEATURES.md
│
├── docs/                      ← consolidated reference
│   ├── LOCAL_SETUP.md
│   ├── GOOGLE_SHEETS_REFERENCE.md
│   ├── GITHUB_ACTIONS.md
│   ├── AZURE.md
│   ├── TROUBLESHOOTING.md
│   └── SESSION_HISTORY.md
│
├── .github/workflows/
├── basecamp/
│   ├── README.md
│   ├── SETUP.md
│   ├── LOCAL_SETUP.md
│   └── TEST_INDIVIDUAL_COMPONENTS.md
├── web-apps/
└── photo-manager/
```

---

## Documentation Standards

### Metadata Block (Top of Each File)
```markdown
# Title

**Status**: ✅ Current / 🟡 Partial / 🔴 Outdated
**Last Updated**: YYYY-MM-DD
**Owner**: @github_handle
**Purpose**: One-sentence description
**Audience**: Who should read this?
```

### Sections to Include
- Quick start / TL;DR (if applicable)
- Table of contents (if file > 500 lines)
- Prerequisites or dependencies
- Step-by-step instructions (if procedural)
- Examples / code snippets (if technical)
- Troubleshooting (if applicable)
- Links to related docs
- Last updated date

### Links Format
```markdown
# Good
- See [`DEPLOYMENT.md`](DEPLOYMENT.md) for production setup
- Read [MONOREPO.md](MONOREPO.md) for architecture overview

# Avoid
- See DEPLOYMENT.md
- Read the other document
```

### Emoji Usage
- 🚀 Getting started, fast paths
- 📚 Reference documentation
- 🔧 Technical/operational docs
- 📊 Status, metrics, summaries
- 🐛 Troubleshooting, debugging
- 📅 Temporal (dates, schedules)
- ✅ Complete, done
- 🟡 In progress, partial
- 🔴 Outdated, deprecated

---

## Summary

**Current State**: 25+ markdown files, many with overlapping content and unclear purposes

**Goal**: Clear, hierarchical documentation with single purpose per file

**Action Items**:
1. ✅ Create `SYNC_PIPELINE_COMPLETION.md` (done — March 22)
2. ✅ Create this index (`DOCUMENTATION_INDEX.md`) (done)
3. [ ] Archive outdated files to `docs/archive/`
4. [ ] Add metadata blocks to all main docs
5. [ ] Consolidate root markdown files into `docs/` subfolder
6. [ ] Create cross-reference links in each component README
7. [ ] Establish quarterly review schedule
8. [ ] Train team on documentation standards

---

**Questions?** Check this index first, then look for similar files in the recommended reading paths above.

---

*Last Updated: March 23, 2026*
*Maintained by: Development team*
*Purpose: Single source of truth for documentation organization*
