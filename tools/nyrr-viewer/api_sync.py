"""
NYRR data load (sync) worker for nyrr-viewer.

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

TEAM_CODE = 'MMR'

# In-flight jobs (event_code -> status dict)
_jobs: Dict[str, Dict[str, Any]] = {}
_jobs_lock = threading.Lock()


@sync_bp.route('/api/load/<int:event_id>', methods=['POST'])
@login_required
def api_load_event(event_id):
    """
    Trigger loading runner results from the NYRR API for a specific event.
    Accepts scope ('team' or 'all') and force_reload flags.
    Runs in a background thread so the UI isn't blocked.
    """
    rows = query("SELECT * FROM nyrr_events WHERE id = %s", [event_id])
    if not rows:
        return json_response({'ok': False, 'error': 'Event not found'}, 404)

    event = rows[0]
    event_code = event['event_code']

    data = request.json or {}
    scope = data.get('scope', 'team')
    force_reload = data.get('force_reload', False)

    if scope not in ('team', 'all'):
        return json_response({'ok': False, 'error': 'Invalid scope'}, 400)

    with _jobs_lock:
        if event_code in _jobs and _jobs[event_code].get('status') == 'running':
            return json_response({
                'ok': False,
                'error': f'Already loading {event_code}',
            }, 409)
        _jobs[event_code] = {
            'status': 'running',
            'started_at': datetime.utcnow().isoformat(),
            'rows_written': 0,
            'scope': scope,
            'message': 'Starting...',
        }

    thread = threading.Thread(
        target=_load_event_background,
        args=(event_id, event_code, scope, force_reload),
        daemon=True,
    )
    thread.start()

    return json_response({
        'ok': True,
        'message': f'Loading started for {event_code} (scope: {scope})',
        'event_code': event_code,
    })


@sync_bp.route('/api/load/<event_code>/status')
@login_required
def api_load_status(event_code):
    """Check status of a background load job."""
    with _jobs_lock:
        job = _jobs.get(event_code)
    if not job:
        return json_response({'ok': True, 'status': 'idle'})
    return json_response({'ok': True, **job})


def _load_event_background(event_id: int, event_code: str, scope: str = 'team', force_reload: bool = False):
    """
    Background worker: fetch runners from NYRR API (team or all) and upsert.
    If force_reload, delete existing runners first.

    For large events (30K+ finishers), this:
    - Closes the DB connection during the long API fetch phase to avoid timeouts
    - Uses executemany with batching (500 rows) instead of row-by-row inserts
    - Commits after each batch to avoid giant transactions
    """
    BATCH_SIZE = 500
    conn = None
    try:
        client = NyrrApiClient()

        # --- Phase 1: Mark InProgress (short-lived connection) ---
        conn = get_conn()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE nyrr_events
            SET processing_status = 'InProgress', processed_by = 'Viewer', processed_at = NOW()
            WHERE id = %s
        """, (event_id,))

        deleted_count = 0
        if force_reload:
            cursor.execute("""
                DELETE FROM nyrr_event_runners WHERE nyrr_event_id = %s
            """, (event_id,))
            deleted_count = cursor.rowcount
            with _jobs_lock:
                _jobs[event_code]['message'] = f'Re-syncing: deleted {deleted_count} existing rows, loading fresh...'
        else:
            with _jobs_lock:
                _jobs[event_code]['message'] = f'Fetching runners from NYRR API (scope: {scope})...'

        conn.commit()
        cursor.close()
        conn.close()
        conn = None

        # --- Phase 2: Fetch runners from NYRR API (no DB connection open) ---
        if scope == 'all':
            runners = client.get_event_finishers(event_code)
        else:
            runners = client.get_team_runners(event_code, TEAM_CODE)

        with _jobs_lock:
            _jobs[event_code]['message'] = f'Got {len(runners)} runners. Upserting...'

        # Prepare row tuples, skipping blank runner_ids
        row_tuples = []
        for runner in runners:
            if not runner.runner_id:
                continue
            full_name = f"{runner.first_name} {runner.last_name}".strip()
            row_tuples.append((
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
                runner.team_code or '',
            ))

        # --- Phase 3: Batch upsert with fresh connection ---
        conn = get_conn()
        conn.autocommit = False
        cursor = conn.cursor()

        upsert_sql = """
            INSERT INTO nyrr_event_runners
                (nyrr_event_id, nyrr_runner_id, runner_name, first_name, last_name,
                 age, gender, state_province, bib_number, finish_time, pace,
                 overall_place, gender_place, team_code, is_registered_only, scan_timestamp)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 0, NOW())
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
                scan_timestamp = NOW()
        """

        rows_written = 0
        for i in range(0, len(row_tuples), BATCH_SIZE):
            batch = row_tuples[i : i + BATCH_SIZE]
            cursor.executemany(upsert_sql, batch)
            conn.commit()
            rows_written += len(batch)

            with _jobs_lock:
                _jobs[event_code]['rows_written'] = rows_written
                _jobs[event_code]['message'] = f'Upserted {rows_written}/{len(row_tuples)} runners...'

        # --- Phase 4: Auto-match + finalize ---
        with _jobs_lock:
            _jobs[event_code]['message'] = 'Running auto-matcher (Tier 1: NYRR name)...'

        # Tier 1: Match by NYRRRunnerName
        cursor.execute("""
            UPDATE nyrr_event_runners er
            INNER JOIN members m
                ON LOWER(TRIM(er.runner_name)) = LOWER(TRIM(m.NYRRRunnerName))
            SET er.mmr_member_id = m.MemberID,
                er.match_method = 'auto_name',
                er.matched_by = 'Viewer',
                er.matched_at = NOW()
            WHERE er.mmr_member_id IS NULL
              AND m.NYRRRunnerName IS NOT NULL
              AND m.NYRRRunnerName != ''
              AND er.nyrr_event_id = %s
        """, (event_id,))
        t1_matched = cursor.rowcount

        with _jobs_lock:
            _jobs[event_code]['message'] = f'Tier 1: {t1_matched} matched. Running Tier 2 (first/last name)...'

        # Tier 2: Match by first + last name when exactly one member matches
        cursor.execute("""
            UPDATE nyrr_event_runners er
            INNER JOIN (
                SELECT LOWER(TRIM(FirstName)) AS fn, LOWER(TRIM(LastName)) AS ln,
                       MAX(MemberID) AS MemberID
                FROM members
                WHERE FirstName IS NOT NULL AND FirstName != ''
                  AND LastName IS NOT NULL AND LastName != ''
                GROUP BY LOWER(TRIM(FirstName)), LOWER(TRIM(LastName))
                HAVING COUNT(*) = 1
            ) uniq ON LOWER(TRIM(er.first_name)) = uniq.fn
                  AND LOWER(TRIM(er.last_name)) = uniq.ln
            SET er.mmr_member_id = uniq.MemberID,
                er.match_method = 'auto_firstlast',
                er.matched_by = 'Viewer',
                er.matched_at = NOW()
            WHERE er.mmr_member_id IS NULL
              AND er.first_name IS NOT NULL AND er.first_name != ''
              AND er.last_name IS NOT NULL AND er.last_name != ''
              AND er.nyrr_event_id = %s
        """, (event_id,))
        t2_matched = cursor.rowcount
        total_matched = t1_matched + t2_matched

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
                mmr_matched_count = (
                    SELECT COUNT(*) FROM nyrr_event_runners
                    WHERE nyrr_event_id = %s AND mmr_member_id IS NOT NULL
                ),
                processed_at = NOW()
            WHERE id = %s
        """, (event_id, event_id, TEAM_CODE, event_id, event_id))

        # Log
        cursor.execute("""
            INSERT INTO nyrr_processing_log
                (nyrr_event_id, triggered_by, run_status, rows_written)
            VALUES (%s, 'Viewer', 'Success', %s)
        """, (event_id, rows_written))

        conn.commit()
        cursor.close()

        msg = f'Done! {rows_written} runners loaded, {total_matched} auto-matched.'
        if force_reload:
            msg = f'Re-synced: deleted {deleted_count} rows, loaded {rows_written} runners, {total_matched} auto-matched.'

        with _jobs_lock:
            _jobs[event_code] = {
                'status': 'done',
                'rows_written': rows_written,
                'scope': scope,
                'auto_matched': total_matched,
                'message': msg,
                'finished_at': datetime.utcnow().isoformat(),
            }

    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
            try:
                cur2 = conn.cursor()
                cur2.execute("""
                    UPDATE nyrr_events
                    SET processing_status = 'Error', notes = %s
                    WHERE id = %s
                """, (str(e)[:500], event_id))
                cur2.execute("""
                    INSERT INTO nyrr_processing_log
                        (nyrr_event_id, triggered_by, run_status, rows_written, error_details)
                    VALUES (%s, 'Viewer', 'Failed', 0, %s)
                """, (event_id, str(e)[:2000]))
                conn.commit()
                cur2.close()
            except Exception:
                pass

        with _jobs_lock:
            _jobs[event_code] = {
                'status': 'error',
                'scope': scope,
                'message': str(e),
                'finished_at': datetime.utcnow().isoformat(),
            }
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass
