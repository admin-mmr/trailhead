# type: ignore
"""
NYRR Sync — Stage 4 (Result Ingestion).

  process_pending_events       — pull pending events, ingest each one
  ingest_event_runners         — core single-event ingestion (Pass 1 + 2 + 3)
  collect_member_id_runners    — Pass 2 cross-club lookup for known members

Row-level helpers live in sync_nyrr_upsert.py (upsert_runner +
backfill_team_runners) to keep this file under the 400-LOC hard rule.

Split out of sync_nyrr_events.py so each file stays under the 400-LOC limit.
The auto-matcher is invoked inline after each event ingest (see Stage 5).
"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, Optional, Set, Tuple

import mysql.connector

from nyrr_api import NyrrApiClient, NyrrFinisher
from nyrr_finisher_splitter import FinisherSplitter
from sync_nyrr_helpers import (
    API_SLEEP_SECONDS,
    TEAM_CODE,
    append_processing_log,
)
from sync_nyrr_upsert import backfill_team_runners, upsert_runner

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
        # ---- Pass 1: Fetch runners and stream-upsert ----
        # For completed events: use FinisherSplitter to get ALL finishers
        # (divide-and-conquer over age × gender × pace to stay under NYRR's
        # ~500-row per-query cap). For upcoming events: NYRR's finishers-filter
        # has no data yet, so keep the team-runners path for registrants.
        captured_ids: Set[str] = set()
        rows_written = 0
        total_inserts = 0
        total_updates = 0
        page_num = 0

        if is_upcoming:
            logger.info(
                f'  [pass1] event is upcoming — fetching MMR registrants '
                f'via teams/teamRunners (event_code={event_code} team={TEAM_CODE})'
            )
            page_iter = (
                (f'team={TEAM_CODE}', page)
                for page in client.get_team_runners_streaming(event_code, TEAM_CODE)
            )
        else:
            logger.info(
                f'  [pass1] event has finishers — fetching ALL runners via '
                f'finishers-filter divide-and-conquer (event_code={event_code})'
            )
            # Skip-if-already-synced: compare NYRR totalItems vs MySQL count
            # at every recursion level. Lets the splitter short-circuit the
            # entire subtree (no need to push down to <=500) when criteria
            # produce identical row counts on both sides.
            count_cursor = conn.cursor()
            def already_synced(*, expected, age_from=None, age_to=None,
                               gender=None, pace_min=None, pace_max=None):
                sql  = "SELECT COUNT(*) FROM nyrr_event_runners WHERE nyrr_event_id=%s"
                args = [event_id]
                if age_from is not None: sql += " AND age >= %s"; args.append(age_from)
                if age_to   is not None: sql += " AND age <= %s"; args.append(age_to)
                if gender   is not None: sql += " AND gender = %s"; args.append(gender)
                if pace_min and pace_min != "00:00:00":
                    sql += " AND pace >= %s"; args.append(pace_min)
                if pace_max:
                    sql += " AND pace <= %s"; args.append(pace_max)
                count_cursor.execute(sql, args)
                return count_cursor.fetchone()[0] == expected
            splitter = FinisherSplitter(client, event_code,
                                        should_skip_shard=already_synced)
            page_iter = splitter.iter_pages()

        for label, page in page_iter:
            page_num += 1
            page_inserts = 0
            page_updates = 0
            for runner in page:
                captured_ids.add(str(runner.runner_id))
                rc = upsert_runner(
                    cursor, event_id, runner, event_date,
                    is_upcoming=is_upcoming,
                    is_registered_only=is_upcoming,
                )
                # ON DUPLICATE KEY UPDATE: 1=INSERT, 2=UPDATE-changed, 0=UPDATE-no-op
                if rc == 1:
                    page_inserts += 1
                else:
                    page_updates += 1
                rows_written += 1
            total_inserts += page_inserts
            total_updates += page_updates

            # Commit this page + update live counters so UI shows progress.
            # mmr_runner_count = MMR-team only; result_count = total rows.
            cursor.execute("""
                UPDATE nyrr_events
                   SET result_count = (
                           SELECT COUNT(*) FROM nyrr_event_runners
                            WHERE nyrr_event_id = %s
                       ),
                       mmr_runner_count = (
                           SELECT COUNT(*) FROM nyrr_event_runners
                            WHERE nyrr_event_id = %s AND team_code = %s
                       )
                 WHERE id = %s
            """, (event_id, event_id, TEAM_CODE, event_id))
            conn.commit()

            # Read back the live DB counts (what the user actually cares about).
            cursor.execute(
                "SELECT result_count, mmr_runner_count "
                "FROM nyrr_events WHERE id = %s",
                (event_id,),
            )
            db_total, db_mmr = cursor.fetchone() or (0, 0)
            logger.info(
                f'  [pass1] {label} page {page_num}: '
                f'DB now {db_total} rows ({db_mmr} MMR) | '
                f'this page: +{page_inserts} new, ~{page_updates} re-fetched | '
                f'this run: {total_inserts} new inserts so far'
            )

        if page_num == 0:
            logger.warning(
                f'  [pass1] API yielded 0 pages for event_code={event_code} '
                f'(is_upcoming={is_upcoming}) — NYRR has no runners published '
                f'for this event yet (check event_code on NYRR site, or event '
                f'may be too recent / wrong slug)'
            )
        else:
            logger.info(
                f'  [pass1] stream complete: {page_num} pages, {rows_written} upserts '
                f'({total_inserts} NEW, {total_updates} updated, '
                f'{len(captured_ids)} distinct)'
            )

        # ---- Pass 2: Member-ID search ----
        if not is_registrant_refresh:
            p2_rows = collect_member_id_runners(
                client, cursor, conn, event_id, event_code, event_date,
                captured_ids, is_upcoming,
            )
            rows_written += p2_rows

        # ---- Pass 3: Team-roster backfill ----
        # finishers-filter (Pass 1 for completed events) doesn't return team
        # info, so without this step the MMR tag is NULL for every row.
        # Always run; idempotent. cursor.close() then reopen below because
        # Pass 3 commits internally with its own cursor.
        cursor.close()
        p3_updated, p3_inserted = backfill_team_runners(
            client, conn, event_id, event_code, TEAM_CODE,
        )
        rows_written += p3_inserted
        cursor = conn.cursor()

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
    # from prior ingestions. GROUP BY nyrr_runner_id (not DISTINCT on the tuple)
    # so the same runner with name-spelling variants is fetched only once.
    cursor.execute("""
        SELECT nyrr_runner_id,
               MAX(mmr_member_id) AS mmr_member_id,
               MAX(runner_name)   AS runner_name
        FROM nyrr_event_runners
        WHERE mmr_member_id IS NOT NULL
          AND nyrr_runner_id NOT IN (
              SELECT nyrr_runner_id FROM nyrr_event_runners WHERE nyrr_event_id = %s
          )
        GROUP BY nyrr_runner_id
    """, (event_id,))
    known_runners = cursor.fetchall()
    logger.info(f'  [pass2] {len(known_runners)} known member runners to cross-check '
                f'(deduped by nyrr_runner_id)')

    # Derive event year so we can constrain get_runner_races server-side.
    # Saves 30-50% wall time: most runners have ~5-10 races/year vs ~30-80 total.
    event_year = None
    if event_date is not None:
        try:
            event_year = event_date.year if hasattr(event_date, 'year') \
                else int(str(event_date)[:4])
        except (ValueError, AttributeError):
            event_year = None

    additional = 0
    for nyrr_runner_id, mmr_member_id, runner_name in known_runners:
        if nyrr_runner_id in captured_ids:
            continue

        try:
            history = client.get_runner_races(nyrr_runner_id, year=event_year)
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
            conn.commit()  # flush immediately so UI can see pass-2 additions

        time.sleep(API_SLEEP_SECONDS)

    if additional:
        logger.info(f'  [pass2] {additional} additional runners flushed')
    return additional
