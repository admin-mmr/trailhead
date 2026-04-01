# Trailhead Monorepo — Codebase Audit Report

**Date**: April 1, 2026
**Scope**: Full architecture review, code quality assessment, testing strategy, consolidation roadmap
**Auditor**: Claude (automated analysis)

---

## 1. Executive Summary

The Trailhead monorepo manages a running club's membership system across five service boundaries: a Next.js Member Portal, a Python/Flask Admin Portal, Google Apps Script automation, a photo processing pipeline, and GitHub Actions orchestration. The system has grown organically over several months and now needs consolidation.

**Overall Grade: B-**

The codebase is functional and actively maintained, but suffers from language fragmentation (Python + TypeScript + GAS), duplicated logic across services, inconsistent error handling in database operations, and near-zero automated test coverage on the Python backend. The MySQL pain point the team experiences — code not working and requiring manual frontend testing — traces directly to three root causes: no connection pooling in Python, inconsistent error handling patterns, and zero unit tests for database operations.

**Key Numbers**:

| Metric | Value |
|--------|-------|
| Total Python LOC (mmr-admin) | ~11,500 |
| Total TypeScript LOC (mmr-webapp) | ~11,600 |
| Total GAS LOC (membership + nyrr) | ~7,400 |
| Files exceeding 400-line threshold | 10 (Python), 2 (TypeScript) |
| Largest single file | `api_sheets_sync.py` — 2,224 lines |
| Duplicated functions (exact) | 7 |
| Duplicated functions (similar) | 5+ |
| Unit test suites (Python backend) | 0 (only import checker) |
| Unit test suites (webapp) | 4 |
| Unit test suites (GAS) | 10 |
| GitHub Actions workflows | 7 (4 active, 3 disabled) |
| Database tables | 18 |

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        GitHub Actions                           │
│  bidirectional-sync (4×/day) │ deploy │ schema-drift │ nyrr    │
└────────────┬────────────────────────────────┬───────────────────┘
             │                                │
┌────────────▼────────────┐    ┌──────────────▼──────────────────┐
│  mmr-admin (Flask)      │    │  mmr-webapp (Next.js)           │
│  Azure Web App Service  │    │  Azure Static Web App           │
│  Port 5050              │    │  Member Portal                  │
│  ─────────────────────  │    │  ──────────────────────         │
│  10 Blueprints, 50+ API │    │  50+ API routes                 │
│  routes                 │    │  NextAuth (Google/MS/email)     │
│  OAuth (Google/MS)      │    │  mysql2/promise (pooled)        │
│  mysql-connector (no    │    │  ──────────────────────         │
│  pool)                  │    │  Jest: 4 test suites            │
│  ─────────────────────  │    └──────────────────┬──────────────┘
│  Tests: import checker  │                       │
│  only                   │                       │
└────────────┬────────────┘              ┌────────▼────────┐
             │                           │  GAS Membership  │
             │                           │  Google Sheets   │
             │  ┌────────────────┐       │  OTP Auth        │
             │  │  basecamp/     │       │  Email hooks     │
             │  │  sync_engine   │       │  ────────────    │
             │  │  nyrr_api      │       │  Jest: 10 suites │
             │  │  ops scripts   │       └────────┬─────────┘
             │  └───────┬────────┘                │
             │          │                         │
     ┌───────▼──────────▼─────────────────────────▼───┐
     │              MySQL (Azure)                      │
     │              mmr-mysql-v4 (Sweden Central)      │
     │              18 tables, UTF8MB4                  │
     └─────────────────────────────────────────────────┘
