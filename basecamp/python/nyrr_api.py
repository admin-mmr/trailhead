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
  nyrr_api.py (this)     — HTTP helpers + the bound NyrrApiClient class
"""

from __future__ import annotations

import logging
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

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BASE_URL = "https://rmsprodapi.nyrr.org/api/v2"

DEFAULT_PAGE_SIZE = 51          # matches the GAS client / NYRR's apparent default
DEFAULT_SLEEP_SECONDS = 2.0     # polite delay between paginated requests
REQUEST_TIMEOUT = 30            # seconds


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
    ):
        self.base_url = base_url.rstrip("/")
        self.page_size = page_size
        self.sleep_seconds = sleep_seconds
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({
            "Content-Type": "application/json",
            "Accept": "application/json",
        })

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _post(self, path: str, body: Dict[str, Any]) -> Any:
        """POST JSON to the API and return the parsed response."""
        url = f"{self.base_url}/{path.lstrip('/')}"
        logger.debug("POST %s  body=%s", url, body)

        resp = self.session.post(url, json=body, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def _paginate(
        self,
        path: str,
        body: Dict[str, Any],
        *,
        items_key: str = "items",
        total_key: str = "totalItems",
    ) -> List[Dict[str, Any]]:
        """
        Fetch all pages from a paginated POST endpoint.

        The NYRR API uses ``pageIndex`` (1-based) and ``pageSize`` for
        pagination.  Each response contains ``totalItems`` and ``items``.
        """
        all_items: List[Dict[str, Any]] = []
        page_index = 1

        while True:
            page_body = {**body, "pageIndex": page_index, "pageSize": self.page_size}
            data = self._post(path, page_body)

            items = data.get(items_key, [])
            total = data.get(total_key, 0)
            all_items.extend(items)

            est_pages = f"~{-(-total // self.page_size)}" if total else "?"
            logger.info(
                "  [api] %s  page %d/%s  +%d items  total so far: %d%s",
                path, page_index, est_pages, len(items), len(all_items),
                f" (server reports {total})" if total else "",
            )

            # Stop when we received fewer items than requested (last page).
            # Do NOT trust totalItems alone — NYRR sometimes caps it
            # (e.g. reports 500 even when there are more).
            if len(items) < self.page_size:
                break

            page_index += 1
            time.sleep(self.sleep_seconds)

        if total and len(all_items) != total:
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
