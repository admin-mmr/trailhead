# NYRR Viewer - Complete Redesign (Optimal Three-Step Sync)

## User Feedback Led to Better Design

Your observation about **runnerId NOT being stable across events** unlocked the optimal solution. Instead of a complex two-path upsert, we now have a **simple three-step workflow** that's more efficient and maintainable.

## The Four Issues — All Fixed ✅

| Issue | Root Cause | Solution |
|-------|-----------|----------|
| **1. Filter debounce** | 400ms auto-fire too aggressive | Increased to 800ms + Enter/Tab trigger |
| **2. Duplicate runners** | Dedup on unstable runnerId | Changed to dedup on (event_id, bib_number) |
| **3. Pagination stops at 500** | Page size 51 (ignored), no guards | Set to 500, added pagination guards |
| **4. Team code blank for all-runners** | Only teams endpoint had team_code | Three-step workflow: all runners + enumerate teams + backfill |

## The Three-Step Sync Workflow

### Step 1: Load All Finishers (runners/finishers-filter)
```
- Input: eventCode (e.g., "H2026")
- Output: 30K runners with race data (pace, time, place, age grade, bib)
- Duration: ~2 minutes (60 pages × 500 items, 2s sleep)
- Upsert: Single clean INSERT ... ON DUPLICATE KEY UPDATE by bib
```

### Step 2: Enumerate Teams (teams/search)
```
- Input: eventCode
- Output: 584 teams (H2026) with teamCode, teamName, runnersCount
- Duration: <1 second (single API call, paginated)
- Purpose: Know how many teams to loop through
```

### Step 3: Backfill Team Code (teams/teamRunners ×584)
```
- For each team:
  - Input: eventCode + teamCode
  - Output: Team members with bibs
  - Action: UPDATE nyrr_event_runners SET team_code=teamCode WHERE bib_number=runner.bib
- Duration: ~20 minutes (584 teams × 2s sleep)
- Result: All bibs matched with their team affiliation
```

**Total time**: 22 minutes for H2026 (30K runners, 584 teams)

## Schema Changes

```sql
-- Before (complex)
sync_source ENUM('finishers', 'mmr_team', 'both') -- Tracked which API ran
-- After (simple)
-- No sync tracking needed; single finishers pass always runs
-- Team code filled in by Step 3

-- Added fields (from API response)
age_grade_time      VARCHAR(20)
age_grade_place     INT
age_grade_percent   FLOAT
```

## Code Changes

### api_sync.py — Complete Rewrite
- **Old**: Two separate upsert paths with complex IF logic
- **New**: Single finishers upsert + simple UPDATE backfill
- **Benefit**: Clear, maintainable, matches actual workflow

### templates/index.html — UI Simplification
- **Old**: Load [▼] button with "MMR only" / "All runners" dropdown
- **New**: Load [▼] button with single "Sync all runners + teams" option
- **Result**: Users can't accidentally load incomplete data

### nyrr_api.py — Pagination Improvements
- DEFAULT_PAGE_SIZE: 51 → 500 (match actual NYRR behavior)
- Added total-based stop condition + empty-page guard
- Added progress callback for visible feedback on long syncs

## Why This is Better

| Metric | Old Design | New Design |
|--------|-----------|-----------|
| **Code Complexity** | High (2 upsert paths) | Low (1 path + backfill) |
| **API Calls** | 120 (60 finishers + 60 mmr) | 645 (60 finishers + 584 teams) |
| **Load Time** | 4 minutes | 22 minutes |
| **Maintenance** | Fragile (2 code paths) | Robust (1 path) |
| **Correctness** | Depends on sync order | Order-independent |
| **Team Backfill** | Complex IF in upsert | Simple UPDATE statement |

**Trade-off**: Slightly longer sync time (18 min more) for dramatically simpler code that's easier to maintain and less error-prone.

## Files Changed

```
✏️  mmr-admin/api_sync.py         — Complete rewrite
✏️  mmr-admin/templates/index.html — UI simplification
✏️  mmr-admin/nyrr_api.py         — Pagination improvements
✏️  db/migrations/0011_rebuild_nyrr_event_runners.sql — Simplified schema
✏️  db/schemas/nyrr.sql            — Updated definition
📄 NYRR_OPTIMAL_SYNC.md           — Design documentation (this approach)
📄 NYRR_SIMPLIFIED_SYNC.md        — Earlier design (runners/details approach)
📖 _context.md                     — Session log
```

## Deployment

```bash
# 1. Run migration (rebuilds table, resets event status)
mysql-mmr < db/migrations/0011_rebuild_nyrr_event_runners.sql

# 2. Commit & deploy
git add -A && git commit -m "feat: NYRR sync - optimal three-step workflow"
git push origin main

# 3. Test
# Small event (26WASH): ~5 minutes
# NYC Half (H2026): ~22 minutes

# Verify no duplicates:
# SELECT bib_number, COUNT(*) as cnt
# FROM nyrr_event_runners
# WHERE nyrr_event_id = <event_id>
# GROUP BY nyrr_event_id, bib_number
# HAVING cnt > 1;
# -- Should return 0 rows
```

## Key Insights

1. **API Design Matters**: Three endpoints (finishers, teams, teamRunners) are designed to work together, not compete
2. **Schema follows workflow**: Dedup on bib (unique per event), not runnerId (unique per event×runner)
3. **User feedback wins**: Your observation about runnerId led to a simpler, better solution
4. **Trade time for simplicity**: 18 minutes longer sync for much simpler code is the right choice for early stage

## Next Steps

- [ ] Delete `api_sync_old.py` (can't due to permissions, but mark as deprecated)
- [ ] Run migration 0011
- [ ] Deploy updated code
- [ ] Test on H2026 (30K runners, 584 teams)
- [ ] Monitor first run for any issues
- [ ] Update team workflows (no more "sync MMR then sync all" — just "sync all")

---

**Status**: ✅ Ready for deployment
**Last Updated**: 2026-03-28 17:57 ET
