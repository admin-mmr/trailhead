# type: ignore
#!/usr/bin/env python3
"""
NYRR Event Sync Pipeline — Phase 2

Port of web-apps/gas/nyrr/src/pipeline.ts to Python + MySQL.
Handles:
  1. Event discovery  — fetch new events from NYRR API, upsert into nyrr_events
  2. Registrant refresh — re-scan upcoming events for new registrants
  3. Completed event promotion — flip is_upcoming when event date has passed
  4. Result ingestion — fetch team runners + member-ID runners, upsert rows
  5. Auto-matching — inline Tier 1 (known name) + Tier 2 (unique last name)
  6. Match propagation — backfill mmr_member_id across all historical rows

Tables (migration 0007): nyrr_events, nyrr_event_runners, nyrr_processing_log

Usage:
    # Daily recurring (batch of 10):
    python sync_nyrr_events.py --mode daily --batch-size 10

    # Weekly full run (no batch limit):
    python sync_nyrr_events.py --mode weekly

    # Manual single-event reprocess:
    python sync_nyrr_events.py --mode single --event-code 26WASH
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Set, Tuple

import mysql.connector
from mysql.connector import Error as MySQLError

# Add basecamp/python to import path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'python'))

from nyrr_api import NyrrApiClient, NyrrEvent, NyrrFinisher, NyrrRunnerRace

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TEAM_CODE = 'MMR'
API_SLEEP_SECONDS = 2.0  # polite delay between NYRR API calls


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_db_connection() -> mysql.connector.MySQLConnection:
    """Create a MySQL connection from environment variables."""
    return mysql.connector.connect(
        host=os.environ.get('MYSQL_HOST'),
        user=os.environ.get('MYSQL_USER'),
        password=os.environ.get('MYSQL_PASSWORD'),
        database=os.environ.get('MYSQL_DATABASE'),
        ssl_disabled=False,
        autocommit=False,
        charset='utf8mb4',
        collation='utf8mb4_unicode_ci',
    )


def normalize_name(name: str) -> str:
    """Case-insensitive, whitespace-collapsed name for matching."""
    return ' '.join(name.strip().lower().split())


def is_upcoming_event(event_date: date) -> bool:
    """Return True if event_date is in the future."""
    return event_date > date.today()


# ===================================================================
# Stage 1: Event Discovery
# ===================================================================

def discover_events(client: NyrrApiClient, conn: mysql.connector.MySQLConnection) -> int:
    """
    Fetch all events from the NYRR API for the current year and previous year.
    Insert any we haven't seen before as Pending.

    Returns: number of new events inserted.
    """
    logger.info('[discover_events] Starting event discovery...')
    cursor = conn.cursor()

    # Load existing event codes into memory for fast dedup
    cursor.execute("SELECT event_code FROM nyrr_events")
    existing_codes: Set[str] = {row[0] for row in cursor.fetchall()}
    logger.info(f'[discover_events] {len(existing_codes)} existing events in DB')

    current_year = date.today().year
    years_to_scan = [current_year, current_year - 1]
    new_count = 0

    for year in years_to_scan:
        logger.info(f'[discover_events] Fetching events for year {year}...')
        try:
            api_events = client.search_events(year=year)
            logger.info(f'[discover_events] API returned {len(api_events)} events for {year}')
        except Exception as e:
            logger.error(f'[discover_events] Failed to fetch events for {year}: {e}')
            continue

        for ev in api_events:
            if ev.event_code in existing_codes:
                continue

            event_date_str = ev.start_date_time.split('T')[0] if ev.start_date_time else None
            event_date_obj = date.fromisoformat(event_date_str) if event_date_str else None
            upcoming = is_upcoming_event(event_date_obj) if event_date_obj else False
            event_year = event_date_obj.year if event_date_obj else year

            cursor.execute("""
                INSERT INTO nyrr_events
                    (event_code, event_name, event_url, location, distance,
                     event_date, event_year, is_upcoming, is_virtual, processing_status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'Pending')
                ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP
            """, (
                ev.event_code,
                ev.event_name,
                f"https://results.nyrr.org/event/{ev.event_code}/finishers",
                ev.venue,
                ev.distance_unit_code,
                event_date_str,
                event_year,
                int(upcoming),
                int(ev.is_virtual),
            ))

            existing_codes.add(ev.event_code)
            new_count += 1

        time.sleep(API_SLEEP_SECONDS)

    conn.commit()
    cursor.close()
    logger.info(f'[discover_events] Inserted {new_count} new events')
    return new_count


# ===================================================================
# Stage 2: Promote Completed Events
# ===================================================================

def promote_completed_events(conn: mysql.connector.MySQLConnection) -> int:
    """
    Flip is_upcoming=0 and processing_status='Pending' for events whose
    date has passed. This queues them for full result ingestion on the
    next processing pass.

    Returns: number of events promoted.
    """
    logger.info('[promote_completed] Checking for completed events to promote...')
    cursor = conn.cursor()

    cursor.execute("""
        UPDATE nyrr_events
        SET is_upcoming = 0,
            processing_status = 'Pending',
            notes = CONCAT(IFNULL(notes, ''), ' Promoted from upcoming — awaiting result ingestion.')
        WHERE is_upcoming = 1
          AND event_date < CURDATE()
          AND processing_status != 'Pending'
    """)
    promoted = cursor.rowcount
    conn.commit()
    cursor.close()

    logger.info(f'[promote_completed] Promoted {promoted} events')
    return promoted


# ===================================================================
# Stage 3: Registrant Refresh (upcoming events)
# ===================================================================

def refresh_upcoming_registrants(
    client: NyrrApiClient,
    conn: mysql.connector.MySQLConnection,
) -> int:
    """
    Re-scan upcoming events to capture new registrants from the team roster.

    Returns: total rows upserted across all upcoming events.
    """
    logger.info('[refresh_upcoming] Refreshing upcoming event registrants...')
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT id, event_code, event_name, event_date, is_upcoming
        FROM nyrr_events
        WHERE is_upcoming = 1
        ORDER BY event_date ASC
    """)
    upcoming_events = cursor.fetchall()
    cursor.close()

    logger.info(f'[refresh_upcoming] Found {len(upcoming_events)} upcoming events')
    total_rows = 0

    for ev in upcoming_events:
        rows = _ingest_event_runners(
            client, conn, ev,
            triggered_by='System',
            is_registrant_refresh=True,
        )
        total_rows += rows
        time.sleep(API_SLEEP_SECONDS)

    logger.info(f'[refresh_upcoming] Total registrant rows upserted: {total_rows}')
    return total_rows


