# type: ignore
"""
NYRR Sync — Stage 4 (Result Ingestion).

  process_pending_events       — pull pending events, ingest each one
  ingest_event_runners         — core single-event ingestion (Pass 1 + Pass 2)
  upsert_runner                — write a single nyrr_event_runners row
  collect_member_id_runners    — Pass 2 cross-club lookup for known members

Split out of sync_nyrr_events.py so each file stays under the 400-LOC limit.
The auto-matcher is invoked inline after each event ingest (see Stage 5).
"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, Optional, Set, Tuple

import mysql.connector

from nyrr_api import NyrrApiClient, NyrrFinisher
from sync_nyrr_helpers import (
    API_SLEEP_SECONDS,
    TEAM_CODE,
    append_processing_log,
)

logger = logging.getLogger(__name__)


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
    # Local import to avoid circular dependency at module load time
    from sync_nyrr_matching import run_auto_matcher

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

        rows = ingest_event_runners(client, conn, ev, triggered_by='System')

        # Run inline auto-matching for this event (Stages 5a + 5b)
        matched = run_auto_matcher(conn, event_id=ev['id'])
        logger.info(f'  └─ {rows} rows ingested, {matched} auto-matched')

        total_events += 1
        total_rows += rows
        time.sleep(API_SLEEP_SECONDS)

    logger.info(f'[process_pending] Done: {total_events} events, {total_rows} rows')
    return total_events, total_rows


def ingest_event_runners(
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

            rows_written += upsert_runner(
                cursor, event_id, runner, event_date,
                is_upcoming=is_upcoming,
                is_registered_only=is_upcoming,
            )

        # ---- Pass 2: Member-ID search ----
        if not is_registrant_refresh:
            p2_rows = collect_member_id_runners(
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
        append_processing_log(cursor, event_id, triggered_by, 'Success', rows_written)
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
        append_processing_log(cursor2, event_id, triggered_by, 'Failed', 0, error_msg)
        conn.commit()
        cursor2.close()
        cursor.close()
        return 0


def upsert_runner(
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
            runner_name       = VALUES(runner_name),
            first_name        = VALUES(first_name),
            last_name         = VALUES(last_name),
            age               = VALUES(age),
            gender            = VALUES(gender),
            state_province    = VALUES(state_province),
            bib_number        = VALUES(bib_number),
            finish_time       = VALUES(finish_time),
            pace              = VALUES(pace),
            overall_place     = VALUES(overall_place),
            gender_place      = VALUES(gender_place),
            team_code         = VALUES(team_code),
            is_registered_only = VALUES(is_registered_only),
            scan_timestamp    = NOW()
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


def collect_member_id_runners(
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
            upsert_runner(cursor, event_id, synth, event_date, is_upcoming=is_upcoming)

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
