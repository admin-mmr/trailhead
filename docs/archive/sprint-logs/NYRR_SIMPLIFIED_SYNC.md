# NYRR Sync — Simplified Single-Pass Design

## New Discovery

The `runners/details` endpoint returns `teamName`:
```json
{
  "runnerId": 50950261,
  "teamName": "MMR",  // ← Team affiliation is here!
  ...
}
```

This means we **don't need `teams/teamRunners` endpoint at all**.

## Simplified Sync Strategy

### Phase 1: Load All Runners (One Call)

**Endpoint**: `POST /runners/finishers-filter`

```json
{
  "eventCode": "H2026",
  "pageIndex": 1,
  "pageSize": 500,
  "sortColumn": "overallTime",
  "sortDescending": false
}
```

**Result**: Inserts all 30K runners with:
- `nyrr_runner_id` (canonical)
- `bib_number` (dedup key)
- Race results (pace, time, place, age grade, etc.)
- `team_code = NULL` (for now)

**Duration**: ~2 minutes for 30K runners (60 pages × 500, 2s sleep)

### Phase 2: Backfill Team Code (Optional, for MMR Only)

After Phase 1 completes, backfill `team_code` for known MMR members.

**Option A: Query External MMR Member List** (Recommended)
```sql
-- You already have MMR members in a source (Basecamp, Sheets, members table)
UPDATE nyrr_event_runners r
INNER JOIN members m ON r.nyrr_runner_id = m.NYRRRunnerID
SET r.team_code = 'MMR'
WHERE r.nyrr_event_id = ?
  AND m.MemberID IS NOT NULL;
```

**Option B: Call runners/details for Each Finisher** (Slow)
```
For each row in nyrr_event_runners:
  POST /runners/details with runnerId
  Extract teamName from response
  UPDATE team_code
```
⚠️ This is O(N) — 30K API calls × 2sec = 60K seconds = 16+ hours. ❌

**Option C: Check if /clubs/clubMembers Exists** (Unknown)
```
POST /clubs/clubMembers with clubCode="MMR"
  → May return all MMR members with teamName already set
```

## Simplified Schema

Since we only run ONE finishers sync:

```sql
nyrr_runner_id      VARCHAR(20) NOT NULL,    -- Always present (finishers-filter returns it)
team_code           VARCHAR(20) NULL,        -- Set via backfill, or NULL for non-MMR
sync_source         ENUM('finishers') NULL,  -- Only one source
```

Simplified `sync_source` — no need for `'mmr_team'` or `'both'`.

## Updated API Sync Code

```python
def api_load_event(event_id):
    """Single-pass finishers load."""
    
    # Phase 1: Fetch all finishers
    runners = client.get_event_finishers(event_code)  # Paginated, all 30K
    
    # Upsert: simple INSERT ... ON DUPLICATE KEY UPDATE
    # nyrr_runner_id always set, team_code left as-is
    for batch in chunks(runners, 500):
        cursor.executemany("""
            INSERT INTO nyrr_event_runners 
              (nyrr_event_id, nyrr_runner_id, bib, first_name, last_name, ..., sync_source)
            VALUES (?, ?, ?, ?, ?, ..., 'finishers')
            ON DUPLICATE KEY UPDATE
              runner_name=VALUES(runner_name), ...
        """, batch)
    
    # Phase 2: Backfill team_code (if MMR members are known)
    conn.execute("""
        UPDATE nyrr_event_runners r
        INNER JOIN members m ON r.nyrr_runner_id = m.NYRRRunnerID
        SET r.team_code = 'MMR'
        WHERE r.nyrr_event_id = %s
          AND m.MemberID IS NOT NULL
    """, (event_id,))
```

## Benefits

| Aspect | Old (Two-Path) | New (One-Pass) |
|--------|----------------|---|
| Complexity | High | Low ✅ |
| API Calls | 2 endpoints × N pages | 1 endpoint × N pages ✅ |
| Load Time | 2×2min = 4min | 1×2min = 2min ✅ |
| Team Code Logic | Complex IF statements in upsert | Simple backfill join ✅ |
| Maintenance | Two code paths | One code path ✅ |
| Dependency on teamRunners | Required | Not needed ✅ |

## Implementation Steps

1. **Simplify migration 0011**: Remove `sync_source ENUM` complexity, just VARCHAR(20) nullable
2. **Simplify api_sync.py**: Single upsert path, no IF statements
3. **Add backfill logic**: SQL UPDATE to set `team_code='MMR'` for known members
4. **Update UI**: Remove "MMR only" / "All runners" toggle → just "Load All"
5. **Test**: Sync H2026, verify no dupes, backfill teamCode for known MMR members

## Open Questions

1. **Do you have MMR member IDs stored?** (NYRRRunnerID in members table?)
   - If yes: Use the JOIN approach (Phase 2, Option A)
   - If no: Manually maintain a list, or skip team_code for now

2. **Does `/clubs/clubMembers` endpoint exist?**
   ```bash
   curl -X POST https://rmsprodapi.nyrr.org/api/v2/clubs/clubMembers \
     -H "Content-Type: application/json" \
     -d '{"clubCode":"MMR","pageIndex":1,"pageSize":500}'
   ```
   This might be a faster way to get MMR members without looping finishers.

3. **Can you verify Basecamp / Google Sheets has MMR member list?**
   If yes, sync that into `members.NYRRRunnerID` before running finishers load.

