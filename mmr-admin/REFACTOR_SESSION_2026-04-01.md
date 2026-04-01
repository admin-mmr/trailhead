# MMR Admin — Refactor & Payments Session Notes
**Date:** 2026-04-01
**Scope:** `mmr-admin` Flask/Python + React admin portal on Azure

---

## What Was Accomplished This Session

### 1. Payment Pipeline Review
Documented the full 2-step async payment workflow:

- **Ops Mode 1 (Auto-scan):** GAS webhook → `webapp_events` (pending) → auto-match heuristic → `matched` → admin approves → `approved` + payment record + member update + Sheets sync
- **Ops Mode 2 (Audit):** Admin reviews unmatched gmail vs pending events side-by-side, manually links or creates payment records
- **`paymentIntent_approved_node`** dispatches to category handlers via `INTENT_HANDLERS` dict in `payment_handlers.py`

Auto-match heuristic (3 rules — all must pass):
1. Amount exact match (±$0.01)
2. Transaction date within ±7 days of event timestamp
3. At least ONE of: last4 matches TransactionNumber suffix, MemberID regex in memo (`\bA\d{4}\b`), payer name fuzzy match

### 2. GAS Autoguess Review (`web-apps/gas/membership/src/jobs.ts`)
`autoMatchUnmatchedPayments` implementation:
- Guards: `isWithinCollectionWindow()` using `MembershipCollectionStart`/`MembershipCollectionEnd` config keys
- Amount filter: exactly `IndividualPrice` (30) or `FamilyPrice` (50)
- Intent inference: `amount === familyPrice ? 'Family Membership' : 'Individual Membership'`
- Creates payment with `eventID: ''`, `source: 'AutoGuess'`, `processedBy: 'auto-guess@system'`
- Uses `txDate` (not today) as `periodStart`
- Marks gmail row with `Source = 'AutoGuess'`

**Key divergence from Python:** `reconcileWebAppWithGmail` in `dues.ts` auto-approves immediately after match (`approveDuesPayment` inline). Python `run_auto_match` only sets status to `matched` — requires manual admin approval step.

### 3. Payments UI Redesign (`mmr-admin/static/payments.js` — full rewrite)
New layout and features added:

**Side-by-side reconcile layout:**
- Left panel: `PendingEventsTable` (flex: `0 0 420px`) — webapp_events with pending/matched status
- Right panel: `GmailTable` (flex: 1) — gmail_transactions
- Toggle button: `◀ Hide Events / ▶ Show Events` in gmail panel header

**Event focus → gmail filter:**
- Click event row → sets `focusedEventId`, triggers `GET /api/payments/gmail-candidates/<event_id>`
- Filter badge: `🔍 Candidates for [chip] · $30 · Intent · [✕ Clear]`
- `MatchCtxBadge`: `✓ LINKED` (green), `⚠ PROCESSED` (yellow), `~ CANDIDATE` (accent)
- Includes already-processed rows (so admin can spot misattributions)

**MemberID hover tooltip (anywhere on page):**
- `MemberIdChip` component: `onMouseEnter` → fetches `GET /api/payments/member-quick/<member_id>` → 150ms debounced show
- `MemberTooltip`: fixed-position hover card, `pointerEvents: 'none'`
- Shows: name, MemberID, expiration, type, gender, district
- Module-level `_memberCache = {}` persists across re-renders

### 4. New API Endpoints Added to `api_payments.py`
```
GET /api/payments/gmail-candidates/<event_id>
  → matched row + fuzzy candidates incl. already-processed
  → MatchContext: 'matched' | 'candidate' per row
  → post-filters by last4, MemberID in memo, payer name

GET /api/payments/member-quick/<member_id>
  → MemberID, FirstName, LastName, Expiration, Type, Gender, District
```

### 5. Full Refactoring Executed

#### New Python utility modules created:

| File | Purpose | Replaces |
|------|---------|---------|
| `core.py` | `gen_id(prefix)` — collision-safe ID | `_gen_id()` in payment_handlers + payment_actions (both had the same bug) |
| `config_cache.py` | Thread-safe session-level config cache | 5 independent `get_config()` implementations |
| `activity_logger.py` | `log_activity(action, ...)` | 3 identical `activity_log` INSERT blocks in payment_actions.py |
| `sync_jobs.py` | `launch_job/update_job/get_job/list_jobs` | `_sync_jobs` dict + `_sync_jobs_lock` + `_gen_job_id` + 10 daemon thread dispatch blocks in api_sheets_sync.py |
| `query_builder.py` | `add_search(sql, params, search, columns)` | 4× repeated LIKE search boilerplate |
| `datetime_utils.py` | `to_datetime/to_date` normalizers | Scattered `isinstance(val, datetime)` guard chains |

