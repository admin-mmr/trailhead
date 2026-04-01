# NYRR Sync — Optimal Three-Step Workflow

## Key Discovery

**runnerId is NOT stable across events** — same runner gets different IDs per event.

But **team affiliation is stable** — `/teams/search` lists all teams, then `/teams/teamRunners` gives bibs for each team.

## Optimal Workflow

### Step 1: Load All Finishers (Canonical Runner Data)

**Endpoint**: `POST /runners/finishers-filter`

Paginate through all runners, store:
- `nyrr_runner_id` (event-context ID)
- `bib_number` (dedup key — truly unique per event)
- Race results (pace, time, place, age grade, gender place, etc.)
- `team_code = NULL` (initially)

**Duration**: ~2 minutes for 30K runners (60 pages × 500, 2s sleep between)

```python
runners = client.get_event_finishers(event_code)  # Returns all 30K with pagination
# Upsert to nyrr_event_runners
```

### Step 2: Enumerate All Teams in Event (Metadata)

**Endpoint**: `POST /teams/search`

Get list of all teams to know how many to process:

```json
{
  "eventCode": "H2026",
  "searchWord": null,
  "pageIndex": 1,
  "pageSize": 500,
  "sortColumn": "TeamName",
  "sortDescending": false
}
```

**Result**: List of 584 teams (H2026) with:
- `teamCode` (e.g., "NYTR", "CAHC", "MMR")
- `teamName` (e.g., "New York Triathlon Racing", "Correcaminos", "Manhattan Multisport Runners")
- `runnersCount` (e.g., 2, 16, 150 per team)

**Use**: Loop through teams to backfill team_code

### Step 3: Backfill Team Code (584 API Calls)

**Endpoint**: `POST /teams/teamRunners` for each team

For each team, query its runners and update bibs:

```python
teams = client.search_teams(event_code)  # Get all 584 teams

for team in teams:
    team_runners = client.get_team_runners(event_code, team['teamCode'])
    
    for runner in team_runners:
        # Upsert: update existing row (matched by bib) with team_code
        cursor.execute("""
            UPDATE nyrr_event_runners
            SET team_code = %s
            WHERE nyrr_event_id = %s AND bib_number = %s
        """, (team['teamCode'], event_id, runner['bib']))
```

**Duration**: 584 API calls × 2s sleep = ~1200 seconds = **20 minutes**
(Much better than 30K calls!)

**Total**: Step 1 (2min) + Step 3 (20min) = **~22 minutes for H2026** ✅

## Simplified Schema

```sql
CREATE TABLE nyrr_event_runners (
    id                  INT             AUTO_INCREMENT PRIMARY KEY,
    nyrr_event_id       INT             NOT NULL,
    
    -- Runner identity (from finishers-filter)
    nyrr_runner_id      VARCHAR(20)     NOT NULL,    -- Event-context ID (not stable across events)
    runner_name         VARCHAR(200)    NOT NULL,
    first_name          VARCHAR(100)    NULL,
    last_name           VARCHAR(100)    NULL,
    age                 SMALLINT        NULL,
    gender              VARCHAR(10)     NULL,
    city                VARCHAR(100)    NULL,
    state_province      VARCHAR(50)     NULL,
    
    -- Race result (dedup key)
    bib_number          VARCHAR(20)     NOT NULL,
    finish_time         VARCHAR(20)     NULL,
    pace                VARCHAR(20)     NULL,
    overall_place       INT             NULL,
    gender_place        INT             NULL,
    age_grade_time      VARCHAR(20)     NULL,
    age_grade_place     INT             NULL,
    age_grade_percent   FLOAT           NULL,
    
    -- Team affiliation (backfilled by Step 3)
    team_code           VARCHAR(20)     NULL,
    
    -- MMR member matching (separate concern)
    mmr_member_id       VARCHAR(10)     NULL,
    match_method        ENUM('auto_name', 'auto_lastname', 'auto_firstlast', 'manual', 'not_member', 'unmatched') NULL,
    matched_by          VARCHAR(100)    NULL,
    matched_at          DATETIME        NULL,
    
    -- Timestamps
    is_registered_only  TINYINT(1)      NOT NULL DEFAULT 0,
    scan_timestamp      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Keys
    UNIQUE KEY uq_event_bib (nyrr_event_id, bib_number),
    INDEX idx_runner_id (nyrr_runner_id),
    INDEX idx_team_code (team_code),
    INDEX idx_mmr_member (mmr_member_id),
    
    CONSTRAINT fk_event_runners_event
        FOREIGN KEY (nyrr_event_id) REFERENCES nyrr_events(id) ON DELETE CASCADE
);
```

