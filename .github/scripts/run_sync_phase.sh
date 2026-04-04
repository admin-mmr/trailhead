#!/usr/bin/env bash
# Usage: run_sync_phase.sh <endpoint-path> [--verbose]
# e.g.   run_sync_phase.sh /api/sync/mysql-to-google/members
# e.g.   run_sync_phase.sh /api/sync/mysql-to-google/members --verbose
#
# Env vars expected (set by the workflow):
#   ADMIN_URL        — base URL of the admin app, no trailing slash
#   CRON_TOKEN       — value of the X-Cron-Token header
#   POLL_INTERVAL    — initial polling interval in seconds (default 10, grows exponentially)
#   POLL_MAX_INTERVAL — max polling interval (default 60s)
#   POLL_TIMEOUT     — max seconds to wait (default 600)
#   CIRCUIT_BREAKER  — max consecutive 404/5xx errors before giving up (default 10)
#
# Writes to GITHUB_OUTPUT:
#   status  — "done" | "error" | "timeout" | "circuit-breaker"
#   summary — human-readable job message
set -euo pipefail

ENDPOINT="${1:?endpoint argument required}"
VERBOSE="${2:-}"  # Optional --verbose flag
POLL_INTERVAL="${POLL_INTERVAL:-10}"           # Start at 10s
POLL_MAX_INTERVAL="${POLL_MAX_INTERVAL:-60}"   # Cap at 60s
POLL_TIMEOUT="${POLL_TIMEOUT:-600}"            # 10 min timeout
CIRCUIT_BREAKER="${CIRCUIT_BREAKER:-10}"       # Fail after 10 consecutive errors

# Guard: fail fast if secrets are not configured
if [ -z "${CRON_TOKEN:-}" ]; then
  echo "❌ ERROR: CRON_TOKEN is empty. Set the SYNC_CRON_TOKEN secret in GitHub repo settings."
  echo "status=error" >> "$GITHUB_OUTPUT"
  echo "summary=SYNC_CRON_TOKEN secret not configured" >> "$GITHUB_OUTPUT"
  exit 1
fi
if [ -z "${ADMIN_URL:-}" ]; then
  echo "❌ ERROR: ADMIN_URL is empty. Set the MMR_ADMIN_URL secret in GitHub repo settings."
  echo "status=error" >> "$GITHUB_OUTPUT"
  echo "summary=MMR_ADMIN_URL secret not configured" >> "$GITHUB_OUTPUT"
  exit 1
fi

# Append ?verbose=true if --verbose flag is set
if [ "$VERBOSE" = "--verbose" ]; then
  ENDPOINT="${ENDPOINT}?verbose=true"
fi

# ── Trigger job ──────────────────────────────────────────────────────────────
echo "▶ POST $ADMIN_URL$ENDPOINT"
RESP=$(curl -sf -X POST "$ADMIN_URL$ENDPOINT" \
  -H "X-Cron-Token: $CRON_TOKEN" \
  -H "Content-Type: application/json" 2>&1) || true

# Debug: show raw response if it looks empty or like an error
if [ -z "$RESP" ]; then
  echo "❌ ERROR: Empty response from server"
  exit 1
fi

if echo "$RESP" | grep -q "^<html\|<!DOCTYPE\|error\|Error\|ERROR"; then
  echo "❌ ERROR: Unexpected response (HTML error or plain text):"
  echo "$RESP" | head -20
  exit 1
fi

JOB_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['job_id'])" 2>&1) || {
  echo "❌ ERROR: Failed to parse JSON response:"
  echo "Response was: $RESP" | head -100
  exit 1
}
echo "job_id=$JOB_ID"

# ── Poll until done / error / timeout ────────────────────────────────────────
ELAPSED=0
CURRENT_INTERVAL="$POLL_INTERVAL"
CONSECUTIVE_ERRORS=0
JITTER_SEED=$RANDOM

