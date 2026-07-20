"""
NYRR request throttle + rate-limit telemetry.

Split out of nyrr_api.py (CLAUDE.md <400 LOC rule). Owns the single
process-wide lock/timestamp that serializes ALL NYRR traffic — the one global
throttle that stops probe storms (divide-and-conquer) and concurrent callers
(weekly sync + manual Load + Probe All) from bursting the API into a 429 — plus
the rate-limit telemetry the admin Sync Activity rail reads via
get_throttle_stats().

NyrrApiClient (in nyrr_api.py) delegates to throttle_wait() / stat_bump() here;
all state is module-level so every client instance and thread shares it.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Dict

# Status codes worth retrying with backoff (transient server / rate-limit).
RETRYABLE_STATUS = {429, 500, 502, 503, 504}

# Process-wide throttle state. A single lock + timestamp shared by every
# NyrrApiClient instance and every thread, so all NYRR traffic is serialized to
# at most one request per ``min_interval`` regardless of how many loaders/probes
# are running.
_THROTTLE_LOCK = threading.Lock()
_LAST_REQUEST_TS = 0.0

# Process-wide rate-limit telemetry, read by the admin Sync Activity rail via
# get_throttle_stats(). Mutated only under _THROTTLE_LOCK. `in_backoff` counts
# requests currently sleeping on a retry — >0 means we're actively being
# rate-limited right now.
_STATS = {
    "total_requests":  0,
    "total_retries":   0,
    "total_429":       0,
    "last_429_at":     None,   # epoch seconds (time.time())
    "last_request_at": None,   # epoch seconds
    "in_backoff":      0,
}


def stat_bump(**deltas) -> None:
    """Apply integer deltas / value sets to _STATS under the lock."""
    with _THROTTLE_LOCK:
        for k, v in deltas.items():
            if k in ("last_429_at", "last_request_at"):
                _STATS[k] = v
            else:
                _STATS[k] += v


def throttle_wait(min_interval: float) -> None:
    """Block until at least ``min_interval`` has elapsed since the last NYRR
    request made by ANY client/thread in this process. Holding the lock across
    the sleep is intentional: it serializes all NYRR traffic, so a probe storm
    or two concurrent loaders can never burst the API."""
    global _LAST_REQUEST_TS
    with _THROTTLE_LOCK:
        wait = min_interval - (time.monotonic() - _LAST_REQUEST_TS)
        if wait > 0:
            time.sleep(wait)
        _LAST_REQUEST_TS = time.monotonic()
        _STATS["total_requests"]  += 1
        _STATS["last_request_at"]  = time.time()


def get_throttle_stats() -> Dict[str, Any]:
    """Snapshot of process-wide NYRR rate-limit telemetry for the activity rail.

    Adds derived fields: ``last_429_age_sec`` (None if never) and ``health``
    ('backing_off' if currently retrying or a 429 hit in the last 30s, else
    'healthy')."""
    with _THROTTLE_LOCK:
        s = dict(_STATS)
    now = time.time()
    age = (now - s["last_429_at"]) if s["last_429_at"] else None
    s["last_429_age_sec"] = round(age, 1) if age is not None else None
    s["health"] = "backing_off" if (s["in_backoff"] > 0 or (age is not None and age < 30)) else "healthy"
    return s
