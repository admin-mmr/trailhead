# MMR Admin — Full Refactor Blueprint
> **Instructions for Haiku:** Execute each task group in order. Read each source file fully before editing. After each file split, run `python3 test_imports.py` (Python) or verify `wc -l` line counts (JS). Commit source + `_context.md` together when done with a phase.

---

## HARD CONSTRAINTS (never violate)

- **Python >400 lines** → must split. **JS/React >300 lines** → must split.
- **MySQL 5.7+**: no `IF NOT EXISTS` in `ALTER TABLE`, no multi-clause ALTERs, no `REGEXP_REPLACE`.
- **JS architecture**: NO ES modules. All new JS files must assign to `window.ComponentName` and be loaded via `<script type="text/babel" src="...">` in `index.html`. No imports/exports.
- **Basecamp source-of-truth**: Edit `basecamp/python/` first; CI auto-copies to `mmr-admin/`. Then run `./scripts/sync-shared-modules.sh` and `python3 mmr-admin/test_imports.py`.
- **app.py blueprint registration**: Every new `*_bp` Blueprint must be imported and registered in `app.py`.
- **Never push, never force-push, never --no-verify.**

---

## FILE SIZE TARGETS (after all splits)

| Module | Target |
|--------|--------|
| Python routes files | ≤350 lines |
| Python helper/util files | ≤250 lines |
| React component files | ≤280 lines |
| React helper/util files | ≤150 lines |

---

## PHASE 1 — Python Backend (mmr-admin/)

### ──────────────────────────────────────────
### TASK 1.1 — Split `api_payments.py` (1,314 → ~350)
### ──────────────────────────────────────────

**Source:** `/sessions/admiring-confident-feynman/mnt/trailhead/mmr-admin/api_payments.py`

#### Step A — Create `payment_helpers.py` (~180 lines)

New file path: `mmr-admin/payment_helpers.py`

Extract these functions verbatim (they are pure utilities with no Flask imports):
- `get_member_by_id(member_id)` — lines ~40–48
- `get_pending_submissions_for_member(member_id)` — lines ~49–57
- `get_config(key)` — lines ~58–63
- `get_renewal_period()` — lines ~64–71
- `parse_member_id_from_memo(memo)` — lines ~72–81
- `is_within_renewal_period(payment_date)` — lines ~332–354

File header/imports needed:
```python
from __future__ import annotations
import re, logging
from datetime import date
from db import query
logger = logging.getLogger(__name__)
```

No Blueprint. No Flask. Pure helpers only.

#### Step B — Create `payment_matching.py` (~300 lines)

New file path: `mmr-admin/payment_matching.py`

Extract these functions verbatim (fuzzy matching logic, no Flask):
- `partial_name_match(submission_memberid, gmail_sender, gmail_memo)` — lines ~82–105
- `build_member_text(member)` — lines ~106–130
- `build_transaction_text(gmail)` — lines ~131–144
- `fuzzy_match_transaction_to_member(gmail, member)` — lines ~145–192
- `find_best_matching_submission(gmail, amount)` — lines ~193–233
- `fuzzy_select_transaction_to_submission(submission_id, max_candidates)` — lines ~234–331
- `_autoguess_single_transaction(...)` — lines ~603–701 (private helper called by autoguess route)

File header/imports needed:
```python
from __future__ import annotations
import logging, re
from decimal import Decimal
from db import query
from payment_helpers import get_member_by_id, get_pending_submissions_for_member, get_renewal_period, is_within_renewal_period, parse_member_id_from_memo
logger = logging.getLogger(__name__)
```

No Blueprint. No Flask.

#### Step C — Trim `api_payments.py` to routes only (~350 lines)