while [ "$ELAPSED" -lt "$POLL_TIMEOUT" ]; do
  # Exponential backoff with jitter: avoid thundering herd
  # Jitter = random 0-20% of current interval to stagger requests
  JITTER=$(( (JITTER_SEED % 20) + 90 ))  # 90-110% of interval
  SLEEP_TIME=$(( CURRENT_INTERVAL * JITTER / 100 ))

  sleep "$SLEEP_TIME"
  ELAPSED=$((ELAPSED + SLEEP_TIME))

  # Fetch status with timeout and error handling
  STATUS_RESP=$(curl -sf --max-time 10 "$ADMIN_URL/api/sync/status/$JOB_ID" \
    -H "X-Cron-Token: $CRON_TOKEN" 2>&1) || STATUS_RESP=""
  CURL_EXIT=$?

  # Handle connection/timeout errors
  if [ $CURL_EXIT -ne 0 ] || [ -z "$STATUS_RESP" ]; then
    CONSECUTIVE_ERRORS=$((CONSECUTIVE_ERRORS + 1))
    if [ $CONSECUTIVE_ERRORS -ge "$CIRCUIT_BREAKER" ]; then
      echo "[${ELAPSED}s] 🔌 CIRCUIT BREAKER: $CONSECUTIVE_ERRORS consecutive errors, giving up"
      echo "status=circuit-breaker" >> "$GITHUB_OUTPUT"
      echo "summary=Circuit breaker triggered after $CONSECUTIVE_ERRORS consecutive errors" >> "$GITHUB_OUTPUT"
      exit 1
    fi
    echo "[${ELAPSED}s] ⏳ Retry ($CONSECUTIVE_ERRORS/$CIRCUIT_BREAKER) — network/timeout error"

    # Increase backoff interval exponentially (max 60s)
    CURRENT_INTERVAL=$((CURRENT_INTERVAL * 2))
    if [ "$CURRENT_INTERVAL" -gt "$POLL_MAX_INTERVAL" ]; then
      CURRENT_INTERVAL="$POLL_MAX_INTERVAL"
    fi
    continue
  fi

  # Reset error counter on successful response
  CONSECUTIVE_ERRORS=0

  # Check for auth/server errors (401, 403, 500, etc.)
  if echo "$STATUS_RESP" | grep -q "^<html\|<!DOCTYPE\|401\|403\|500\|502\|503"; then
    echo "[${ELAPSED}s] ❌ ERROR: Auth failed or server error"
    echo "Response: $STATUS_RESP" | head -20
    exit 1
  fi

  # Parse status and message (with error handling)
  JOB_STATUS=$(echo "$STATUS_RESP" | python3 -c \
    "import sys,json; print(json.load(sys.stdin).get('data', {}).get('status', ''))" 2>&1) || JOB_STATUS=""

  if [ -z "$JOB_STATUS" ]; then
    echo "[${ELAPSED}s] ❌ ERROR: Failed to parse status response: $STATUS_RESP"
    exit 1
  fi

  JOB_MSG=$(echo "$STATUS_RESP" | python3 -c \
    "import sys,json; print(json.load(sys.stdin).get('data', {}).get('message', ''))" 2>&1) || JOB_MSG="(unknown)"

  # Decrease backoff interval on progress
  if [ "$CURRENT_INTERVAL" -gt "$POLL_INTERVAL" ]; then
    CURRENT_INTERVAL=$((CURRENT_INTERVAL / 2))
    if [ "$CURRENT_INTERVAL" -lt "$POLL_INTERVAL" ]; then
      CURRENT_INTERVAL="$POLL_INTERVAL"
    fi
  fi

  echo "[${ELAPSED}s] $JOB_STATUS — $JOB_MSG (interval: ${CURRENT_INTERVAL}s)"

  if [ "$JOB_STATUS" = "done" ] || [ "$JOB_STATUS" = "error" ]; then
    echo "status=$JOB_STATUS" >> "$GITHUB_OUTPUT"
    echo "summary=$JOB_MSG"   >> "$GITHUB_OUTPUT"
    [ "$JOB_STATUS" = "error" ] && exit 1 || exit 0
  fi
done

echo "status=timeout"                           >> "$GITHUB_OUTPUT"
echo "summary=Timed out after ${POLL_TIMEOUT}s" >> "$GITHUB_OUTPUT"
exit 1
