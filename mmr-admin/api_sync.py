"""
NYRR data load (sync) worker for mmr-admin.
Optimal three-step workflow:
  1. runners/finishers-filter → Load all runners (all race data)
  2. teams/search            → Enumerate all teams in event
  3. teams/teamRunners (×584)→ Backfill team_code by bib

Blueprint: sync_bp
Routes: /api/load/<event_id> (POST), /api/load/<event_code>/status
"""

from __future__ import annotations

import logging
import threading
import traceback
import time
from datetime import datetime
from typing import Any, Dict

import mysql.connector.errors

from flask import Blueprint, request

from auth import login_required
from db import query, get_conn
from helpers import json_response
from nyrr_api import NyrrApiClient

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

sync_bp = Blueprint('sync', __name__)

# In-flight jobs (event_code -> status dict)
_jobs: Dict[str, Dict[str, Any]] = {}
_jobs_lock = threading.Lock()


@sync_bp.route('/api/load/<int:event_id>', methods=['POST'])
@login_required
def api_load_event(event_id):
    """
    Trigger three-step sync:
      Step 1: Load all finishers (runners/finishers-filter)
      Step 2: Enumerate teams (teams/search)
      Step 3: Backfill team_code (teams/teamRunners × each team)

    Runs in background thread.
    """
    logger.debug(f"🔄 api_load_event called: event_id={event_id}, request.json={request.json}")

    rows = query("SELECT * FROM nyrr_events WHERE id = %s", [event_id])
    if not rows:
        logger.warning(f"❌ Event not found: id={event_id}")
        return json_response({'ok': False, 'error': 'Event not found'}, 404)

    event = rows[0]
    event_code = event['event_code']
    force_reload = request.json.get('force_reload', False)
    logger.info(f"📋 Event found: event_code={event_code}, force_reload={force_reload}")

    # Start background worker
    thread = threading.Thread(
        target=_sync_worker,
        args=(event_id, event_code, force_reload),
        daemon=True
    )
    thread.start()

    return json_response({'ok': True, 'event_code': event_code, 'status': 'started'})


@sync_bp.route('/api/load/<event_code>/status')
@login_required
def api_sync_status(event_code):
    """Get current sync job status."""
    with _jobs_lock:
        job = _jobs.get(event_code, {
            'status': 'not_found',
            'message': 'No sync job for this event'
        })
    return json_response(job)


