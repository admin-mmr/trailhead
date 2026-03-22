# 📚 Documentation Index & Architecture Guide

**Last Updated**: March 22, 2026
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
| Auth | **NextAuth.js v5** for OAuth dance only → bridges to custom `mmr_session` JWT cookie at `/auth/complete`. Providers: Google, Apple, Microsoft (EntraId), Facebook, Yahoo. Also: email + bcrypt password. No OTP. |

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

**New env vars needed** (see `.env.local.example`): `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `APPLE_ID/SECRET/TEAM_ID/KEY_ID`, `MICROSOFT_CLIENT_ID/SECRET`, `FACEBOOK_CLIENT_ID/SECRET`, `YAHOO_CLIENT_ID/SECRET`

**Yahoo** is a custom OIDC provider (not built into NextAuth v5): `wellKnown: 'https://login.yahoo.com/.well-known/openid-configuration'`

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
| `app/login/page.tsx` | Login UI — email+password form + 5 social login buttons |
| `app/auth/complete/route.ts` | NextAuth→mmr_session bridge (GET, called after any sign-in) |
| `app/auth/forgot-password/page.tsx` | Forgot password page |
| `app/auth/reset-password/page.tsx` | Reset password page (reads `?token=`) |
| `app/api/auth/[...nextauth]/route.ts` | NextAuth v5 catch-all handler |
| `app/api/auth/forgot-password/route.ts` | POST: generate token, send reset email |
| `app/api/auth/reset-password/route.ts` | POST: validate token, save new bcrypt password |
| `app/api/payments/submit/route.ts` | POST: submit payment event → `webapp_events` |
| `app/api/payments/pending/route.ts` | GET: pending events for logged-in member |
| `app/api/payments/proof/route.ts` | POST: upload payment proof screenshot |
| `auth.ts` | NextAuth v5 config (all providers + Credentials) |
| `lib/auth/password.ts` | `hashPassword` / `verifyPassword` (bcryptjs, cost 12) |
| `lib/auth/session.ts` | Custom JWT create/validate, cookie management (unchanged) |
| `lib/db/connection.ts` | MySQL pool (reads `DATABASE_URL`) |
| `lib/db/members.ts` | Member CRUD; `updateMemberOAuthSub()`, `setMemberPassword()` |
| `lib/email/client.ts` | Azure Communication Services `sendEmail()` |
| `lib/email/templates.ts` | HTML templates (bilingual EN/ZH); `passwordResetEmailHtml()` |
| `lib/access.ts` | Route access rules (public/member/active tiers) |
| `middleware.ts` | JWT validation (edge runtime) — unchanged |
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
| 2026-03-22 | Social login implemented: NextAuth.js v5, 5 OAuth providers + email/password, `/auth/complete` bridge |
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

### ⏭️ Next Session — Pending Tasks
Copy this block into the new session context:

```
Auth is implemented but NOT yet fully tested end-to-end. Two things to verify before committing:

1. GOOGLE OAUTH TEST
   - Run: cd web-apps/mmr-webapp && bash start-dev.sh
   - Go to http://localhost:3000/login
   - Click "Continue with Google"
   - Expected: Google consent → /portal (or /join if first time)
   - The /auth/complete route was just fixed (uses wrapped auth handler)

2. EMAIL/PASSWORD TEST
   First, set a password on your account (run from web-apps/mmr-webapp/):
     node -e "const b=require('bcryptjs'); b.hash('TestPassword123!', 12).then(h => console.log(h))"
     mysql-mmr -e "UPDATE members SET password_hash='\$2b\$12\$...' WHERE Email='cathylin@gmail.com';"
   Then sign in at /login with email + that password.
   Expected: redirects to /portal

3. RUN MIGRATION V9 (if not already done)
     mysql-mmr < web-apps/mmr-webapp/db/mmr_migration_v9_social_auth.sql
   Adds facebook_sub column to members, drops otp_codes table.

4. BUILD CHECK before committing:
     cd web-apps/mmr-webapp && npm run build
   Must pass with zero errors.

