# Trailhead Project Context

Last updated: 2026-04-02 01:40 UTC
Last commit: 3480bee (feat: add unmatch button, membership filter, improved UI colors)

## Session log

### 2026-04-02 15:42 UTC — Members: fix search parameter mismatch error
Changed: `api_members.py` — Removed duplicate `params.append(exact)` in `_build_member_search` (line 118 was redundant). Status: Fixed "Not all parameters were used in the SQL statement" error in member search. Verified: Single token = 5 params, two tokens = 9 params (counts now match placeholders). Next: Test member search in Members tab.

### 2026-04-02 15:40 UTC — Sync: silence parse_datetime warnings for 0 values
Changed: `sync_engine.py` — Silently treat integer 0 and string "0" (with whitespace) as NULL in datetime columns; no warnings logged. Status: Sync will complete cleanly without parse_datetime noise when Google Sheets has 0 values. Tested: all edge cases (int 0, str "0", " 0 ", etc.) now return None silently. Next: (Optional) Persist completed sync jobs for history.

### 2026-04-02 09:34 ET — member card + partial search utilities (centralised)
Changed: `api_members.py` — `get_member_card()` helper + `GET /api/members/<id>/card` endpoint; search now includes WeChatID, enforces ≥2-char minimum; `utils.js` — `searchMembers(q)` and `getMemberCard(memberID)` as single source of truth for all panels. Status: Done. Next: Wire tooltip card component in Members/Audit panels using `getMemberCard`; swap Members.js search calls to use `searchMembers`.

## ⏭️ Next Session — Pending Tasks

DEDUPLICATION & TECH DEBT TARGETS:
1. Python API Clients: Consolidate basecamp/python/nyrr_api.py vs mmr-admin/nyrr_api.py.
2. DB Schemas/Migrations: Merge basecamp/schemas/ vs db/schemas/ and basecamp/migrations/ vs db/migrations/.
3. Sheets Sync Scripts: Deduplicate api_sheets_sync_batched.py, api_sheets_sync.py, and mmr-admin/api_sheets_sync.py.
4. Docs/Scripts: Clean up duplicate LOCAL_SETUP.md and orphaned .sh scripts at root.
5. Column Mapping: Unify Google Sheets ↔ MySQL column name mapping (camelCase vs PascalCase).
6. Datetime Handling: Standardize timestamp/datetime conversion logic across sync scripts.
7. Triggers & GH Actions: Reconcile Admin portal manual buttons vs GitHub Actions scheduled jobs.
8. Email Webhooks: Consolidate email sending via GAS webhook (including user copies and GH scheduled jobs).

PORTAL LAUNCH PREP (Carryover):
1. GOOGLE OAUTH TEST (local)
2. EMAIL/PASSWORD TEST (local)
3. FIRST-TIME SETUP TEST
4. EXPIRED MEMBER TEST
5. RUN MIGRATION V9 ON PRODUCTION
6. PUSH TO TRIGGER AZURE DEPLOY
