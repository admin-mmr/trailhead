# MMR Admin — Testing Guide

**Last updated:** 2026-04-12

---

## Pre-Push Routine

Run from `mmr-admin/`:

```bash
./pre-push.sh
```

Optional flags:

| Flag | Effect |
|---|---|
| `--step N` | Run only step N (1–6) |
| `--no-integration` | Skip steps 3 & 4 (no live DB needed) |
| `--no-ts` | Skip step 5 (TypeScript check) |
| `--help` | Print usage summary |

---

## Steps at a Glance

| # | Step | Tool | Live DB? |
|---|---|---|---|
| 1 | Import sanity | `test_imports.py` | No |
| 2 | Unit tests | `pytest tests/` (mocked) | No |
| 3 | Integration tests | `pytest tests/integration/` | **Yes** |
| 4 | Schema validation | `db/validate_schema.py` | **Yes** |
| 5 | TypeScript check | `npx tsc --noEmit` | No |
| 6 | Flask startup smoke | inline python3 check | No |

---

## Running Steps Manually

### Step 1 — Import sanity
Catches circular imports and syntax errors across all admin modules.
```bash
cd mmr-admin && python3 test_imports.py
```

### Step 2 — Unit tests (no live DB)
All tests use mocked DB via `conftest.py` (`DEV_BYPASS_AUTH=true`, `db.get_conn` mocked).
```bash
pytest tests/ --ignore=tests/integration -v
```

**Test files:**

| File | What it covers |
|---|---|
| `test_api_smoke.py` | Core endpoint 200/auth responses |
| `test_api_smoke_extended.py` | Extended endpoint coverage |
| `test_api_response_format.py` | JSON shape validation |
| `test_endpoint_coverage.py` | All routes have tests |
| `test_db.py` | DB helper behaviour (mocked) |
| `test_payment_type.py` | Payment type enum logic |
| `test_safe_columns.py` | Column allowlist enforcement |
| `test_sql_columns.py` | SQL column name sanitisation |
| `test_sync_coerce.py` | Type coercion in sync engine |
| `test_sync_status.py` | Sync job status transitions |
| `test_actlog_email_constraint.py` | Activity log email constraint |
| `test_trigger_columns.py` | DB trigger column existence |

### Step 3 — Integration tests (live Azure DB)
Requires environment loaded from macOS Keychain via `load-env.sh`.
```bash
source ../load-env.sh
pytest tests/integration/ -v
```

### Step 4 — Schema validation
```bash
source ../load-env.sh && python3 ../db/validate_schema.py
```
Checks: NULL violations, FK orphans, ENUM mismatches, missing PKs, duplicate uniques.

### Step 5 — TypeScript (web app)
```bash
cd web-apps/mmr-webapp && npx tsc --noEmit
```
Or use the `mmr-check` alias from repo root.

### Step 6 — Flask startup smoke
```bash
cd mmr-admin && python3 -c "
import os; os.environ['DEV_BYPASS_AUTH']='true'
from app import app; print('OK:', app.name)
"
```

---

## Quick No-DB Check (CI / fast iteration)
```bash
cd mmr-admin && python3 test_imports.py && \
  pytest tests/ --ignore=tests/integration -v
```

---

## Adding New Tests

- **Unit tests** → `tests/` (mock DB via `conftest.py` `client` fixture)
- **Integration tests** → `tests/integration/` (use `conftest_integration.py`)
- **New module** → `test_imports.py` auto-discovers it; no changes needed

---

## Environment

- Secrets via macOS Keychain only — no `.env` files committed
- Load env: `source load-env.sh` (repo root)
- DB alias: `mysql-mmr`
- Admin shortcuts: `adm-test`, `adm-logs`, `adm-restart`, `adm-status`