```

### Service Inventory

| # | Service | Stack | Deployment | Status |
|---|---------|-------|------------|--------|
| 1 | Member Portal (GAS) | Google Apps Script + TypeScript | clasp deploy | Active (being replaced) |
| 2 | Member Portal (new) | Next.js 14 + TypeScript | Azure Static Web App | Active |
| 3 | Admin Portal | Python Flask | Azure Web App Service | Active |
| 4 | NYRR backend (GAS) | Google Apps Script + TypeScript | clasp deploy | To be deprecated |
| 5 | Photo Manager | Python + Flask + OpenCV | Local / planned Azure | Early stage |
| 6 | Automation | GitHub Actions | GitHub-hosted runners | Active |

---

## 3. MySQL — The Core Pain Point

### 3.1 Root Cause Analysis

The team reports that "MySQL read/write code often doesn't work and requires manual frontend testing." This traces to three architectural gaps:

**Problem 1: No connection pooling in Python (mmr-admin)**

The `db.py` module creates a fresh MySQL connection for every single query:

```python
# mmr-admin/db.py — every call opens + closes a connection
def query(sql, params=None, dictionary=True):
    conn = get_conn()          # new TCP connection
    cur = conn.cursor(dictionary=dictionary)
    cur.execute(sql, params or [])
    rows = cur.fetchall()
    cur.close()
    conn.close()               # destroyed immediately
    return rows
```

By contrast, the TypeScript webapp uses a proper pool (mysql2/promise, connectionLimit=10). The Python side has no pooling, no connection reuse, and no health checks. Under concurrent sync operations (threading), this can exhaust Azure MySQL's connection limit and produce intermittent "Can't connect" or "Too many connections" errors.

**Problem 2: Inconsistent error handling across 28 Python modules**

Four different error handling patterns exist, and they're mixed inconsistently:

| Pattern | Where Used | Problem |
|---------|------------|---------|
| Generic `except Exception as e: return json_response({error: str(e)[:300]})` | Most API routes | Truncates errors to 300 chars, always returns 500, no distinction between user error and server error |
| MySQL-specific handler in `helpers.py` | Registered globally | Good, but only catches connection errors (2003), not data errors (1062 duplicate, 1452 FK violation, 1366 bad value) |
| Retry logic for lock timeouts (1205) | `api_sync.py` only | Good pattern, but only in one file — other files with batch operations don't retry |
| No error handling | `api_events.py` automatch inner tiers | If tier 2 fails, tier 1 changes are already committed — partial state corruption |

**Problem 3: No automated tests for database operations**

The Python backend has zero unit tests for any database operation. The only test file (`test_imports.py`) checks that modules can be imported without circular dependencies. There are no tests for:
- SQL query correctness (wrong column names, missing WHERE clauses)
- Type coercion (the `_coerce_value()` function that was bug-fixed 3 times in one day)
- Transaction boundaries (partial commits on multi-step operations)
- Edge cases (NULL handling, empty strings vs None, datetime format mismatches)

### 3.2 Recommended Fix: Python DB Layer Overhaul

**Phase 1 — Connection pooling (Week 1)**

Replace `get_conn()` with a connection pool:

```python
# db.py — proposed replacement
from mysql.connector.pooling import MySQLConnectionPool

_pool = None
_pool_lock = threading.Lock()

def _get_pool():
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = MySQLConnectionPool(
                    pool_name="mmr_admin",
                    pool_size=5,
                    pool_reset_session=True,
                    **_db_config,
                    charset='utf8mb4',
                    collation='utf8mb4_unicode_ci',
                )
    return _pool

def get_conn():
    return _get_pool().get_connection()
```

**Phase 2 — Context manager for automatic cleanup (Week 1)**

```python
from contextlib import contextmanager

@contextmanager
def db_cursor(dictionary=True):
    conn = get_conn()
    try:
        cur = conn.cursor(dictionary=dictionary)
        yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()  # returns to pool
```

**Phase 3 — Typed error responses (Week 2)**

```python
from mysql.connector import Error as MySQLError

def handle_mysql_error(e: MySQLError) -> tuple:
    """Map MySQL error codes to HTTP status codes and user-friendly messages."""
    error_map = {
        1062: (409, "Duplicate entry"),
        1452: (422, "Referenced record does not exist"),
        1366: (422, "Invalid data format"),
        1205: (503, "Database busy, please retry"),
        2003: (503, "Database connection failed"),
        2006: (503, "Database connection lost"),
    }
    status, msg = error_map.get(e.errno, (500, "Database error"))
    return {'ok': False, 'error': msg, 'detail': str(e)[:500], 'errno': e.errno}, status