# ===================================================================
# Stage 4: Result Ingestion
# ===================================================================

def process_pending_events(
    client: NyrrApiClient,
    conn: mysql.connector.MySQLConnection,
    batch_size: Optional[int] = None,
) -> Tuple[int, int]:
    """
    Fetch runners/results for pending events and ingest them.
    Runs auto-matching inline after each event.

    Args:
        batch_size: Max events to process. None = no limit.

    Returns: (events_processed, total_rows_written)
    """
    logger.info(f'[process_pending] Fetching pending events (batch_size={batch_size})...')
    cursor = conn.cursor(dictionary=True)

    query = """
        SELECT id, event_code, event_name, event_date, is_upcoming
        FROM nyrr_events
        WHERE processing_status = 'Pending'
        ORDER BY event_date DESC
    """
    if batch_size:
        query += f" LIMIT {int(batch_size)}"

    cursor.execute(query)
    pending = cursor.fetchall()
    cursor.close()

    logger.info(f'[process_pending] {len(pending)} pending events to process')
    total_events = 0
    total_rows = 0

    for ev in pending:
        logger.info(f'[process_pending] {total_events + 1}/{len(pending)}: '
                     f'{ev["event_code"]} "{ev["event_name"]}"')

        rows = _ingest_event_runners(client, conn, ev, triggered_by='System')

        # Run inline auto-matching for this event (Stages 5a + 5b)
        matched = run_auto_matcher(conn, event_id=ev['id'])
        logger.info(f'  └─ {rows} rows ingested, {matched} auto-matched')

        total_events += 1
        total_rows += rows
        time.sleep(API_SLEEP_SECONDS)

    logger.info(f'[process_pending] Done: {total_events} events, {total_rows} rows')
    return total_events, total_rows


