# Members Audit — 2026-04-02

Audit scope: GAS column mapping vs uploaded CSV, `members`/`member_log` schema, admin portal API endpoints.

---

## 1 — GAS Column Mapping Audit (MM_COL vs CSV)

The sheet was changed: `ProfileLastUpdated` (col 22) was removed, and `LastLoginDate` was renamed to `LastLogin`. The GAS code (`config.ts`) has **not been updated** to match — every column from index 22 onward is now misaligned by −1, and two now-gone unix columns still exist in code.

### Side-by-side diff (0-indexed)

| Col | CSV header (truth) | MM_COL key (code) | Issue |
|-----|--------------------|-------------------|-------|
| 0–20 | MemberID … PhoneNumber | MEMBER_ID … PHONE_NUMBER | ✅ correct |
| 21 | `LastLogin` | `LAST_LOGIN_DATE` | ❌ header rename not reflected |
| 22 | `Notes` | `PROFILE_LAST_UPDATED` | ❌ removed col, code reads wrong data |
| 23 | `NYRRRunnerName` | `NOTES` | ❌ off by 1 |
| 24 | `YearBorn` | `NYRR_RUNNER_NAME` | ❌ off by 1 |
| 25 | `LastUpdatedUnix` | `YEAR_BORN` | ❌ off by 1 |
| 26 | `LatLoginUnix` ⚠️ typo | `LAST_UPDATED_UNIX` | ❌ off by 1; also header typo |
| 27 | `CreatedUnix` | `LAST_LOGIN_DATE_UNIX` | ❌ off by 1; reads wrong unix |
| 28 | *(not in CSV)* | `PROFILE_LAST_UPDATED_UNIX` | ❌ ghost column — no data |
| 29 | *(not in CSV)* | `CREATED_UNIX` | ❌ ghost column — no data |

**CSV: 28 columns (0–27). MM_COL: 30 entries (0–29). Misaligned from col 22 onward.**

### Required MM_COL changes (config.ts)

```diff
- LAST_LOGIN_DATE: 21,
+ LAST_LOGIN: 21,          // renamed to match sheet header
- PROFILE_LAST_UPDATED: 22, // REMOVE — column deleted from sheet
  NOTES: 22,               // was 23
  NYRR_RUNNER_NAME: 23,    // was 24
  YEAR_BORN: 24,           // was 25
  LAST_UPDATED_UNIX: 25,   // was 26
- LAST_LOGIN_DATE_UNIX: 27, // remove old
+ LAST_LOGIN_UNIX: 26,     // renamed + shifted from 27
- PROFILE_LAST_UPDATED_UNIX: 28, // REMOVE — column deleted
- CREATED_UNIX: 29,        // remove old index
+ CREATED_UNIX: 27,        // shifted from 29
```

### Also fix: SHEET_HEADERS[MEMBERSHIP_LOG] in config.ts

Current (wrong):
```
'JoinYear', 'PhoneNumber', 'LastLoginDate', 'ProfileLastUpdated', 'Notes',
```

Correct:
```
'JoinYear', 'PhoneNumber', 'LastLogin', 'Notes',
'NYRRRunnerName', 'YearBorn',
'LastUpdatedUnix', 'LastLoginUnix', 'CreatedUnix',
```

Note: The log headers were also missing NYRRRunnerName, YearBorn, and all unix columns — they were never added when those columns were appended to Main. The log sheet auto-creates with headers on first use, so live data may already have columns without headers. Fix headers for correctness; existing log rows are still readable by position.

### Also fix: sheet header typo at col 26

The CSV has `LatLoginUnix` — missing the `s`. Should be `LastLoginUnix`. Fix in-sheet manually (col Z / col 27 header row).

---

## 2 — GAS types.ts + sheets.ts changes needed

**types.ts — Member interface:**
```diff
- lastLoginDate: string;
+ lastLogin: string;
- profileLastUpdated: string;  // REMOVE
```

**sheets.ts — rowToMember:**
```diff
- lastLoginDate: toISO8601(row[MM_COL.LAST_LOGIN_DATE]) || '',
+ lastLogin: toISO8601(row[MM_COL.LAST_LOGIN]) || '',
- profileLastUpdated: toISO8601(row[MM_COL.PROFILE_LAST_UPDATED]) || '',  // REMOVE
```

**sheets.ts — updateMemberRow (unix auto-compute block):**
```diff
- if (updates['LAST_LOGIN_DATE']) {
-   updatesWithUnix['LAST_LOGIN_DATE_UNIX'] = toUnixTimestamp(updates['LAST_LOGIN_DATE']);
- }
+ if (updates['LAST_LOGIN']) {
+   updatesWithUnix['LAST_LOGIN_UNIX'] = toUnixTimestamp(updates['LAST_LOGIN']);
+ }
- if (updates['PROFILE_LAST_UPDATED']) {
-   updatesWithUnix['PROFILE_LAST_UPDATED_UNIX'] = toUnixTimestamp(updates['PROFILE_LAST_UPDATED']);
- }   // REMOVE entire block
```