5. COMMIT + DEPLOY
   Once both auth flows pass, commit and push to trigger Azure deploy.
```

---

## Quick Navigation

### 🚀 **Getting Started (First Time?)**
1. [`README.md`](README.md) — Project overview and monorepo structure
2. [`MONOREPO.md`](MONOREPO.md) — How all services integrate together
3. [`START_HERE.md`](START_HERE.md) — Quick start for local development
4. [`QUICK_SETUP_GUIDE.md`](QUICK_SETUP_GUIDE.md) — One-page setup checklist

### 🔄 **Data Sync & Automation**
1. [`SYNC_PIPELINE_COMPLETION.md`](SYNC_PIPELINE_COMPLETION.md) ⭐ **LATEST** — Complete sync system status (March 22, 2026)
2. [`SYNC_AUTOMATION_SUMMARY.md`](SYNC_AUTOMATION_SUMMARY.md) — GitHub Actions automation setup
3. [`GITHUB_ACTIONS_SETUP.md`](GITHUB_ACTIONS_SETUP.md) — Detailed workflow configuration
4. [`GITHUB_SECRETS_QUICK_SETUP.md`](GITHUB_SECRETS_QUICK_SETUP.md) — 5-minute secrets checklist
5. [`basecamp/GITHUB_ACTIONS_SETUP.md`](basecamp/GITHUB_ACTIONS_SETUP.md) — Basecamp-specific workflows
6. [`basecamp/LOCAL_SETUP.md`](basecamp/LOCAL_SETUP.md) — Local testing of sync scripts

### 🌐 **Deployment & Infrastructure**
1. [`DEPLOYMENT.md`](DEPLOYMENT.md) — Production deployment checklist (Azure default URL)
2. [`STAGING_SETUP_GUIDE.md`](STAGING_SETUP_GUIDE.md) ⭐ **NEW** — Azure staging slots setup (5 steps)
3. [`AZURE_RESOURCES.md`](AZURE_RESOURCES.md) — Azure service names and credentials
4. [`web-apps/mmr-webapp/AZURE_PROTOTYPE_DEPLOY.md`](web-apps/mmr-webapp/AZURE_PROTOTYPE_DEPLOY.md) — Web app deployment
5. [`web-apps/README.md`](web-apps/README.md) — Web app architecture

### 📖 **Component Documentation**cd 
1. [`basecamp/README.md`](basecamp/README.md) — Shared library, schemas, utilities
2. [`basecamp/SETUP.md`](basecamp/SETUP.md) — Basecamp local setup
3. [`basecamp/TEST_INDIVIDUAL_COMPONENTS.md`](basecamp/TEST_INDIVIDUAL_COMPONENTS.md) — Component testing guide
4. [`photo-manager/README.md`](photo-manager/README.md) — Photo CV pipeline
5. [`web-apps/mmr-webapp/DEVELOPMENT.md`](web-apps/mmr-webapp/DEVELOPMENT.md) — Web app development guide

### 📋 **Planning & Status**
1. [`PROJECT_PLAN.md`](PROJECT_PLAN.md) — Features roadmap and timeline
2. [`BUGS_AND_FEATURES.md`](BUGS_AND_FEATURES.md) ⭐ **NEW** — Quick bug/feature reference
3. [`WORK_COMPLETED.md`](WORK_COMPLETED.md) — Historical work summaries (Phase 1)
4. [`CHANGELOG.md`](CHANGELOG.md) — Release notes and version history

### 🔧 **Technical Reference**
1. [`GOOGLE_SHEETS_EXACT_STRUCTURE.md`](GOOGLE_SHEETS_EXACT_STRUCTURE.md) — Sheet column schemas
2. [`REQUIRED_GOOGLE_SHEETS_STRUCTURE.md`](REQUIRED_GOOGLE_SHEETS_STRUCTURE.md) — Data requirements
3. [`SCHEMA_UPDATES_SUMMARY.md`](SCHEMA_UPDATES_SUMMARY.md) — Database schema changes
4. [`MYSQL_PASSWORD_ENCRYPTION_GUIDE.md`](MYSQL_PASSWORD_ENCRYPTION_GUIDE.md) — Credential security
5. [`SETUP_MYSQL_ALIAS.md`](SETUP_MYSQL_ALIAS.md) — MySQL command shortcuts

### 🐛 **Troubleshooting**
1. [`TROUBLESHOOTING_CHECKLIST.md`](TROUBLESHOOTING_CHECKLIST.md) — Common issues and fixes
2. [`START_DEBUGGING_HERE.md`](START_DEBUGGING_HERE.md) — Debug workflow
3. [`DEBUG_SYNC_SETUP.md`](DEBUG_SYNC_SETUP.md) — Sync debugging guide
4. [`GITHUB_ACTIONS_DEBUGGING.md`](GITHUB_ACTIONS_DEBUGGING.md) — GitHub Actions issues

### 📅 **Session Notes**
1. [`NEXT_SESSION.md`](NEXT_SESSION.md) — Handoff for next session
2. [`DATETIME_CONVERSION_FIX.md`](DATETIME_CONVERSION_FIX.md) — Date parsing fix details
3. [`SNAPSHOT_FIX_SUMMARY.md`](SNAPSHOT_FIX_SUMMARY.md) — Snapshot storage fixes
4. [`FIX_AZURE_AND_SMTP.md`](FIX_AZURE_AND_SMTP.md) — Azure & email config
5. [`CONFLICT_HANDLING_IMPROVEMENT.md`](CONFLICT_HANDLING_IMPROVEMENT.md) — Data conflict resolution
6. [`PHASE_2_TABLE_SYNC_ANALYSIS.md`](PHASE_2_TABLE_SYNC_ANALYSIS.md) — Multi-table sync analysis

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
- Set up GitHub Actions? → [`GITHUB_ACTIONS_SETUP.md`](GITHUB_ACTIONS_SETUP.md)
- Configure Azure? → [`AZURE_RESOURCES.md`](AZURE_RESOURCES.md)
- Sync data on schedule? → [`SYNC_AUTOMATION_SUMMARY.md`](SYNC_AUTOMATION_SUMMARY.md)
- Debug a failed sync? → [`DEBUG_SYNC_SETUP.md`](DEBUG_SYNC_SETUP.md)
- Manage MySQL credentials? → [`MYSQL_PASSWORD_ENCRYPTION_GUIDE.md`](MYSQL_PASSWORD_ENCRYPTION_GUIDE.md)

### For Developers
**"How does...?"**
- The whole system work? → [`MONOREPO.md`](MONOREPO.md)
- Data flow from Sheets to MySQL? → [`SYNC_PIPELINE_COMPLETION.md`](SYNC_PIPELINE_COMPLETION.md)
- The web app work? → [`web-apps/README.md`](web-apps/README.md) + [`web-apps/mmr-webapp/DEVELOPMENT.md`](web-apps/mmr-webapp/DEVELOPMENT.md)
- The photo pipeline work? → [`photo-manager/README.md`](photo-manager/README.md)
- The shared library work? → [`basecamp/README.md`](basecamp/README.md)
- Local testing happen? → [`basecamp/LOCAL_SETUP.md`](basecamp/LOCAL_SETUP.md) + [`basecamp/TEST_INDIVIDUAL_COMPONENTS.md`](basecamp/TEST_INDIVIDUAL_COMPONENTS.md)

### For Team/Project Managers
**"What's the status?"**
- Where are we in the roadmap? → [`PROJECT_PLAN.md`](PROJECT_PLAN.md)
- What got done? → [`WORK_COMPLETED.md`](WORK_COMPLETED.md)
- What are the latest changes? → [`CHANGELOG.md`](CHANGELOG.md)
- What needs to happen next? → [`NEXT_SESSION.md`](NEXT_SESSION.md)

### For New Team Members
**"Where do I start?"**
1. [`README.md`](README.md) — Understand the project
2. [`MONOREPO.md`](MONOREPO.md) — Understand how it's organized
3. [`START_HERE.md`](START_HERE.md) — Set up locally
4. Pick your component and read its README
5. [`TROUBLESHOOTING_CHECKLIST.md`](TROUBLESHOOTING_CHECKLIST.md) — Common gotchas

---

## File Categories & Consolidation Plan

### 🔴 **Outdated/Superseded** (Can Archive)
These files contain information that's been updated in newer documents:

| File | Reason | Replaced By |
|------|--------|------------|
| `ENVIRONMENT_AND_TABLE_SETUP.md` | Initial setup notes | `QUICK_SETUP_GUIDE.md` + `SYNC_PIPELINE_COMPLETION.md` |
| `FIX_AZURE_AND_SMTP.md` | Specific bug fix | Incorporated into main docs |
| `CONFLICT_HANDLING_IMPROVEMENT.md` | Specific improvement | Covered in `SYNC_PIPELINE_COMPLETION.md` |
| `DATETIME_CONVERSION_FIX.md` | Specific bug fix | Covered in `SYNC_PIPELINE_COMPLETION.md` |
| `SNAPSHOT_FIX_SUMMARY.md` | Specific bug fix | Covered in `SYNC_PIPELINE_COMPLETION.md` |
| `PHASE_2_TABLE_SYNC_ANALYSIS.md` | Old analysis | Superseded by actual implementation |
| `GITHUB_ACTIONS_DEBUGGING.md` | Generic debugging | Covered in `GITHUB_ACTIONS_SETUP.md` |
| `START_DEBUGGING_HERE.md` | Old debug guide | Covered in `TROUBLESHOOTING_CHECKLIST.md` |

**Recommendation**: Archive these to `docs/archive/` directory for historical reference.

### 🟡 **Partially Redundant** (Can Consolidate)
These files have overlapping content that could be deduplicated:

| Files | Issue | Solution |
|-------|-------|----------|
| `GITHUB_ACTIONS_SETUP.md` + `basecamp/GITHUB_ACTIONS_SETUP.md` | Two versions of same content | Keep root version, link from basecamp |
| `SYNC_AUTOMATION_SUMMARY.md` + `SYNC_PIPELINE_COMPLETION.md` | Both describe syncs (automation vs status) | Keep both; make distinction clear in each |
| `QUICK_SETUP_GUIDE.md` + `START_HERE.md` | Two quick starts | Clarify: QUICK_SETUP for operations, START_HERE for devs |

**Recommendation**: Add cross-references so readers know which document to choose.

### 🟢 **Current & Useful** (Keep Updated)
These files are actively maintained and referenced:

| File | Status | Last Update |
|------|--------|------------|
| `README.md` | Core project overview | Keep current ✅ |
| `MONOREPO.md` | Architecture reference | Keep current ✅ |
| `SYNC_PIPELINE_COMPLETION.md` | Current sync status | March 22, 2026 ✅ |
| `SYNC_AUTOMATION_SUMMARY.md` | GitHub Actions guide | Keep current ✅ |
| `DEPLOYMENT.md` | Deployment checklist | Keep current ✅ |
| `AZURE_RESOURCES.md` | Azure reference | Keep current ✅ |
| `PROJECT_PLAN.md` | Roadmap | Update quarterly ✅ |
| `CHANGELOG.md` | Version history | Update per release ✅ |
| `basecamp/README.md` | Component overview | Keep current ✅ |
| `TROUBLESHOOTING_CHECKLIST.md` | Common issues | Keep current ✅ |

---

## Recommended Reading Paths

### Path 1: New Developer (Full System Understanding)
```
1. README.md (5 min)
   ↓