def _ingest_event_runners(
    client: NyrrApiClient,
    conn: mysql.connector.MySQLConnection,
    event: Dict[str, Any],
    triggered_by: str = 'System',
    is_registrant_refresh: bool = False,
) -> int:
    """
    Core ingestion for a single event:
      Pass 1: Club search (get_team_runners for MMR)
      Pass 2: Member-ID search (cross-reference members who race under other clubs)

    Upserts rows into nyrr_event_runners and updates nyrr_events status.

    Returns: number of rows upserted.
    """
    event_id = event['id']
    event_code = event['event_code']
    event_date = event.get('event_date')
    is_upcoming = bool(event.get('is_upcoming', False))
    cursor = conn.cursor()

    # Mark event InProgress
    cursor.execute("""
        UPDATE nyrr_events
        SET processing_status = 'InProgress', processed_by = %s, processed_at = NOW()
        WHERE id = %s
    """, (triggered_by, event_id))
    conn.commit()

    try:
        # ---- Pass 1: Club search ----
        logger.info(f'  [pass1] get_team_runners({event_code}, {TEAM_CODE})')
        team_runners = client.get_team_runners(event_code, TEAM_CODE)
        logger.info(f'  [pass1] Got {len(team_runners)} MMR runners')

        captured_ids: Set[str] = set()
        rows_written = 0

        for runner in team_runners:
            runner_id_str = str(runner.runner_id)
            captured_ids.add(runner_id_str)

            rows_written += _upsert_runner(
                cursor, event_id, runner, event_date,
                is_upcoming=is_upcoming,
                is_registered_only=is_upcoming,
            )

        # ---- Pass 2: Member-ID search ----
        if not is_registrant_refresh:
            p2_rows = _collect_member_id_runners(
                client, cursor, conn, event_id, event_code, event_date,
                captured_ids, is_upcoming,
            )
            rows_written += p2_rows

        # Update event status + counters
        cursor.execute("""
            UPDATE nyrr_events
            SET processing_status = 'Completed',
                result_count = (
                    SELECT COUNT(*) FROM nyrr_event_runners WHERE nyrr_event_id = %s
                ),
                mmr_runner_count = (
                    SELECT COUNT(*) FROM nyrr_event_runners
                    WHERE nyrr_event_id = %s AND team_code = %s
                ),
                processed_at = NOW()
            WHERE id = %s
        """, (event_id, event_id, TEAM_CODE, event_id))

        # Log success
        _append_processing_log(cursor, event_id, triggered_by, 'Success', rows_written)
        conn.commit()

        logger.info(f'  [ingest] ✓ {rows_written} rows for {event_code}')
        cursor.close()
        return rows_written

    except Exception as e:
        conn.rollback()
        error_msg = str(e)
        logger.error(f'  [ingest] ✗ FAILED {event_code}: {error_msg}')

        # Mark error + log
        cursor2 = conn.cursor()
        cursor2.execute("""
            UPDATE nyrr_events
            SET processing_status = 'Error', notes = %s
            WHERE id = %s
        """, (error_msg[:500], event_id))
        _append_processing_log(cursor2, event_id, triggered_by, 'Failed', 0, error_msg)
        conn.commit()
        cursor2.close()
        cursor.close()
        return 0


