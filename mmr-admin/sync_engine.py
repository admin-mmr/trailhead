"""
sync_engine.py — Shared bidirectional sync logic for MMR Trailhead.

Canonical implementation of the MMR Bidirectional Sync Specification.
Used by:
  - basecamp/ops/sync_sheets_to_mysql.py  (GitHub-scheduled cron job)
  - mmr-admin/api_sheets_sync.py           (Admin Portal Flask endpoints)

Table configuration:
  Standard tables  (members, payments, webapp_events):
      Bidirectional newer-wins with Sheets tie-break.
  Specialized table (gmail_transactions):
      Sheets→MySQL for new rows + Memo; MySQL→Sheets for ProcessedTime/Notes/PaymentID.

Timezone contract:
  All comparisons and storage use UTC, represented as naive datetime objects
  (no tzinfo) matching MySQL DATETIME UTC storage.  The _parse_datetime()
  helper normalises every known input format — including JS Date.toString()
  with GMT±HHMM offsets — to UTC before returning.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Table configuration
# ─────────────────────────────────────────────────────────────────────────────

# Standard tables: bidirectional, newer-wins.
# key        → primary-key column name
# ts_col     → comparison timestamp column
# sheets_tab → Google Sheets tab name
STANDARD_TABLES: Dict[str, Dict[str, str]] = {
    'members': {
        'key':        'MemberID',
        'ts_col':     'LastUpdated',
        'sheets_tab': 'Main',
    },
    'payments': {
        'key':        'PaymentID',
        'ts_col':     'ProcessedDate',
        'sheets_tab': 'Payment-History',
    },
    'webapp_events': {
        'key':        'EventID',
        'ts_col':     'UpdatedAt',
        'sheets_tab': 'WebApp-Events',
    },
}

# Column whitelist for members (cols 1–26, ending at YearBorn).
# Anything after YearBorn in the schema is a system/auth column — never synced.
MEMBERS_SYNC_COLUMNS: Set[str] = {
    'MemberID', 'Status', 'Created', 'Expiration',
    'Email', 'FirstName', 'LastName', 'Type', 'FamilyID',
    'Gender', 'WeChatID', 'District', 'WebApp', 'PaymentCheck',
    'Info', 'LastUpdated', 'MembershipFeePaid', 'PaymentDate',
    'PaymentTransaction', 'JoinYear', 'PhoneNumber',
    'LastLoginDate', 'ProfileLastUpdated', 'Notes',
    'NYRRRunnerName', 'YearBorn',
}

# Columns that are set on INSERT but must never be changed on UPDATE.
IMMUTABLE_ON_UPDATE: Dict[str, Set[str]] = {
    'members':       {'MemberID'},
    'payments':      {'PaymentID'},
    'webapp_events': {'EventID'},
    'gmail_transactions': {'MessageId'},
}

# gmail_transactions field-level sync rules.
# Sheets → MySQL (always, regardless of timestamp):
GMAIL_SHEETS_TO_MYSQL_FIELDS: Set[str] = {'Memo'}
# MySQL → Sheets (always, regardless of timestamp):
GMAIL_MYSQL_TO_SHEETS_FIELDS: Set[str] = {'ProcessedTime', 'Notes', 'PaymentID'}


# ─────────────────────────────────────────────────────────────────────────────
# Datetime normalisation
# ─────────────────────────────────────────────────────────────────────────────

# Match 'GMT-0400', 'GMT+0530', 'GMT-04:00', 'GMT+05:30'
_GMT_OFFSET_RE = re.compile(
    r'GMT([+-])(\d{2}):?(\d{2})',
    re.IGNORECASE,
)


def _apply_gmt_offset(dt: datetime, sign: str, hours: int, minutes: int) -> datetime:
    """Convert a naive local datetime to UTC using the supplied GMT offset."""
    offset = timedelta(hours=hours, minutes=minutes)
    if sign == '+':
        return dt - offset   # local = UTC + offset  →  UTC = local - offset
    else:
        return dt + offset   # local = UTC - offset  →  UTC = local + offset


def parse_datetime(value: Any) -> Optional[datetime]:
    """
    Parse any datetime value to a *timezone-naive UTC* datetime.

    Accepted formats
    ----------------
    • Python datetime (naive)          → returned as-is (assumed UTC)
    • Python datetime (aware)          → converted to UTC, tzinfo stripped
    • ISO 8601 with Z                  → '2026-03-31T20:27:00.000Z'
    • ISO 8601 with offset             → '2026-03-31T20:27:00+00:00'
    • JS Date.toString() with offset   → 'Tue Mar 31 2026 15:51:18 GMT-0400 (...)'
    • MySQL DATETIME string            → '2026-03-31 20:27:00'
    • Date-only string                 → '2026-03-31'

    Returns None for empty / unparseable input.

    Key difference from legacy code
    --------------------------------
    The old helpers discarded the GMT offset (e.g. GMT-0400 → local time was
    stored as-is).  This helper applies the offset so the returned datetime is
    always UTC, preventing phantom conflict writes across DST transitions.
    """
    if value is None:
        return None

    # ── Already a Python datetime ─────────────────────────────────────────
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value  # assume UTC

    if not isinstance(value, str):
        return None

    s = value.strip()
    if not s:
        return None

    # ── JS Date.toString() with GMT offset ───────────────────────────────
    # 'Tue Mar 31 2026 15:51:18 GMT-0400 (Eastern Daylight Time)'
    if 'GMT' in s:
        m = _GMT_OFFSET_RE.search(s)
        date_part = s.split(' GMT')[0].strip()
        # Parse the local time portion
        for fmt in ('%a %b %d %Y %H:%M:%S', '%a %b  %d %Y %H:%M:%S'):
            try:
                dt_local = datetime.strptime(date_part, fmt)
                if m:
                    sign  = m.group(1)
                    hrs   = int(m.group(2))
                    mins  = int(m.group(3))
                    return _apply_gmt_offset(dt_local, sign, hrs, mins)
                return dt_local  # no offset found — treat as UTC (edge case)
            except ValueError:
                continue
        logger.warning("Could not parse JS Date string: %s", s)
        return None

    # ── ISO 8601 with trailing Z ──────────────────────────────────────────
    if s.endswith('Z'):
        s = s[:-1]  # strip Z; treat as UTC

    # ── ISO 8601 with explicit offset (+HH:MM or -HH:MM) ─────────────────
    # e.g. '2026-03-31T15:51:18-04:00' or '2026-03-31T15:51:18+00:00'
    offset_match = re.search(r'([+-])(\d{2}):(\d{2})$', s)
    if offset_match:
        try:
            # Remove the offset suffix and parse the bare datetime
            bare = s[:offset_match.start()]
            dt_local = datetime.fromisoformat(bare.replace('T', ' ').split('.')[0])
            sign = offset_match.group(1)
            hrs  = int(offset_match.group(2))
            mins = int(offset_match.group(3))
            return _apply_gmt_offset(dt_local, sign, hrs, mins)
        except ValueError:
            pass

    # ── Standard formats (already UTC) ───────────────────────────────────
    for fmt in (
        '%Y-%m-%dT%H:%M:%S.%f',
        '%Y-%m-%dT%H:%M:%S',
        '%Y-%m-%d %H:%M:%S',
        '%Y-%m-%d',
    ):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue

    logger.warning("parse_datetime: unrecognised format: %s", s[:80])
    return None


def to_mysql_datetime(value: Any, date_only: bool = False) -> Optional[str]:
    """
    Convert any input to a MySQL-safe UTC datetime string.

    Args:
        date_only: if True, return 'YYYY-MM-DD'; otherwise 'YYYY-MM-DD HH:MM:SS'

    Returns None for empty / unparseable input.
    """
    dt = parse_datetime(value)
    if dt is None:
        return None
    fmt = '%Y-%m-%d' if date_only else '%Y-%m-%d %H:%M:%S'
    return dt.strftime(fmt)


def datetimes_equal(a: Any, b: Any, tolerance_seconds: int = 1) -> bool:
    """
    Compare two datetime values after normalising both to UTC.

    Returns False if either value cannot be parsed as a datetime — this
    prevents non-datetime strings (e.g. 'active', 'not active') from being
    incorrectly considered equal because both return None from parse_datetime.

    tolerance_seconds: allow up to this many seconds of difference (handles
    fractional-second storage inconsistencies between MySQL and Sheets).
    """
    dt_a = parse_datetime(a)
    dt_b = parse_datetime(b)
    if dt_a is None or dt_b is None:
        return False   # not comparable as datetimes
    return abs((dt_a - dt_b).total_seconds()) <= tolerance_seconds


# ─────────────────────────────────────────────────────────────────────────────
# Conflict resolution
# ─────────────────────────────────────────────────────────────────────────────

class SyncDecision:
    """Result of resolve_conflict()."""
    __slots__ = ('direction', 'reason')

    SHEETS_WINS  = 'sheets_wins'   # copy Sheets → MySQL
    MYSQL_WINS   = 'mysql_wins'    # copy MySQL → Sheets
    NO_CHANGE    = 'no_change'

    def __init__(self, direction: str, reason: str):
        self.direction = direction
        self.reason    = reason

    def __repr__(self) -> str:
        return f'SyncDecision({self.direction}: {self.reason})'


def resolve_conflict(
    table: str,
    key_value: str,
    mysql_row: Dict[str, Any],
    sheets_row: Dict[str, Any],
) -> SyncDecision:
    """
    Apply spec §2.2 version conflict resolution for a Standard table row.

    Rules (in order):
      1. No difference → NO_CHANGE
      2. Newer timestamp wins → SHEETS_WINS or MYSQL_WINS
      3. Tie (same timestamp, data differs) → SHEETS_WINS (spec §2.2.3)
      4. Missing timestamp on one side → SHEETS_WINS (conservative; Sheets is
         the human-editable source of truth)

    Args:
        table:      table name (used to look up ts_col)
        key_value:  PK value (for logging only)
        mysql_row:  dict of MySQL column values
        sheets_row: dict of Google Sheets column values

    Returns:
        SyncDecision
    """
    cfg = STANDARD_TABLES.get(table)
    if cfg is None:
        raise ValueError(f'resolve_conflict called for non-standard table: {table}')

    ts_col = cfg['ts_col']

    # Normalise both timestamp values to UTC
    mysql_ts   = parse_datetime(mysql_row.get(ts_col))
    sheets_ts  = parse_datetime(sheets_row.get(ts_col))

    # Check for any data differences (ignoring the timestamp column itself)
    if not _rows_differ(mysql_row, sheets_row, ignore_cols={ts_col}):
        return SyncDecision(SyncDecision.NO_CHANGE, 'rows identical')

    # Both timestamps present
    # NOTE: Apply 10-second buffer to Sheets timestamps to account for async propagation delays
    #       (GAS → Sheets API takes ~2-10 seconds; don't penalize MySQL updates that race)
    if mysql_ts is not None and sheets_ts is not None:
        from datetime import timedelta
        sheets_ts_adjusted = sheets_ts - timedelta(seconds=10)
        diff = (mysql_ts - sheets_ts_adjusted).total_seconds()

        if diff > 1:
            return SyncDecision(
                SyncDecision.MYSQL_WINS,
                f'MySQL newer: {mysql_ts.isoformat()} > {sheets_ts.isoformat()} (adjusted -10s)',
            )
        if diff < -1:
            return SyncDecision(
                SyncDecision.SHEETS_WINS,
                f'Sheets newer: {sheets_ts.isoformat()} > {mysql_ts.isoformat()} (adjusted -10s)',
            )
        # Tie (within 1 second after adjustment) → MySQL wins (fresher data)
        return SyncDecision(
            SyncDecision.MYSQL_WINS,
            f'Tie within 10s buffer ({sheets_ts.isoformat()}): MySQL wins (fresher data)',
        )

    # Missing timestamp on one or both sides → Sheets wins
    if mysql_ts is None and sheets_ts is None:
        return SyncDecision(
            SyncDecision.SHEETS_WINS,
            'both timestamps missing; Sheets wins by default',
        )
    if mysql_ts is None:
        return SyncDecision(
            SyncDecision.SHEETS_WINS,
            f'MySQL timestamp missing; Sheets ({sheets_ts.isoformat()}) wins',
        )
    # sheets_ts is None
    return SyncDecision(
        SyncDecision.MYSQL_WINS,
        f'Sheets timestamp missing; MySQL ({mysql_ts.isoformat()}) wins',
    )


def resolve_conflict_unix(
    table: str,
    key_value: str,
    mysql_row: Dict[str, Any],
    sheets_row: Dict[str, Any],
) -> SyncDecision:
    """
    Apply spec §2.2 version conflict resolution using Unix timestamps.

    Same logic as resolve_conflict() but uses Unix timestamp columns instead
    of parsing ISO datetime strings. This is timezone-invariant and avoids
    the EDT/UTC comparison issue.

    Args:
        table:      table name (used to look up ts_col and unix_ts_col)
        key_value:  PK value (for logging only)
        mysql_row:  dict of MySQL column values
        sheets_row: dict of Google Sheets column values

    Returns:
        SyncDecision

    Unix column mapping:
      members:       updated_at → updated_at_unix
      webapp_events: timestamp → timestamp_unix
      payment_history: processed_date → processed_date_unix
    """
    cfg = STANDARD_TABLES.get(table)
    if cfg is None:
        raise ValueError(f'resolve_conflict_unix called for non-standard table: {table}')

    ts_col = cfg['ts_col']

    # Map timestamp column → Unix timestamp column
    unix_col_map = {
        'members': {
            'LastUpdated': 'LastUpdatedUnix',
            'LastLoginDate': 'LastLoginDateUnix',
            'ProfileLastUpdated': 'ProfileLastUpdatedUnix',
            'CreatedAt': 'CreatedAtUnix',
        },
        'payments': {
            'ProcessedDate': 'ProcessedDateUnix',
        },
        'webapp_events': {
            'Timestamp': 'TimestampUnix',
            'ExpiresAt': 'ExpiresAtUnix',
            'ApprovalDate': 'ApprovalDateUnix',
        },
    }

    unix_col = unix_col_map.get(table, {}).get(ts_col)
    if not unix_col:
        # Fallback to datetime comparison if Unix column not found
        logger.warning(f'Unix column not mapped for {table}.{ts_col}; falling back to datetime comparison')
        return resolve_conflict(table, key_value, mysql_row, sheets_row)

    # Get Unix timestamps (integers, seconds since epoch)
    mysql_unix = _safe_int(mysql_row.get(unix_col))
    sheets_unix = _safe_int(sheets_row.get(unix_col))

    # Check for any data differences (ignoring the timestamp column itself)
    if not _rows_differ(mysql_row, sheets_row, ignore_cols={ts_col, unix_col}):
        return SyncDecision(SyncDecision.NO_CHANGE, 'rows identical')

    # Both Unix timestamps present
    # NOTE: Apply 10-second buffer to Sheets timestamps to account for async propagation
    if mysql_unix is not None and mysql_unix > 0 and sheets_unix is not None and sheets_unix > 0:
        sheets_unix_adjusted = sheets_unix - 10  # Subtract 10 seconds
        diff = mysql_unix - sheets_unix_adjusted

        if diff > 1:
            return SyncDecision(
                SyncDecision.MYSQL_WINS,
                f'MySQL newer (Unix): {mysql_unix} > {sheets_unix} (adjusted -10s)',
            )
        if diff < -1:
            return SyncDecision(
                SyncDecision.SHEETS_WINS,
                f'Sheets newer (Unix): {sheets_unix} > {mysql_unix} (adjusted -10s)',
            )
        # Tie (within 1 second after adjustment) → MySQL wins
        return SyncDecision(
            SyncDecision.MYSQL_WINS,
            f'Tie within 10s buffer (Unix: {sheets_unix}): MySQL wins',
        )

    # Missing Unix timestamp on one or both sides → Sheets wins
    if (mysql_unix is None or mysql_unix == 0) and (sheets_unix is None or sheets_unix == 0):
        return SyncDecision(
            SyncDecision.SHEETS_WINS,
            'both Unix timestamps missing; Sheets wins by default',
        )
    if mysql_unix is None or mysql_unix == 0:
        return SyncDecision(
            SyncDecision.SHEETS_WINS,
            f'MySQL Unix timestamp missing; Sheets ({sheets_unix}) wins',
        )
    # sheets_unix is None or 0
    return SyncDecision(
        SyncDecision.MYSQL_WINS,
        f'Sheets Unix timestamp missing; MySQL ({mysql_unix}) wins',
    )


def _safe_int(value: Any) -> Optional[int]:
    """
    Safely convert a value to int, handling None, 0, and non-numeric values.
    Returns None if value is None, 0, or cannot be converted.
    """
    if value is None:
        return None
    try:
        i = int(value)
        return i if i > 0 else None
    except (ValueError, TypeError):
        return None


def _rows_differ(
    mysql_row: Dict[str, Any],
    sheets_row: Dict[str, Any],
    ignore_cols: Optional[Set[str]] = None,
) -> bool:
    """Return True if any sync-eligible column differs between the two rows."""
    ignore = ignore_cols or set()
    all_cols = set(mysql_row.keys()) | set(sheets_row.keys())
    for col in all_cols:
        if col in ignore:
            continue
        if not _values_equal(mysql_row.get(col), sheets_row.get(col)):
            return True
    return False


def _values_equal(a: Any, b: Any) -> bool:
    """
    Loose equality check that tolerates:
      - None / '' equivalence
      - Case differences
      - Numeric representation ('50.00' == '50')
      - Datetime format differences (delegates to datetimes_equal)
    """
    a_str = '' if a is None else str(a).strip()
    b_str = '' if b is None else str(b).strip()

    if not a_str and not b_str:
        return True
    if a_str.lower() == b_str.lower():
        return True

    # Numeric
    try:
        return abs(float(a_str) - float(b_str)) < 0.001
    except (ValueError, TypeError):
        pass

    # Datetime
    if datetimes_equal(a_str, b_str):
        return True

    return False


# ─────────────────────────────────────────────────────────────────────────────
# Row discovery helpers
# ─────────────────────────────────────────────────────────────────────────────

def classify_rows(
    mysql_keys: Set[str],
    sheets_keys: Set[str],
) -> Tuple[Set[str], Set[str], Set[str]]:
    """
    Partition keys into three disjoint sets per spec §2.1.

    Returns:
        (only_in_sheets, only_in_mysql, in_both)
    """
    only_in_sheets = sheets_keys - mysql_keys
    only_in_mysql  = mysql_keys  - sheets_keys
    in_both        = mysql_keys  & sheets_keys
    return only_in_sheets, only_in_mysql, in_both


# ─────────────────────────────────────────────────────────────────────────────
# gmail_transactions field-level sync
# ─────────────────────────────────────────────────────────────────────────────

class GmailSyncAction:
    """Encapsulates a field-level update decision for gmail_transactions."""
    __slots__ = ('message_id', 'mysql_updates', 'sheets_updates')

    def __init__(self, message_id: str):
        self.message_id    = message_id
        self.mysql_updates: Dict[str, Any]  = {}   # fields to write to MySQL
        self.sheets_updates: Dict[str, Any] = {}   # fields to write to Sheets

    @property
    def has_mysql_updates(self) -> bool:
        return bool(self.mysql_updates)

    @property
    def has_sheets_updates(self) -> bool:
        return bool(self.sheets_updates)

    def __repr__(self) -> str:
        return (
            f'GmailSyncAction({self.message_id}: '
            f'mysql={list(self.mysql_updates)}, '
            f'sheets={list(self.sheets_updates)})'
        )


def resolve_gmail_row(
    message_id: str,
    mysql_row: Dict[str, Any],
    sheets_row: Dict[str, Any],
) -> GmailSyncAction:
    """
    Apply spec §3.2 field-level rules for a single gmail_transactions row.

    Rules (applied unconditionally, regardless of timestamps):
      Sheets → MySQL : Memo  (if Sheets value differs from MySQL)
      MySQL → Sheets : ProcessedTime, Notes, PaymentID  (if MySQL differs)

    Note: 'ProcessedTime' is the MySQL column; the spec also refers to it as
    'ProcessedAt' in prose — same field.
    """
    action = GmailSyncAction(message_id)

    # Memo: Sheets → MySQL
    sheets_memo = sheets_row.get('Memo', '') or ''
    mysql_memo  = mysql_row.get('Memo', '') or ''
    if not _values_equal(sheets_memo, mysql_memo):
        action.mysql_updates['Memo'] = sheets_memo

    # ProcessedTime: direction depends on which side has the value.
    # If GAS processed the row (Sheets has timestamp, MySQL is NULL) → Sheets→MySQL.
    # If Python processed it (MySQL has timestamp) → MySQL→Sheets.
    mysql_pt  = mysql_row.get('ProcessedTime')
    sheets_pt = sheets_row.get('ProcessedTime')
    if sheets_pt and not mysql_pt:
        # GAS has marked this row processed; backfill MySQL so it disappears from
        # "Unmatched" counts and won't be double-processed.
        action.mysql_updates['ProcessedTime'] = to_mysql_datetime(sheets_pt) or ''
        # Also pull Source and PaymentID from Sheets if MySQL is empty
        sheets_source = sheets_row.get('Source', '') or ''
        mysql_source  = mysql_row.get('Source', '') or ''
        if sheets_source and not mysql_source:
            action.mysql_updates['Source'] = sheets_source
        sheets_pid = sheets_row.get('PaymentID', '') or ''
        mysql_pid  = mysql_row.get('PaymentID', '') or ''
        if sheets_pid and not mysql_pid:
            action.mysql_updates['PaymentID'] = sheets_pid
    elif mysql_pt and not _values_equal(mysql_pt, sheets_pt):
        # MySQL has ProcessedTime that Sheets hasn't seen yet → push MySQL→Sheets
        action.sheets_updates['ProcessedTime'] = to_mysql_datetime(mysql_pt) or ''

    # Notes / PaymentID: MySQL → Sheets (Python admin portal is authoritative)
    for field in ('Notes', 'PaymentID'):
        mysql_val  = mysql_row.get(field)
        sheets_val = sheets_row.get(field)
        if not _values_equal(mysql_val, sheets_val):
            val = '' if mysql_val is None else str(mysql_val)
            action.sheets_updates[field] = val

    return action


# ─────────────────────────────────────────────────────────────────────────────
# Column safety helpers
# ─────────────────────────────────────────────────────────────────────────────

def filter_sync_columns(table: str, row: Dict[str, Any]) -> Dict[str, Any]:
    """
    Return only the columns that are safe to sync for this table.

    For 'members' this enforces the cols-1-26 / YearBorn boundary.
    All other tables pass through unchanged (caller is responsible for
    their own whitelisting if needed).
    """
    if table == 'members':
        filtered  = {k: v for k, v in row.items() if k in MEMBERS_SYNC_COLUMNS}
        discarded = set(row.keys()) - MEMBERS_SYNC_COLUMNS
        if discarded:
            logger.debug('members: ignoring non-sync columns: %s', sorted(discarded))
        return filtered
    return row


def is_immutable_column(table: str, col: str) -> bool:
    """Return True if col must not be modified during an UPDATE."""
    return col in IMMUTABLE_ON_UPDATE.get(table, set())


# ─────────────────────────────────────────────────────────────────────────────
# Audit logging helpers
# ─────────────────────────────────────────────────────────────────────────────

class SyncAudit:
    """
    Accumulates sync_changes records for batch insertion.

    Usage:
        audit = SyncAudit()
        audit.record('members', 'sheets_to_mysql', 'M001', old_row, new_row)
        audit.flush(conn)   # INSERT all pending records in one transaction
    """

    def __init__(self) -> None:
        self._pending: List[Dict[str, Any]] = []

    def record(
        self,
        table: str,
        direction: str,       # 'sheets_to_mysql' | 'mysql_to_sheets'
        key_value: str,
        old_values: Optional[Dict[str, Any]],
        new_values: Optional[Dict[str, Any]],
        reason: str = '',
    ) -> None:
        self._pending.append({
            'table':      table,
            'direction':  direction,
            'key_value':  str(key_value),
            'old_values': json.dumps(_serialize(old_values)) if old_values else None,
            'new_values': json.dumps(_serialize(new_values)) if new_values else None,
            'reason':     reason,
            'synced_at':  datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'),
        })

    def flush(self, execute_fn) -> int:
        """
        Write all pending records to sync_changes via execute_fn.

        execute_fn signature: execute_fn(sql: str, params: list) -> None
        Returns the number of records written.
        """
        if not self._pending:
            return 0
        written = 0
        for rec in self._pending:
            try:
                execute_fn(
                    """
                    INSERT INTO sync_changes
                        (sheet_name, change_type, row_key,
                         old_values, new_values, synced_at)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    [
                        rec['table'],
                        rec['direction'],
                        rec['key_value'],
                        rec['old_values'],
                        rec['new_values'],
                        rec['synced_at'],
                    ],
                )
                written += 1
            except Exception as exc:
                # Audit failure must never abort the sync
                logger.error('SyncAudit.flush: failed to write record: %s', exc)
        self._pending.clear()
        return written


def _serialize(obj: Any) -> Any:
    """JSON-serialise a dict that may contain datetime objects."""
    if isinstance(obj, dict):
        return {k: _serialize(v) for k, v in obj.items()}
    if isinstance(obj, datetime):
        return obj.isoformat()
    return obj


# ─────────────────────────────────────────────────────────────────────────────
# sync_metadata error logging helper
# ─────────────────────────────────────────────────────────────────────────────

def log_sync_error(
    execute_fn,
    table: str,
    error_msg: str,
    context: str = '',
) -> None:
    """
    Append a failure record to sync_metadata (spec §5.4).

    execute_fn signature: execute_fn(sql: str, params: list) -> None
    """
    try:
        execute_fn(
            """
            INSERT INTO sync_metadata
                (table_name, status, error_message, context, created_at)
            VALUES (%s, 'error', %s, %s, %s)
            """,
            [
                table,
                error_msg[:2000],   # guard against huge tracebacks
                context[:1000],
                datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'),
            ],
        )
    except Exception as exc:
        logger.error('log_sync_error: could not write to sync_metadata: %s', exc)