2. MONOREPO.md (15 min)
   ↓
3. START_HERE.md (10 min — setup)
   ↓
4. Component-specific README (basecamp, web-apps, photo-manager)
   ↓
5. TROUBLESHOOTING_CHECKLIST.md (reference)
```
**Total**: ~1 hour

### Path 2: Operations Engineer (Deployment & Monitoring)
```
1. README.md (5 min)
   ↓
2. DEPLOYMENT.md (15 min)
   ↓
3. AZURE_RESOURCES.md (10 min)
   ↓
4. SYNC_AUTOMATION_SUMMARY.md (10 min)
   ↓
5. GITHUB_ACTIONS_SETUP.md (20 min)
   ↓
6. TROUBLESHOOTING_CHECKLIST.md (reference)
```
**Total**: ~1 hour

### Path 3: Data Integration Engineer (Sync System)
```
1. README.md (5 min)
   ↓
2. SYNC_PIPELINE_COMPLETION.md (20 min)
   ↓
3. GOOGLE_SHEETS_EXACT_STRUCTURE.md (10 min)
   ↓
4. basecamp/LOCAL_SETUP.md (15 min)
   ↓
5. basecamp/TEST_INDIVIDUAL_COMPONENTS.md (15 min)
   ↓
6. DEBUG_SYNC_SETUP.md (reference)
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
- [ ] Review `TROUBLESHOOTING_CHECKLIST.md` for new issues

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