def _upsert_runner(
    cursor,
    event_id: int,
    runner: NyrrFinisher,
    event_date: Any,
    is_upcoming: bool = False,
    is_registered_only: bool = False,
) -> int:
    """Upsert a single runner row. Returns 1 on success."""
    full_name = f"{runner.first_name} {runner.last_name}".strip()
    cursor.execute("""
        INSERT INTO nyrr_event_runners
            (nyrr_event_id, nyrr_runner_id, runner_name, first_name, last_name,
             age, gender, state_province, bib_number, finish_time, pace,
             overall_place, gender_place, team_code, is_registered_only, scan_timestamp)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        ON DUPLICATE KEY UPDATE
            runner_name = VALUES(runner_name),
            first_name = VALUES(first_name),
            last_name = VALUES(last_name),
            age = VALUES(age),
            gender = VALUES(gender),
            state_province = VALUES(state_province),
            bib_number = VALUES(bib_number),
            finish_time = VALUES(finish_time),
            pace = VALUES(pace),
            overall_place = VALUES(overall_place),
            gender_place = VALUES(gender_place),
            team_code = VALUES(team_code),
            is_registered_only = VALUES(is_registered_only),
            scan_timestamp = NOW()
    """, (
        event_id,
        str(runner.runner_id),
        full_name,
        runner.first_name,
        runner.last_name,
        runner.age,
        runner.gender,
        runner.state_province,
        runner.bib,
        runner.overall_time,
        runner.pace,
        runner.overall_place,
        runner.gender_place,
        runner.team_code or TEAM_CODE,
        int(is_registered_only),
    ))
    return 1


def _collect_member_id_runners(
    client: NyrrApiClient,
    cursor,
    conn: mysql.connector.MySQLConnection,
    event_id: int,
    event_code: str,
    event_date: Any,
    captured_ids: Set[str],
    is_upcoming: bool,
) -> int:
    """
    Pass 2: Cross-reference MMR members who have a known NYRR runner ID
    (from a prior match) but race under a different club on NYRR.
    Look up their race history and check for the current event.

    Returns: number of additional rows upserted.
    """
    # Get members who have a matched NYRR runner — we stored nyrr_runner_id
    # from prior ingestions. Pull distinct nyrr_runner_ids already linked to
    # mmr_member_id across any event.
    cursor.execute("""
        SELECT DISTINCT nyrr_runner_id, mmr_member_id, runner_name
        FROM nyrr_event_runners
        WHERE mmr_member_id IS NOT NULL
          AND nyrr_runner_id NOT IN (
              SELECT nyrr_runner_id FROM nyrr_event_runners WHERE nyrr_event_id = %s
          )
    """, (event_id,))
    known_runners = cursor.fetchall()
    logger.info(f'  [pass2] {len(known_runners)} known member runners to cross-check')

    additional = 0
    for nyrr_runner_id, mmr_member_id, runner_name in known_runners:
        if nyrr_runner_id in captured_ids:
            continue

        try:
            history = client.get_runner_races(nyrr_runner_id)
        except Exception as e:
            logger.warning(f'  [pass2] Failed to get races for {nyrr_runner_id}: {e}')
            continue

        matching_race = next(
            (r for r in history if r.event_code == event_code), None
        )

        if matching_race:
            logger.info(f'  [pass2] ✓ Found {runner_name} in {event_code}')
            # Build a synthetic finisher for uniform upsert
            synth = NyrrFinisher(
                runner_id=int(nyrr_runner_id) if nyrr_runner_id.isdigit() else 0,
                first_name=runner_name.split(' ')[0] if runner_name else '',
                last_name=' '.join(runner_name.split(' ')[1:]) if runner_name else '',
                bib=matching_race.bib,
                overall_time=matching_race.actual_time,
                pace=matching_race.actual_pace,
            )
            _upsert_runner(cursor, event_id, synth, event_date, is_upcoming=is_upcoming)

            # Carry the known match forward
            cursor.execute("""
                UPDATE nyrr_event_runners
                SET mmr_member_id = %s, match_method = 'auto_name',
                    matched_by = 'System', matched_at = NOW()
                WHERE nyrr_event_id = %s AND nyrr_runner_id = %s
            """, (mmr_member_id, event_id, nyrr_runner_id))

            additional += 1
            captured_ids.add(nyrr_runner_id)

        time.sleep(API_SLEEP_SECONDS)

    return additional