def _sync_worker(event_id: int, event_code: str, force_reload: bool):
    """
    Background worker: three-step sync.

    Step 1: runners/finishers-filter (paginated, all runners)
    Step 2: teams/search (enumerate teams)
    Step 3: teams/teamRunners (backfill team_code by bib for each team)
    """
    logger.info(f"🚀 Sync worker started: event_id={event_id}, event_code={event_code}, force_reload={force_reload}")
    start_time = time.time()
    client = NyrrApiClient()
    conn = None

    # Initialize job status (must happen before any _jobs access)
    with _jobs_lock:
        _jobs[event_code] = {
            'status': 'running',
            'message': 'Starting three-step sync...',
            'step': 'init',
            'rows_written': 0,
            'teams_processed': 0,
            'started_at': datetime.utcnow().isoformat(),
        }

    try:
        # --- Step 1: Fetch and upsert finishers (streaming, per-page) ---
        logger.info("⏱️  STEP 1: Starting finishers fetch & upsert (streaming)...")
        step1_start = time.time()

        with _jobs_lock:
            _jobs[event_code]['step'] = 'step1_finishers'
            _jobs[event_code]['message'] = 'Step 1: Fetching and upserting finishers from NYRR API...'

        # Connect once for all pages
        conn = get_conn()
        conn.autocommit = False
        cursor = conn.cursor()
        logger.debug(f"  └─ DB connection acquired")

        # Delete if force_reload requested
        if force_reload:
            logger.info(f"🗑️  force_reload=True: Deleting existing runners for event_id={event_id}...")
            cursor.execute("DELETE FROM nyrr_event_runners WHERE nyrr_event_id = %s", (event_id,))
            conn.commit()
            logger.debug(f"  └─ Deleted {cursor.rowcount} rows")

        upsert_sql = """
            INSERT INTO nyrr_event_runners
              (nyrr_event_id, nyrr_runner_id, runner_name, first_name, last_name,
               age, gender, city, state_province, bib_number,
               finish_time, pace, overall_place, gender_place,
               age_grade_time, age_grade_place, age_grade_percent,
               scan_timestamp)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON DUPLICATE KEY UPDATE
              runner_name = VALUES(runner_name),
              first_name = VALUES(first_name),
              last_name = VALUES(last_name),
              age = VALUES(age),
              gender = VALUES(gender),
              city = VALUES(city),
              state_province = VALUES(state_province),
              finish_time = VALUES(finish_time),
              pace = VALUES(pace),
              overall_place = VALUES(overall_place),
              gender_place = VALUES(gender_place),
              age_grade_time = VALUES(age_grade_time),
              age_grade_place = VALUES(age_grade_place),
              age_grade_percent = VALUES(age_grade_percent),
              scan_timestamp = NOW()
        """

        MAX_RETRIES = 3
        RETRY_DELAY = 2  # seconds
        rows_written = 0
        pages_written = 0

        from nyrr_api import NyrrFinisher

        def _probe(age_from=None, age_to=None, gender=None, team_code=None, pace_min=None, pace_max=None, sort_column="bib", sort_desc=False, return_pace=False):
            """Single pageSize=1 call to get totalItems for a filter combination. Optionally return first item's pace."""
            data = client._post("runners/finishers-filter", {
                "eventCode": event_code,
                "ageFrom": age_from,
                "ageTo": age_to,
                "gender": gender,
                "teamCode": team_code,
                "paceFrom": pace_min,
                "paceTo": pace_max,
                "sortColumn": sort_column,
                "sortDescending": sort_desc,
                "pageIndex": 1,
                "pageSize": 1,
            })
            if return_pace:
                # Extract pace from first item if available
                items = data.get("items", [])
                pace = items[0].get("pace") if items else None
                if pace and pace.count(':') == 1:
                    pace = "00:" + pace
                return data.get("totalItems", 0), pace
            return data.get("totalItems", 0)

        def _upsert_pages(label, age_from=None, age_to=None, gender=None, team_code=None, pace_min=None, pace_max=None, sort_desc=False):
            """Fetch all pages for a given filter set and upsert to DB."""
            nonlocal rows_written, pages_written
            for page_num, page_raw in enumerate(client._paginate_streaming(
                "runners/finishers-filter",
                {
                    "eventCode": event_code,
                    "ageFrom": age_from,
                    "ageTo": age_to,
                    "gender": gender,
                    "teamCode": team_code,
                    "paceFrom": pace_min,
                    "paceTo": pace_max,
                    "sortColumn": "bib",
                    "sortDescending": sort_desc,
                },
            ), 1):
                page_runners = [NyrrFinisher.from_api(item) for item in page_raw]
                row_tuples = []
                for runner in page_runners:
                    full_name = f"{runner.first_name} {runner.last_name}".strip()
                    row_tuples.append((
                        event_id,
                        str(runner.runner_id),
                        full_name,
                        runner.first_name,
                        runner.last_name,
                        runner.age,
                        runner.gender,
                        getattr(runner, 'city', '') or '',
                        runner.state_province,
                        runner.bib,
                        runner.overall_time,
                        runner.pace,
                        runner.overall_place,
                        runner.gender_place,
                        getattr(runner, 'age_grade_time', '') or '',
                        getattr(runner, 'age_grade_place', None),
                        getattr(runner, 'age_grade_percent', None),
                    ))

                for attempt in range(1, MAX_RETRIES + 1):
                    try:
                        batch_start = time.time()
                        cursor.executemany(upsert_sql, row_tuples)
                        conn.commit()
                        batch_elapsed = time.time() - batch_start
                        rows_written += len(row_tuples)
                        pages_written += 1
                        break
                    except mysql.connector.errors.DatabaseError as e:
                        if e.errno == 1205 and attempt < MAX_RETRIES:
                            logger.warning(f"  └─ Lock timeout [{label}] page {page_num}, attempt {attempt}/{MAX_RETRIES}. Retrying in {RETRY_DELAY}s...")
                            conn.rollback()
                            time.sleep(RETRY_DELAY * attempt)
                        else:
                            raise

                logger.debug(f"  └─ [{label}] page {page_num}: {len(row_tuples)} rows in {batch_elapsed:.3f}s, total={rows_written}")

        def _pace_to_seconds(pace_str: str) -> int:
            """Convert MM:SS or 00:MM:SS pace to seconds."""
            parts = pace_str.split(':')
            if len(parts) == 2:
                m, s = int(parts[0]), int(parts[1])
                return m * 60 + s
            elif len(parts) == 3:
                h, m, s = int(parts[0]), int(parts[1]), int(parts[2])
                return h * 3600 + m * 60 + s
            return 0

        def _seconds_to_pace(seconds: int) -> str:
            """Convert seconds to 00:MM:SS pace."""
            m = seconds // 60
            s = seconds % 60
            return f"00:{m:02d}:{s:02d}"

        def _split_by_pace(age_from: int, age_to: int, gender: str, max_pace: str, depth: int = 0):
            """
            Recursively binary-split by pace until each shard <= 500 items.
            Called when age+gender combo is still >1000 after age/gender splitting.
            """
            indent = "  " * (depth + 3)

            # Base case: shard is small enough
            total_pace = _probe(age_from=age_from, age_to=age_to, gender=gender, pace_max=max_pace)
            label_pace = f"age {age_from}-{age_to} gender={gender} pace 00:00-{max_pace}"
            logger.info(f"{indent}└─ {label_pace}: {total_pace} items")

            if total_pace == 0:
                return

            if total_pace <= 500:
                _upsert_pages(label_pace, age_from=age_from, age_to=age_to, gender=gender,
                             pace_min="00:00", pace_max=max_pace, sort_desc=False)
            else:
                # Recursive case: split by pace
                logger.info(f"{indent}└─ Splitting pace range by half...")
                max_sec = _pace_to_seconds(max_pace)
                mid_sec = max_sec // 2
                mid_pace = _seconds_to_pace(mid_sec)

                _split_by_pace(age_from, age_to, gender, mid_pace, depth + 1)
                _split_by_pace(age_from, age_to, gender, max_pace, depth + 1)

        def _divide_and_conquer(age_from: int, age_to: int, gender=None, depth=0):
            """
            Recursively split age range until totalItems <= 1000, then fetch.
            - If <=500: single pass (sortAsc only)
            - If 501-1000: two passes (sortAsc + sortDesc) to guarantee all pages
            - If >1000 and age_from==age_to: split by gender M/W/X + null-gender pass
            - Otherwise: bisect the age range
            """
            indent = "  " * (depth + 2)
            label_base = f"age {age_from}-{age_to}" + (f" gender={gender}" if gender else "")
            total = _probe(age_from=age_from, age_to=age_to, gender=gender)
            logger.info(f"{indent}└─ {label_base}: totalItems={total}")

            with _jobs_lock:
                _jobs[event_code]['message'] = f'Step 1: Fetching age {age_from}-{age_to}{" "+gender if gender else ""} ({total} runners)...'

            if total == 0:
                return

            if total <= 500:
                _upsert_pages(label_base, age_from=age_from, age_to=age_to, gender=gender, sort_desc=False)
            elif age_from == age_to:
                # Can't split further by age — break by gender
                if gender is not None:
                    # Already split by gender and still >1000 — get max pace and split by pace
                    logger.info(f"{indent}⚠️  age={age_from} gender={gender} still {total} items — querying max pace...")
                    # Query sorted by pace descending to get slowest runner's pace
                    total_pace, max_pace = _probe(age_from=age_from, age_to=age_to, gender=gender,
                                                  sort_column="pace", sort_desc=True, return_pace=True)
                    if not max_pace:
                        max_pace = "00:20:00"  # Fallback
                    logger.info(f"{indent}└─ Max pace: {max_pace}")
                    _split_by_pace(age_from, age_to, gender, max_pace, depth=depth + 1)
                else:
                    logger.info(f"{indent}└─ Splitting age={age_from} by gender...")
                    for g in ("M", "W", "X"):
                        _divide_and_conquer(age_from, age_to, gender=g, depth=depth + 1)
                    # Catch runners with no/blank gender
                    total_ungendered = _probe(age_from=age_from, age_to=age_to)
                    mmr_gendered = sum(_probe(age_from=age_from, age_to=age_to, gender=g) for g in ("M", "W", "X"))
                    if total_ungendered > mmr_gendered:
                        logger.info(f"{indent}└─ age={age_from} ungendered pass ({total_ungendered - mmr_gendered} likely)")
                        _upsert_pages(f"age {age_from} ungendered asc",  age_from=age_from, age_to=age_to, sort_desc=False)
                        _upsert_pages(f"age {age_from} ungendered desc", age_from=age_from, age_to=age_to, sort_desc=True)
            else:
                # Bisect the age range
                mid = (age_from + age_to) // 2
                _divide_and_conquer(age_from, mid,      gender=gender, depth=depth + 1)
                _divide_and_conquer(mid + 1, age_to,    gender=gender, depth=depth + 1)

            with _jobs_lock:
                _jobs[event_code]['rows_written'] = rows_written

        # ── Pass 0: MMR members first (teamCode=MMR, covers all ages) ──────────
        mmr_total = _probe(team_code="MMR")
        logger.info(f"  └─ MMR members totalItems={mmr_total}")
        if mmr_total > 0:
            if mmr_total <= 500:
                _upsert_pages("MMR", team_code="MMR", sort_desc=False)
            else:
                logger.warning(f"  └─ MMR has {mmr_total} members (>500). Consider pre-filtering or splitting by district.")
                _upsert_pages("MMR asc",  team_code="MMR", sort_desc=False)
                _upsert_pages("MMR desc", team_code="MMR", sort_desc=True)
        with _jobs_lock:
            _jobs[event_code]['rows_written'] = rows_written
            _jobs[event_code]['message'] = f'Step 1: MMR pass done ({rows_written} rows). Starting divide & conquer...'

        # ── Pass 1+: divide & conquer the full field by age ───────────────────
        total_finishers = _probe()
        logger.info(f"  └─ Total finishers (all ages) = {total_finishers}")

        # Store total_finishers for later update to nyrr_events
        with _jobs_lock:
            _jobs[event_code]['nyrr_finisher_count'] = total_finishers

        _divide_and_conquer(0, 100)

        step1_elapsed = time.time() - step1_start
        logger.info(f"✅ STEP 1 complete: Upserted {rows_written} rows in {step1_elapsed:.2f}s ({rows_written/step1_elapsed:.1f} rows/sec, {pages_written} pages)")

        cursor.close()
        conn.close()
        conn = None
        logger.debug(f"  └─ DB connection closed")

        # --- Step 2: Enumerate all teams ---
        logger.info("⏱️  STEP 2: Fetching team list...")
        step2_start = time.time()

        with _jobs_lock:
            _jobs[event_code]['step'] = 'step2_teams'
            _jobs[event_code]['message'] = 'Step 2: Fetching team list...'

        logger.debug(f"  └─ Calling client.search_teams(event_code={event_code})...")
        teams = client.search_teams(event_code)
        step2_elapsed = time.time() - step2_start

        logger.info(f"✅ STEP 2 complete: {len(teams)} teams found in {step2_elapsed:.2f}s")
        with _jobs_lock:
            _jobs[event_code]['message'] = f'Step 2 complete: Found {len(teams)} teams. Backfilling team_code...'
            _jobs[event_code]['step2_elapsed_sec'] = step2_elapsed

        # --- Step 3: Backfill team_code for each team ---
        logger.info("⏱️  STEP 3: Backfilling team_code for each team...")
        step3_start = time.time()

        with _jobs_lock:
            _jobs[event_code]['step'] = 'step3_backfill'

        conn = get_conn()
        cursor = conn.cursor()
        logger.debug(f"  └─ DB connection acquired for backfill")

        total_backfilled = 0
        total_inserted = 0
        TEAM_BATCH_SIZE = 100  # Batch updates/inserts to avoid lock timeouts

        for idx, team in enumerate(teams):
            team_code = team.team_code
            team_start = time.time()

            logger.debug(f"  └─ Team {idx+1}/{len(teams)}: fetching runners for team_code={team_code}...")
            team_runners = client.get_team_runners(event_code, team_code)
            logger.debug(f"    └─ Got {len(team_runners)} runners for {team_code}")

            updates_in_team = 0
            inserts_in_team = 0

            # Batch updates first
            update_bibs = [(team_code, event_id, runner.bib) for runner in team_runners]
            for batch_idx in range(0, len(update_bibs), TEAM_BATCH_SIZE):
                batch = update_bibs[batch_idx : batch_idx + TEAM_BATCH_SIZE]
                try:
                    cursor.executemany(
                        """
                        UPDATE nyrr_event_runners
                        SET team_code = %s
                        WHERE nyrr_event_id = %s AND bib_number = %s
                        """,
                        batch
                    )
                    updates_in_team += cursor.rowcount
                    conn.commit()
                except Exception as e:
                    logger.warning(f"    └─ Batch update error for {team_code}: {e}")
                    conn.rollback()

            # Collect runners that need INSERT (those that weren't updated)
            insert_batch = []
            for runner in team_runners:
                cursor.execute(
                    "SELECT COUNT(*) FROM nyrr_event_runners WHERE nyrr_event_id = %s AND bib_number = %s",
                    (event_id, runner.bib)
                )
                if cursor.fetchone()[0] == 0:
                    full_name = f"{runner.first_name} {runner.last_name}".strip()
                    insert_batch.append((
                        event_id,
                        str(runner.runner_id),
                        full_name,
                        runner.first_name,
                        runner.last_name,
                        runner.age,
                        runner.gender,
                        getattr(runner, 'city', '') or '',
                        runner.state_province,
                        runner.bib,
                        runner.overall_time,
                        runner.pace,
                        runner.overall_place,
                        runner.gender_place,
                        getattr(runner, 'age_grade_time', '') or '',
                        getattr(runner, 'age_grade_place', None),
                        getattr(runner, 'age_grade_percent', None),
                        team_code,
                        team_code
                    ))

            # Batch inserts
            for insert_idx in range(0, len(insert_batch), TEAM_BATCH_SIZE):
                batch = insert_batch[insert_idx : insert_idx + TEAM_BATCH_SIZE]
                if batch:
                    try:
                        cursor.executemany(
                            """
                            INSERT INTO nyrr_event_runners
                              (nyrr_event_id, nyrr_runner_id, runner_name, first_name, last_name,
                               age, gender, city, state_province, bib_number,
                               finish_time, pace, overall_place, gender_place,
                               age_grade_time, age_grade_place, age_grade_percent,
                               team_code, scan_timestamp)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                            ON DUPLICATE KEY UPDATE team_code = %s
                            """,
                            batch
                        )
                        inserts_in_team += cursor.rowcount
                        conn.commit()
                    except Exception as e:
                        logger.warning(f"    └─ Batch insert error for {team_code}: {e}")
                        conn.rollback()

            total_backfilled += updates_in_team
            total_inserted += inserts_in_team
            team_elapsed = time.time() - team_start

            logger.debug(f"    └─ {team_code}: {updates_in_team} updates, {inserts_in_team} inserts, {team_elapsed:.3f}s")

            with _jobs_lock:
                _jobs[event_code]['teams_processed'] = idx + 1
                _jobs[event_code]['message'] = f'Step 3: Backfilled {idx + 1}/{len(teams)} teams ({total_inserted} new runners)...'

        step3_elapsed = time.time() - step3_start
        logger.info(f"✅ STEP 3 complete: {len(teams)} teams, {total_backfilled} updates + {total_inserted} new inserts ({total_backfilled + total_inserted} total) in {step3_elapsed:.2f}s")

        # --- Finalize ---
        logger.info("⏱️  Finalizing: updating nyrr_events status...")
        finalize_start = time.time()

        # Get finisher count from job state
        finisher_count = None
        with _jobs_lock:
            finisher_count = _jobs[event_code].get('nyrr_finisher_count')

        cursor.execute(
            """
            UPDATE nyrr_events
            SET processing_status = 'Completed', processed_at = NOW(), processed_by = 'Viewer',
                result_count = (SELECT COUNT(*) FROM nyrr_event_runners WHERE nyrr_event_id = %s),
                nyrr_finisher_count = %s
            WHERE id = %s
            """,
            (event_id, finisher_count, event_id)
        )
        conn.commit()

        # Fetch final counts for logging
        cursor.execute("SELECT COUNT(*) as cnt FROM nyrr_event_runners WHERE nyrr_event_id = %s", (event_id,))
        final_count_row = cursor.fetchone()
        final_count = final_count_row[0] if final_count_row else 0

        finalize_elapsed = time.time() - finalize_start
        total_elapsed = time.time() - start_time

        cursor.close()
        conn.close()
        conn = None
        logger.debug(f"  └─ DB connection closed")

        logger.info(f"✅ FINALIZE complete: {final_count} total runners in DB, {finalize_elapsed:.2f}s")
        logger.info(f"🎉 FULL SYNC COMPLETE in {total_elapsed:.2f}s ({total_elapsed/60:.1f}m)")
        logger.info(f"   Summary: {rows_written} fetched (Step 1), {len(teams)} teams, {total_backfilled} updates + {total_inserted} new inserts")

        with _jobs_lock:
            _jobs[event_code]['status'] = 'done'
            _jobs[event_code]['message'] = f'✅ Sync complete: {final_count} total runners ({rows_written} from Step 1, {total_inserted} from team enrichment)'
            _jobs[event_code]['finished_at'] = datetime.utcnow().isoformat()
            _jobs[event_code]['step3_elapsed_sec'] = step3_elapsed
            _jobs[event_code]['finalize_elapsed_sec'] = finalize_elapsed
            _jobs[event_code]['total_elapsed_sec'] = total_elapsed
            _jobs[event_code]['final_count'] = final_count
            _jobs[event_code]['total_backfilled'] = total_backfilled
            _jobs[event_code]['total_inserted'] = total_inserted

    except Exception as e:
        elapsed = time.time() - start_time
        logger.error(f"❌ SYNC FAILED for {event_code} after {elapsed:.2f}s")
        logger.error(f"   Exception: {type(e).__name__}: {e}")
        # Log traceback at DEBUG level only (don't spam terminal with full stack trace)
        logger.debug(f"   Full traceback:\n{traceback.format_exc()}")

        # Format error message for UI (include context, suppress raw traceback)
        error_msg = str(e)
        if isinstance(e, mysql.connector.errors.DatabaseError):
            if e.errno == 1048:
                error_msg = f"Database error: Column cannot be null (check data format)"
            elif e.errno == 1205:
                error_msg = f"Database timeout: Too much lock contention"
            elif e.errno == 2003:
                error_msg = f"Database connection failed: Check network"
            else:
                error_msg = f"Database error {e.errno}: {error_msg}"
        elif isinstance(e, ConnectionError):
            error_msg = f"Network error: Cannot reach NYRR API or database"
        elif isinstance(e, ValueError):
            error_msg = f"Invalid data: {error_msg}"
        else:
            error_msg = f"{type(e).__name__}: {error_msg}"

        with _jobs_lock:
            _jobs[event_code]['status'] = 'error'
            _jobs[event_code]['message'] = error_msg[:500]
            _jobs[event_code]['finished_at'] = datetime.utcnow().isoformat()
            _jobs[event_code]['total_elapsed_sec'] = elapsed
            _jobs[event_code]['error_type'] = type(e).__name__

        # Update event status to error
        try:
            logger.debug(f"  └─ Updating nyrr_events and nyrr_processing_log with error...")
            conn2 = get_conn()
            cur2 = conn2.cursor()
            cur2.execute(
                "UPDATE nyrr_events SET processing_status = 'Error', notes = %s WHERE id = %s",
                (str(e)[:500], event_id)
            )
            cur2.execute(
                """
                INSERT INTO nyrr_processing_log
                  (nyrr_event_id, triggered_by, run_status, rows_written, error_details)
                VALUES (%s, 'Viewer', 'Failed', 0, %s)
                """,
                (event_id, str(e)[:2000])
            )
            conn2.commit()
            cur2.close()
            conn2.close()
            logger.debug(f"  └─ Error status recorded in DB")
        except Exception as log_err:
            logger.error(f"  └─ Failed to log error to DB: {log_err}")

    finally:
        if conn:
            try:
                conn.close()
                logger.debug(f"  └─ Final cleanup: closed DB connection")
            except Exception as close_err:
                logger.warning(f"  └─ Error closing final DB connection: {close_err}")