**Removed**:
- `sync_source ENUM` — Not needed; always single pass
- City, state, country — Already captured from finishers-filter

**Added**:
- `age_grade_time`, `age_grade_place`, `age_grade_percent` — Present in finishers response

## Updated API Sync Code

```python
@sync_bp.route('/api/load/<int:event_id>', methods=['POST'])
@login_required
def api_load_event(event_id):
    """Three-step sync: finishers → teams → backfill."""
    event = query("SELECT * FROM nyrr_events WHERE id = %s", [event_id])[0]
    event_code = event['event_code']
    
    client = NyrrApiClient()
    conn = None
    
    try:
        # --- Step 1: Load all finishers ---
        runners = client.get_event_finishers(event_code)
        
        conn = get_conn()
        cursor = conn.cursor()
        
        upsert_sql = """
            INSERT INTO nyrr_event_runners
              (nyrr_event_id, nyrr_runner_id, runner_name, first_name, last_name,
               age, gender, city, state_province, bib_number,
               finish_time, pace, overall_place, gender_place,
               age_grade_time, age_grade_place, age_grade_percent,
               scan_timestamp)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON DUPLICATE KEY UPDATE
              runner_name = VALUES(runner_name),
              first_name = VALUES(first_name),
              ... (all fields)
        """
        
        for i in range(0, len(runners), 500):
            batch = runners[i:i+500]
            cursor.executemany(upsert_sql, [(
                event_id, runner.runner_id, runner.full_name,
                runner.first_name, runner.last_name,
                runner.age, runner.gender, runner.city, runner.state_province,
                runner.bib, runner.overall_time, runner.pace,
                runner.overall_place, runner.gender_place,
                runner.age_grade_time, runner.age_grade_place, runner.age_grade_percent
            ) for runner in batch])
            conn.commit()
        
        # --- Step 2 & 3: Load teams, then backfill team_code ---
        teams = client.search_teams(event_code)
        
        for team in teams:
            team_runners = client.get_team_runners(event_code, team['teamCode'])
            
            for runner in team_runners:
                cursor.execute("""
                    UPDATE nyrr_event_runners
                    SET team_code = %s
                    WHERE nyrr_event_id = %s AND bib_number = %s
                """, (team['teamCode'], event_id, runner['bib']))
            
            conn.commit()
        
        # Update event status
        cursor.execute("""
            UPDATE nyrr_events
            SET processing_status = 'Completed', processed_at = NOW(), processed_by = 'Viewer',
                result_count = (SELECT COUNT(*) FROM nyrr_event_runners WHERE nyrr_event_id = %s)
            WHERE id = %s
        """, (event_id, event_id))
        conn.commit()
        
    finally:
        if conn:
            conn.close()
```

## Comparison: Old vs New

| Aspect | Old (Two-Path) | New (Three-Step) |
|--------|---|---|
| API endpoints | 2 (`finishers-filter`, `teamRunners`) | 3 (`finishers-filter`, `teams/search`, `teamRunners` ×584) |
| Complexity | High (two upsert paths) | Low (simple backfill UPDATE) |
| Team backfill logic | Complex IF in upsert | Simple UPDATE by bib |
| Total API calls | 120 (60×2) | 645 (60 + 584) |
| Load time | ~4 minutes | ~22 minutes |
| Schema | Complex (`sync_source` ENUM) | Simple (no tracking needed) |
| Maintenance | Two code paths | One code path ✅ |

## Implementation Checklist

- [ ] Simplify migration 0011 (remove `sync_source ENUM`, add age_grade columns)
- [ ] Update `db/schemas/nyrr.sql`
- [ ] Rewrite `api_sync.py` with three-step workflow
- [ ] Remove "MMR only" / "All" toggle from UI → just "Load All"
- [ ] Test on H2026 (30K runners, 584 teams)
- [ ] Verify no duplicates, all teams backfilled

## Notes

- Step 1 uses existing pagination logic (50 pages × 500 items = 2 min)
- Step 2 (teams/search) is just enumeration, fast
- Step 3 benefits from `teams/teamRunners` endpoint (originally designed for this use case!)
- Total: efficient, maintainable, clean code

