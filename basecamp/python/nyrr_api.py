"""
NYRR API Client

Python port of web-apps/gas/nyrr/src/nyrrApi.ts — the Google Apps Script
client for the undocumented results.nyrr.org API (v2).

All endpoints use POST with JSON bodies.  The API was reverse-engineered
from the results.nyrr.org frontend and the open-source nyrr-results-api
package (https://github.com/tedbrakob/nyrr-results-api).

Covers every endpoint in Section 3 of nyrr-backend-migration-plan.docx:
  3.1 Events     — search_events, get_event_details
  3.2 Runners    — get_event_finishers, get_runner_races, get_runner_details,
                   get_runner_profile
  3.3 Teams      — search_teams, get_team_runners
  3.4 Awards     — get_team_awards, get_team_award_runners
  3.5 Standings  — get_standings_years, get_divisions_results,
                   get_division_results, get_teams

Layout (CLAUDE.md hard rule: keep each file <400 LOC):
  nyrr_api_models.py     — dataclasses + NyrrApiError
  nyrr_api_endpoints.py  — endpoint methods (mixin requires _post / _paginate)
  nyrr_api_throttle.py   — process-wide request throttle + rate-limit telemetry
  nyrr_api.py (this)     — HTTP helpers + the bound NyrrApiClient class
"""

from __future__ import annotations

import logging
import os
import random
import time
from typing import Any, Dict, List, Optional

import requests