#### Existing files modified:
- **`helpers.py`** — added `@handle_api_errors` decorator (eliminates ~40 try/except blocks)
- **`payment_handlers.py`** — uses `gen_id`, `get_config`, `to_date`; removed `_gen_id()` and local `get_config()`
- **`payment_actions.py`** — uses `gen_id`, `get_config`, `log_activity`, `to_datetime`; removed `_gen_id()`, 3 INSERT blocks, local `get_config`
- **`api_payments.py`** — all routes decorated with `@handle_api_errors`; search routes use `add_search()`
- **`api_sheets_sync.py`** — 38 `_sync_jobs_lock` blocks → `update_job()`; 9 thread dispatches → `launch_job()`; `_get_config_value` → `config_cache`
- **`sheets_sync.py`** — removed local `get_config_value()`, uses `config_cache.get_config()`
- **`webhook_client.py`** — `get_sheets_webhook_url()` simplified from 60 → 15 lines using `config_cache`
- **`api_sheets_diags.py`** — removed local `_get_config_value()`, uses `config_cache.get_config()`
- **`static/utils.js`** (new) — shared JS: `fmt`, `fmtDate`, `fmtMoney`, `STATUS_COLORS`, `Badge`, `extractMemberIds`, `api()` — exposed as `window.mmrUtils`
- **`static/DistrictMembersPanel.js`** — data fetch calls use `mmrUtils.api()` instead of raw `fetch()`

#### Import test result:
```
python3 test_imports.py
→ 7 pure-python modules: ✅ all clean
→ 29 modules: skipped (missing third-party deps — expected in sandbox, not a failure)
```

---

## Open Bugs

### 🔴 Bug 1 — `_gen_id` collision (FIXED this session)
**Was:** `rand = int(time.time() * 10000) % 10000` — deterministic, not random
**Fix:** Replaced with `random.randint(0, 9999)` in `core.py`, wired into both call sites
**Status:** ✅ Fixed

---

### 🔴 Bug 2 — Amount/Sender NULL in `gmail_transactions` (OPEN)
**File:** `api_sheets_sync.py` → `_import_transactions()` (~line 1244)
**Problem:** INSERT only writes:
```python
INSERT INTO gmail_transactions (MessageId, TimeStamp, Memo, Notes, ProcessedTime, PaymentID)
```
Missing: `Sender`, `Amount`, `TransactionDate`, `TransactionNumber`, `Subject`, `OriginalMemo`, `Source`

**Impact:**
- UI shows `—` for Amount and Sender on every gmail row
- Auto-match is completely broken — every gmail row has `Amount = None → 0.0`, so no event ever matches on Rule 1
- Dashboard "Unmatched Gmail: 512" count is inflated because null-amount rows look unprocessed

**Fix needed:** Extend the INSERT in `_import_transactions` to capture all fields from the GAS webhook payload. Need to check exact field names the webhook sends (likely `amount`, `sender`, `transactionDate`, `transactionNumber`, `subject`, `originalMemo`, `source`).

---

### 🔴 Bug 3 — GAS-processed rows never reach MySQL's `ProcessedTime` (OPEN)
**File:** `sync_engine.py` → `resolve_gmail_row()` (~line 423)
**Problem:** Sync direction for `ProcessedTime` is `MySQL → Sheets` only. When GAS processes a row (sets `ProcessedTime` in Sheets), the next sync does NOT write it back to MySQL. So MySQL's `gmail_transactions.ProcessedTime` stays NULL forever for GAS-processed rows.

**Impact:** Dashboard "Unmatched Gmail" count is inflated — rows GAS already processed still appear as unmatched in the Python admin portal.

**Fix needed:** Change `resolve_gmail_row` so that if `sheets_row.ProcessedTime` is non-null and `mysql_row.ProcessedTime` is null, write `ProcessedTime` from Sheets → MySQL. Also sync `Source` and `PaymentID` in the same direction.

---

### 🔴 Bug 4 — Gmail marked `ProcessedTime = NOW()` at match time, not approval time (OPEN)
**Files:** `payment_actions.py` → `run_auto_match()` and `manual_match()`
**Problem:** Both functions set `ProcessedTime = NOW()` on `gmail_transactions` at the moment of *matching*, before the admin approves. If the admin later rejects the event, the gmail row is left with `ProcessedTime` set but no corresponding payment record — it's permanently "orphaned" and invisible to future matching.

**Fix needed:** Remove `ProcessedTime = NOW()` from both `run_auto_match` and `manual_match`. Only set it in `approve_event`, after the payment is confirmed. The `matched` status on `webapp_events` is sufficient to show that a gmail row is tentatively linked.

---

### 🟡 Bug 5 — GAS auto-approves; Python requires manual approval (behavioral divergence, OPEN)
**GAS (`dues.ts`):** `reconcileWebAppWithGmail` finds a match → immediately calls `approveDuesPayment` → member updated, email sent
**Python (`payment_actions.py`):** `run_auto_match` only sets status to `matched` → requires admin to click Approve

**Impact:** Dual-system inconsistency. If GAS is running alongside the Python portal, a payment may be approved twice (GAS approves automatically, admin also approves in portal). Or a GAS-approved payment appears as "pending" in the portal and confuses admins.