## File Organization Recommendations

### Current Structure
```
trailhead/
├── *.md               # 25+ loose markdown files (root level)
├── .github/workflows/ # GitHub Actions (referenced in docs)
├── basecamp/
│   ├── README.md
│   ├── SETUP.md
│   └── GITHUB_ACTIONS_SETUP.md
├── web-apps/
│   ├── README.md
│   └── docs/
│       └── prd-archive/
└── photo-manager/
    └── README.md
```

### Recommended Refactoring
```
trailhead/
├── README.md                    # Main entry point
├── docs/
│   ├── ARCHITECTURE.md          # MONOREPO.md renamed
│   ├── GETTING_STARTED.md       # START_HERE.md renamed
│   ├── DEPLOYMENT.md
│   ├── TROUBLESHOOTING.md
│   │
│   ├── sync/
│   │   ├── PIPELINE.md          # SYNC_PIPELINE_COMPLETION.md
│   │   ├── AUTOMATION.md        # SYNC_AUTOMATION_SUMMARY.md
│   │   ├── DEBUGGING.md         # DEBUG_SYNC_SETUP.md
│   │   └── GOOGLE_SHEETS.md     # GOOGLE_SHEETS_EXACT_STRUCTURE.md
│   │
│   ├── infrastructure/
│   │   ├── AZURE.md             # AZURE_RESOURCES.md
│   │   ├── GITHUB_ACTIONS.md    # GITHUB_ACTIONS_SETUP.md
│   │   ├── MYSQL.md             # MYSQL_PASSWORD_ENCRYPTION_GUIDE.md
│   │   └── SECRETS.md           # GITHUB_SECRETS_QUICK_SETUP.md
│   │
│   ├── components/
│   │   ├── BASECAMP.md          # basecamp/README.md
│   │   ├── WEBAPP.md            # web-apps/mmr-webapp/README.md
│   │   └── PHOTO_PIPELINE.md    # photo-manager/README.md
│   │
│   ├── project/
│   │   ├── ROADMAP.md           # PROJECT_PLAN.md
│   │   ├── CHANGELOG.md
│   │   └── HISTORY.md           # WORK_COMPLETED.md
│   │
│   └── archive/
│       ├── DATETIME_FIX_SESSION.md
│       ├── SNAPSHOT_FIX_SESSION.md
│       └── ... (old session notes)
│
├── .github/workflows/
└── basecamp/
    ├── README.md                # Keep: component-specific
    ├── LOCAL_SETUP.md           # Keep: how to set up locally
    └── TEST_COMPONENTS.md       # Keep: testing guide
```

**Benefits**:
- ✅ Clearer hierarchy (docs/ folder)
- ✅ Topic-based organization (sync/, infrastructure/, etc.)
- ✅ Easier to navigate by role
- ✅ Room to grow without cluttering root
- ✅ Historical archive separate from current docs

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

*Last Updated: March 22, 2026*
*Maintained by: Development team*
*Purpose: Single source of truth for documentation organization*