def _append_processing_log(
    cursor,
    event_id: Optional[int],
    triggered_by: str,
    status: str,
    rows_written: int,
    error_details: str = '',
) -> None:
    """Append a row to nyrr_processing_log."""
    cursor.execute("""
        INSERT INTO nyrr_processing_log
            (nyrr_event_id, triggered_by, run_status, rows_written, error_details)
        VALUES (%s, %s, %s, %s, %s)
    """, (
        event_id,
        triggered_by,
        status,
        rows_written,
        error_details[:2000] if error_details else None,
    ))


# ===================================================================
# Stage 5: Auto-Matching (Tier 1 + Tier 2)
# ===================================================================

def run_auto_matcher(
    conn: mysql.connector.MySQLConnection,
    event_id: Optional[int] = None,
) -> int:
    """
    Run Tier 1 + Tier 2 auto-matching.

    Tier 1 — Known Name Lookup (~70%):
        If a member's NYRRRunnerName is set (from a prior match), and the
        runner_name matches case-insensitively, link immediately.

    Tier 2 — Unique Last Name (~20%):
        Compare unmatched runner last names against active members. If exactly
        one member shares that last name, auto-link. Write NYRRRunnerName to
        the member so Tier 1 catches them next time.

    Returns: total matches made.
    """
    total_matched = 0

    # ---- Tier 1: Known NYRRRunnerName ----
    t1 = _tier1_known_name(conn, event_id)
    total_matched += t1
    logger.info(f'  [matcher.tier1] {t1} matches via known NYRRRunnerName')

    # ---- Tier 2: Unique last name ----
    t2 = _tier2_unique_lastname(conn, event_id)
    total_matched += t2
    logger.info(f'  [matcher.tier2] {t2} matches via unique last name')

    # Update mmr_matched_count on nyrr_events
    _update_matched_counts(conn, event_id)

    return total_matched


def _tier1_known_name(
    conn: mysql.connector.MySQLConnection,
    event_id: Optional[int],
) -> int:
    """
    Tier 1: Match runners whose name matches a member's NYRRRunnerName.
    Uses case-insensitive comparison via LOWER().
    """
    cursor = conn.cursor()

    event_filter = "AND er.nyrr_event_id = %s" if event_id else ""
    params: list = []
    if event_id:
        params = [event_id]

    # Join unmatched runners against members where NYRRRunnerName is set
    # Column 25 in members table = NYRRRunnerName
    query = f"""
        UPDATE nyrr_event_runners er
        INNER JOIN members m
            ON LOWER(TRIM(er.runner_name)) = LOWER(TRIM(m.NYRRRunnerName))
        SET er.mmr_member_id = m.MemberID,
            er.match_method = 'auto_name',
            er.matched_by = 'System',
            er.matched_at = NOW()
        WHERE er.mmr_member_id IS NULL
          AND m.NYRRRunnerName IS NOT NULL
          AND m.NYRRRunnerName != ''
          {event_filter}
    """
    cursor.execute(query, params)
    matched = cursor.rowcount
    conn.commit()
    cursor.close()
    return matched


