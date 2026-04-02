#!/usr/bin/env bash
# Usage: run_sync_phase.sh <endpoint-path> [--verbose]
# e.g.   run_sync_phase.sh /api/sync/mysql-to-google/members
# e.g.   run_sync_phase.sh /api/sync/mysql-to-google/members --verbose
#
# Env vars expected (set by the workflow):
#   ADMIN_URL      — base URL of the admin app, no trailing slash
#   CRON_TOKEN     — value of the X-Cron-Token header
#   POLL_INTERVAL  — seconds between polls (default 5)
#   POLL_TIMEOUT   — max seconds to wait (default 300)
#
# Writes to GITHUB_OUTPUT:
#   status  — "done" | "error" | "timeout"
#   summary — human-readable job message
set -euo pipefail

ENDPOINT="${1:?endpoint argument required}"
VERBOSE="${2:-}"  # Optional --verbose flag
POLL_INTERVAL="${POLL_INTERVAL:-5}"
POLL_TIMEOUT="${POLL_TIMEOUT:-300}"

# Append ?verbose=true if --verbose flag is set
if [ "$VERBOSE" = "--verbose" ]; then
  ENDPOINT="${ENDPOINT}?verbose=true"
fi

# ── Trigger job ──────────────────────────────────────────────────────────────
echo "▶ POST $ADMIN_URL$ENDPOINT"
RESP=$(curl -sf -X POST "$ADMIN_URL$ENDPOINT" \
  -H "X-Cron-Token: $CRON_TOKEN" \
  -H "Content-Type: application/json")

JOB_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['job_id'])")
echo "job_id=$JOB_ID"

# ── Poll until done / error / timeout ────────────────────────────────────────
ELAPSED=0
while [ "$ELAPSED" -lt "$POLL_TIMEOUT" ]; do
  sleep "$POLL_INTERVAL"
  ELAPSED=$((ELAPSED + POLL_INTERVAL))

  STATUS_RESP=$(curl -sf "$ADMIN_URL/api/sync/status/$JOB_ID" \
    -H "X-Cron-Token: $CRON_TOKEN")

  JOB_STATUS=$(echo "$STATUS_RESP" | python3 -c \
    "import sys,json; print(json.load(sys.stdin)['data'].get('status',''))")
  JOB_MSG=$(echo "$STATUS_RESP" | python3 -c \
    "import sys,json; print(json.load(sys.stdin)['data'].get('message',''))")

  echo "[${ELAPSED}s] $JOB_STATUS — $JOB_MSG"

  if [ "$JOB_STATUS" = "done" ] || [ "$JOB_STATUS" = "error" ]; then
    echo "status=$JOB_STATUS" >> "$GITHUB_OUTPUT"
    echo "summary=$JOB_MSG"   >> "$GITHUB_OUTPUT"
    [ "$JOB_STATUS" = "error" ] && exit 1 || exit 0
  fi
done

echo "status=timeout"                           >> "$GITHUB_OUTPUT"
echo "summary=Timed out after ${POLL_TIMEOUT}s" >> "$GITHUB_OUTPUT"
exit 1
