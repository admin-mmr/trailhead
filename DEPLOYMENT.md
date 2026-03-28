# Deployment Steps — NYRR Schema Rebuild

## 1. Review Changes

Read the summary first:
```bash
cat NYRR_SCHEMA_REBUILD.md
```

## 2. Test the API (Optional)

Before running migrations, verify the NYRR API behavior:
```bash
./test_nyrr_api.sh 26NYCHALF
# or with a different event:
./test_nyrr_api.sh H2026
```

Expected output: Confirms that `teamCode` is NOT present in API responses, but both endpoints return the same `runnerId`.

## 3. Run Migration

**This will drop and recreate `nyrr_event_runners` table (data loss).**
Safe because we're in early development stage.

```bash
mysql-mmr < db/migrations/0011_rebuild_nyrr_event_runners.sql
```

Verify:
```bash
mysql-mmr -e "DESCRIBE nyrr_event_runners;" | grep -E "nyrr_runner_id|team_code|sync_source|bib_number"
```

Expected columns:
- `nyrr_runner_id` (VARCHAR(20), NULL)
- `team_code` (VARCHAR(20), NULL)
- `sync_source` (ENUM, NULL)
- `bib_number` (VARCHAR(20), NOT NULL)

## 4. Deploy Web App

Deploy mmr-admin with updated code:
```bash
# Frontend changes: filter debounce, "Clear runners" button
# Backend: api_sync.py (two-path upsert), nyrr_api.py (pagination), api_sync.py (cleanup endpoint)

# Azure deployment:
git add -A && git commit -m "feat: NYRR schema rebuild - fix runner ID dedup"
git push origin main
```

## 5. Test Sync on Small Event

Via the web UI:
1. Navigate to NYRR Viewer → Events tab
2. Pick a small event (e.g., "26WASH")
3. Click [Load ▼] → "MMR team only"
4. Wait for completion
5. Verify: All rows have `team_code='MMR'` and `sync_source='mmr_team'`

Then:
1. Click [Load ▼] → "All runners"
2. Wait for completion
3. Verify:
   - MMR runners now have `sync_source='both'` and `nyrr_runner_id` set
   - Non-MMR runners have `sync_source='finishers'`, `team_code=NULL`, `nyrr_runner_id` set
   - No duplicates (check via database viewer tab)

```sql
SELECT nyrr_event_id, bib_number, COUNT(*) as cnt
FROM nyrr_event_runners
WHERE nyrr_event_id = <event_id>
GROUP BY nyrr_event_id, bib_number
HAVING cnt > 1;
-- Should return no rows (no duplicates)
```

## 6. Test on Large Event (Optional)

NYC Half (30K runners):
1. Click [Load ▼] → "All runners"
2. Watch progress in sync status
3. Expected: ~2 minutes to fetch 30K runners (60 pages × 500 items, 2s sleep between)
4. Verify completion and no data loss

## 7. Cleanup

Delete the superseded migration (if manual cleanup needed):
```bash
# Cannot delete due to permissions, but it's marked DEPRECATED in file
# Never run migration 0010; use 0011 instead
cat db/migrations/0010_nyrr_runner_bib_unique.sql
```

## 8. Document Status

Update your records:
- ✅ Schema rebuild complete
- ✅ Two-API sync strategy implemented
- ✅ Pagination fix for 30K+ events
- ✅ Filter debounce + clear runners UI
- ⏳ Test on production events
- ⏳ Monitor for any sync issues

## Rollback (If Needed)

If something breaks:
1. Keep a DB backup from before migration
2. Restore: `mysql-mmr < backup.sql`
3. Revert code: `git revert <commit-hash>`
4. Root cause analysis before retrying

## Key Files Modified

| File | Change | Impact |
|------|--------|--------|
| `db/migrations/0011_rebuild_nyrr_event_runners.sql` | New schema | Data loss (intentional) |
| `mmr-admin/api_sync.py` | Two-path upsert | No upsert dupes |
| `mmr-admin/nyrr_api.py` | Page size 500 | Fix 30K pagination |
| `mmr-admin/templates/index.html` | UI improvements | Better UX |
| `NYRR_SCHEMA_REBUILD.md` | Documentation | Reference |
| `test_nyrr_api.sh` | Test script | Verify API behavior |

## Support

If issues arise, check:
1. Are both syncs running? (Sync all alone leaves `team_code=NULL`)
2. Is pagination working? (Check logs for page count)
3. Are rows truly deduplicated? (Run SQL check above)