def _tier2_unique_lastname(
    conn: mysql.connector.MySQLConnection,
    event_id: Optional[int],
) -> int:
    """
    Tier 2: For unmatched runners, if exactly one active member shares
    the same last name, auto-link them.

    Also writes NYRRRunnerName to the member so Tier 1 catches them next time.
    """
    cursor = conn.cursor(dictionary=True)
    matched = 0

    event_filter = "AND er.nyrr_event_id = %s" if event_id else ""
    params: list = []
    if event_id:
        params = [event_id]

    # Get unmatched runners (team_code = MMR only — we don't try to match
    # runners from other clubs)
    query = f"""
        SELECT er.id, er.nyrr_event_id, er.runner_name, er.last_name, er.nyrr_runner_id
        FROM nyrr_event_runners er
        WHERE er.mmr_member_id IS NULL
          AND er.match_method IS NULL
          AND er.team_code = %s
          {event_filter}
    """
    cursor.execute(query, [TEAM_CODE] + params)
    unmatched = cursor.fetchall()

    if not unmatched:
        cursor.close()
        return 0

    # Load active members into memory for matching
    cursor.execute("""
        SELECT MemberID, FirstName, LastName, NYRRRunnerName, Status
        FROM members
        WHERE Status IN ('Active', 'Comp', 'Grace')
    """)
    members = cursor.fetchall()

    # Build a last-name → [member] index
    lastname_index: Dict[str, List[Dict]] = {}
    for m in members:
        ln = normalize_name(m['LastName']) if m.get('LastName') else ''
        if ln:
            lastname_index.setdefault(ln, []).append(m)

    cursor2 = conn.cursor()

    for runner in unmatched:
        runner_ln = normalize_name(runner['last_name']) if runner.get('last_name') else ''
        if not runner_ln:
            continue

        candidates = lastname_index.get(runner_ln, [])

        if len(candidates) == 1:
            # Unique last name match — auto-link
            member = candidates[0]
            member_id = member['MemberID']

            # Update this runner row
            cursor2.execute("""
                UPDATE nyrr_event_runners
                SET mmr_member_id = %s, match_method = 'auto_lastname',
                    matched_by = 'System', matched_at = NOW()
                WHERE id = %s
            """, (member_id, runner['id']))

            # Write NYRRRunnerName to member for future Tier 1 matches
            cursor2.execute("""
                UPDATE members
                SET NYRRRunnerName = %s
                WHERE MemberID = %s AND (NYRRRunnerName IS NULL OR NYRRRunnerName = '')
            """, (runner['runner_name'], member_id))

            # Propagate match across all historical rows with same runner_name
            _propagate_match(cursor2, runner['runner_name'], member_id)

            matched += 1
            logger.info(f'    [tier2] ✓ {runner["runner_name"]} → {member_id} '
                         f'(unique last name "{runner_ln}")')

    conn.commit()
    cursor2.close()
    cursor.close()
    return matched


# ===================================================================
# Stage 6: Match Propagation
# ===================================================================

def _propagate_match(cursor, runner_name: str, mmr_member_id: str) -> int:
    """
    When a match is confirmed (auto or manual), backfill mmr_member_id
    across ALL nyrr_event_runners rows where runner_name matches
    (case-insensitive). This links a person across their entire race history
    with one confirmation.

    Also updates mmr_matched_count on affected nyrr_events.

    Returns: number of rows updated.
    """
    cursor.execute("""
        UPDATE nyrr_event_runners
        SET mmr_member_id = %s,
            match_method = COALESCE(match_method, 'auto_name'),
            matched_by = COALESCE(matched_by, 'System'),
            matched_at = COALESCE(matched_at, NOW())
        WHERE LOWER(TRIM(runner_name)) = LOWER(TRIM(%s))
          AND (mmr_member_id IS NULL OR mmr_member_id = '')
    """, (mmr_member_id, runner_name))
    propagated = cursor.rowcount

    if propagated > 0:
        logger.info(f'    [propagate] Backfilled {propagated} historical rows '
                     f'for "{runner_name}" → {mmr_member_id}')

    return propagated