After extracting helpers and matching:
1. Remove all extracted functions from `api_payments.py`
2. Add these imports at the top:
```python
from payment_helpers import (get_member_by_id, get_pending_submissions_for_member,
    get_config, get_renewal_period, parse_member_id_from_memo, is_within_renewal_period)
from payment_matching import (partial_name_match, build_member_text, build_transaction_text,
    fuzzy_match_transaction_to_member, find_best_matching_submission,
    fuzzy_select_transaction_to_submission, _autoguess_single_transaction)
```
3. Keep only: Blueprint definition (`payments_bp`) + all `@payments_bp.route(...)` functions.

#### Step D — Update `app.py`

No change needed — `payments_bp` stays in `api_payments.py`. `payment_helpers.py` and `payment_matching.py` are not blueprints.

#### Validation
```bash
python3 test_imports.py
wc -l api_payments.py payment_helpers.py payment_matching.py
# Expected: api_payments.py ~350, payment_helpers.py ~180, payment_matching.py ~300
```

---

### ──────────────────────────────────────────
### TASK 1.2 — Split `api_sync.py` (1,155 → ~400)
### ──────────────────────────────────────────

**Source:** `mmr-admin/api_sync.py`

#### Step A — Create `sync_worker.py` (~350 lines)

New file path: `mmr-admin/sync_worker.py`

Extract:
- Module-level globals: `_jobs = {}`, `_jobs_lock = threading.Lock()`
- `_sync_worker(event_id, event_code, force_reload)` — lines ~417–1043 (the main threading.Thread target; huge function)
- `_process_finishers_batch(conn, event_id, finisher_data, batch_size)` — private helper called inside `_sync_worker`

File header/imports needed:
```python
from __future__ import annotations
import threading, logging, time
from datetime import datetime
import mysql.connector.errors
from db import query, execute, get_conn
from nyrr_api import NyrrApiClient, get_client, NyrrApiError
logger = logging.getLogger(__name__)

_jobs: dict = {}
_jobs_lock = threading.Lock()
```

Exports needed (for api_sync.py to use):
```python
# at bottom of sync_worker.py — these are already just functions/globals, no extra needed
```

#### Step B — Trim `api_sync.py` to routes only (~400 lines)

After extracting sync_worker:
1. Remove `_jobs`, `_jobs_lock`, `_sync_worker`, `_process_finishers_batch` from `api_sync.py`
2. Add at top: `from sync_worker import _jobs, _jobs_lock, _sync_worker`
3. Keep: Blueprint definition (`sync_bp`) + all route functions:
   - `api_load_event(event_id)` — lines ~42–75
   - `api_sync_cancel(event_code)` — lines ~76–90
   - `api_sync_status(event_code)` — lines ~91–102
   - `api_sync_membership_fees()` — lines ~103–265
   - `api_sync_members_lastupdated()` — lines ~266–416
   - `api_delete_event_runners(event_id)` — lines ~1046–1155

#### Step C — No `app.py` changes needed

`sync_bp` stays in `api_sync.py`. `sync_worker.py` is not a blueprint.

#### Validation
```bash
python3 test_imports.py
wc -l api_sync.py sync_worker.py
# Expected: api_sync.py ~400, sync_worker.py ~350
```

---

### ──────────────────────────────────────────
### TASK 1.3 — Split `api_python_exec.py` (717 → ~300)
### ──────────────────────────────────────────

**Source:** `mmr-admin/api_python_exec.py`

#### Step A — Create `diagnostics.py` (~400 lines)

New file path: `mmr-admin/diagnostics.py`

Extract these 9 diagnostic functions and the `REGISTERED_FUNCTIONS` dict:
- `get_sheet_vs_db_counts()` — lines ~41–98
- `get_sync_status()` — lines ~99–142
- `check_transaction_dups()` — lines ~143–195
- `check_transaction_nulls()` — lines ~196–246
- `get_sample_transactions(limit=10)` — lines ~247–289
- `check_webhook_email_config()` — lines ~290–321
- `send_test_email()` — lines ~322–398
- `test_db_connection()` — lines ~399–459
- `dump_schema()` — lines ~460–519

Also extract the `REGISTERED_FUNCTIONS` dict (maps string name → function reference).