```

### 3.3 Comparison: TypeScript vs Python DB Access

| Aspect | mmr-webapp (TypeScript) | mmr-admin (Python) |
|--------|------------------------|-------------------|
| Driver | mysql2/promise | mysql-connector-python |
| Pooling | Yes (connectionLimit=10) | No (fresh connection per query) |
| Parameterized queries | Yes (?) | Yes (%s) |
| Error handling | Route-level try/catch | Inconsistent (4 patterns) |
| Connection cleanup | Pool-managed | Manual close (sometimes forgotten) |
| SSL | Always on (rejectUnauthorized=true) | Configurable (ssl_disabled flag) |
| Transaction support | Manual | Manual (inconsistent commit/rollback) |
| Unit tests for queries | None | None |

---

## 4. Code Duplication Map

### 4.1 Exact Duplicates

| Function | File A | File B | Action |
|----------|--------|--------|--------|
| `send_payment_approved_email()` | email_client.py:174 | webhook_client.py:255 | Extract interface, pluggable backends |
| `send_payment_rejected_email()` | email_client.py:210 | webhook_client.py:296 | Same |
| `send_membership_activated_email()` | email_client.py:243 | webhook_client.py:334 | Same |
| `send_admin_notification_email()` | email_client.py:281 | webhook_client.py:372 | Same |
| `_gen_id(prefix)` | payment_actions.py:47 | payment_handlers.py:24 | Move to helpers.py |
| `_get_config_value(key)` | api_sheets_sync.py:62 | api_sheets_diags.py:17 | Move to db.py or config.py |
| `_call_gas_webhook(payload)` | api_sheets_sync.py:68 | api_sheets_diags.py:26 | Move to webhook_client.py |

### 4.2 Cross-Service Duplicates

| Logic | Service A | Service B | Notes |
|-------|-----------|-----------|-------|
| NYRR API client | `web-apps/mmr-webapp/lib/nyrr/api.ts` (fetch) | `web-apps/gas/nyrr/src/nyrrApi.ts` (UrlFetchApp) | Different runtimes require separate implementations; acceptable |
| NYRR API client | `basecamp/python/nyrr_api.py` (requests) | Above two | Third implementation; shared by mmr-admin via sys.path |
| Member status derivation | `mmr-webapp/lib/db/members.ts` | `gas/membership/src/sheets.ts` | Both derive active/inactive/pending from expiration date |
| Email templates | `mmr-webapp/lib/email/templates.ts` | `gas/membership/src/email.ts` | Both generate bilingual HTML emails |
| Sync engine | `basecamp/python/sync_engine.py` | `mmr-admin/sync_engine.py` | Identical file copied (md5 match); should import, not copy |
| Column name mapping | `api_sheets_sync.py` | `gas/membership/src/webhook.ts` | camelCase ↔ PascalCase mapping in both Python and GAS |
| Datetime normalization | `api_sheets_sync.py` `_to_iso_datetime()` | `gas/membership/src/sheets.ts` | Both normalize JS Date.toString() format |
| Payment ID generation | `mmr-webapp/app/api/payments/submit/route.ts` (nanoid) | `gas/membership/src/dues.ts` (timestamp+random) | Different ID formats per service |

### 4.3 Consolidation Priority

**High priority** (save maintenance time, reduce bugs):
1. Email sending: Create abstract `EmailSender` interface in Python with `WebhookSender` and `DirectSender` backends
2. `sync_engine.py`: Make mmr-admin import from basecamp, not copy
3. `_gen_id`, `_get_config_value`, `_call_gas_webhook`: Move to shared modules

**Medium priority** (reduce drift between services):
4. Column mapping: Create a shared `column_map.json` that both Python and GAS read
5. Datetime normalization: Standardize on ISO 8601 everywhere; create shared utility per language

**Acceptable duplication** (different runtimes):
6. NYRR API clients (Python vs TypeScript vs GAS — can't share code across runtimes)
7. Email templates (different HTML renderers per runtime)

---

## 5. Files Exceeding Size Thresholds

Per CLAUDE.md, Python files >400 lines should be flagged. Here are all violations:

| File | Lines | Recommendation |
|------|-------|----------------|
| `mmr-admin/api_sheets_sync.py` | **2,224** | **CRITICAL** — Split into: `api_sheets_sync.py` (routes only, ~200 lines), `sync_workers.py` (async job runners), `sync_mysql_to_google.py`, `sync_google_to_mysql.py`, `sync_helpers.py` |
| `mmr-admin/api_sync.py` | 839 | Split NYRR load steps into `nyrr_loader.py`; keep routes thin |
| `mmr-admin/api_python_exec.py` | 716 | Acceptable (diagnostic tool); could extract function registry |
| `mmr-admin/sync_engine.py` | 598 | Acceptable (cohesive algorithm) |
| `mmr-admin/api_events.py` | 544 | Extract automatch algorithm into `automatch.py` |
| `mmr-admin/payment_actions.py` | 506 | Borderline; well-organized by concern |
| `mmr-admin/api_sheets_diags.py` | 436 | Acceptable (diagnostic tool) |
| `mmr-admin/webhook_client.py` | 425 | Acceptable (cohesive email sending) |
| `mmr-admin/auth.py` | 415 | Borderline; could extract OAuth flows |
| `mmr-admin/api_sync_old.py` | 415 | **DELETE** — deprecated, confirmed replaced |
| `mmr-admin/payment_handlers.py` | 405 | Borderline |
| `gas/membership/src/admin.ts` | 785 | Split admin operations by domain |
| `gas/membership/src/jobs.ts` | 764 | Split scheduled jobs into individual files |

---

## 6. Testing Strategy — Proposed

### 6.1 Current State

| Component | Unit Tests | Integration | E2E | Coverage |
|-----------|-----------|-------------|-----|----------|
| mmr-webapp | 4 suites (30 tests) | None | None | ~40% |
| GAS membership | 10 suites (2000+ LOC) | None | Manual | ~60% |
| mmr-admin | **0 suites** (import check only) | None | Manual | **~0%** |
| photo-manager | 1 suite (Azure API) | None | None | ~20% |
| basecamp ops | None | Manual scripts | None | ~10% |

The mmr-admin gap is the most critical because it handles all database mutations (sync, payments, events, member management) and is the service where MySQL bugs are discovered only on the frontend.

### 6.2 Proposed Testing Pyramid

```
         ┌──────────────┐
         │   E2E Tests   │  ← Playwright: 10 critical flows
         │   (10 tests)  │     Login → Pay → Approve → Active
         ├──────────────┤
         │  Integration  │  ← pytest: Real DB, test fixtures
         │  (30 tests)   │     Sync pipeline, payment flow,
         │               │     automatch algorithm
         ├──────────────┤
         │  Unit Tests   │  ← pytest (Python), Jest (TS)
         │  (100+ tests) │     DB queries, helpers, coercion,
         │               │     datetime normalization, ID gen
         └──────────────┘