**Fix needed:** Either (a) disable GAS reconciliation and route all through Python, or (b) add a guard in `approve_event` that checks if a payment record already exists for the member/amount/date before creating another.

---

## Pending Feature Work

### Mode 1 Step 2 — Python autoguess scan (not yet implemented)
The GAS `autoMatchUnmatchedPayments` logic needs a Python equivalent. Design:
```python
def run_autoguess_scan(admin_email: str) -> dict:
    """
    For unmatched gmail rows within the collection window,
    infer PaymentIntent from amount (IndividualPrice / FamilyPrice),
    extract MemberID from memo, create webapp_event + payment record.
    Only runs if today is within MembershipCollectionStart–End.
    Source = 'AutoGuess', processedBy = 'auto-guess@system'.
    """
```
Config keys needed: `IndividualPrice`, `FamilyPrice`, `MembershipCollectionStart`, `MembershipCollectionEnd`

---

### Mode 2 — Audit mode (not yet implemented)
Full review workflow:
- Show all `approved` events with payment records
- Allow admin to flag suspicious ones (amount mismatch, duplicate, etc.)
- Generate reconciliation report (period, total collected, by intent)

---

## Key File Map

```
mmr-admin/
├── core.py                  ← gen_id() — NEW
├── config_cache.py          ← get_config(), refresh_config() — NEW
├── activity_logger.py       ← log_activity() — NEW
├── sync_jobs.py             ← launch_job/update_job/get_job/list_jobs — NEW
├── query_builder.py         ← add_search(), add_date_filter() — NEW
├── datetime_utils.py        ← to_datetime(), to_date() — NEW
├── helpers.py               ← + @handle_api_errors — MODIFIED
├── payment_handlers.py      ← wired to core/config_cache/datetime_utils — MODIFIED
├── payment_actions.py       ← wired to core/config_cache/activity_logger/datetime_utils — MODIFIED
├── api_payments.py          ← @handle_api_errors + add_search + 2 new routes — MODIFIED
├── api_sheets_sync.py       ← launch_job/update_job replaces 38 lock blocks — MODIFIED
├── sheets_sync.py           ← config_cache — MODIFIED
├── webhook_client.py        ← config_cache — MODIFIED
├── api_sheets_diags.py      ← config_cache — MODIFIED
└── static/
    ├── utils.js             ← window.mmrUtils — NEW
    ├── payments.js          ← full rewrite: side-by-side, focus filter, tooltip
    └── DistrictMembersPanel.js ← mmrUtils.api() — MODIFIED
```

---

## Dependency Graph (leaf → consumer)

```
core.py  →  payment_handlers, payment_actions, activity_logger
config_cache.py  →  payment_handlers, payment_actions, api_sheets_sync,
                    sheets_sync, webhook_client, api_sheets_diags
activity_logger.py  →  payment_actions
sync_jobs.py  →  api_sheets_sync
query_builder.py  →  api_payments
datetime_utils.py  →  payment_handlers, payment_actions
helpers.py  →  api_payments, api_sheets_sync (+ all Blueprints)
```

`helpers.py` is a strict leaf module (no mmr-admin imports). All new utility modules are also leaf modules except `activity_logger` (imports `core` and `db`).

---

## Config Keys Referenced

| Key | Value | Used By |
|-----|-------|---------|
| `IndividualPrice` | 30 | autoguess, auto-match |
| `FamilyPrice` | 50 | autoguess, auto-match |
| `FamilyUpgradePrice` | 20 | handle_family_upgrade |
| `MembershipYearEnd` | 2027-03-31 | compute_membership_expiration |
| `MembershipRenewalYears` | 1 | compute_membership_expiration |
| `MembershipCollectionStart` | 2026-02-01 | autoguess guard |
| `MembershipCollectionEnd` | 2026-04-30 | autoguess guard |
| `SheetsWebhookUrl` | https://script.google.com/... | all GAS calls |

---

## Recommended Next Steps (Priority Order)

1. **Fix Bug 2** — extend `_import_transactions` INSERT to capture Amount, Sender, TransactionDate, TransactionNumber, Subject, OriginalMemo, Source. This unblocks everything else (auto-match, dashboard counts, UI display).
2. **Fix Bug 4** — move `ProcessedTime = NOW()` from match to approve in `payment_actions.py`.
3. **Fix Bug 3** — update `sync_engine.py:resolve_gmail_row` to sync `ProcessedTime` Sheets→MySQL when GAS has processed a row.
4. **Implement Python autoguess** — `run_autoguess_scan()` mirroring GAS `jobs.ts` logic.
5. **Deploy and smoke test** — run `_import_transactions` sync, verify Amount/Sender appear in UI, verify auto-match starts working.
6. **Fix Bug 5** — decide on dual-system strategy (GAS off vs. Python dedup guard).
7. **Implement Mode 2 (Audit)**.