File header/imports needed:
```python
from __future__ import annotations
import logging, os, traceback
from db import query
from api_email_diags import send_email   # only if send_test_email uses it
logger = logging.getLogger(__name__)
```

At the bottom, define:
```python
REGISTERED_FUNCTIONS = {
    'get_sheet_vs_db_counts': get_sheet_vs_db_counts,
    'get_sync_status': get_sync_status,
    'check_transaction_dups': check_transaction_dups,
    'check_transaction_nulls': check_transaction_nulls,
    'get_sample_transactions': get_sample_transactions,
    'check_webhook_email_config': check_webhook_email_config,
    'send_test_email': send_test_email,
    'test_db_connection': test_db_connection,
    'dump_schema': dump_schema,
}
```

No Blueprint. No Flask.

#### Step B — Trim `api_python_exec.py` to routes only (~250 lines)

1. Remove all extracted diagnostic functions from `api_python_exec.py`
2. Add: `from diagnostics import REGISTERED_FUNCTIONS`
3. Keep: Blueprint (`py_exec_bp`) + 4 route functions:
   - `list_functions()` — GET /api/py-exec/list
   - `run_function(fn_name)` — POST /api/py-exec/run/<fn_name>
   - `execute_code()` — POST /api/py-exec/code
   - `health_check()` — GET /api/py-exec/health

Update `list_functions()` to use `REGISTERED_FUNCTIONS.keys()` instead of local dict.
Update `run_function(fn_name)` to look up in `REGISTERED_FUNCTIONS` instead of local dict.

#### Step C — No `app.py` changes needed

`py_exec_bp` stays in `api_python_exec.py`.

#### Validation
```bash
python3 test_imports.py
wc -l api_python_exec.py diagnostics.py
# Expected: api_python_exec.py ~250, diagnostics.py ~400
```

---

### ──────────────────────────────────────────
### TASK 1.4 — Split `api_events.py` (544 → ~280)
### ──────────────────────────────────────────

**Source:** `mmr-admin/api_events.py`

#### Step A — Create `api_events_discovery.py` (~270 lines)

New file path: `mmr-admin/api_events_discovery.py`

Extract:
- Constant `NYRR_UPCOMING_API = "https://widget.hakuapp.com/v2/event_lists"` — line ~449
- Constant `NYRR_UPCOMING_API_KEY = os.environ.get(...)` — line ~450
- `api_discover_events()` — lines ~382–448 (includes any shared upsert helper used only by discover routes)
- `api_discover_upcoming()` — lines ~455–544

New Blueprint:
```python
events_discovery_bp = Blueprint('events_discovery', __name__)
```

File header/imports needed:
```python
from __future__ import annotations
import logging, os, requests, json
from datetime import datetime
from flask import Blueprint, request
from auth import login_required, require_role
from db import query, execute
from helpers import json_response, handle_api_errors
logger = logging.getLogger(__name__)
events_discovery_bp = Blueprint('events_discovery', __name__)
```

#### Step B — Trim `api_events.py` (~280 lines)

1. Remove `api_discover_events`, `api_discover_upcoming`, the two NYRR_UPCOMING constants from `api_events.py`
2. Keep: `events_bp` Blueprint + all other routes:
   - `api_events()` — lines ~32–84
   - `api_event_detail(event_id)` — lines ~85–113
   - `api_event_runners(event_id)` — lines ~114–153
   - `api_run_automatch(event_id)` — lines ~154–330
   - `api_stats()` — lines ~331–365
   - `api_stats_years()` — lines ~366–381

#### Step C — Update `app.py`

Add after the existing `events_bp` registration:
```python
from api_events_discovery import events_discovery_bp
app.register_blueprint(events_discovery_bp)
```

#### Validation
```bash
python3 test_imports.py
wc -l api_events.py api_events_discovery.py
# Expected: api_events.py ~280, api_events_discovery.py ~270
```

---

## PHASE 2 — JavaScript Frontend (mmr-admin/static/)

