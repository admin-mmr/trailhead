"""
NYRR Event Sync Worker — orchestration shell for three-step background sync.

Step 1 (finisher fetch + divide-and-conquer) → sync_worker_fetch.py
Step 3 (team-code backfill)                  → sync_worker_backfill.py
This file: slug resolution, job state, Steps 2+3 calls, cancellation, error handling.
"""

from __future__ import annotations

import logging
import re as _re
import threading
import time
import traceback
from datetime import datetime
from typing import Any, Dict

from db import query, get_conn, execute
from nyrr_api import NyrrApiClient
from nyrr_api_models import NyrrEvent
from sync_worker_fetch import FinisherFetcher
from sync_worker_backfill import TeamBackfiller

logger = logging.getLogger(__name__)

# In-flight jobs (event_code -> status dict)
_jobs: Dict[str, Dict[str, Any]] = {}
_jobs_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Slug → canonical code resolution (Bug D)
# ---------------------------------------------------------------------------

def _resolve_slug_to_event(client: NyrrApiClient, slug: str,
                            event_name: str, event_year: int) -> NyrrEvent | None:
    """Resolve a Haku URL slug (e.g. 'rbc-brooklyn-half') to the canonical
    NyrrEvent record from NYRR's events/search.

    Returns the full NyrrEvent (so callers can sync ALL derived fields, not
    just event_code), or None if no confident match found. A slug is detected
    by the presence of hyphens — canonical codes never have them.
    """
    if '-' not in slug:
        return None

    logger.info(f"🔍 Slug detected ({slug!r}) — resolving via events/search for year={event_year}")
    try:
        events = client.search_events(year=event_year)
    except Exception as e:
        logger.warning(f"  └─ events/search failed: {e}")
        return None

    if not events:
        return None

    def _norm(s: str) -> str:
        return _re.sub(r'[^a-z0-9 ]', '', s.lower()).strip()

    slug_words = set(_norm(slug.replace('-', ' ')).split())
    name_words = set(_norm(event_name).split()) if event_name else set()
    query_words = slug_words | name_words

    best_ev, best_score = None, 0.0
    for ev in events:
        ev_words = set(_norm(ev.event_name).split())
        if not ev_words:
            continue
        overlap = len(query_words & ev_words) / max(len(query_words), len(ev_words))
        if overlap > best_score:
            best_score, best_ev = overlap, ev

    THRESHOLD = 0.4
    if best_ev and best_score >= THRESHOLD:
        logger.info(f"  └─ Resolved {slug!r} → {best_ev.event_code!r} (score={best_score:.2f})")
        return best_ev

    logger.warning(f"  └─ Could not resolve {slug!r}: best score {best_score:.2f} < {THRESHOLD}")
    return None


# Backwards-compat shim — older callers (and tests) may import the original name.
def _resolve_slug_to_canonical(client: NyrrApiClient, slug: str,
                                event_name: str, event_year: int) -> str | None:
    ev = _resolve_slug_to_event(client, slug, event_name, event_year)
    return ev.event_code if ev else None


# ---------------------------------------------------------------------------
# Background worker
# ---------------------------------------------------------------------------