```

### 6.3 Phase 1 — Python Unit Tests (Week 1-2)

Create `mmr-admin/tests/` directory with pytest fixtures and test files:

**Priority 1: Database layer tests** (`tests/test_db.py`)
- Test `query()` and `execute()` with a test database or mock
- Test connection error handling (simulate timeouts, connection refused)
- Test `_coerce_value()` with edge cases: empty strings, None, decimals, dates

**Priority 2: Sync logic tests** (`tests/test_sync_engine.py`)
- Test conflict resolution (Sheets wins on tie)
- Test datetime comparison with timezone offsets
- Test missing-timestamp edge cases
- Test the 6 conflict-resolution scenarios already documented in `_context.md`

**Priority 3: Payment workflow tests** (`tests/test_payments.py`)
- Test `_gen_id()` uniqueness and format
- Test payment status transitions (pending → matched → approved)
- Test email trigger conditions

**Priority 4: API route tests** (`tests/test_routes.py`)
- Test each blueprint's routes with Flask test client
- Test auth decorators (@login_required, @require_role)
- Test JSON response format consistency

### 6.4 Phase 2 — Integration Tests (Week 3-4)

**MySQL integration tests** (require test database):

```python
# tests/conftest.py — proposed
import pytest
from db import get_conn, execute, query

