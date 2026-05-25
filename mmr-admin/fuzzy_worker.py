"""
NYRR Tier-4 fuzzy-match background worker.

Runs rapidfuzz token_set_ratio comparisons off the request thread so large
events (25k runners × 1.5k members ≈ 37M comparisons) don't OOM Azure.

Public API
----------
start_fuzzy_job(event_id)  → str   # job_key to poll
get_fuzzy_status(job_key)  → dict  # job status dict (copy)

Routes live in api_events_fuzzy.py.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime
from typing import Any, Dict, Optional

from db import query, get_conn

logger = logging.getLogger(__name__)

# In-flight + recent fuzzy jobs, keyed by str(event_id)
_fuzzy_jobs: Dict[str, Dict[str, Any]] = {}
_fuzzy_lock = threading.Lock()

FUZZY_THRESHOLD = 90   # token_set_ratio minimum
AGE_TOLERANCE   = 2    # years


def start_fuzzy_job(event_id: int) -> str:
    """Spawn a background fuzzy-match thread for event_id.

    Returns the job key (= str(event_id)). Idempotent: if a job is already
    running for this event, returns the existing key without spawning another.
    """
    key = str(event_id)
    with _fuzzy_lock:
        existing = _fuzzy_jobs.get(key, {})
        if existing.get('status') == 'running':
            return key  # already in flight

        _fuzzy_jobs[key] = {
            'status': 'running',
            'message': 'Starting Tier-4 fuzzy match…',
            'matched': 0,
            'skipped': 0,
            'started_at': datetime.utcnow().isoformat(),
            'finished_at': None,
        }

    t = threading.Thread(target=_fuzzy_worker, args=(event_id, key), daemon=True)
    t.start()
    return key


def get_fuzzy_status(job_key: str) -> Optional[Dict[str, Any]]:
    """Return a copy of the job status dict, or None if unknown."""
    with _fuzzy_lock:
        job = _fuzzy_jobs.get(job_key)
        return dict(job) if job else None


# ---------------------------------------------------------------------------
# Internal worker
# ---------------------------------------------------------------------------

def _fuzzy_worker(event_id: int, key: str) -> None:
    start = time.time()
    conn = None
    try:
        try:
            from rapidfuzz import fuzz as rfuzz
        except ImportError:
            _finish(key, error='rapidfuzz not installed — pip install rapidfuzz')
            return

        # Fetch unmatched runners
        unmatched = query("""
            SELECT id, runner_name, age
            FROM nyrr_event_runners
            WHERE nyrr_event_id = %s AND mmr_member_id IS NULL
        """, (event_id,)) or []

        if not unmatched:
            _finish(key, matched=0, message='No unmatched runners — nothing to do.')
            return

        _update(key, message=f'Fetched {len(unmatched)} unmatched runners, loading member list…')

        # Fetch candidate members
        members_raw = query("""
            SELECT MemberID,
                   CONCAT(COALESCE(FirstName,''), ' ', COALESCE(LastName,'')) AS full_name,
                   NYRRRunnerName,
                   COALESCE(YearBorn, YearBornGuess) AS birth_year
            FROM members
            WHERE Status IN ('active', 'expired', 'pending')
              AND FirstName IS NOT NULL AND FirstName != ''
              AND LastName  IS NOT NULL AND LastName  != ''
        """) or []
        mf_list = [dict(m) for m in members_raw]

        cur_year = __import__('datetime').date.today().year
        conn = get_conn()
        conn.autocommit = False
        cursor = conn.cursor()

        matched = 0
        skipped = 0

        for i, runner_row in enumerate(unmatched, 1):
            rname = (runner_row.get('runner_name') or '').strip()
            rage  = runner_row.get('age')
            if not rname:
                skipped += 1
                continue

            best_score   = 0
            best_matches: list = []

            for m in mf_list:
                fname = (m.get('full_name') or '').strip()
                if not fname:
                    continue

                # Age gate
                mbirth = m.get('birth_year')
                if rage is not None and mbirth is not None:
                    if abs(cur_year - mbirth - rage) > AGE_TOLERANCE:
                        continue

                score = rfuzz.token_set_ratio(rname.lower(), fname.lower())
                nyrr_name = (m.get('NYRRRunnerName') or '').strip()
                if nyrr_name:
                    score = max(score, rfuzz.token_set_ratio(rname.lower(), nyrr_name.lower()))

                if score > best_score:
                    best_score   = score
                    best_matches = [m]
                elif score == best_score and score >= FUZZY_THRESHOLD:
                    best_matches.append(m)

            if best_score >= FUZZY_THRESHOLD and len(best_matches) == 1:
                cursor.execute("""
                    UPDATE nyrr_event_runners
                    SET mmr_member_id    = %s,
                        match_method     = 'auto_fuzzy',
                        confidence_score = %s,
                        matched_by       = 'Viewer',
                        matched_at       = NOW()
                    WHERE id = %s AND mmr_member_id IS NULL
                """, (best_matches[0]['MemberID'], int(best_score), runner_row['id']))
                if cursor.rowcount > 0:
                    matched += 1

            # Progress heartbeat every 200 runners
            if i % 200 == 0:
                conn.commit()
                _update(key, message=f'Processing runner {i}/{len(unmatched)}… ({matched} matched so far)')

        # Update matched count on the event
        cursor.execute("""
            UPDATE nyrr_events
            SET mmr_matched_count = (
                SELECT COUNT(*) FROM nyrr_event_runners
                WHERE nyrr_event_id = %s AND mmr_member_id IS NOT NULL
            )
            WHERE id = %s
        """, (event_id, event_id))
        conn.commit()
        cursor.close()

        elapsed = time.time() - start
        _finish(key, matched=matched, skipped=skipped,
                message=f'Fuzzy match complete: {matched} matched, {skipped} skipped ({elapsed:.1f}s). '
                        f'Flagged as auto_fuzzy — review in Match Queue before treating as final.')

    except Exception as e:
        logger.exception("fuzzy_worker error for event_id=%s", event_id)
        if conn:
            conn.rollback()
        _finish(key, error=str(e)[:300])
    finally:
        if conn:
            conn.close()


def _update(key: str, **kwargs: Any) -> None:
    with _fuzzy_lock:
        if key in _fuzzy_jobs:
            _fuzzy_jobs[key].update(kwargs)


def _finish(key: str, error: str = '', matched: int = 0,
            skipped: int = 0, message: str = '') -> None:
    status = 'error' if error else 'done'
    with _fuzzy_lock:
        if key in _fuzzy_jobs:
            _fuzzy_jobs[key].update({
                'status': status,
                'matched': matched,
                'skipped': skipped,
                'message': error or message,
                'finished_at': datetime.utcnow().isoformat(),
            })