def _sync_worker(event_id: int, event_code: str, force_reload: bool, mmr_only: bool = False) -> None:
    """Background thread: three-step sync for one NYRR event."""
    logger.info(f"🚀 Sync worker started: event_id={event_id}, event_code={event_code}, force_reload={force_reload}, mmr_only={mmr_only}")
    start_time = time.time()
    client = NyrrApiClient()
    conn = None

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
        # --- Slug resolution (Bug D) ---
        if '-' in event_code:
            ev_meta  = query("SELECT event_name, event_year FROM nyrr_events WHERE id = %s", [event_id])
            ev_name  = ev_meta[0]['event_name'] if ev_meta else ''
            ev_year  = ev_meta[0]['event_year'] if ev_meta else 0
            canonical = _resolve_slug_to_canonical(client, event_code, ev_name, ev_year)
            if canonical:
                # Bug L: also rewrite event_url to the canonical results page so
                # a human (and downstream reconciliation tooling) lands on the
                # right NYRR URL. Use the same format as sync_nyrr_discovery.
                new_url = f"https://results.nyrr.org/event/{canonical}/finishers"
                logger.info(f"✅ Slug resolved: DB {event_code!r} → {canonical!r}; event_url → {new_url}")
                execute(
                    "UPDATE nyrr_events "
                    "   SET event_code = %s, event_url = %s, "
                    "       notes = CONCAT(IFNULL(notes,''), ' [reconciled: slug→canonical ', %s, ']') "
                    " WHERE id = %s",
                    [canonical, new_url, event_code, event_id],
                )
                with _jobs_lock:
                    _jobs[canonical] = _jobs.pop(event_code)
                    _jobs[canonical]['message'] = f'Slug resolved to {canonical!r}, starting sync...'
                event_code = canonical
            elif '-' in event_code:
                # Resolution failed and we still hold a slug. If event_date has
                # already passed, the fetch is guaranteed to return 0 finishers
                # — bail out early (Bug L verification) rather than burn API
                # calls + risk a destructive force_reload delete.
                ev_date_row = query(
                    "SELECT event_date FROM nyrr_events WHERE id = %s",
                    [event_id],
                )
                ev_date = ev_date_row[0]['event_date'] if ev_date_row else None
                if ev_date and ev_date < datetime.utcnow().date():
                    msg = (
                        f"Slug {event_code!r} could not be resolved to a canonical "
                        f"NYRR eventCode and event_date={ev_date} is in the past. "
                        f"Aborting sync to avoid wiping data with an empty fetch. "
                        f"Try `POST /api/discover/reconcile-slugs` or `python "
                        f"sync_nyrr_events.py --mode reconcile --include-upcoming`."
                    )
                    logger.error(f"❌ {msg}")
                    with _jobs_lock:
                        _jobs[event_code].update({
                            'status':     'error',
                            'message':    msg[:500],
                            'error_type': 'UnresolvedSlug',
                            'step':       'slug_resolution',
                            'finished_at': datetime.utcnow().isoformat(),
                        })
                    _db_log_error(event_id, msg)
                    return
                logger.warning(
                    f"⚠️  Slug {event_code!r} did NOT resolve to canonical — "
                    f"event is upcoming, will retry on next run"
                )
                with _jobs_lock:
                    _jobs[event_code]['message'] = (
                        f"Slug {event_code!r} unresolved — proceeding anyway; "
                        f"expect 0 finishers until canonical code is published."
                    )

        # --- Step 1: Fetch and upsert finishers ---
        logger.info("⏱️  STEP 1: Starting finishers fetch & upsert...")
        step1_start = time.time()
        with _jobs_lock:
            _jobs[event_code]['step'] = 'step1_finishers'
            _jobs[event_code]['message'] = 'Step 1: Fetching and upserting finishers from NYRR API...'

        conn = get_conn()
        conn.autocommit = False
        cursor = conn.cursor()

        fetcher = FinisherFetcher(client, event_id, event_code, conn, cursor, _jobs, _jobs_lock)
        rows_written, total_finishers = fetcher.run(force_reload, mmr_only=mmr_only)

        step1_elapsed = time.time() - step1_start
        logger.info(f"✅ STEP 1 complete: {rows_written} rows in {step1_elapsed:.2f}s "
                    f"({fetcher.pages_written} pages)")
        cursor.close()
        conn.close()
        conn = None

        if mmr_only:
            elapsed = time.time() - start_time
            logger.info(f"✅ MMR-ONLY COMPLETE: {rows_written} MMR runners in {elapsed:.2f}s")
            with _jobs_lock:
                _jobs[event_code]['status'] = 'done'
                _jobs[event_code]['step'] = 'complete'
                _jobs[event_code]['message'] = f'MMR-only sync complete: {rows_written} MMR runners loaded'
                _jobs[event_code]['finished_at'] = datetime.utcnow().isoformat()
                _jobs[event_code]['total_elapsed_sec'] = elapsed
            _db_final_status(event_id, event_code, 'Completed',
                             f'MMR-only sync: {rows_written} runners', 'Success',
                             rows_written, rows_written, 0, int(elapsed))
            return

        # --- Step 2: Enumerate all teams ---
        logger.info("⏱️  STEP 2: Fetching team list...")
        step2_start = time.time()
        with _jobs_lock:
            _jobs[event_code]['step'] = 'step2_teams'
            _jobs[event_code]['message'] = 'Step 2: Fetching team list...'

        teams = client.search_teams(event_code)
        step2_elapsed = time.time() - step2_start
        logger.info(f"✅ STEP 2 complete: {len(teams)} teams in {step2_elapsed:.2f}s")
        with _jobs_lock:
            _jobs[event_code]['message'] = f'Step 2 complete: {len(teams)} teams. Backfilling team_code...'
            _jobs[event_code]['step2_elapsed_sec'] = step2_elapsed
            _jobs[event_code]['teams_total'] = len(teams)

        # --- Step 3: Backfill team_code ---
        logger.info("⏱️  STEP 3: Backfilling team_code...")
        step3_start = time.time()
        with _jobs_lock:
            _jobs[event_code]['step'] = 'step3_backfill'

        backfiller = TeamBackfiller(client, event_id, event_code)

        total_backfilled = total_inserted = 0
        teams_skipped = 0
        for idx, team in enumerate(teams, 1):
            team_code = team.team_code
            nyrr_count = team.runners_count
            with _jobs_lock:
                _jobs[event_code]['message'] = f'Step 3: Processing team {idx}/{len(teams)}: {team_code}...'
                _jobs[event_code]['teams_processed'] = idx
            try:
                # Reconciliation: skip if MySQL already has the expected runner count
                if nyrr_count > 0:
                    row = query(
                        "SELECT COUNT(*) as cnt FROM nyrr_event_runners "
                        "WHERE nyrr_event_id = %s AND team_code = %s",
                        (event_id, team_code)
                    )
                    mysql_count = row[0]['cnt'] if row else 0
                    if mysql_count == nyrr_count:
                        logger.info(f"  [{idx}/{len(teams)}] ⏭️  {team_code}: {nyrr_count} runners already in DB, skipping")
                        teams_skipped += 1
                        continue
                    logger.info(f"  [{idx}/{len(teams)}] {team_code}: MySQL={mysql_count} vs NYRR={nyrr_count}, fetching...")
                else:
                    logger.info(f"  [{idx}/{len(teams)}] {team_code}: runners_count=0 from teams/search, fetching anyway")

                all_runners = client.get_team_runners(event_code, team_code)
                u, i = backfiller._process_team(team_code, all_runners)
                total_backfilled += u
                total_inserted   += i
            except Exception as team_err:
                logger.error(f"  └─ Error processing team {team_code}: {team_err}")
            with _jobs_lock:
                if _jobs.get(event_code, {}).get('cancel_requested'):
                    raise InterruptedError("Sync cancelled by user")

        step3_elapsed = time.time() - step3_start
        logger.info(f"✅ STEP 3 complete: {total_backfilled} backfilled, {total_inserted} inserted, {teams_skipped} skipped in {step3_elapsed:.2f}s")

        # --- Final status ---
        final_count = query(f"SELECT COUNT(*) as cnt FROM nyrr_event_runners WHERE nyrr_event_id = {event_id}")
        final_count_val = final_count[0]['cnt'] if final_count else 0
        elapsed = time.time() - start_time
        logger.info(f"✅ ALL STEPS COMPLETE in {elapsed:.2f}s")

        with _jobs_lock:
            if rows_written > 0:
                _jobs[event_code]['status'] = 'done'
                _jobs[event_code]['message'] = (
                    f'Sync complete: {rows_written} runners, {len(teams)} teams, {total_backfilled} assignments'
                )
            else:
                _jobs[event_code]['status'] = 'error'
                _jobs[event_code]['message'] = (
                    f'NYRR returned 0 finishers for eventCode={event_code!r}. '
                    f'Check event_code format (slug vs canonical).'
                )
                _jobs[event_code]['error_type'] = 'EmptyApiResponse'
            _jobs[event_code].update({
                'step': 'complete',
                'finished_at': datetime.utcnow().isoformat(),
                'total_elapsed_sec': elapsed,
                'final_count': final_count_val,
            })

        # Persist final status to DB
        if rows_written > 0:
            final_status, final_notes, log_status = 'Completed', 'Sync completed successfully', 'Success'
        else:
            final_status = 'Error'
            final_notes = (
                f"NYRR API returned 0 finishers for eventCode={event_code!r}. "
                f"Likely cause: event_code stored as URL slug. Verify with probe_finishers.py."
            )
            log_status = 'Failed'
            logger.warning(f"⚠️  Marking event as 'Error': rows_written=0 for {event_code}")

        _db_final_status(event_id, event_code, final_status, final_notes,
                         log_status, final_count_val, rows_written, len(teams), int(elapsed))

    except (InterruptedError, KeyboardInterrupt):
        elapsed = time.time() - start_time
        logger.info(f"🛑 Sync cancelled after {elapsed:.2f}s")
        with _jobs_lock:
            _jobs[event_code].update({
                'status': 'cancelled',
                'message': f'Sync cancelled by user after {elapsed:.2f}s',
                'finished_at': datetime.utcnow().isoformat(),
                'total_elapsed_sec': elapsed,
            })
        _db_log_cancellation(event_id)

    except Exception as e:
        elapsed = time.time() - start_time
        logger.error(f"❌ Sync FAILED after {elapsed:.2f}s: {type(e).__name__}: {e}")
        logger.error(traceback.format_exc())
        error_msg = f"{type(e).__name__}: {str(e)[:200]}"
        with _jobs_lock:
            _jobs[event_code].update({
                'status': 'error',
                'message': error_msg[:500],
                'finished_at': datetime.utcnow().isoformat(),
                'total_elapsed_sec': elapsed,
                'error_type': type(e).__name__,
            })
        _db_log_error(event_id, str(e))

    finally:
        if conn:
            try:
                conn.close()
            except Exception as close_err:
                logger.warning(f"  └─ Error closing final DB connection: {close_err}")


