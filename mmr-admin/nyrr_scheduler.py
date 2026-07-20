"""
In-app NYRR automation scheduler (runs on the Azure App Service that hosts
mmr-admin — replaces the deleted GitHub Actions NYRR sync workflow).

Two scheduled jobs:
  • monthly  — discover new races via events/search (rmsprodapi.nyrr.org).
               NOTE: the Haku widget / nyrr.org itself sit behind Queue-it bot
               protection that 403s/redirects server-to-server requests no
               matter the API key, so it can't be the discovery source here —
               events/search is the only endpoint that actually works
               unattended, at the cost of shorter lead time (it only lists a
               race once NYRR posts it toward results, not months ahead).
  • weekly   — the "expensive" pipeline: promote past upcoming events, load
               finisher data for every Pending past event (sequential, reusing
               the tested sync_worker), then reconcile slug-coded event codes.

Enable in production by setting env  ENABLE_NYRR_SCHEDULER=1  on the App
Service. It is OFF by default so local dev and import tests never schedule.

Single-instance safety:
  • A process-level file lock ensures only ONE gunicorn worker starts the
    scheduler (default gunicorn spawns several workers per instance).
  • APScheduler runs with max_instances=1 + coalesce, so a job never overlaps
    itself.
  NOTE: if the App Service is ever scaled out to multiple INSTANCES, add a
  DB-based lease (e.g. GET_LOCK on a dedicated connection or a locks table)
  around run_* — the file lock only guards workers within one instance.
"""

from __future__ import annotations

import os
import time
import atexit
import logging
import threading
logger = logging.getLogger(__name__)

# Schedules (overridable via env). Defaults: 1st of month 06:00 UTC discovery;
# Tuesdays 02:00 UTC finisher pipeline (matches the old GitHub cron).
DISCOVERY_CRON = os.environ.get("NYRR_DISCOVERY_CRON", "0 6 1 * *")
FINISHER_CRON = os.environ.get("NYRR_FINISHER_CRON", "0 2 * * 2")

# Per-event completion states reported by sync_worker.get_job_status().
_TERMINAL = {"done", "complete", "error", "cancelled", "canceled"}
_LOCK_PATH = "/tmp/nyrr_scheduler.lock"
_lock_fh = None  # kept open for process lifetime to hold the flock


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------

def run_discovery():
    """Monthly: discover new races via events/search."""
    from api_events_discovery import discover_current_events
    logger.info("[scheduler] discovery start")
    try:
        result = discover_current_events()
        logger.info("[scheduler] discovery done: %s", result)
    except Exception:
        logger.exception("[scheduler] discovery failed")


def run_finisher_pipeline():
    """Weekly: promote completed events, load all Pending past events, reconcile."""
    from db import query, execute
    from sync_worker import start_sync, get_job_status

    logger.info("[scheduler] finisher pipeline start")
    try:
        # 1) Promote upcoming events whose date has passed → eligible for loading.
        execute(
            "UPDATE nyrr_events SET is_upcoming = 0 "
            "WHERE is_upcoming = 1 AND event_date IS NOT NULL AND event_date < CURDATE()"
        )

        # 2) Load finisher data for every Pending, past-dated event (sequential).
        pending = query(
            "SELECT id, event_code FROM nyrr_events "
            "WHERE processing_status = 'Pending' AND is_upcoming = 0 "
            "AND event_date IS NOT NULL AND event_date < CURDATE() "
            "ORDER BY event_date DESC"
        )
        logger.info("[scheduler] %d pending past events to load", len(pending))
        for ev in pending:
            loaded = _load_one_blocking(
                ev["id"], ev["event_code"], start_sync, get_job_status)
            # 2b) Auto-match finishers ↔ MMR members for events that loaded
            # results. Mirrors the CLI weekly pipeline (run_auto_matcher) and the
            # UI /automatch button so unattended runs are end-to-end (Tier 1+2;
            # Tier 4 fuzzy stays a separate on-demand background job).
            if loaded:
                _automatch_one(ev["id"], ev["event_code"])

        # 3) Resolve any slug-coded event codes now that results exist.
        try:
            from sync_worker_reconcile import reconcile_slug_event_codes
            rec = reconcile_slug_event_codes()
            logger.info("[scheduler] reconcile: %s", rec)
        except Exception:
            logger.exception("[scheduler] reconcile step failed (non-fatal)")

        logger.info("[scheduler] finisher pipeline done")
    except Exception:
        logger.exception("[scheduler] finisher pipeline failed")


def _load_one_blocking(event_id, event_code, start_sync, get_job_status,
                       poll_secs=10, max_wait_secs=3600):
    """Start a single-event sync and block until it reaches a terminal state.
    Returns True only if the event loaded results successfully (done/complete);
    False on error/cancelled/timeout, so the caller can skip auto-matching an
    event with no fresh finisher rows."""
    logger.info("[scheduler] loading %s (id=%s)", event_code, event_id)
    start_sync(event_id, event_code)
    waited = 0
    while waited < max_wait_secs:
        time.sleep(poll_secs)
        waited += poll_secs
        job = get_job_status(event_code)
        if not job:
            continue
        status = job.get("status")
        if status in _TERMINAL:
            logger.info("[scheduler]   %s → %s", event_code, status)
            return status in ("done", "complete")
    logger.warning("[scheduler]   %s timed out after %ss", event_code, max_wait_secs)
    return False


def _automatch_one(event_id, event_code):
    """Run Tier-1/Tier-2 auto-match for one loaded event (best-effort; a match
    failure must not abort the whole pipeline)."""
    try:
        from api_events import run_event_automatch
        res = run_event_automatch(event_id)
        logger.info("[scheduler]   %s auto-matched %s runner(s)",
                    event_code, res.get("matched", 0))
    except Exception:
        logger.exception("[scheduler]   %s auto-match failed (non-fatal)", event_code)


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

def _acquire_process_lock() -> bool:
    """Return True if this process won the single-scheduler lock (non-blocking)."""
    global _lock_fh
    try:
        import fcntl
        _lock_fh = open(_LOCK_PATH, "w")
        fcntl.flock(_lock_fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except (OSError, ImportError):
        if _lock_fh:
            _lock_fh.close()
            _lock_fh = None
        return False


def init_scheduler():
    """Start the background scheduler once, in a single worker. No-op unless
    ENABLE_NYRR_SCHEDULER is truthy. Safe to call at import time."""
    if os.environ.get("ENABLE_NYRR_SCHEDULER", "").lower() not in ("1", "true", "yes"):
        logger.info("[scheduler] disabled (set ENABLE_NYRR_SCHEDULER=1 to enable)")
        return None

    if not _acquire_process_lock():
        logger.info("[scheduler] another worker owns the scheduler; skipping")
        return None

    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.cron import CronTrigger
    except ImportError:
        logger.error("[scheduler] APScheduler not installed; scheduler not started")
        return None

    sched = BackgroundScheduler(
        timezone="UTC",
        job_defaults={"max_instances": 1, "coalesce": True, "misfire_grace_time": 3600},
    )
    sched.add_job(run_discovery, CronTrigger.from_crontab(DISCOVERY_CRON),
                  id="nyrr_discovery", replace_existing=True)
    sched.add_job(run_finisher_pipeline, CronTrigger.from_crontab(FINISHER_CRON),
                  id="nyrr_finisher", replace_existing=True)
    sched.start()
    atexit.register(lambda: sched.shutdown(wait=False))
    logger.info("[scheduler] started — discovery '%s', finisher '%s'",
                DISCOVERY_CRON, FINISHER_CRON)
    return sched