All callers of `updateMemberWithLog` that pass `LAST_LOGIN_DATE` or `PROFILE_LAST_UPDATED` need to be updated (search `web-apps/gas/membership/src/`).

---

## 3 — MySQL Schema: members table

### Issues found

| Column | Issue | Fix |
|--------|-------|-----|
| `LastLoginDate datetime` | Has "Date" suffix but stores datetime — rename per convention | `CHANGE LastLoginDate LastLogin datetime DEFAULT NULL` |
| `ProfileLastUpdated datetime` | Column removed from sheet | `DROP COLUMN ProfileLastUpdated` |
| `last_login_date_unix bigint` | Name reflects old column name | `CHANGE last_login_date_unix last_login_unix bigint DEFAULT '0' ...` |
| `profile_last_updated_unix bigint` | Removed from sheet | `DROP COLUMN profile_last_updated_unix` |
| `CreatedAt datetime` | Duplicate of `Created` (both DEFAULT CURRENT_TIMESTAMP) | `DROP COLUMN CreatedAt` — `Created` is the Sheets-synced value and should be the canonical one |
| `UpdatedAt datetime ON UPDATE CURRENT_TIMESTAMP` | Fine — MySQL-maintained auto-timestamp. Different purpose than `LastUpdated` (manual sync) | Keep as-is |

### Migration V10 (proposed)

```sql
ALTER TABLE members
  CHANGE COLUMN LastLoginDate   LastLogin              datetime        DEFAULT NULL,
  CHANGE COLUMN last_login_date_unix last_login_unix   bigint          DEFAULT '0'
    COMMENT 'Unix timestamp for last login',
  DROP COLUMN ProfileLastUpdated,
  DROP COLUMN profile_last_updated_unix,
  DROP COLUMN CreatedAt,
  DROP KEY `idx_members_last_login_date_unix`,
  DROP KEY `idx_members_profile_last_updated_unix`,
  ADD KEY `idx_members_last_login_unix` (`last_login_unix`);
```

> ⚠️ Run `mysql-mmr` to test on staging/dev snapshot before applying to production.

---

## 4 — MySQL Schema: member_log table

### Issues found