def _update_matched_counts(
    conn: mysql.connector.MySQLConnection,
    event_id: Optional[int] = None,
) -> None:
    """
    Recompute mmr_matched_count on nyrr_events from actual data.
    If event_id is provided, only update that event; otherwise update all.
    """
    cursor = conn.cursor()

    if event_id:
        cursor.execute("""
            UPDATE nyrr_events e
            SET mmr_matched_count = (
                SELECT COUNT(*)
                FROM nyrr_event_runners er
                WHERE er.nyrr_event_id = e.id
                  AND er.mmr_member_id IS NOT NULL
            )
            WHERE e.id = %s
        """, (event_id,))
    else:
        cursor.execute("""
            UPDATE nyrr_events e
            SET mmr_matched_count = (
                SELECT COUNT(*)
                FROM nyrr_event_runners er
                WHERE er.nyrr_event_id = e.id
                  AND er.mmr_member_id IS NOT NULL
            )
        """)

    conn.commit()
    cursor.close()


# ===================================================================
# Birth Year Inference (Section 6.5)
# ===================================================================

def infer_birth_year(
    conn: mysql.connector.MySQLConnection,
) -> int:
    """
    NYRR age + event_year → YearBornGuess.
    Updates members.YearBornGuess where we have age data and member match.

    Returns: number of members updated.
    """
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE members m
        INNER JOIN (
            SELECT er.mmr_member_id,
                   ROUND(AVG(e.event_year - er.age)) AS guess_year
            FROM nyrr_event_runners er
            INNER JOIN nyrr_events e ON e.id = er.nyrr_event_id
            WHERE er.mmr_member_id IS NOT NULL
              AND er.age IS NOT NULL
            GROUP BY er.mmr_member_id
        ) sub ON sub.mmr_member_id = m.MemberID
        SET m.YearBornGuess = sub.guess_year
        WHERE m.YearBornGuess IS NULL
    """)
    updated = cursor.rowcount
    conn.commit()
    cursor.close()

    if updated > 0:
        logger.info(f'[birth_year] Updated YearBornGuess for {updated} members')
    return updated


# ===================================================================
# Orchestrators (called by __main__ / GitHub Actions)
# ===================================================================

def run_daily_pipeline(
    client: NyrrApiClient,
    conn: mysql.connector.MySQLConnection,
    batch_size: int = 10,
) -> Dict[str, Any]:
    """
    Daily pipeline (sync-nyrr-recurring.yml):
      1. Discover new events
      2. Promote completed events
      3. Refresh upcoming registrants
      4. Process pending events (batch limited)
      5. Auto-match inline (Tier 1 + 2)
      6. Update dashboard counters
      7. Infer birth years

    Returns: summary dict for logging.
    """
    logger.info('========== DAILY NYRR PIPELINE START ==========')
    summary: Dict[str, Any] = {
        'mode': 'daily',
        'batch_size': batch_size,
        'started_at': datetime.utcnow().isoformat(),
    }

    try:
        # Step 1: Discover new events
        summary['new_events'] = discover_events(client, conn)

        # Step 2: Promote completed
        summary['events_promoted'] = promote_completed_events(conn)

        # Step 3: Refresh upcoming registrants
        summary['registrant_rows'] = refresh_upcoming_registrants(client, conn)

        # Step 4 + 5: Process pending (auto-match runs inline)
        events_processed, rows_written = process_pending_events(
            client, conn, batch_size=batch_size,
        )
        summary['events_processed'] = events_processed
        summary['rows_written'] = rows_written

        # Step 6: Ensure all matched counts are current
        _update_matched_counts(conn)

        # Step 7: Infer birth years
        summary['birth_years_inferred'] = infer_birth_year(conn)

        summary['status'] = 'success'
        logger.info(f'========== DAILY PIPELINE SUCCESS: {summary} ==========')

    except Exception as e:
        summary['status'] = 'failed'
        summary['error'] = str(e)
        logger.error(f'========== DAILY PIPELINE FAILED: {e} ==========')
        raise

    finally:
        summary['finished_at'] = datetime.utcnow().isoformat()

    return summary


def run_weekly_pipeline(
    client: NyrrApiClient,
    conn: mysql.connector.MySQLConnection,
) -> Dict[str, Any]:
    """
    Weekly pipeline (sync-nyrr-weekly.yml):
      Same as daily but with NO batch limit on pending events.

    Returns: summary dict for logging.
    """
    logger.info('========== WEEKLY NYRR PIPELINE START ==========')
    summary: Dict[str, Any] = {
        'mode': 'weekly',
        'batch_size': None,
        'started_at': datetime.utcnow().isoformat(),
    }

    try:
        summary['new_events'] = discover_events(client, conn)
        summary['events_promoted'] = promote_completed_events(conn)
        summary['registrant_rows'] = refresh_upcoming_registrants(client, conn)

        events_processed, rows_written = process_pending_events(
            client, conn, batch_size=None,  # no limit
        )
        summary['events_processed'] = events_processed
        summary['rows_written'] = rows_written

        _update_matched_counts(conn)
        summary['birth_years_inferred'] = infer_birth_year(conn)

        summary['status'] = 'success'
        logger.info(f'========== WEEKLY PIPELINE SUCCESS: {summary} ==========')

    except Exception as e:
        summary['status'] = 'failed'
        summary['error'] = str(e)
        logger.error(f'========== WEEKLY PIPELINE FAILED: {e} ==========')
        raise

    finally:
        summary['finished_at'] = datetime.utcnow().isoformat()

    return summary


def run_single_event(
    client: NyrrApiClient,
    conn: mysql.connector.MySQLConnection,
    event_code: str,
    triggered_by: str = 'Manual',
) -> Dict[str, Any]:
    """
    Reprocess a single event by event_code.
    """
    logger.info(f'========== SINGLE EVENT: {event_code} ==========')
    cursor = conn.cursor(dictionary=True)
    cursor.execute(
        "SELECT id, event_code, event_name, event_date, is_upcoming "
        "FROM nyrr_events WHERE event_code = %s",
        (event_code,)
    )
    event = cursor.fetchone()
    cursor.close()

    if not event:
        raise ValueError(f'Event "{event_code}" not found in nyrr_events')

    rows = _ingest_event_runners(client, conn, event, triggered_by=triggered_by)
    matched = run_auto_matcher(conn, event_id=event['id'])
    _update_matched_counts(conn, event_id=event['id'])

    return {
        'mode': 'single',
        'event_code': event_code,
        'rows_written': rows,
        'auto_matched': matched,
        'status': 'success',
    }


# ===================================================================
# CLI Entry Point
# ===================================================================

def main() -> None:
    parser = argparse.ArgumentParser(
        description='NYRR Event Sync Pipeline — Phase 2'
    )
    parser.add_argument(
        '--mode', choices=['daily', 'weekly', 'single'],
        default='daily',
        help='Pipeline mode (default: daily)',
    )
    parser.add_argument(
        '--batch-size', type=int, default=10,
        help='Max events per run in daily mode (default: 10)',
    )
    parser.add_argument(
        '--event-code', type=str, default=None,
        help='Event code for single-event mode',
    )
    parser.add_argument(
        '--triggered-by', type=str, default='System',
        help='Who triggered this run (default: System)',
    )
    args = parser.parse_args()

    # Validate
    if args.mode == 'single' and not args.event_code:
        parser.error('--event-code is required for single mode')

    # Init API client + DB
    client = NyrrApiClient()
    conn = get_db_connection()

    try:
        if args.mode == 'daily':
            summary = run_daily_pipeline(client, conn, batch_size=args.batch_size)
        elif args.mode == 'weekly':
            summary = run_weekly_pipeline(client, conn)
        elif args.mode == 'single':
            summary = run_single_event(
                client, conn, args.event_code,
                triggered_by=args.triggered_by,
            )
        else:
            parser.error(f'Unknown mode: {args.mode}')

        logger.info(f'Pipeline complete: {summary}')

        if summary.get('status') != 'success':
            sys.exit(1)

    except Exception as e:
        logger.error(f'Pipeline failed: {e}')
        sys.exit(1)

    finally:
        conn.close()


if __name__ == '__main__':
    main()