> **Critical JS rule**: All new files must use `window.ComponentName = ...` pattern. They must NOT use ES module syntax (`import`/`export`). Load order in `index.html` matters: helper files BEFORE component files.

### ──────────────────────────────────────────
### TASK 2.1 — Split `PaymentsPanel.js` (1,046 → ~250)
### ──────────────────────────────────────────

**Source:** `mmr-admin/static/PaymentsPanel.js`

#### Step A — Create `PaymentsHelpers.js` (~120 lines)

New file: `mmr-admin/static/PaymentsHelpers.js`

Extract from PaymentsPanel.js (these are module-level, non-React constants/functions):
- `const fmt = (v) => ...` — line ~24
- `const fmtDate = (v) => ...` — lines ~25–36
- `const fmtMoney = (v) => ...` — line ~37
- `const STATUS_COLORS = { ... }` — lines ~39–47
- `const Badge = ({ status }) => ...` — lines ~48–63
- `function extractMemberIds(text) { ... }` — lines ~64–69
- `function suggestIntent(amount) { ... }` — lines ~70–76
- `const PAYMENT_INTENTS = [...]` — lines ~77–89

Wrap entire file as an IIFE that assigns to window:
```javascript
// PaymentsHelpers.js — Shared helpers for Payments UI
// Must be loaded BEFORE PaymentsPanel.js in index.html
(function() {
  const fmt = ...;
  // ... all extracted code ...
  window.PaymentsHelpers = { fmt, fmtDate, fmtMoney, STATUS_COLORS, Badge, extractMemberIds, suggestIntent, PAYMENT_INTENTS };
})();
```

Then in `PaymentsPanel.js`, at the top add:
```javascript
const { fmt, fmtDate, fmtMoney, STATUS_COLORS, Badge, extractMemberIds, suggestIntent, PAYMENT_INTENTS } = window.PaymentsHelpers;
```

#### Step B — Create `MemberTooltip.js` (~160 lines)

New file: `mmr-admin/static/MemberTooltip.js`

Extract:
- `const _memberCache = {}` — line ~90
- `const MemberTooltip = ({ memberId, anchorRect, data }) => { ... }` — lines ~92–158
- `const MemberIdChip = ({ memberId, tooltipHandlers, onClick }) => { ... }` — lines ~159–179
- `const fuzzyMatchMember = (query, member) => { ... }` — lines ~180–192

Assign to window:
```javascript
window._memberCache = {};
window.MemberTooltip = MemberTooltip;
window.MemberIdChip = MemberIdChip;
window.fuzzyMatchMember = fuzzyMatchMember;
```

In PaymentsPanel.js, destructure from window:
```javascript
const { MemberTooltip, MemberIdChip, fuzzyMatchMember, _memberCache } = window;
```

#### Step C — Create `GmailQuickApprove.js` (~200 lines)

New file: `mmr-admin/static/GmailQuickApprove.js`

Extract:
- `const GmailQuickApprovePopover = ({ gmail, anchorRect, onClose, onApproved, tooltipHandlers }) => { ... }` — lines ~193–383
- `const getMatchContext = (gmail) => { ... }` — lines ~499–505
- `const MatchCtxBadge = ({ status, linkedTime }) => { ... }` — lines ~506–516

Assign to window:
```javascript
window.GmailQuickApprovePopover = GmailQuickApprovePopover;
window.getMatchContext = getMatchContext;
window.MatchCtxBadge = MatchCtxBadge;
```

#### Step D — Create `PaymentsSubPanels.js` (~280 lines)

New file: `mmr-admin/static/PaymentsSubPanels.js`

Extract:
- `const StatsCards = ({ stats, onAutoguess, autoguessLoading }) => { ... }` — lines ~384–423
- `const PendingSubmissionsTable = ({ submissions, selectedSubmissionIds, ... }) => { ... }` — lines ~424–498
- `const GmailTable = ({ rows, candidates, ... }) => { ... }` — lines ~517–733
- `const PaymentHistoryTable = ({ payments }) => { ... }` — lines ~734–771

