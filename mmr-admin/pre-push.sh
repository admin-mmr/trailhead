#!/usr/bin/env bash
# =============================================================================
# MMR Admin — Pre-Push Routine
# Run from: mmr-admin/
# Usage:    ./pre-push.sh [OPTIONS]
#
# Options:
#   --step N          Run only step N (1–6)
#   --no-integration  Skip steps 3 & 4 (no live DB needed)
#   --no-ts           Skip step 5 (TypeScript check)
#   --help            Show this help
#
# Steps:
#   1  Import sanity       python3 test_imports.py
#   2  Unit tests          pytest tests/ (mocked DB, no live connection)
#   3  Integration tests   pytest test_integration_*.py (requires live DB)
#   4  Schema validation   db/validate_schema.py (requires live DB)
#   5  TypeScript check    npx tsc --noEmit (mmr-webapp)
#   6  Flask startup smoke python3 -c "from app import app"
# =============================================================================

set -uo pipefail   # NOTE: no -e — we handle exit codes manually per step

SKIP_INTEGRATION=false
SKIP_TS=false
ONLY_STEP=""
PASS=0
FAIL=0
SKIP=0

# --- Arg parsing ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --step)
      ONLY_STEP="$2"; shift 2 ;;
    --step=*)
      ONLY_STEP="${1#--step=}"; shift ;;
    --no-integration)
      SKIP_INTEGRATION=true; shift ;;
    --no-ts)
      SKIP_TS=true; shift ;;
    --help|-h)
      sed -n '/^# Usage/,/^# ====/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      echo "Unknown option: $1"; exit 1 ;;
  esac
done

# --- Helpers ---
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass() { echo -e "${GREEN}✅  $1${NC}"; PASS=$((PASS + 1)); }
fail() { echo -e "${RED}❌  $1${NC}";  FAIL=$((FAIL + 1)); }
skip() { echo -e "${YELLOW}⏭️   $1${NC}"; SKIP=$((SKIP + 1)); }

should_run() { [[ -z "$ONLY_STEP" || "$ONLY_STEP" == "$1" ]]; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "=================================================="
if [[ -n "$ONLY_STEP" ]]; then
  echo "  MMR Admin Pre-Push — Step $ONLY_STEP only — $(date '+%Y-%m-%d %H:%M')"
else
  echo "  MMR Admin Pre-Push Checks — $(date '+%Y-%m-%d %H:%M')"
fi
echo "=================================================="
echo ""

# ------------------------------------------------------------------
# Step 1 — Import sanity (circular imports, syntax errors)
# ------------------------------------------------------------------
if should_run 1; then
  echo "▶ Step 1: Import sanity (test_imports.py)"
  if python3 test_imports.py > /tmp/mmr_imports.log 2>&1; then
    pass "All modules import cleanly"
  else
    fail "Import errors detected"
    cat /tmp/mmr_imports.log
  fi
  echo ""
fi

# ------------------------------------------------------------------
# Step 2 — Unit tests (no live DB)
# ------------------------------------------------------------------
if should_run 2; then
  echo "▶ Step 2: Unit tests (mocked DB)"
  if pytest tests/ \
      --ignore=tests/test_integration_payments.py \
      --ignore=tests/test_integration_stored_procs.py \
      --tb=short -q > /tmp/mmr_unit.log 2>&1; then
    UNIT_SUMMARY=$(tail -1 /tmp/mmr_unit.log)
    pass "Unit tests passed — $UNIT_SUMMARY"
  else
    fail "Unit tests failed"
    cat /tmp/mmr_unit.log
  fi
  echo ""
fi

# ------------------------------------------------------------------
# Step 3 — Integration tests (live Azure DB)
# ------------------------------------------------------------------
if should_run 3; then
  echo "▶ Step 3: Integration tests (live DB)"
  if $SKIP_INTEGRATION; then
    skip "Skipped (--no-integration)"
  else
    ENV_FILE="$REPO_ROOT/load-env.sh"
    if [[ ! -f "$ENV_FILE" ]]; then
      skip "load-env.sh not found — skipping"
    else
      # shellcheck disable=SC1090
      source "$ENV_FILE"
      if pytest tests/test_integration_payments.py tests/test_integration_stored_procs.py \
          --tb=short -q > /tmp/mmr_integration.log 2>&1; then
        INT_SUMMARY=$(tail -1 /tmp/mmr_integration.log)
        pass "Integration tests passed — $INT_SUMMARY"
      else
        fail "Integration tests failed"
        cat /tmp/mmr_integration.log
      fi
    fi
  fi
  echo ""
fi

# ------------------------------------------------------------------
# Step 4 — Schema validation
# ------------------------------------------------------------------
if should_run 4; then
  echo "▶ Step 4: Schema validation (validate_schema.py)"
  if $SKIP_INTEGRATION; then
    skip "Skipped (--no-integration implies no live DB)"
  else
    if [[ -f "$REPO_ROOT/db/validate_schema.py" ]]; then
      ENV_FILE="$REPO_ROOT/load-env.sh"
      [[ -f "$ENV_FILE" ]] && source "$ENV_FILE"  # may already be loaded
      if python3 "$REPO_ROOT/db/validate_schema.py" > /tmp/mmr_schema.log 2>&1; then
        pass "Schema validation clean"
      else
        fail "Schema validation failed"
        cat /tmp/mmr_schema.log
      fi
    else
      skip "db/validate_schema.py not found"
    fi
  fi
  echo ""
fi

# ------------------------------------------------------------------
# Step 5 — TypeScript check (web app)
# ------------------------------------------------------------------
if should_run 5; then
  echo "▶ Step 5: TypeScript check (mmr-webapp)"
  if $SKIP_TS; then
    skip "Skipped (--no-ts)"
  else
    WEBAPP="$REPO_ROOT/web-apps/mmr-webapp"
    if [[ -d "$WEBAPP" ]]; then
      if (cd "$WEBAPP" && npx tsc --noEmit > /tmp/mmr_ts.log 2>&1); then
        pass "TypeScript check passed"
      else
        fail "TypeScript errors found"
        cat /tmp/mmr_ts.log
      fi
    else
      skip "mmr-webapp not found"
    fi
  fi
  echo ""
fi

# ------------------------------------------------------------------
# Step 6 — Flask app startup smoke
# ------------------------------------------------------------------
if should_run 6; then
  echo "▶ Step 6: Flask app startup smoke"
  if python3 - > /tmp/mmr_flask.log 2>&1 <<'PYEOF'
import sys, os
sys.path.insert(0, '.')
os.environ.setdefault('DEV_BYPASS_AUTH', 'true')
try:
    from app import app
    print('App created OK:', app.name)
except Exception as e:
    print('FAIL:', e)
    sys.exit(1)
PYEOF
  then
    pass "Flask app initialises cleanly"
  else
    fail "Flask startup error"
    cat /tmp/mmr_flask.log
  fi
  echo ""
fi

# ------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------
echo "=================================================="
echo -e "  Results: ${GREEN}${PASS} passed${NC}  ${RED}${FAIL} failed${NC}  ${YELLOW}${SKIP} skipped${NC}"
echo "=================================================="
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo -e "${RED}⛔  Fix failures before pushing.${NC}"
  exit 1
else
  echo -e "${GREEN}🚀  All checks passed — safe to push.${NC}"
  exit 0
fi
