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
        # --- Step 1: Load all finishers ---
        logger.info("⏱️  STEP 1: Starting finishers fetch...")
        step1_start = time.time()

        with _jobs_lock:
            _jobs[event_code]['step'] = 'step1_finishers'
            _jobs[event_code]['message'] = 'Step 1: Fetching all finishers from NYRR API...'

        def _fetch_progress(fetched, total):
            logger.debug(f"  └─ Progress: {fetched}/{total if total else '?'} finishers")
            with _jobs_lock:
                if total:
                    _jobs[event_code]['message'] = f'Step 1: Fetched {fetched}/{total} finishers...'
                else:
                    _jobs[event_code]['message'] = f'Step 1: Fetched {fetched} finishers...'

        logger.debug(f"  └─ Calling client.get_event_finishers(event_code={event_code})...")
        runners = client.get_event_finishers(event_code, progress_cb=_fetch_progress)
        step1_elapsed = time.time() - step1_start

        logger.info(f"✅ STEP 1 complete: {len(runners)} runners fetched in {step1_elapsed:.2f}s")
        with _jobs_lock:
            _jobs[event_code]['message'] = f'Step 1 complete: Got {len(runners)} runners. Upserting...'
            _jobs[event_code]['step1_elapsed_sec'] = step1_elapsed

        # --- Phase 1b: Upsert runners ---
        logger.info("⏱️  PHASE 1b: Upserting runners to database...")
        upsert_start = time.time()

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

        BATCH_SIZE = 500
        rows_written = 0
        logger.debug(f"  └─ Starting batch upsert: BATCH_SIZE={BATCH_SIZE}, total_runners={len(runners)}")

        for i in range(0, len(runners), BATCH_SIZE):
            batch = runners[i : i + BATCH_SIZE]
            row_tuples = []
            for runner in batch:
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

            batch_start = time.time()
            cursor.executemany(upsert_sql, row_tuples)
            conn.commit()
            batch_elapsed = time.time() - batch_start
            rows_written += len(batch)

            logger.debug(f"  └─ Batch {i//BATCH_SIZE + 1}: {len(batch)} rows in {batch_elapsed:.3f}s, total={rows_written}/{len(runners)}")

            with _jobs_lock:
                _jobs[event_code]['rows_written'] = rows_written
                _jobs[event_code]['message'] = f'Step 1: Upserted {rows_written}/{len(runners)} finishers...'

        upsert_elapsed = time.time() - upsert_start
        logger.info(f"✅ PHASE 1b complete: Upserted {rows_written} rows in {upsert_elapsed:.2f}s ({rows_written/upsert_elapsed:.1f} rows/sec)")

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
        for idx, team in enumerate(teams):
            team_code = team['teamCode']
            team_start = time.time()

            logger.debug(f"  └─ Team {idx+1}/{len(teams)}: fetching runners for team_code={team_code}...")
            team_runners = client.get_team_runners(event_code, team_code)
            logger.debug(f"    └─ Got {len(team_runners)} runners for {team_code}")

            updates_in_team = 0
            for runner in team_runners:
                cursor.execute(
                    """
                    UPDATE nyrr_event_runners
                    SET team_code = %s
                    WHERE nyrr_event_id = %s AND bib_number = %s
                    """,
                    (team_code, event_id, runner.bib)
                )
                updates_in_team += cursor.rowcount

            conn.commit()
            total_backfilled += updates_in_team
            team_elapsed = time.time() - team_start

            logger.debug(f"    └─ {team_code}: {updates_in_team} updates, {team_elapsed:.3f}s")

            with _jobs_lock:
                _jobs[event_code]['teams_processed'] = idx + 1
                _jobs[event_code]['message'] = f'Step 3: Backfilled {idx + 1}/{len(teams)} teams...'

        step3_elapsed = time.time() - step3_start
        logger.info(f"✅ STEP 3 complete: {len(teams)} teams, {total_backfilled} runner-team assignments in {step3_elapsed:.2f}s")

        # --- Finalize ---
        logger.info("⏱️  Finalizing: updating nyrr_events status...")
        finalize_start = time.time()

        cursor.execute(
            """
            UPDATE nyrr_events
            SET processing_status = 'Completed', processed_at = NOW(), processed_by = 'Viewer',
                result_count = (SELECT COUNT(*) FROM nyrr_event_runners WHERE nyrr_event_id = %s)
            WHERE id = %s
            """,
            (event_id, event_id)
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
        logger.info(f"   Summary: {rows_written} runners fetched, {len(teams)} teams, {total_backfilled} assignments")

        with _jobs_lock:
            _jobs[event_code]['status'] = 'done'
            _jobs[event_code]['message'] = f'✅ Sync complete: {rows_written} runners, {len(teams)} teams backfilled'
            _jobs[event_code]['finished_at'] = datetime.utcnow().isoformat()
            _jobs[event_code]['step3_elapsed_sec'] = step3_elapsed
            _jobs[event_code]['finalize_elapsed_sec'] = finalize_elapsed
            _jobs[event_code]['total_elapsed_sec'] = total_elapsed
            _jobs[event_code]['final_count'] = final_count
            _jobs[event_code]['total_backfilled'] = total_backfilled

    except Exception as e:
        elapsed = time.time() - start_time
        logger.error(f"❌ SYNC FAILED for {event_code} after {elapsed:.2f}s")
        logger.error(f"   Exception: {type(e).__name__}: {e}")
        logger.error(f"   Traceback:\n{traceback.format_exc()}")

        with _jobs_lock:
            _jobs[event_code]['status'] = 'error'
            _jobs[event_code]['message'] = str(e)[:500]
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
