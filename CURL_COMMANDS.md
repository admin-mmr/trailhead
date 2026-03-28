# NYRR API Test Commands

Use these to verify the API behavior directly. Both endpoints return `runnerId` but only `teams/teamRunners` has implicit team affiliation.

## Setup

```bash
EVCODE="26NYCHALF"    # or use H2026, 26WASH, etc.
BASE="https://rmsprodapi.nyrr.org/api/v2"
```

## 1. All Finishers (runners/finishers-filter)

```bash
curl -s -X POST "$BASE/runners/finishers-filter" \
  -H "Content-Type: application/json" \
  -d '{
    "eventCode":"'"$EVCODE"'",
    "pageIndex":1,
    "pageSize":5,
    "sortColumn":"overallTime",
    "sortDescending":false
  }' | jq '.items[0]'
```

**Output**: First finisher with fields: `runnerId`, `firstName`, `lastName`, `bib`, `age`, `gender`, `pace`, `overallTime`, etc.
**Note**: No `teamCode` field.

## 2. MMR Team Only (teams/teamRunners)

```bash
curl -s -X POST "$BASE/teams/teamRunners" \
  -H "Content-Type: application/json" \
  -d '{
    "eventCode":"'"$EVCODE"'",
    "teamCode":"MMR",
    "pageIndex":1,
    "pageSize":5,
    "sortColumn":null,
    "sortDescending":false
  }' | jq '.items[0]'
```

**Output**: First MMR runner with same fields as finishers (same `runnerId`).
**Note**: No `teamCode` field in response either (implicit from query context).

## 3. Compare Two Runners

Extract a runner ID and compare across endpoints:

```bash
# Get a runner ID from finishers
RID=$(curl -s -X POST "$BASE/runners/finishers-filter" \
  -H "Content-Type: application/json" \
  -d '{"eventCode":"'"$EVCODE"'","pageIndex":1,"pageSize":1}' \
  | jq -r '.items[0].runnerId')

echo "Runner ID: $RID"

# Get their details (event-specific)
echo "=== runners/details ==="
curl -s -X POST "$BASE/runners/details" \
  -H "Content-Type: application/json" \
  -d '{"runnerId":'"$RID"'}' | jq '.details | {firstName, lastName, age, teamCode, bib}'

# Get their race history
echo "=== runners/races (page 1) ==="
curl -s -X POST "$BASE/runners/races" \
  -H "Content-Type: application/json" \
  -d '{"runnerId":'"$RID"',"pageIndex":1,"pageSize":3,"sortColumn":"EventDate","sortDescending":true}' \
  | jq '.items[0:2]'
```

## 4. Check for teamCode in Response

```bash
# Finishers-filter - check if teamCode exists
echo "=== finishers-filter response keys ==="
curl -s -X POST "$BASE/runners/finishers-filter" \
  -H "Content-Type: application/json" \
  -d '{"eventCode":"'"$EVCODE"'","pageIndex":1,"pageSize":1}' \
  | jq '.items[0] | keys | sort'

# teams/teamRunners - check if teamCode exists
echo "=== teams/teamRunners response keys ==="
curl -s -X POST "$BASE/teams/teamRunners" \
  -H "Content-Type: application/json" \
  -d '{"eventCode":"'"$EVCODE"'","teamCode":"MMR","pageIndex":1,"pageSize":1}' \
  | jq '.items[0] | keys | sort'
```

**Expected**: Both return the same field names; `teamCode` will NOT be in either list.

## 5. Pagination Test

```bash
# Count total finishers (check totalItems)
echo "=== Total finishers count ==="
curl -s -X POST "$BASE/runners/finishers-filter" \
  -H "Content-Type: application/json" \
  -d '{"eventCode":"'"$EVCODE"'","pageIndex":1,"pageSize":500}' \
  | jq '{totalItems, itemCount: (.items | length), pageSize: 500}'

# Try page 2 to verify pagination works
echo "=== Page 2 ==="
curl -s -X POST "$BASE/runners/finishers-filter" \
  -H "Content-Type: application/json" \
  -d '{"eventCode":"'"$EVCODE"'","pageIndex":2,"pageSize":500}' \
  | jq '{totalItems, itemCount: (.items | length), pageSize: 500}'
```

## Expected Results

| Endpoint | Returns | teamCode? | runnerId Stable? |
|----------|---------|-----------|------------------|
| `runners/finishers-filter` | All finishers | ❌ No | ✅ Yes (canonical) |
| `teams/teamRunners` | MMR only | ❌ No (implicit) | ✅ Yes (same as above) |

**Conclusion**: Both endpoints return the same `runnerId`. Team affiliation is only available through the query context (which endpoint you called). Dedup key must be `(event_id, bib_number)`, not runner_id.

## For NYC Half (30K runners)

```bash
# Time a full finishers-filter load (will take ~2 minutes)
time curl -s -X POST "$BASE/runners/finishers-filter" \
  -H "Content-Type: application/json" \
  -d '{
    "eventCode":"26NYCHALF",
    "pageIndex":1,
    "pageSize":500
  }' | jq -r '.items | length'

# Keep fetching until we get fewer than 500 items
PAGE=1
while true; do
  COUNT=$(curl -s -X POST "$BASE/runners/finishers-filter" \
    -H "Content-Type: application/json" \
    -d "{\"eventCode\":\"26NYCHALF\",\"pageIndex\":$PAGE,\"pageSize\":500}" \
    | jq '.items | length')
  echo "Page $PAGE: $COUNT items"
  [ "$COUNT" -lt 500 ] && break
  PAGE=$((PAGE + 1))
  sleep 2
done

echo "Total pages: $PAGE"
echo "Expected for 30K: ~60 pages (30000 / 500)"
```

