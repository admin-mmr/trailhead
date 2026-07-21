"""
Helpers for sync_worker.py — job registry, slug resolution, and read-only
job-state getters.

Split out of sync_worker.py (CLAUDE.md 400-LOC hard rule). The in-flight job
registry (`_jobs` / `_jobs_lock`) lives here so the read-only status getters can
own it; sync_worker.py re-imports both objects so the background worker mutates
the same dict. No behavior change.
"""

from __future__ import annotations

import logging
import re as _re
import threading
from typing import Any, Dict

from nyrr_api import NyrrApiClient
from nyrr_api_models import NyrrEvent

logger = logging.getLogger(__name__)

# In-flight jobs (event_code -> status dict). Defined here (not in sync_worker)
# so the status getters below and the background worker in sync_worker.py share
# the exact same dict object via a plain import.
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
# Job progress + read-only status getters (public API)
# ---------------------------------------------------------------------------

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