Assign to window:
```javascript
window.StatsCards = StatsCards;
window.PendingSubmissionsTable = PendingSubmissionsTable;
window.GmailTable = GmailTable;
window.PaymentHistoryTable = PaymentHistoryTable;
```

#### Step E — Trim `PaymentsPanel.js` to core (~230 lines)

After extracting everything above:
1. Remove all extracted code from PaymentsPanel.js
2. Add destructures from window at the top (as shown above)
3. Keep only: `const PaymentsPanel = () => { ... }` (lines ~772–1046 with state management, data fetching, main layout)
4. End with: `window.PaymentsPanel = PaymentsPanel;`

#### Step F — Update `index.html` script loading

Add new `<script>` tags BEFORE the PaymentsPanel.js line:
```html
<script type="text/babel" src="/static/PaymentsHelpers.js"></script>
<script type="text/babel" src="/static/MemberTooltip.js"></script>
<script type="text/babel" src="/static/GmailQuickApprove.js"></script>
<script type="text/babel" src="/static/PaymentsSubPanels.js"></script>
<script type="text/babel" src="/static/PaymentsPanel.js"></script>  <!-- must be last -->
```

#### Validation
```
wc -l static/PaymentsPanel.js static/PaymentsHelpers.js static/MemberTooltip.js static/GmailQuickApprove.js static/PaymentsSubPanels.js
# All should be ≤280 lines
```

---

### ──────────────────────────────────────────
### TASK 2.2 — Split `DistrictMembersPanel.js` (950 → ~260)
### ──────────────────────────────────────────

**Source:** `mmr-admin/static/DistrictMembersPanel.js`

#### Step A — Create `DistrictExport.js` (~180 lines)

New file: `mmr-admin/static/DistrictExport.js`

Extract CSV and Excel export logic. Search in DistrictMembersPanel.js for:
- `exportToCSV` function (search for: `function exportToCSV` or `const exportToCSV`)
- `exportToExcel` function
- Any shared formatting helpers used only by export

Assign to window:
```javascript
window.DistrictExportHelpers = { exportToCSV, exportToExcel };
```

#### Step B — Create `DistrictMemberTable.js` (~280 lines)

New file: `mmr-admin/static/DistrictMemberTable.js`

Extract the large table rendering component (search for the JSX block that renders `<table>` rows with member data, checkbox selection, sort headers). This will be the biggest sub-component.

Assign to window:
```javascript
window.DistrictMemberTable = DistrictMemberTable;
```

In DistrictMembersPanel.js, replace the inlined table JSX with:
```javascript
{window.DistrictMemberTable && React.createElement(window.DistrictMemberTable, { members, selectedMembers, sortBy, sortOrder, ... })}
```

#### Step C — Create `DistrictMemberFilters.js` (~180 lines)

New file: `mmr-admin/static/DistrictMemberFilters.js`

Extract filter/control UI component (district selector dropdown, status filter, renewed filter, sort controls, column visibility toggle, export buttons). Search for the JSX section rendering filter controls.

Assign to window:
```javascript
window.DistrictMemberFilters = DistrictMemberFilters;
```

#### Step D — Trim `DistrictMembersPanel.js` to core (~290 lines)

After extractions:
1. Remove extracted code
2. Add window destructures at top
3. Keep: state declarations, `fetchDistricts()`, `fetchMembers()`, `applyFilters()`, `applySorting()`, main layout JSX (delegating to DistrictMemberTable + DistrictMemberFilters)
4. End with: `window.DistrictMembersPanel = DistrictMembersPanel;`

#### Step E — Update `index.html`

Add BEFORE DistrictMembersPanel.js:
```html
<script type="text/babel" src="/static/DistrictExport.js"></script>
<script type="text/babel" src="/static/DistrictMemberTable.js"></script>
<script type="text/babel" src="/static/DistrictMemberFilters.js"></script>
```

---