| Column | Issue | Fix |
|--------|-------|-----|
| `LastLoginDate datetime` | Same rename as members | `CHANGE LastLoginDate LastLogin datetime DEFAULT NULL` |
| `PaymentDate datetime` | Should be `date` per convention (it's a calendar date, no time needed) | `CHANGE PaymentDate PaymentDate date DEFAULT NULL` |
| `Expiration datetime` | Should be `date` — in `members` it's already `date`, log has it as `datetime` | `CHANGE Expiration Expiration date DEFAULT NULL` |
| No unix columns | Log table only needs to be readable by humans/audit — unix cols not needed | No action needed |

### Migration V10 addition

```sql
ALTER TABLE member_log
  CHANGE COLUMN LastLoginDate LastLogin   datetime DEFAULT NULL,
  CHANGE COLUMN PaymentDate   PaymentDate date     DEFAULT NULL,
  CHANGE COLUMN Expiration    Expiration  date     DEFAULT NULL;
```

---

## 5 — Python: Files needing updates after rename

After renaming `LastLoginDate` → `LastLogin` and dropping `ProfileLastUpdated`:

| File | What to change |
|------|----------------|
| `sync_engine.py` (line 67) | MEMBERS_SYNC_COLUMNS: `'LastLoginDate'` → `'LastLogin'`, remove `'ProfileLastUpdated'` |
| `sync_engine.py` (lines 378–379) | unix map: `'LastLoginDate': 'last_login_date_unix'` → `'LastLogin': 'last_login_unix'`; remove `'ProfileLastUpdated'` entry |
| `api_sheets_sync.py` (lines 216–217) | camelCase map: `'lastLoginDate': 'LastLoginDate'` → `'lastLogin': 'LastLogin'`; remove `'profileLastUpdated'` |
| `api_sheets_sync.py` (line 710) | query column list: `LastLoginDate` → `LastLogin`, remove `ProfileLastUpdated` |
| `api_data.py` (lines 359–370) | Backfill SQL: `last_login_date_unix` → `last_login_unix`; `LastLoginDate` → `LastLogin`; remove ProfileLastUpdated block |
| `backfill_unix_timestamps.py` (line 38–39) | Tuple: `'last_login_date'` → `'last_login'` (source col), `'last_login_date_unix'` → `'last_login_unix'` (dest col); remove profile row |
| `api_district_members.py` (lines 41, 74, 110–111) | `LastLoginDate` → `LastLogin` |
| `api_district_export.py` (lines 36, 67–68, 123, 193, 209, 269, 275) | `LastLoginDate` → `LastLogin` |
| `static/DistrictMembersPanel.js` (lines 39, 232) | `LastLoginDate` → `LastLogin` |
| `templates/DistrictMembersPanel.js` (line 510) | `LastLoginDate` → `LastLogin` |

---

## 6 — Admin Portal: API Endpoint Inventory

### What exists in `api_members.py`

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/members/search?q=` | Partial search (name/ID/WeChatID) |
| GET | `/api/members/<id>/card` | Tooltip card data |
| GET | `/api/members/<id>/family` | Family members list |
| POST | `/api/members/family/add-member` | Add member to family |
| POST | `/api/members/family/remove-member` | Remove from family |
| GET | `/api/districts` | List all districts |
| POST | `/api/members/<id>/district` | Update district |

Also in `api_payments.py`:
- `POST /api/payments/sync-member-to-sheets/<id>` — push single member row to Sheets

### What's missing

| Missing endpoint | Why needed |
|-----------------|-----------|
| `GET /api/members/<id>` | Full member detail view — no way to load a complete member record |
| `PATCH /api/members/<id>` | Edit basic fields (name, phone, wechat, notes) without payment flow |
| `POST /api/members/<id>/status` | Admin override: activate / deactivate / mark pending |
| `POST /api/members/<id>/expiration` | Admin override: manually set expiration date |
| `POST /api/members` | Create a new member record |
| `GET /api/members/<id>/log` | View audit log for a member (member_log) |

### Current Members.js UI capabilities

The Members tab currently only surfaces:
1. Family management (add/remove members, link by ID)
2. District update

There is no general member edit UI. Status and expiration changes can only happen indirectly through payment approval.

---

## 7 — Recommended Approach: Member Management in Admin Portal

### Principle: audit trail first

Every write to `members` must mirror the GAS `logMainTableRow` pattern — copy the current row to `member_log` before any change. Python already does this in payment flows (payment_actions.py). Extend this to all direct admin edits.

### Proposed endpoint design

**GET /api/members/<id>** — full member record
No writes, used for the edit drawer.

**PATCH /api/members/<id>** — edit non-payment fields only
Editable: FirstName, LastName, Email, PhoneNumber, WeChatID, District, Gender, JoinYear, Notes, NYRRRunnerName, YearBorn
NOT editable via this endpoint: Status, Expiration, Type, MembershipFeePaid, PaymentDate, PaymentTransaction (those go through payment approval)
Action: write to member_log first, then UPDATE members, then trigger Sheets sync.

**POST /api/members/<id>/override** — admin-only status/expiration override
Fields: Status, Expiration
Requires: `reason` field (logged to member_log ChangeType)
Use case: fix a broken state, manual correction
Action: log to member_log with ChangeType='admin_override', UPDATE members, sync to Sheets.

**POST /api/members** — create new member
For walk-up / paper registrations that bypassed the web app.
Generates MemberID, sets Created=now, Status='pending'.

**GET /api/members/<id>/log** — audit trail
SELECT from member_log WHERE MemberID = ? ORDER BY LoggingTime DESC.

### UI suggestion for Members tab

Replace the current two-panel layout (family | district) with a **three-tab drawer**:
1. **Edit** — basic fields PATCH
2. **Family** — existing add/remove UI
3. **History** — member_log entries

A "⚙ Override" button (status/expiration) lives outside the drawer tabs, requires confirmation modal with reason field.

Keep all payment-related fields **read-only** in the admin portal — changes must come from the payment approval flow to preserve payment audit trail integrity.

---

## Summary: Action Checklist

### High priority (breaks sync right now)
- [ ] Fix MM_COL indices in `config.ts` (col 22–29 all wrong)
- [ ] Fix `SHEET_HEADERS[MEMBERSHIP_LOG]` in `config.ts`
- [ ] Rename `LAST_LOGIN_DATE` → `LAST_LOGIN` and remove `PROFILE_LAST_UPDATED` throughout GAS
- [ ] Fix `types.ts` Member interface
- [ ] Fix `sheets.ts` rowToMember + updateMemberRow

### Medium priority (data consistency)
- [x] Run Migration V10 on MySQL: rename LastLogin, drop ProfileLastUpdated, drop CreatedAt, fix log date types
- [ ] Update all Python files (sync_engine, api_sheets_sync, api_data, api_district_*, backfill)
- [ ] Fix sheet col 26 header typo: `LatLoginUnix` → `LastLoginUnix`

### Lower priority (admin portal features)
- [ ] Add GET + PATCH /api/members/<id> endpoints
- [ ] Add POST /api/members/<id>/override (status/expiration)
- [ ] Add GET /api/members/<id>/log (audit trail)
- [ ] Update Members.js with edit drawer UI

---
*Generated: 2026-04-02*