# ---------------------------------------------------------------------------
# DB persistence helpers (keep _sync_worker slim)
# ---------------------------------------------------------------------------

def _db_final_status(event_id, event_code, status, notes, log_status,
                     final_count, rows_written, team_count, elapsed_sec):
    try:
        execute("""
            UPDATE nyrr_events
               SET processing_status = %s, nyrr_finisher_count = %s, notes = %s
             WHERE id = %s
        """, (status, final_count, notes, event_id))
        execute("""
            INSERT INTO nyrr_processing_log
              (nyrr_event_id, triggered_by, run_status, rows_written, teams_processed, elapsed_sec, error_details)
            VALUES (%s, 'Viewer', %s, %s, %s, %s, %s)
        """, (event_id, log_status, rows_written, team_count, elapsed_sec,
              None if rows_written > 0 else notes))
    except Exception as e:
        logger.error(f"  └─ Warning: failed to update final status in DB: {e}")


def _db_log_cancellation(event_id):
    conn2 = None
    try:
        conn2 = get_conn()
        cur2  = conn2.cursor()
        cur2.execute(
            "UPDATE nyrr_events SET processing_status = 'Cancelled', notes = 'User cancelled' WHERE id = %s",
            (event_id,)
        )
        cur2.execute("""
            INSERT INTO nyrr_processing_log (nyrr_event_id, triggered_by, run_status, error_details)
            VALUES (%s, 'Viewer', 'Cancelled', 'User requested cancellation')
        """, (event_id,))
        conn2.commit()
        cur2.close()
    except Exception as e:
        logger.error(f"  └─ Failed to log cancellation: {e}")
    finally:
        if conn2:
            try:
                conn2.close()  # always return slot to pool
            except Exception as close_err:
                logger.warning(f"  └─ Error closing cancellation DB connection: {close_err}")


