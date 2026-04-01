# NYRR Schema Rebuild — Runner ID & Team Code Fix

## Problem Summary

You observed two different runner IDs for the same person (Oscar Lorenzo, bib 4271) appearing as duplicate rows:
- ID `50901943` (tagged "MMR" in Club)
- ID `50963354` (no Club tag, but correct race history URL)

This was caused by **faulty deduplication logic**, not NYRR API inconsistency.

## Root Cause Analysis

### API Behavior (Confirmed)
Both endpoints return the same `runnerId` field:
- **`runners/finishers-filter`** (all finishers): has `runnerId`, NO `teamCode`
- **`teams/teamRunners`** (MMR only): has `runnerId` (same as finishers-filter), NO `teamCode` field

### Why Duplicates Occurred
The old unique constraint was:
```sql
UNIQUE KEY uq_event_runner (nyrr_event_id, nyrr_runner_id)
```

When different syncs or data issues caused `runnerId` to differ between calls, MySQL treated them as different rows → duplicates.

The canonical dedup key should be:
```sql
UNIQUE KEY uq_event_bib (nyrr_event_id, bib_number)
```

**Bib number is guaranteed unique per event** and is always present in both endpoints.

### Why Team Code Was Missing
The `runners/finishers-filter` endpoint **never returns `teamCode`** in the response. Only `teams/teamRunners` (which only returns MMR runners) has implicit team affiliation.

**Solution**: Run both syncs:
1. **Sync All** (`runners/finishers-filter`) → populates canonical `nyrr_runner_id` + race data
2. **Sync MMR** (`teams/teamRunners`) → backfills `team_code='MMR'` for MMR members

## Schema Changes

### Before (Broken)
```sql
nyrr_runner_id      VARCHAR(20) NOT NULL,  -- Event-specific, NOT stable
team_code           VARCHAR(20) NULL,
UNIQUE KEY uq_event_runner (nyrr_event_id, nyrr_runner_id)
```

### After (Fixed)
```sql
nyrr_runner_id      VARCHAR(20) NULL,      -- Canonical NYRR member ID (from finishers-filter)
team_code           VARCHAR(20) NULL,      -- Set by teams/teamRunners pass
city                VARCHAR(100) NULL,     -- New field from API
sync_source         ENUM('finishers', 'mmr_team', 'both') NULL,
UNIQUE KEY uq_event_bib (nyrr_event_id, bib_number)
```

### Key Differences
| Column | Before | After | Reason |
|--------|--------|-------|--------|
| `nyrr_runner_id` | NOT NULL | NULL | May be absent if only MMR-team sync ran |
| `team_code` | NULL | NULL | Set only by MMR-team pass |
| `city` | — | Added | Included in API response |
| `sync_source` | — | Added | Track which API(s) populated row |
| Dedup Key | `(event_id, runner_id)` | `(event_id, bib)` | Bib is reliable unique key |

## Upsert Strategy

**Two different SQL paths** depending on which endpoint ran:

### Path 1: `finishers-filter` (scope='all')
```sql
INSERT ... ON DUPLICATE KEY UPDATE
  nyrr_runner_id = VALUES(nyrr_runner_id),   -- ← Always set canonical ID
  ... (race data),
  team_code = team_code,                     -- ← Never touch (preserve existing)
  sync_source = IF(sync_source='mmr_team', 'both', 'finishers')
```

### Path 2: `teams/teamRunners` (scope='mmr')
```sql
INSERT ... ON DUPLICATE KEY UPDATE
  ... (runner data),
  team_code = 'MMR',                         -- ← Always set
  nyrr_runner_id = nyrr_runner_id,           -- ← Never touch (preserve canonical)
  sync_source = IF(sync_source='finishers', 'both', 'mmr_team')
```

## Migration

**File**: `db/migrations/0011_rebuild_nyrr_event_runners.sql`

Run once:
```bash
mysql-mmr < db/migrations/0011_rebuild_nyrr_event_runners.sql
```

This:
1. Drops and recreates `nyrr_event_runners` (safe in early stage)
2. Resets all events to `processing_status='Pending'` so they can be resynced

## Recommended Sync Workflow

For any event, run in this order:

1. **Sync MMR team only**
   ```
   POST /api/load/<event_id>
   { "scope": "mmr", "force_reload": false }
   ```
   → Result: `team_code='MMR'`, `sync_source='mmr_team'`, `nyrr_runner_id=NULL`

2. **Sync All finishers**
   ```
   POST /api/load/<event_id>
   { "scope": "all", "force_reload": false }
   ```
   → Result: 
     - New rows for non-MMR: `sync_source='finishers'`, `team_code=NULL`
     - Existing MMR rows: `nyrr_runner_id` set, `sync_source='both'`

**Result**: All runners have canonical `nyrr_runner_id` for race history links. MMR runners additionally have `team_code='MMR'`.

## Testing

Run the test script to verify API behavior:
```bash
./test_nyrr_api.sh 26NYCHALF
```

Or with a different event code:
```bash
./test_nyrr_api.sh H2026
```

Output will show:
- Sample response from `finishers-filter`
- Sample response from `teams/teamRunners`
- Race history lookup for an MMR runner
- Confirmation that `teamCode` is absent from API responses

## Next Steps

1. Run migration 0011
2. Test sync on a small event (e.g., 26WASH) to verify no duplicates
3. Test on NYC Half (30K runners) to verify pagination works correctly
4. Delete old migration 0010 (superseded)