### ──────────────────────────────────────────
### TASK 2.3 — Split `AuditPanel.js` (574 → ~200)
### ──────────────────────────────────────────

**Source:** `mmr-admin/static/AuditPanel.js`

#### Step A — Create `AuditResultsTable.js` (~240 lines)

New file: `mmr-admin/static/AuditResultsTable.js`

Extract the large results table rendering. Search for the JSX block rendering audit result rows (expandable rows showing message_id, amount, transaction_date, sender, status_match, trace_route, family_all_match). This is the bulk of the render section.

Assign to window:
```javascript
window.AuditResultsTable = AuditResultsTable;
```

Props it needs: `{ auditResults, expandedRows, onToggleRow, onUnmatch, unmatching }`

#### Step B — Create `AuditSummaryBar.js` (~120 lines)

New file: `mmr-admin/static/AuditSummaryBar.js`

Extract summary statistics bar (matched/mismatched/not-traced counts, export CSV button). Search for the JSX that renders the summary stats section and export.

Assign to window:
```javascript
window.AuditSummaryBar = AuditSummaryBar;
```

Props: `{ summary, auditResults, startDate, endDate, targetExpiration }`

#### Step C — Trim `AuditPanel.js` to core (~210 lines)

After extractions:
1. Remove extracted render sections
2. Keep: all state hooks, config load `useEffect`, `runAudit()`, member search debounce, date input JSX, filter controls, run button, and delegated rendering:
   ```javascript
   {auditResults && window.AuditSummaryBar && React.createElement(window.AuditSummaryBar, { summary: auditResults.summary, ... })}
   {auditResults && window.AuditResultsTable && React.createElement(window.AuditResultsTable, { auditResults: auditResults.audit_results, ... })}
   ```
3. End with: `window.AuditPanel = AuditPanel;`

#### Step D — Update `index.html`

Add BEFORE AuditPanel.js:
```html
<script type="text/babel" src="/static/AuditResultsTable.js"></script>
<script type="text/babel" src="/static/AuditSummaryBar.js"></script>
```

---

## PHASE 3 — Basecamp Sync Modules (basecamp/python/)

> **IMPORTANT**: Edit files in `basecamp/python/` ONLY. After completing this phase, run `./scripts/sync-shared-modules.sh` to copy to `mmr-admin/`. Then run `python3 mmr-admin/test_imports.py`.

### ──────────────────────────────────────────
### TASK 3.1 — Split `basecamp/python/sync_config.py` (1,064 → ~400)
### ──────────────────────────────────────────

**Source:** `basecamp/python/sync_config.py`

#### Step A — Create `basecamp/python/sync_diff.py` (~200 lines)

Extract these diff/comparison helpers:
- `_normalize_for_diff(value)` — search for this function
- `_row_changed(db_row, sheet_row, columns)` — search for this function
- `_filter_changed_rows(db_rows, sheet_rows, key_col, columns)` — search for this function
- Any private helpers called only from these functions

File header:
```python
from __future__ import annotations
import logging
from decimal import Decimal
from datetime import date, datetime
logger = logging.getLogger(__name__)
```

#### Step B — Create `basecamp/python/sync_batch.py` (~200 lines)

Extract batch/logging helpers:
- `_log_sync_batch(...)` — search for this function
- `_get_last_successful_batch(config_key, job_id)` — search for this function
- `_batch_insert_rows(conn, table, rows, columns, mode)` — search for this function
- `_normalize_sheet_rows(rows, columns)` — search for this function
- `_prepare_sheet_rows(config, raw_rows)` — search for this function
- `BATCH_SIZE = 300` constant (move here)

File header:
```python
from __future__ import annotations
import logging
from db import query, execute, get_conn
logger = logging.getLogger(__name__)
BATCH_SIZE = 300
```

#### Step C — Create `basecamp/python/sync_models.py` (~120 lines)

Extract:
- `SYNC_CONFIG` dict (all 6 sync operation definitions)
- Any Enum-like constants or type aliases
- `get_config(key)` and `list_configs()` accessor functions