def _db_log_error(event_id, error_str):
    conn2 = None
    try:
        conn2 = get_conn()
        cur2  = conn2.cursor()
        cur2.execute(
            "UPDATE nyrr_events SET processing_status = 'Error', notes = %s WHERE id = %s",
            (error_str[:500], event_id)
        )
        cur2.execute("""
            INSERT INTO nyrr_processing_log (nyrr_event_id, triggered_by, run_status, rows_written, error_details)
            VALUES (%s, 'Viewer', 'Failed', 0, %s)
        """, (event_id, error_str[:2000]))
        conn2.commit()
        cur2.close()
    except Exception as e:
        logger.error(f"  └─ Failed to log error: {e}")
    finally:
        if conn2:
            try:
                conn2.close()  # always return slot to pool
            except Exception as close_err:
                logger.warning(f"  └─ Error closing error-log DB connection: {close_err}")


# ---------------------------------------------------------------------------
# Public API (called from api_sync.py / Flask routes)
# ---------------------------------------------------------------------------

def start_sync(event_id: int, event_code: str, force_reload: bool = False, mmr_only: bool = False) -> None:
    """Spawn the background sync thread for one event."""
    t = threading.Thread(
        target=_sync_worker,
        args=(event_id, event_code, force_reload, mmr_only),
        daemon=True,
    )
    t.start()


