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

import threading
from datetime import datetime
from typing import Any, Dict

from flask import Blueprint, request

from auth import login_required
from db import query, get_conn
from helpers import json_response
from nyrr_api import NyrrApiClient

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
    rows = query("SELECT * FROM nyrr_events WHERE id = %s", [event_id])
    if not rows:
        return json_response({'ok': False, 'error': 'Event not found'}, 404)

    event = rows[0]
    event_code = event['event_code']
    force_reload = request.json.get('force_reload', False)

    # Initialize job status
    with _jobs_lock:
        _jobs[event_code] = {
            'status': 'running',
            'message': 'Starting three-step sync...',
            'step': 'init',
            'rows_written': 0,
            'teams_processed': 0,
            'started_at': datetime.utcnow().isoformat(),
        }

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
    client = NyrrApiClient()
    conn = None

    try:
        # --- Step 1: Load all finishers ---
        with _jobs_lock:
            _jobs[event_code]['step'] = 'step1_finishers'
            _jobs[event_code]['message'] = 'Step 1: Fetching all finishers from NYRR API...'

        def _fetch_progress(fetched, total):
            with _jobs_lock:
                if total:
                    _jobs[event_code]['message'] = f'Step 1: Fetched {fetched}/{total} finishers...'
                else:
                    _jobs[event_code]['message'] = f'Step 1: Fetched {fetched} finishers...'

        runners = client.get_event_finishers(event_code, progress_cb=_fetch_progress)

        with _jobs_lock:
            _jobs[event_code]['message'] = f'Step 1 complete: Got {len(runners)} runners. Upserting...'

        # --- Phase 1b: Upsert runners ---
        conn = get_conn()
        conn.autocommit = False
        cursor = conn.cursor()

        # Delete if force_reload requested
        if force_reload:
            cursor.execute("DELETE FROM nyrr_event_runners WHERE nyrr_event_id = %s", (event_id,))
            conn.commit()

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

            cursor.executemany(upsert_sql, row_tuples)
            conn.commit()
            rows_written += len(batch)

            with _jobs_lock:
                _jobs[event_code]['rows_written'] = rows_written
                _jobs[event_code]['message'] = f'Step 1: Upserted {rows_written}/{len(runners)} finishers...'

        cursor.close()
        conn.close()
        conn = None

        # --- Step 2: Enumerate all teams ---
        with _jobs_lock:
            _jobs[event_code]['step'] = 'step2_teams'
            _jobs[event_code]['message'] = 'Step 2: Fetching team list...'

        teams = client.search_teams(event_code)

        with _jobs_lock:
            _jobs[event_code]['message'] = f'Step 2 complete: Found {len(teams)} teams. Backfilling team_code...'

        # --- Step 3: Backfill team_code for each team ---
        with _jobs_lock:
            _jobs[event_code]['step'] = 'step3_backfill'

        conn = get_conn()
        cursor = conn.cursor()

        for idx, team in enumerate(teams):
            team_code = team['teamCode']
            team_runners = client.get_team_runners(event_code, team_code)

            for runner in team_runners:
                cursor.execute(
                    """
                    UPDATE nyrr_event_runners
                    SET team_code = %s
                    WHERE nyrr_event_id = %s AND bib_number = %s
                    """,
                    (team_code, event_id, runner.bib)
                )

            conn.commit()

            with _jobs_lock:
                _jobs[event_code]['teams_processed'] = idx + 1
                _jobs[event_code]['message'] = f'Step 3: Backfilled {idx + 1}/{len(teams)} teams...'

        # --- Finalize ---
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
        cursor.close()
        conn.close()
        conn = None

        with _jobs_lock:
            _jobs[event_code]['status'] = 'done'
            _jobs[event_code]['message'] = f'✅ Sync complete: {rows_written} runners, {len(teams)} teams backfilled'
            _jobs[event_code]['finished_at'] = datetime.utcnow().isoformat()

    except Exception as e:
        import traceback
        logger.error(f"Sync failed for {event_code}: {e}\n{traceback.format_exc()}")

        with _jobs_lock:
            _jobs[event_code]['status'] = 'error'
            _jobs[event_code]['message'] = str(e)[:500]
            _jobs[event_code]['finished_at'] = datetime.utcnow().isoformat()

        # Update event status to error
        try:
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
        except Exception:
            pass

    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


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