File header:
```python
from __future__ import annotations
from typing import Optional
```

#### Step D — Trim `sync_config.py` to runner only (~540 lines)

After extractions:
1. Remove extracted functions/constants from sync_config.py
2. Add imports:
   ```python
   from sync_models import SYNC_CONFIG, get_config, list_configs
   from sync_diff import _normalize_for_diff, _row_changed, _filter_changed_rows
   from sync_batch import BATCH_SIZE, _log_sync_batch, _get_last_successful_batch, _batch_insert_rows, _normalize_sheet_rows, _prepare_sheet_rows
   ```
3. Keep: `generic_sync_runner()` function (the main orchestrator, ~500 lines)

> Note: `generic_sync_runner` is still large but is a single unified algorithm — do NOT split it further unless a clear responsibility boundary exists.

#### Validation
```bash
cd basecamp/python && python3 -c "from sync_config import generic_sync_runner; print('OK')"
./scripts/sync-shared-modules.sh
python3 mmr-admin/test_imports.py
wc -l sync_config.py sync_diff.py sync_batch.py sync_models.py
```

---

### ──────────────────────────────────────────
### TASK 3.2 — Split `basecamp/python/sync_engine.py` (1,063 → ~250)
### ──────────────────────────────────────────

**Source:** `basecamp/python/sync_engine.py`

#### Step A — Create `basecamp/python/sync_datetime.py` (~200 lines)

Extract datetime parsing logic:
- `_GMT_OFFSET_RE` constant — search for this regex pattern
- `parse_datetime(value)` — main parser function (handles JS Date.toString() format)
- `datetimes_equal(a, b)` — comparison function
- `to_mysql_datetime(value)` — formatter
- `_apply_gmt_offset(naive_dt, offset_str)` — private helper

File header:
```python
from __future__ import annotations
import re, logging
from datetime import datetime, timedelta, timezone
logger = logging.getLogger(__name__)
```

#### Step B — Create `basecamp/python/sync_types.py` (~200 lines)

Extract dataclasses/constants:
- `STANDARD_TABLES` dict/list — table configuration
- `MEMBERS_SYNC_COLUMNS` list — column whitelist
- `IMMUTABLE_ON_UPDATE` set — immutable column names
- Any GMAIL-specific constants/rules
- `SyncDecision` dataclass (fields: reason, precedence, value, source)
- `GmailSyncAction` dataclass
- `SyncAudit` class (with `log()`, `to_dict()`, `__str__()` methods)
- `SyncRowResult` class (with result tracking fields)

File header:
```python
from __future__ import annotations
import json, logging
from dataclasses import dataclass, field
from typing import Optional, Any
logger = logging.getLogger(__name__)
```

#### Step C — Create `basecamp/python/sync_compare.py` (~250 lines)

Extract comparison and conflict resolution:
- `_rows_differ(db_row, sheet_row, columns)` — row-level diff
- `_values_equal(a, b)` — value equality with type coercion
- `classify_rows(db_rows, sheet_rows, key_col, columns)` — classify added/modified/unchanged
- `compare_sync_rows(db_row, sheet_row, config)` — main bidirectional comparison
- `resolve_conflict(db_val, sheet_val, column, config)` — conflict resolution
- `resolve_conflict_unix(db_val, sheet_val, column)` — unix timestamp conflict
- `resolve_gmail_row(db_row, sheet_row)` — gmail-specific resolution
- `_safe_int(v)` — private helper

File header:
```python
from __future__ import annotations
import logging
from sync_types import SyncDecision, GmailSyncAction, IMMUTABLE_ON_UPDATE, STANDARD_TABLES
from sync_datetime import datetimes_equal, parse_datetime
logger = logging.getLogger(__name__)
```

#### Step D — Create `basecamp/python/sync_audit.py` (~150 lines)