@pytest.fixture(scope='session')
def test_db():
    """Create a test database with schema_snapshot.sql."""
    conn = get_conn()
    conn.cursor().execute("CREATE DATABASE IF NOT EXISTS mmrdb_test")
    # Apply schema_snapshot.sql
    # Seed test data
    yield conn
    conn.cursor().execute("DROP DATABASE IF EXISTS mmrdb_test")
    conn.close()

@pytest.fixture(autouse=True)
def rollback_after_test(test_db):
    """Wrap each test in a transaction and roll back."""
    test_db.start_transaction()
    yield
    test_db.rollback()
```

**Key integration test scenarios**:
1. Member sync round-trip: Insert member in test DB → sync to mock Sheets → sync back → verify no data loss
2. Payment approval: Create webapp_event → approve → verify member status changes to active
3. NYRR automatch: Load test runners → run automatch → verify tier 1/2/3 matching
4. Schema drift: Compare `schema_snapshot.sql` against test DB DDL

### 6.5 Phase 3 — Pre-Push Self-Checks (Week 2)

Extend `.githooks/pre-commit` to catch MySQL errors before push:

```bash
#!/bin/bash
# .githooks/pre-commit — expanded

echo "🔍 Running pre-commit checks..."

# 1. Python import check (existing)
cd mmr-admin && python3 test_imports.py
if [ $? -ne 0 ]; then echo "❌ Import check failed"; exit 1; fi

# 2. Python unit tests (new)
python3 -m pytest tests/ -x -q --tb=short 2>/dev/null
if [ $? -ne 0 ]; then echo "❌ Python tests failed"; exit 1; fi

# 3. SQL syntax validation (new)
python3 tests/validate_sql.py
if [ $? -ne 0 ]; then echo "❌ SQL validation failed"; exit 1; fi

# 4. TypeScript build check
cd ../web-apps/mmr-webapp && npm run build 2>&1 | tail -5
if [ $? -ne 0 ]; then echo "❌ TypeScript build failed"; exit 1; fi