# Re-export everything callers used to import from `nyrr_api` directly so the
# split is transparent to existing code:
#   from nyrr_api import NyrrApiClient, NyrrEvent, NyrrFinisher, NyrrRunnerRace
from nyrr_api_models import (  # noqa: F401  (intentional re-export)
    NyrrApiError,
    NyrrEvent,
    NyrrFinisher,
    NyrrRunnerDetails,
    NyrrRunnerProfile,
    NyrrRunnerRace,
    NyrrStandingsDivision,
    NyrrStandingsTeam,
    NyrrTeam,
    NyrrTeamAward,
    NyrrTeamAwardRunner,
)
from nyrr_api_endpoints import _NyrrEndpointsMixin
# Process-wide throttle + rate-limit telemetry (see nyrr_api_throttle). Imported
# here so `from nyrr_api import get_throttle_stats` keeps working (api_sync.py).
from nyrr_api_throttle import (  # noqa: F401  (get_throttle_stats re-exported)
    RETRYABLE_STATUS,
    get_throttle_stats,
    stat_bump,
    throttle_wait,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BASE_URL = "https://rmsprodapi.nyrr.org/api/v2"

DEFAULT_PAGE_SIZE = 51          # matches the GAS client / NYRR's apparent default
DEFAULT_SLEEP_SECONDS = 2.0     # polite delay between paginated requests
REQUEST_TIMEOUT = 30            # seconds

# --- Rate-limit / retry defaults (overridable via env or constructor) -------
# Minimum gap between ANY two NYRR requests *across the whole process*. This is
# the single global throttle that stops probe storms (divide-and-conquer) and
# concurrent callers (weekly sync + manual Load + Probe All) from bursting the
# API into a 429. Enforced under a module-level lock in _throttle().
DEFAULT_MIN_REQUEST_INTERVAL = float(os.environ.get("NYRR_MIN_REQUEST_INTERVAL", "0.5"))
DEFAULT_MAX_RETRIES = int(os.environ.get("NYRR_MAX_RETRIES", "5"))
DEFAULT_BACKOFF_BASE = float(os.environ.get("NYRR_BACKOFF_BASE", "2.0"))   # seconds
DEFAULT_BACKOFF_MAX = float(os.environ.get("NYRR_BACKOFF_MAX", "60.0"))    # seconds

# RETRYABLE_STATUS, the process-wide throttle lock/state, stat_bump() and
# get_throttle_stats() live in nyrr_api_throttle (imported above). This client
# just delegates to throttle_wait() / stat_bump().


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

class NyrrApiClient(_NyrrEndpointsMixin):
    """
    HTTP client for the NYRR Results API v2.

    Usage::

        client = NyrrApiClient()
        events = client.search_events(year=2026)
        finishers = client.get_event_finishers("26WASH")

    All methods that return lists handle pagination automatically and
    sleep between page requests to be polite to the API.

    Endpoint methods (search_events, get_event_finishers, ...) live in
    `nyrr_api_endpoints._NyrrEndpointsMixin`. This class owns the HTTP
    transport (_post, _paginate, _paginate_streaming) the mixin calls.
    """

    def __init__(
        self,
        base_url: str = BASE_URL,
        page_size: int = DEFAULT_PAGE_SIZE,
        sleep_seconds: float = DEFAULT_SLEEP_SECONDS,
        timeout: int = REQUEST_TIMEOUT,
        min_interval: float = DEFAULT_MIN_REQUEST_INTERVAL,
        max_retries: int = DEFAULT_MAX_RETRIES,
        backoff_base: float = DEFAULT_BACKOFF_BASE,
        backoff_max: float = DEFAULT_BACKOFF_MAX,
    ):
        self.base_url = base_url.rstrip("/")
        self.page_size = page_size
        self.sleep_seconds = sleep_seconds
        self.timeout = timeout
        self.min_interval = min_interval
        self.max_retries = max_retries
        self.backoff_base = backoff_base
        self.backoff_max = backoff_max
        self.session = requests.Session()
        self.session.headers.update({
            "Content-Type": "application/json",
            "Accept": "application/json",
        })

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _throttle(self) -> None:
        """Serialize this request behind the process-wide NYRR throttle (see
        nyrr_api_throttle.throttle_wait — a single lock/timestamp shared by all
        clients/threads so a probe storm can never burst the API)."""
        throttle_wait(self.min_interval)

    def _retry_delay(self, attempt: int, retry_after: Optional[str]) -> float:
        """Seconds to wait before retry ``attempt`` (0-based). Honors the
        server's Retry-After header when present, else exponential backoff with
        jitter, capped at ``backoff_max``."""
        if retry_after:
            try:
                return min(float(retry_after), self.backoff_max)
            except ValueError:
                pass
        delay = min(self.backoff_base * (2 ** attempt), self.backoff_max)
        return delay + random.uniform(0, delay * 0.25)  # jitter avoids thundering herd

    def _post(self, path: str, body: Dict[str, Any]) -> Any:
        """POST JSON to the API and return the parsed response.

        Every NYRR call funnels through here, so this is where the global
        throttle and 429/5xx retry-with-backoff live. Raises NyrrApiError after
        ``max_retries`` exhausted so callers see a clean, typed failure instead
        of a bare HTTPError."""
        url = f"{self.base_url}/{path.lstrip('/')}"
        logger.debug("POST %s  body=%s", url, body)

        attempt = 0
        while True:
            self._throttle()
            try:
                resp = self.session.post(url, json=body, timeout=self.timeout)
            except requests.RequestException as exc:
                if attempt >= self.max_retries:
                    raise NyrrApiError(f"POST {path} failed after {attempt} retries: {exc}") from exc
                delay = self._retry_delay(attempt, None)
                logger.warning("[api] %s network error (%s) — retry %d/%d in %.1fs",
                               path, exc, attempt + 1, self.max_retries, delay)
                stat_bump(total_retries=1, in_backoff=1)
                time.sleep(delay)
                stat_bump(in_backoff=-1)
                attempt += 1
                continue

            if resp.status_code in RETRYABLE_STATUS and attempt < self.max_retries:
                delay = self._retry_delay(attempt, resp.headers.get("Retry-After"))
                logger.warning("[api] %s -> HTTP %d — retry %d/%d in %.1fs",
                               path, resp.status_code, attempt + 1, self.max_retries, delay)
                stat_bump(total_retries=1, in_backoff=1,
                           **({"total_429": 1, "last_429_at": time.time()} if resp.status_code == 429 else {}))
                time.sleep(delay)
                stat_bump(in_backoff=-1)
                attempt += 1
                continue

            if resp.status_code in RETRYABLE_STATUS:
                raise NyrrApiError(
                    f"POST {path} still HTTP {resp.status_code} after {self.max_retries} retries"
                )
            resp.raise_for_status()
            return resp.json()

    def _paginate(
        self,
        path: str,
        body: Dict[str, Any],
        *,
        items_key: str = "items",
        total_key: str = "totalItems",
        dedup_key: Optional[str] = None,
        max_pages: int = 2000,
    ) -> List[Dict[str, Any]]:
        """
        Fetch all pages from a paginated POST endpoint.

        The NYRR API uses ``pageIndex`` (1-based) and ``pageSize`` for
        pagination.  Each response contains ``totalItems`` and ``items``.

        Args:
          dedup_key:  item field to use for deduplication (e.g. "runnerId").
                      When set, stops pagination if a page contains only items
                      already seen — detects the silent-loop bug where NYRR
                      returns exactly page_size items on every page (including
                      the last), so len(items) < page_size never fires.
          max_pages:  hard safety cap (default 2000) to prevent runaway loops.
        """
        all_items: List[Dict[str, Any]] = []
        seen_keys: set = set()
        page_index = 1

        while True:
            page_body = {**body, "pageIndex": page_index, "pageSize": self.page_size}
            data = self._post(path, page_body)

            items = data.get(items_key, [])
            total = data.get(total_key, 0)

            # Deduplication stop: if every item on this page was already seen,
            # the API is looping — stop now.
            if dedup_key and items:
                new_keys = {item.get(dedup_key) for item in items} - seen_keys
                if not new_keys:
                    logger.info(
                        "  [api] %s  page %d: all %d items already seen — "
                        "API loop detected, stopping. %d distinct items total.",
                        path, page_index, len(items), len(seen_keys),
                    )
                    break
                seen_keys.update(new_keys)
                new_count = len(new_keys)
            else:
                new_count = len(items)

            all_items.extend(items)

            # Display: show server total only when it's plausibly accurate
            # (NYRR caps totalItems at page_size for some endpoints)
            total_reliable = total > self.page_size
            est_pages = f"~{-(-total // self.page_size)}" if total_reliable else "?"
            logger.info(
                "  [api] %s  page %d/%s  +%d new (%d on page)  "
                "distinct so far: %d%s",
                path, page_index, est_pages, new_count, len(items), len(seen_keys) if dedup_key else len(all_items),
                f"  server_total={total}" if total_reliable else "",
            )

            # Primary stop: fewer items than requested → last page.
            if len(items) < self.page_size:
                break

            # Safety cap.
            if page_index >= max_pages:
                logger.warning(
                    "  [api] %s  hit max_pages=%d cap at %d items — stopping.",
                    path, max_pages, len(all_items),
                )
                break

            page_index += 1
            time.sleep(self.sleep_seconds)

        if total and total > self.page_size and len(all_items) != total:
            logger.info(
                "paginate %s: fetched %d items but server reported totalItems=%d",
                path, len(all_items), total,
            )

        return all_items

    def _paginate_streaming(
        self,
        path: str,
        body: Dict[str, Any],
        *,
        items_key: str = "items",
        total_key: str = "totalItems",
        progress_cb=None,  # optional callable(fetched: int, total: int)
    ):
        """
        Fetch all pages from a paginated POST endpoint, yielding each page.
        Useful for processing large datasets without buffering everything in memory.
        """
        cumulative = 0
        page_index = 1
        total = 0

        while True:
            page_body = {**body, "pageIndex": page_index, "pageSize": self.page_size}
            try:
                data = self._post(path, page_body)
            except requests.exceptions.HTTPError as e:
                # NYRR API returns 400 "Please use the advanced filter to find more"
                # when finishers-filter hits its ~500 result limit. This is expected.
                if e.response.status_code == 400:
                    logger.info(
                        "paginate_streaming %s: API limit reached at page %d (%d items fetched). "
                        "Stopping pagination gracefully.",
                        path, page_index, cumulative
                    )
                    break
                else:
                    raise

            items = data.get(items_key, [])
            total = data.get(total_key, 0)

            if not items:
                break

            cumulative += len(items)
            logger.debug(
                "paginate_streaming %s  page=%d  got=%d  cumulative=%d  server_total=%d",
                path, page_index, len(items), cumulative, total,
            )

            if progress_cb:
                progress_cb(cumulative, total)

            yield items  # Yield this page for processing

            # Stop conditions:
            # 1. If total is known and we've fetched that many, we're done (authoritative)
            # 2. Empty page always means no more data
            # NOTE: Don't stop on len(items) < page_size; NYRR may return fewer items mid-set
            if total and cumulative >= total:
                break

            page_index += 1
            time.sleep(self.sleep_seconds)

        if total and cumulative != total:
            logger.info(
                "paginate_streaming %s: fetched %d items but server reported totalItems=%d",
                path, cumulative, total,
            )


# ---------------------------------------------------------------------------
# Module-level convenience (matches GAS top-level function style)
# ---------------------------------------------------------------------------

_default_client: Optional[NyrrApiClient] = None


def get_client(**kwargs: Any) -> NyrrApiClient:
    """Return (or create) a module-level default client."""
    global _default_client
    if _default_client is None:
        _default_client = NyrrApiClient(**kwargs)
    return _default_client