Extract:
- `log_sync_error(table, row_key, error, context)` — error logging function
- `_serialize(obj)` — JSON serializer helper
- Any remaining SyncAudit helper methods not already in sync_types.py
- `filter_sync_columns(columns, table)` — filter by allowed list
- `is_immutable_column(column, table)` — immutability check

File header:
```python
from __future__ import annotations
import json, logging
from sync_types import MEMBERS_SYNC_COLUMNS, STANDARD_TABLES, IMMUTABLE_ON_UPDATE
logger = logging.getLogger(__name__)
```

#### Step E — Trim `sync_engine.py` to thin core (~263 lines)

After extractions:
1. Remove all extracted code
2. Add imports:
   ```python
   from sync_types import SyncDecision, GmailSyncAction, SyncAudit, SyncRowResult, STANDARD_TABLES, MEMBERS_SYNC_COLUMNS, IMMUTABLE_ON_UPDATE
   from sync_datetime import parse_datetime, datetimes_equal, to_mysql_datetime
   from sync_compare import compare_sync_rows, resolve_conflict, classify_rows, _rows_differ, _values_equal, _safe_int
   from sync_audit import log_sync_error, filter_sync_columns, is_immutable_column, _serialize
   ```
3. Keep only: remaining small helpers (`_coerce_val`, `_filter_row`, `_diff_rows`, `_log_result`) and the high-level public API

#### Validation
```bash
cd basecamp/python
python3 -c "from sync_engine import compare_sync_rows, classify_rows; print('OK')"
python3 -c "from sync_config import generic_sync_runner; print('OK')"
cd ../..
./scripts/sync-shared-modules.sh
python3 mmr-admin/test_imports.py
wc -l basecamp/python/sync_engine.py basecamp/python/sync_types.py basecamp/python/sync_datetime.py basecamp/python/sync_compare.py basecamp/python/sync_audit.py
```

---

## POST-ALL-PHASES CHECKLIST

### Final Validation Steps

```bash
# 1. Python imports
cd mmr-admin && python3 test_imports.py
# Expect: All 12 tested modules imported cleanly

# 2. File size check — no Python file should be >400 lines
find mmr-admin -name "*.py" | xargs wc -l | sort -rn | head -15

# 3. File size check — no JS file in static/ should be >300 lines
find mmr-admin/static -name "*.js" | xargs wc -l | sort -rn | head -15

# 4. Smoke test app starts (optional if Flask/MySQL available)
# adm-status  (uses the shortcut alias)
```

### _context.md update (add at top, 3 lines max):
```
### MM-DD HH:MM UTC — Full refactor: all large files split
Changed: api_payments→3 files, api_sync→2, api_python_exec→2, api_events→2, sync_config→4, sync_engine→5, PaymentsPanel→5 JS files, DistrictMembersPanel→4, AuditPanel→3. Status: All imports clean, all files under line limits. Next: Browser smoke test.
```

---

## FILES NOT TO SPLIT (already well-sized or cohesive)

| File | Lines | Reason |
|------|-------|--------|
| auth.py | 443 | Single-responsibility auth logic; splitting OAuth routes would fragment the flow |
| api_data.py | 409 | All routes serve related data-access needs; already thin |
| db.py | 346 | Database abstraction layer; should remain a single module |
| helpers.py | ~95 | Leaf module; too small to split further |
| nyrr_api.py | 823 | Well-organized (10 dataclasses + 1 client class); skip unless models need reuse |
| api_sheets_diags.py | 428 | Tight diagnostic coupling; splitting would add confusion |

---

## TOTAL IMPACT SUMMARY

| Category | Files Before | Files After | Lines Reduced |
|----------|-------------|-------------|---------------|
| Python routes | 4 large | 4 core + 6 helpers | ~2,400 → avg 300 |
| JS components | 3 large | 3 core + 9 helpers | ~2,600 → avg 200 |
| Basecamp sync | 2 large | 2 core + 7 helpers | ~2,100 → avg 200 |
| **Total new files** | — | **+16** | — |
