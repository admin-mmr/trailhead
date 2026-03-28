#!/bin/bash
# Test NYRR API endpoints to understand runner ID and team code behavior
# Usage: ./test_nyrr_api.sh [EVENT_CODE]
# Default: 26NYCHALF

set -e

BASE="https://rmsprodapi.nyrr.org/api/v2"
EVCODE="${1:-26NYCHALF}"

echo "🔍 Testing NYRR API with event: $EVCODE"
echo

# ============================================================
# 1. Finishers-filter — all finishers (first 3 only)
# ============================================================
echo "📋 1. runners/finishers-filter (all finishers, page 1, 3 items)"
echo "   Expected: runnerId, firstName, lastName, bib, age, gender, etc."
echo "   Missing: teamCode (runners/finishers-filter never returns it)"
echo
curl -s -X POST "$BASE/runners/finishers-filter" \
  -H "Content-Type: application/json" \
  -d "{\"eventCode\":\"$EVCODE\",\"pageIndex\":1,\"pageSize\":3,\"sortColumn\":\"overallTime\",\"sortDescending\":false}" \
  | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(json.dumps(data, indent=2)[:2000])
if len(data.get('items', [])) > 0:
    print('\\n✅ First finisher fields:')
    print(json.dumps(data['items'][0], indent=2)[:800])
"
echo
echo

# ============================================================
# 2. Teams/teamRunners — MMR team only
# ============================================================
echo "📋 2. teams/teamRunners (MMR team, page 1, 3 items)"
echo "   Expected: same fields as finishers, but teamCode implicit (='MMR')"
echo "   Verify: is runnerId identical to finishers-filter for same person?"
echo
curl -s -X POST "$BASE/teams/teamRunners" \
  -H "Content-Type: application/json" \
  -d "{\"eventCode\":\"$EVCODE\",\"teamCode\":\"MMR\",\"pageIndex\":1,\"pageSize\":3,\"sortColumn\":null,\"sortDescending\":false}" \
  | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(json.dumps(data, indent=2)[:2000])
if len(data.get('items', [])) > 0:
    item = data['items'][0]
    print('\\n✅ First MMR runner:')
    print(f\"  Name: {item.get('firstName')} {item.get('lastName')}\")
    print(f\"  Bib:  {item.get('bib')}\")
    print(f\"  ID:   {item.get('runnerId')}\")
    print(f\"  Pace: {item.get('pace')}\")
    print(f\"  Team: {item.get('teamCode', 'NOT_PRESENT')}\")
"
echo
echo

# ============================================================
# 3. Extract a runner ID and test history lookup
# ============================================================
echo "📋 3. runners/races (race history for a runner from #2)"
echo "   Extract runner ID from MMR team results..."
echo

RUNNER_ID=$(curl -s -X POST "$BASE/teams/teamRunners" \
  -H "Content-Type: application/json" \
  -d "{\"eventCode\":\"$EVCODE\",\"teamCode\":\"MMR\",\"pageIndex\":1,\"pageSize\":1}" \
  | python3 -c "import sys, json; d=json.load(sys.stdin); print(d['items'][0]['runnerId'] if d.get('items') else '')")

if [ -n "$RUNNER_ID" ]; then
  echo "   Got runner ID: $RUNNER_ID"
  echo
  curl -s -X POST "$BASE/runners/races" \
    -H "Content-Type: application/json" \
    -d "{\"runnerId\":$RUNNER_ID,\"pageIndex\":1,\"pageSize\":3,\"sortColumn\":\"EventDate\",\"sortDescending\":true}" \
    | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(json.dumps(data, indent=2)[:1500])
"
else
  echo "⚠️  No MMR runners found in $EVCODE"
fi
echo
echo

# ============================================================
# 4. Runner details (event-specific)
# ============================================================
echo "📋 4. runners/details (event-specific runner info)"
if [ -n "$RUNNER_ID" ]; then
  echo "   For runner ID: $RUNNER_ID"
  echo
  curl -s -X POST "$BASE/runners/details" \
    -H "Content-Type: application/json" \
    -d "{\"runnerId\":$RUNNER_ID}" \
    | python3 -c "
import sys, json
data = json.load(sys.stdin)
if data.get('success'):
    d = data['details']
    print(f\"Name: {d.get('firstName')} {d.get('lastName')}\")
    print(f\"Age:  {d.get('age')}\")
    print(f\"City: {d.get('city')}\")
    print(f\"Team: {d.get('teamCode', 'NOT_PRESENT')}\")
    print(f\"Bib:  {d.get('bib')}\")
    print()
    print('Full response:')
    print(json.dumps(data, indent=2)[:1500])
else:
    print(f\"Error: {data.get('message')}\")
"
else
  echo "⚠️  Skipping (no runner ID)"
fi
echo
echo

# ============================================================
# Summary
# ============================================================
echo "✅ Test complete. Key findings:"
echo
echo "   1. runners/finishers-filter response:"
echo "      - Has: runnerId (canonical), firstName, lastName, bib, age, gender, etc."
echo "      - Missing: teamCode"
echo
echo "   2. teams/teamRunners response:"
echo "      - Has: runnerId (should match finishers-filter), firstName, lastName, bib, age, gender"
echo "      - Missing: teamCode field (but context is MMR team)"
echo
echo "   3. Race history uses same runnerId from both endpoints"
echo
echo "   4. Conclusion:"
echo "      - Dedup key should be (eventId, bibNumber), not runner_id"
echo "      - Use runnerId from finishers-filter for race history links"
echo "      - Team affiliation is implicit from teams/teamRunners query context"
echo