def _compute_progress(job: Dict[str, Any]) -> int | None:
    """Best-effort overall completion percentage (0-100) for a sync job.

    The three steps are weighted so the bar advances monotonically:
      step 1 (finishers fetch) → 0-70%   (rows_written / nyrr_finisher_count)
      step 2 (team list)       → ~72%    (brief, indeterminate)
      step 3 (team backfill)   → 75-99%  (teams_processed / teams_total)
      done / complete          → 100%

    Returns None when we genuinely can't estimate (so the UI can show an
    indeterminate spinner instead of a misleading 0%).
    """
    status = job.get('status')
    if status in ('done', 'complete'):
        return 100
    if status in ('error', 'cancelled'):
        return None

    step = job.get('step') or ''

    if 'step1' in step:
        total = job.get('nyrr_finisher_count') or 0
        written = job.get('rows_written') or 0
        if total > 0:
            return max(1, min(70, round(written / total * 70)))
        return None  # total not probed yet → indeterminate
    if 'step2' in step:
        return 72
    if 'step3' in step:
        total = job.get('teams_total') or 0
        done = job.get('teams_processed') or 0
        if total > 0:
            return min(99, 75 + round(done / total * 24))
        return 75
    if step in ('init', 'slug_resolution', ''):
        return 1
    return None


def get_job_status(event_code: str) -> Dict[str, Any] | None:
    """Return a copy of the in-flight job status dict, or None."""
    with _jobs_lock:
        job = _jobs.get(event_code)
        if not job:
            return None
        snap = dict(job)
        snap['progress_pct'] = _compute_progress(snap)
        return snap


def get_all_jobs(active_only: bool = True) -> list[Dict[str, Any]]:
    """Snapshot of all known sync jobs in this process (for the activity rail).

    active_only=True returns just jobs still running. Each dict gains an
    'event_code' key so the caller doesn't need the registry key separately.
    """
    with _jobs_lock:
        out = []
        for code, job in _jobs.items():
            if active_only and job.get('status') != 'running':
                continue
            entry = {'event_code': code, **job}
            entry['progress_pct'] = _compute_progress(entry)
            out.append(entry)
        return out


def cancel_job(event_code: str) -> bool:
    """Request cancellation for a running job. Returns True if job found."""
    with _jobs_lock:
        job = _jobs.get(event_code)
        if job and job.get('status') == 'running':
            job['cancel_requested'] = True
            return True
    return False