@sync_bp.route('/api/events/<int:event_id>/runners', methods=['DELETE'])
@login_required
def api_delete_event_runners(event_id):
    """Delete all runners for an event so it can be reloaded from scratch."""
    rows = query("SELECT event_code FROM nyrr_events WHERE id = %s", [event_id])
    if not rows:
        return json_response({'ok': False, 'error': 'Event not found'}, 404)

    event_code = rows[0]['event_code']

    # Check if sync is running
    with _jobs_lock:
        job = _jobs.get(event_code, {})
        if job.get('status') == 'running':
            return json_response({'ok': False, 'error': 'Sync in progress — wait for it to finish first'}, 409)

    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM nyrr_event_runners WHERE nyrr_event_id = %s", (event_id,))
        deleted = cursor.rowcount
        cursor.execute(
            "UPDATE nyrr_events SET processing_status = 'Pending', notes = NULL WHERE id = %s",
            (event_id,)
        )
        conn.commit()
        cursor.close()
    finally:
        conn.close()

    return json_response({'ok': True, 'deleted': deleted, 'event_code': event_code})


if __name__ == '__main__':
    """
    Standalone CLI mode: run sync directly and exit.
    Usage: python3 api_sync.py --event <event_code> [--force] [--debug]
    """
    import argparse
    import sys

    parser = argparse.ArgumentParser(
        description='NYRR data sync worker — load runners, teams, and backfill team codes',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  python3 api_sync.py --event H2026
  python3 api_sync.py --event H2026 --force --debug
        '''
    )
    parser.add_argument('--event', required=True, help='Event code (e.g., H2026)')
    parser.add_argument('--force', action='store_true', help='Delete and reload all runners')
    parser.add_argument('--debug', action='store_true', help='Enable DEBUG logging')

    args = parser.parse_args()

    # Setup logging
    log_format = '%(levelname)-8s - %(message)s'
    log_level = logging.DEBUG if args.debug else logging.INFO
    logging.basicConfig(level=log_level, format=log_format)

    logger.info(f"🚀 Starting NYRR sync CLI: event={args.event}, force={args.force}")

    # Lookup event_id by event_code
    rows = query("SELECT id, event_code FROM nyrr_events WHERE event_code = %s", [args.event])
    if not rows:
        logger.error(f"❌ Event not found: {args.event}")
        sys.exit(1)

    event_id = rows[0]['id']
    event_code = rows[0]['event_code']
    logger.info(f"✅ Event found: id={event_id}, code={event_code}")

    # Run sync synchronously (no background thread)
    try:
        _sync_worker(event_id, event_code, force_reload=args.force)

        # Fetch final job status
        with _jobs_lock:
            final_job = _jobs.get(event_code, {})

        if final_job.get('status') == 'done':
            logger.info(f"\n{'='*70}")
            logger.info(f"✅ SYNC SUCCEEDED")
            logger.info(f"{'='*70}")
            logger.info(f"Runners fetched: {final_job.get('rows_written', 0)}")
            logger.info(f"Teams processed: {final_job.get('teams_processed', 0)}")
            logger.info(f"Assignments: {final_job.get('total_backfilled', 0)}")
            logger.info(f"Final count: {final_job.get('final_count', 0)}")
            logger.info(f"Total time: {final_job.get('total_elapsed_sec', 0):.2f}s")
            logger.info(f"{'='*70}\n")
            sys.exit(0)
        elif final_job.get('status') == 'error':
            logger.error(f"\n{'='*70}")
            logger.error(f"❌ SYNC FAILED")
            logger.error(f"{'='*70}")
            logger.error(f"Error: {final_job.get('message', 'Unknown error')}")
            logger.error(f"Type: {final_job.get('error_type', 'Unknown')}")
            logger.error(f"Elapsed: {final_job.get('total_elapsed_sec', 0):.2f}s")
            logger.error(f"{'='*70}\n")
            sys.exit(1)
        else:
            logger.warning(f"⚠️  Unexpected sync status: {final_job.get('status', 'unknown')}")
            sys.exit(1)

    except KeyboardInterrupt:
        logger.warning("\n⚠️  Sync interrupted by user")
        sys.exit(130)
    except Exception as e:
        logger.error(f"\n❌ Unhandled error: {type(e).__name__}: {e}")
        logger.error(f"Traceback:\n{traceback.format_exc()}")
        sys.exit(1)