echo "✅ All pre-commit checks passed"
```

### 6.6 SQL Validation Script (New Tool)

Create `mmr-admin/tests/validate_sql.py` to catch common MySQL mistakes:

```python
"""
Scan Python files for SQL strings and validate:
1. Column names match schema_snapshot.sql
2. Table names exist
3. No string concatenation in queries (SQL injection risk)
4. Parameterized queries use %s (not f-strings)
"""
```

This directly addresses the pain point of "code not working" — catching column name typos, missing table references, and unsafe query construction before deployment.

---

## 7. Stale Documentation Inventory

| File | Last Updated | Issue | Action |
|------|-------------|-------|--------|
| `DOCUMENTATION_INDEX.md` | Mar 26 | 29KB master index; doesn't reflect Mar 31 cleanup (deleted files still listed) | Regenerate from current structure or delete |
| `BUGS_AND_FEATURES.md` | Mar 22 | 10 days stale; contains completed items mixed with open | Review, close completed, merge open into PROJECT_PLAN.md |
| `docs/TESTING.md` | Mar 26 | References `sync-all-sheets-ordered.yml` which was deleted; workflow table outdated | Update to reflect current 7 workflows |
| `basecamp/README.md` | Unknown | Shows imports from `google_workspace.py` and `mysql_sync.py` — both are 0-byte stubs | Rewrite to reflect actual structure |
| `AZURE.md` (root) | Mar 30 | 1.3KB — too minimal, duplicates info in `docs/AZURE.md` and `DEPLOYMENT.md` | Consolidate into one `DEPLOYMENT.md` |
| `photo-manager/*.docx` | Mar 26 | Duplicate of .md versions (phase1-plan, round2-plan) | Keep .md only, delete .docx |
| `DEBUG_ENHANCEMENTS.md` | Mar 28 | Debugging tips that should live in `docs/TROUBLESHOOTING.md` | Merge into TROUBLESHOOTING.md |
| `CLEANUP_SUMMARY.md` | Mar 31 | One-time cleanup log; should be archived | Move to `docs/archive/` |

### Proposed Documentation Structure (Consolidated)

```
ROOT/
├── README.md              ← Entry point (keep as-is)
├── CLAUDE.md              ← AI instructions (keep as-is)
├── CHANGELOG.md           ← Version history (keep as-is)
├── PROJECT_PLAN.md        ← Roadmap + open features (absorb BUGS_AND_FEATURES.md)
├── _context.md            ← Session log (keep as-is)
├── _context_archive.md    ← Old sessions (keep as-is)
│
├── docs/
│   ├── ARCHITECTURE.md    ← NEW: This audit report, maintained going forward
│   ├── DEPLOYMENT.md      ← Merge root AZURE.md + DEPLOYMENT.md + docs/AZURE.md
│   ├── TESTING.md         ← Update with current workflows and new test plan
│   ├── LOCAL_SETUP.md     ← Consolidate LOCAL_SETUP_ALL.md
│   ├── SYNC_ARCHITECTURE.md  ← Keep (comprehensive)
│   ├── EMAIL_INFRASTRUCTURE.md ← Keep
│   ├── TROUBLESHOOTING.md ← Absorb DEBUG_ENHANCEMENTS.md
│   ├── WORKFLOWS.md       ← NEW: Document all 7 GitHub Actions
│   └── archive/           ← Move: CLEANUP_SUMMARY.md, sprint logs, old plans
│
├── DELETE:
│   ├── DOCUMENTATION_INDEX.md  (outdated, 29KB)
│   ├── BUGS_AND_FEATURES.md    (merge into PROJECT_PLAN.md)
│   ├── DEBUG_ENHANCEMENTS.md   (merge into TROUBLESHOOTING.md)
│   ├── AZURE.md (root)         (merge into docs/DEPLOYMENT.md)
│   ├── MONOREPO.md             (merge into docs/ARCHITECTURE.md)
```

---

## 8. Reorganization Roadmap

### Sprint 1: Foundation (Week 1-2) — "Stop the Bleeding"

**Goal**: Fix the MySQL pain point and establish basic testing.

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 1.1 | Add connection pooling to `mmr-admin/db.py` | 2h | Eliminates intermittent connection failures |
| 1.2 | Add `db_cursor()` context manager with auto-rollback | 1h | Prevents partial commits |
| 1.3 | Create `handle_mysql_error()` with error code mapping | 2h | Frontend gets actionable error messages |
| 1.4 | Create `mmr-admin/tests/` with pytest + conftest.py | 3h | Testing infrastructure |
| 1.5 | Write 20 unit tests for db.py, sync_engine.py, helpers | 4h | Catch query bugs before deploy |
| 1.6 | Expand `.githooks/pre-commit` to run pytest | 1h | Self-checking on every commit |
| 1.7 | Delete `api_sync_old.py` (deprecated) | 5min | Remove dead code |
| 1.8 | Delete 3 empty stubs (google_workspace.py, mysql_sync.py, members.sql) | 5min | Remove confusion |

### Sprint 2: Consolidation (Week 3-4) — "One Place for Everything"

**Goal**: Eliminate duplication and establish shared modules.

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 2.1 | Split `api_sheets_sync.py` (2224 lines) into 5 modules | 4h | Maintainability, testability |
| 2.2 | Create `mmr-admin/email_service.py` — abstract interface with webhook + direct backends | 3h | Eliminates 4 duplicate email functions |
| 2.3 | Move `_gen_id`, `_get_config_value`, `_call_gas_webhook` to shared modules | 1h | Single source of truth |
| 2.4 | Make mmr-admin import sync_engine from basecamp (not copy) | 1h | Eliminates file duplication |
| 2.5 | Create `column_map.json` for Sheets ↔ MySQL field mapping | 2h | Shared across Python and GAS |
| 2.6 | Standardize datetime normalization into `mmr-admin/datetime_utils.py` | 2h | One place for all datetime logic |
| 2.7 | Write 30 integration tests (sync round-trip, payment flow, automatch) | 6h | Catch cross-module bugs |

### Sprint 3: Documentation (Week 5) — "Know Where Everything Lives"

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 3.1 | Regenerate or delete `DOCUMENTATION_INDEX.md` | 30min | Remove stale reference |
| 3.2 | Merge `BUGS_AND_FEATURES.md` into `PROJECT_PLAN.md` | 30min | Single backlog |
| 3.3 | Merge `DEBUG_ENHANCEMENTS.md` into `docs/TROUBLESHOOTING.md` | 30min | One debugging guide |
| 3.4 | Consolidate `AZURE.md` + `DEPLOYMENT.md` → `docs/DEPLOYMENT.md` | 1h | One deployment guide |
| 3.5 | Update `docs/TESTING.md` with new pytest strategy and current workflows | 1h | Accurate test guide |
| 3.6 | Create `docs/WORKFLOWS.md` documenting all 7 GitHub Actions | 1h | Workflow clarity |
| 3.7 | Rewrite `basecamp/README.md` to reflect actual code structure | 30min | Remove misleading imports |
| 3.8 | Move `CLEANUP_SUMMARY.md` to `docs/archive/` | 5min | Declutter root |

### Sprint 4: Testing Maturity (Week 6-8) — "Catch Bugs Before Deploy"

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 4.1 | Create `mmr-admin/tests/validate_sql.py` — scan for schema mismatches | 4h | Catch column name typos |
| 4.2 | Add SQL validation to pre-commit hook | 1h | Automated schema checking |
| 4.3 | Create test database fixture with `schema_snapshot.sql` | 3h | Real MySQL integration tests |
| 4.4 | Write 40+ integration tests for all API blueprints | 8h | Route-level coverage |
| 4.5 | Add `pytest` step to `deploy-mmr-admin.yml` CI | 1h | Block deploy on test failure |
| 4.6 | Set up Playwright for 10 critical E2E flows | 8h | Full-stack validation |
| 4.7 | Add API contract tests between webapp ↔ mmr-admin | 4h | Prevent interface drift |

### Sprint 5: Architecture (Week 9-12) — "Long-term Health"

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 5.1 | Evaluate migrating mmr-admin routes into mmr-webapp `/admin` sub-route | 8h | Eliminate Python stack entirely |
| 5.2 | If migrating: extract shared types as JSON Schema → auto-gen Python + TS | 4h | Schema enforcement |
| 5.3 | Consolidate auth into single Identity Provider (Clerk/Auth0/custom) | 16h | One auth surface |
| 5.4 | Create Admin Portal buttons for every GitHub Action (UI parity) | 8h | No more manual GitHub runs |
| 5.5 | Migrate GAS NYRR backend to mmr-admin (expose as API) | 12h | Fewer deployment targets |
| 5.6 | Design photo browser in Member Portal | 16h | Member-facing photo feature |

---

## 9. Orphaned and Dead Files

Files that should be deleted immediately (no dependencies, confirmed replaced):

| File | Reason |
|------|--------|
| `mmr-admin/api_sync_old.py` (415 lines) | Deprecated; replaced by api_sync.py |
| `basecamp/python/google_workspace.py` (0 bytes) | Empty stub; never implemented |
| `basecamp/python/mysql_sync.py` (0 bytes) | Empty stub; never implemented |
| `db/schemas/members.sql` (0 bytes) | Empty stub; schema_snapshot.sql is canonical |
| `reconcile_families.sh` (root) | Orphaned; no recent modifications, not referenced |

Files that should be reviewed for deletion:

| File | Reason | Check First |
|------|--------|-------------|
| `db/schemas/*.sql` (6 files) | Marked deprecated in CLEANUP_SUMMARY | Confirm schema_snapshot.sql covers all |
| `basecamp/schemas/` (directory) | Should have been deleted in cleanup | Verify it's truly empty/deprecated |
| 3 disabled GitHub workflows | No trigger after sync-all-sheets-ordered deletion | Decide: re-enable or delete |
| `photo-manager/*.docx` (2 files) | Duplicate of .md versions | Confirm .md is authoritative |
| `nyrr-backend-migration-plan.docx` (root) | Has .md version in docs/ | Confirm .md is authoritative |
| `Face_API_Application_MMR.docx` (root) | Application document — may not belong in repo | Move to docs/archive/ |

---

## 10. Immediate Action Items (This Session)

These can be done right now with minimal risk:

- [ ] Delete `mmr-admin/api_sync_old.py`
- [ ] Delete `basecamp/python/google_workspace.py` (0 bytes)
- [ ] Delete `basecamp/python/mysql_sync.py` (0 bytes)
- [ ] Delete `db/schemas/members.sql` (0 bytes)
- [ ] Create `mmr-admin/tests/__init__.py` and `mmr-admin/tests/conftest.py`
- [ ] Add `pytest` to `mmr-admin/requirements.txt`
- [ ] Write first 5 unit tests for `db.py` (query, execute, error handling)
- [ ] Update `docs/TESTING.md` workflow table (remove deleted workflows)
- [ ] Move `CLEANUP_SUMMARY.md` to `docs/archive/`

---

## Appendix A: Database Schema Quick Reference

**18 tables** in `mmrdb` (from schema_snapshot.sql, April 1 2026):

| Table | Primary Key | Key Columns | Used By |
|-------|-------------|-------------|---------|
| members | MemberID (varchar) | Email, Status, Expiration, FamilyID, Type | All services |
| webapp_events | EventID (varchar) | EventType, MemberID, Status, Amount, PaymentMethod | Webapp, Admin |
| payments | id (auto) | MemberID, Amount, Status, CreatedAt | Webapp, Admin, GAS |
| gmail_transactions | id (auto) | Subject, Amount, TimeStamp, ProcessedTime | Admin (sync) |
| nyrr_events | id (auto) | event_code, name, date, distance, status | Admin, Webapp |
| nyrr_event_runners | id (auto) | event_id FK, member_id FK, finish_time | Admin, Webapp |
| nyrr_runner_info | id (auto) | nyrr_runner_id, first_name, last_name | Admin |
| admins | id (auto) | email, added_by | Webapp |
| viewer_admins | id (auto) | email, role | Admin |
| config | key (varchar) | value | Admin, GAS |
| activity_log | id (auto) | action, email, timestamp | Admin |
| member_log | id (auto) | member_id, field, old_value, new_value | Admin |
| sync_metadata | id (auto) | table_name, last_sync, row_count | Admin |
| sync_snapshots | id (auto) | table_name, snapshot_data | Admin |
| viewer_user_settings | id (auto) | email, table_name, visible_columns (JSON) | Admin |

*(Photo tables: photo_events, photos, photo_detections, photo_favorites, photo_feedback, photo_detection_corrections, member_reference_photos, member_bib_assignments — used by Webapp + Photo Manager)*

## Appendix B: Auth Surface Inventory

| Service | Auth Method | Session Store | Token Format |
|---------|-------------|---------------|--------------|
| mmr-webapp | NextAuth (Google, Microsoft, email+password) | Cookie (`mmr_session`) | JWT (jose, HS256) |
| mmr-admin | Custom OAuth (Google, Microsoft) + password | Flask session (server-side) | Session cookie |
| GAS membership | OTP (email code) + Google login (Apps Script) | PropertiesService | GAS internal |
| GitHub Actions | `X-Cron-Token` header | None (stateless) | Shared secret |

**Risk**: Three independent auth implementations mean three surfaces for security bugs. A session in mmr-webapp does NOT grant access to mmr-admin — they're completely separate identity domains, even though both use the same OAuth credentials.

---

*Report generated April 1, 2026. To be maintained as `docs/ARCHITECTURE.md` going forward.*
