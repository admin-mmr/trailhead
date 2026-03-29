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
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BASE_URL = "https://rmsprodapi.nyrr.org/api/v2"

DEFAULT_PAGE_SIZE = 51          # NYRR API rejects pageSize > 51; returns ~51 items/page
DEFAULT_SLEEP_SECONDS = 2.0     # polite delay between paginated requests
REQUEST_TIMEOUT = 30            # seconds


# ---------------------------------------------------------------------------
# Data classes for API responses
# ---------------------------------------------------------------------------

@dataclass
class NyrrEvent:
    """Event object from events/search or events/details."""
    event_code: str
    event_name: str
    start_date_time: str                    # ISO datetime
    venue: str = ""
    distance_name: str = ""                 # e.g. "5 kilometers"
    distance_unit_code: str = ""            # e.g. "5K", "Marathon"
    distance_dimension: float = 0.0
    runner_awards_count: int = 0
    event_url: str = ""                     # results.nyrr.org link (not from API)
    is_virtual: bool = False
    logo_url: str = ""

    @classmethod
    def from_api(cls, data: Dict[str, Any]) -> NyrrEvent:
        return cls(
            event_code=data.get("eventCode", ""),
            event_name=data.get("eventName", ""),
            start_date_time=data.get("startDateTime", ""),
            venue=data.get("venue", ""),
            distance_name=data.get("distanceName", ""),
            distance_unit_code=data.get("distanceUnitCode", ""),
            distance_dimension=data.get("distanceDimension", 0.0),
            runner_awards_count=data.get("runnerAwardsCount", 0),
            event_url=data.get("eventUrl", ""),
            is_virtual=bool(data.get("isVirtual", False)),
            logo_url=data.get("logoUrl", ""),
        )


@dataclass
class NyrrFinisher:
    """Runner/finisher object from runners/finishers-filter or teams/teamRunners."""
    runner_id: int
    first_name: str
    last_name: str
    bib: str = ""
    age: Optional[int] = None
    gender: str = ""                        # "M", "W", "X"
    city: str = ""
    country_code: str = ""
    state_province: str = ""
    iaaf: str = ""
    overall_place: Optional[int] = None
    overall_time: str = ""                  # e.g. "0:14:46"
    pace: str = ""                          # e.g. "04:45"
    gender_place: Optional[int] = None
    age_grade_time: str = ""
    age_grade_place: Optional[int] = None
    age_grade_percent: Optional[float] = None
    team_code: str = ""
    team_name: str = ""

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    @classmethod
    def from_api(cls, data: Dict[str, Any]) -> NyrrFinisher:
        return cls(
            runner_id=data.get("runnerId", 0),
            first_name=data.get("firstName", ""),
            last_name=data.get("lastName", ""),
            bib=str(data.get("bib", "")),
            age=data.get("age"),
            gender=data.get("gender", ""),
            city=data.get("city", ""),
            country_code=data.get("countryCode", ""),
            state_province=data.get("stateProvince", ""),
            iaaf=data.get("iaaf", ""),
            overall_place=data.get("overallPlace"),
            overall_time=data.get("overallTime", ""),
            pace=data.get("pace", ""),
            gender_place=data.get("genderPlace"),
            age_grade_time=data.get("ageGradeTime", ""),
            age_grade_place=data.get("ageGradePlace"),
            age_grade_percent=data.get("ageGradePercent"),
            team_code=data.get("teamCode", ""),
            team_name=data.get("teamName", ""),
        )


@dataclass
class NyrrRunnerRace:
    """Race history item from runners/races."""
    runner_id: str                          # numeric as string
    bib: str = ""
    event_code: str = ""
    event_name: str = ""
    venue: str = ""
    distance_name: str = ""
    start_date_time: str = ""
    actual_time: str = ""                   # e.g. "2:00:33"
    actual_pace: str = ""                   # e.g. "09:12"

    @classmethod
    def from_api(cls, data: Dict[str, Any]) -> NyrrRunnerRace:
        return cls(
            runner_id=str(data.get("runnerId", "")),
            bib=str(data.get("bib", "")),
            event_code=data.get("eventCode", ""),
            event_name=data.get("eventName", ""),
            venue=data.get("venue", ""),
            distance_name=data.get("distanceName", ""),
            start_date_time=data.get("startDateTime", ""),
            actual_time=data.get("actualTime", ""),
            actual_pace=data.get("actualPace", ""),
        )


@dataclass
class NyrrRunnerDetails:
    """Event-specific runner detail from runners/details."""
    runner_id: int = 0
    first_name: str = ""
    last_name: str = ""
    age: int = 0
    gender: str = ""
    city: str = ""
    country_code: str = ""
    country_name: str = ""
    state_province: str = ""
    team_name: str = ""
    bib: str = ""
    first_event_year: int = 0
    last_event_year: int = 0
    photo_url: str = ""
    basno_photo_url: str = ""
    event_code: str = ""
    event_name: str = ""
    distance_name: str = ""
    start_date_time: str = ""

    @classmethod
    def from_api(cls, data: Dict[str, Any]) -> NyrrRunnerDetails:
        return cls(
            runner_id=data.get("runnerId", 0),
            first_name=data.get("firstName", ""),
            last_name=data.get("lastName", ""),
            age=data.get("age", 0),
            gender=data.get("gender", ""),
            city=data.get("city", ""),
            country_code=data.get("countryCode", ""),
            country_name=data.get("countryName", ""),
            state_province=data.get("stateProvince", ""),
            team_name=data.get("teamName", ""),
            bib=str(data.get("bib", "")),
            first_event_year=data.get("firstEventYear", 0),
            last_event_year=data.get("lastEventYear", 0),
            photo_url=data.get("photoUrl", ""),
            basno_photo_url=data.get("basnoPhotoUrl", ""),
            event_code=data.get("eventCode", ""),
            event_name=data.get("eventName", ""),
            distance_name=data.get("distanceName", ""),
            start_date_time=data.get("startDateTime", ""),
        )


@dataclass
class NyrrRunnerProfile:
    """General (non-event-specific) profile from runners/recentDetails."""
    runner_id: int = 0
    first_name: str = ""
    last_name: str = ""
    age: int = 0
    gender: str = ""
    city: str = ""
    country_code: str = ""
    country_name: str = ""
    state_province: str = ""
    team_name: str = ""
    bib: str = ""
    first_event_year: int = 0
    last_event_year: int = 0
    photo_url: str = ""
    basno_photo_url: str = ""

    @classmethod
    def from_api(cls, data: Dict[str, Any]) -> NyrrRunnerProfile:
        return cls(
            runner_id=data.get("runnerId", 0),
            first_name=data.get("firstName", ""),
            last_name=data.get("lastName", ""),
            age=data.get("age", 0),
            gender=data.get("gender", ""),
            city=data.get("city", ""),
            country_code=data.get("countryCode", ""),
            country_name=data.get("countryName", ""),
            state_province=data.get("stateProvince", ""),
            team_name=data.get("teamName", ""),
            bib=str(data.get("bib", "")),
            first_event_year=data.get("firstEventYear", 0),
            last_event_year=data.get("lastEventYear", 0),
            photo_url=data.get("photoUrl", ""),
            basno_photo_url=data.get("basnoPhotoUrl", ""),
        )


@dataclass
class NyrrTeam:
    """Team from teams/search."""
    team_code: str = ""
    team_name: str = ""
    team_type: str = ""
    runners_count: int = 0

    @classmethod
    def from_api(cls, data: Dict[str, Any]) -> NyrrTeam:
        return cls(
            team_code=data.get("teamCode", ""),
            team_name=data.get("teamName", ""),
            team_type=data.get("teamType", ""),
            runners_count=data.get("runnersCount", 0),
        )


@dataclass
class NyrrTeamAward:
    """Team award from awards/teamAwards."""
    place: Optional[int] = None
    summary_time: str = ""
    runners_count: int = 0
    gender: str = ""
    minimum_age: Optional[int] = None
    maximum_age: Optional[int] = None

    @classmethod
    def from_api(cls, data: Dict[str, Any]) -> NyrrTeamAward:
        return cls(
            place=data.get("place"),
            summary_time=data.get("summaryTime", ""),
            runners_count=data.get("runnersCount", 0),
            gender=data.get("gender", ""),
            minimum_age=data.get("minimumAge"),
            maximum_age=data.get("maximumAge"),
        )


@dataclass
class NyrrTeamAwardRunner:
    """Individual runner contributing to a team award, from awards/teamAwardRunners."""
    runner_id: int = 0
    first_name: str = ""
    last_name: str = ""
    bib: str = ""
    overall_time: str = ""
    overall_place: Optional[int] = None

    @classmethod
    def from_api(cls, data: Dict[str, Any]) -> NyrrTeamAwardRunner:
        return cls(
            runner_id=data.get("runnerId", 0),
            first_name=data.get("firstName", ""),
            last_name=data.get("lastName", ""),
            bib=str(data.get("bib", "")),
            overall_time=data.get("overallTime", ""),
            overall_place=data.get("overallPlace"),
        )


@dataclass
class NyrrStandingsDivision:
    """Division result from ClubStandings/getDivisionsResults."""
    division_code: str = ""
    division_name: str = ""
    teams: List[Dict[str, Any]] = field(default_factory=list)

    @classmethod
    def from_api(cls, data: Dict[str, Any]) -> NyrrStandingsDivision:
        return cls(
            division_code=data.get("divisionCode", ""),
            division_name=data.get("divisionName", ""),
            teams=data.get("teams", []),
        )


@dataclass
class NyrrStandingsTeam:
    """Team entry from ClubStandings/getTeams."""
    team_code: str = ""
    team_name: str = ""

    @classmethod
    def from_api(cls, data: Dict[str, Any]) -> NyrrStandingsTeam:
        return cls(
            team_code=data.get("teamCode", ""),
            team_name=data.get("teamName", ""),
        )


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

class NyrrApiClient:
    """
    HTTP client for the NYRR Results API v2.

    Usage::

        client = NyrrApiClient()
        events = client.search_events(year=2026)
        finishers = client.get_event_finishers("26WASH")

    All methods that return lists handle pagination automatically and
    sleep between page requests to be polite to the API.
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
        # Bypass system proxies for NYRR API (rmsprodapi.nyrr.org)
        # This is necessary because system proxy config blocks external API calls
        self.session.trust_env = False
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
        if resp.status_code >= 400:
            logger.error("API error %d: %s", resp.status_code, resp.text)
        resp.raise_for_status()
        return resp.json()

    def _paginate(
        self,
        path: str,
        body: Dict[str, Any],
        *,
        items_key: str = "items",
        total_key: str = "totalItems",
        progress_cb=None,  # optional callable(fetched: int, total: int)
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

            logger.debug(
                "paginate %s  page=%d  got=%d  cumulative=%d  server_total=%d",
                path, page_index, len(items), len(all_items), total,
            )
            if progress_cb:
                progress_cb(len(all_items), total)

            # Stop conditions:
            # 1. Received fewer items than page_size → last page.
            # 2. totalItems is known and we've fetched that many → done.
            #    (NYRR sometimes reports correct totalItems for large events)
            # 3. No items returned → empty page, stop.
            if len(items) == 0:
                break
            if len(items) < self.page_size:
                break
            if total and len(all_items) >= total:
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
            data = self._post(path, page_body)

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

            # Stop conditions
            if len(items) < self.page_size:
                break
            if total and cumulative >= total:
                break

            page_index += 1
            time.sleep(self.sleep_seconds)

        if total and cumulative != total:
            logger.info(
                "paginate_streaming %s: fetched %d items but server reported totalItems=%d",
                path, cumulative, total,
            )

    # ==================================================================
    # 3.1  Events
    # ==================================================================

    def search_events(
        self,
        *,
        year: Optional[int] = None,
        search_string: Optional[str] = None,
        distance: Optional[str] = None,
        page_index: int = 1,
        page_size: Optional[int] = None,
        sort_column: str = "StartDateTime",
        sort_descending: bool = True,
    ) -> List[NyrrEvent]:
        """
        Search for NYRR events.  Paginates automatically.

        Endpoint: POST events/search
        """
        body: Dict[str, Any] = {
            "year": year,
            "searchString": search_string,
            "distance": distance,
            "notOlderDays": None,
            "sortColumn": sort_column,
            "sortDescending": sort_descending,
        }
        raw = self._paginate("events/search", body)
        return [NyrrEvent.from_api(item) for item in raw]

    def get_event_details(self, event_code: str) -> NyrrEvent:
        """
        Get full metadata for a single event.

        Endpoint: POST events/details
        """
        data = self._post("events/details", {"eventCode": event_code})
        if not data.get("success") or not data.get("eventDetails"):
            raise NyrrApiError(f"Failed to fetch event details for {event_code}")
        return NyrrEvent.from_api(data["eventDetails"])

    # ==================================================================
    # 3.2  Runners
    # ==================================================================

    def get_event_finishers(
        self,
        event_code: str,
        *,
        search_string: Optional[str] = None,
        handicap: Optional[str] = None,
        sort_column: str = "overallTime",
        sort_descending: bool = False,
        page: Optional[int] = None,
        progress_cb=None,
    ) -> List[NyrrFinisher]:
        """
        Get all finishers for an event.  Paginates automatically.

        Endpoint: POST runners/finishers-filter
        """
        body: Dict[str, Any] = {
            "eventCode": event_code,
            "searchString": search_string,
            "handicap": handicap,
            "sortColumn": sort_column,
            "sortDescending": sort_descending,
        }
        raw = self._paginate("runners/finishers-filter", body, progress_cb=progress_cb)
        return [NyrrFinisher.from_api(item) for item in raw]

    def get_runner_races(
        self,
        runner_id: str | int,
        *,
        year: Optional[int] = None,
        distance: Optional[str] = None,
        team_code: Optional[str] = None,
        sort_column: str = "EventDate",
        sort_descending: bool = True,
        page: Optional[int] = None,
    ) -> List[NyrrRunnerRace]:
        """
        Get full race history for a runner.  Paginates automatically.

        Any RunnerID from any event can be used — NYRR returns the same
        complete history regardless of which event-specific ID you use.

        Endpoint: POST runners/races
        """
        body: Dict[str, Any] = {
            "runnerId": runner_id,
            "searchString": None,
            "year": year,
            "distance": distance,
            "teamCode": team_code,
            "overallPlaceFrom": None,
            "overallPlaceTo": None,
            "paceFrom": None,
            "paceTo": None,
            "overallTimeFrom": None,
            "overallTimeTo": None,
            "gunTimeFrom": None,
            "gunTimeTo": None,
            "ageGradedTimeFrom": None,
            "ageGradedTimeTo": None,
            "ageGradedPlaceFrom": None,
            "ageGradedPlaceTo": None,
            "ageGradedPerformanceFrom": None,
            "ageGradedPerformanceTo": None,
            "sortColumn": sort_column,
            "sortDescending": sort_descending,
        }
        raw = self._paginate("runners/races", body)
        return [NyrrRunnerRace.from_api(item) for item in raw]

    def get_runner_details(self, runner_id: int) -> NyrrRunnerDetails:
        """
        Get event-specific runner detail (name, age, gender, city, team,
        bib, photo URL).

        Endpoint: POST runners/details
        """
        data = self._post("runners/details", {"runnerId": runner_id})
        if not data.get("success") or not data.get("details"):
            raise NyrrApiError(
                f"Failed to fetch runner details for ID {runner_id}: "
                f"success={data.get('success')}, message={data.get('message')}"
            )
        return NyrrRunnerDetails.from_api(data["details"])

    def get_runner_profile(self, runner_id: int) -> NyrrRunnerProfile:
        """
        Get general (non-event-specific) runner profile: name, age, city,
        first/last event year.

        Endpoint: POST runners/recentDetails
        """
        data = self._post("runners/recentDetails", {"runnerId": runner_id})
        if not data.get("success") or not data.get("details"):
            raise NyrrApiError(
                f"Failed to fetch runner profile for ID {runner_id}: "
                f"success={data.get('success')}, message={data.get('message')}"
            )
        return NyrrRunnerProfile.from_api(data["details"])

    # ==================================================================
    # 3.3  Teams
    # ==================================================================

    def search_teams(
        self,
        event_code: str,
        *,
        search_word: Optional[str] = None,
        sort_column: Optional[str] = None,
        sort_descending: bool = False,
        page: Optional[int] = None,
    ) -> List[NyrrTeam]:
        """
        Search for teams in an event.  Paginates automatically.

        Endpoint: POST teams/search
        """
        body: Dict[str, Any] = {
            "eventCode": event_code,
            "searchWord": search_word,
            "sortColumn": sort_column,
            "sortDescending": sort_descending,
        }
        raw = self._paginate("teams/search", body)
        return [NyrrTeam.from_api(item) for item in raw]

    def get_team_runners(
        self,
        event_code: str,
        team_code: str,
        *,
        sort_column: Optional[str] = None,
        sort_descending: bool = False,
        page: Optional[int] = None,
    ) -> List[NyrrFinisher]:
        """
        Get all runners for a specific team in a specific event.
        This is the primary MMR data source.  Paginates automatically.

        Endpoint: POST teams/teamRunners
        """
        body: Dict[str, Any] = {
            "eventCode": event_code,
            "teamCode": team_code,
            "sortColumn": sort_column,
            "sortDescending": sort_descending,
        }
        raw = self._paginate("teams/teamRunners", body)
        return [NyrrFinisher.from_api(item) for item in raw]

    # ==================================================================
    # 3.4  Awards (new — not in GAS scripts)
    # ==================================================================

    def get_team_awards(
        self,
        event_code: str,
        team_code: str,
        *,
        gender: Optional[str] = None,
        minimum_age: Optional[int] = None,
    ) -> List[NyrrTeamAward]:
        """
        Get team award placements for an event.

        Endpoint: POST awards/teamAwards
        """
        body: Dict[str, Any] = {
            "eventCode": event_code,
            "teamCode": team_code,
            "gender": gender,
            "minimumAge": minimum_age,
        }
        data = self._post("awards/teamAwards", body)
        items = data if isinstance(data, list) else data.get("items", [])
        return [NyrrTeamAward.from_api(item) for item in items]

    def get_team_award_runners(
        self,
        event_code: str,
        team_code: str,
        *,
        team_gender: Optional[str] = None,
        team_minimum_age: Optional[int] = None,
    ) -> List[NyrrTeamAwardRunner]:
        """
        Get individual runners contributing to a team award.

        Endpoint: POST awards/teamAwardRunners
        """
        body: Dict[str, Any] = {
            "eventCode": event_code,
            "teamCode": team_code,
            "teamGender": team_gender,
            "teamMinimumAge": team_minimum_age,
        }
        data = self._post("awards/teamAwardRunners", body)
        items = data if isinstance(data, list) else data.get("items", [])
        return [NyrrTeamAwardRunner.from_api(item) for item in items]

    # ==================================================================
    # 3.5  Club Standings (new — not in GAS scripts)
    # ==================================================================

    def get_standings_years(self) -> List[int]:
        """
        Get the list of years that have club standings data.

        Endpoint: POST ClubStandings/getYears
        """
        data = self._post("ClubStandings/getYears", {})
        # Response is typically a list of year ints, or wrapped in an object
        if isinstance(data, list):
            return data
        return data.get("items", data.get("years", []))

    def get_divisions_results(self, year: int) -> List[NyrrStandingsDivision]:
        """
        Get all divisions with team rankings for a given year.
        Divisions: M (male), W (women/female), X (non-binary).

        Endpoint: POST ClubStandings/getDivisionsResults
        """
        data = self._post("ClubStandings/getDivisionsResults", {"year": year})
        items = data if isinstance(data, list) else data.get("items", [])
        return [NyrrStandingsDivision.from_api(item) for item in items]

    def get_division_results(
        self, division_code: str, year: int
    ) -> List[Dict[str, Any]]:
        """
        Get team rankings within a specific division, with per-event
        points breakdown.

        Endpoint: POST ClubStandings/getDivisionResults
        """
        data = self._post(
            "ClubStandings/getDivisionResults",
            {"divisionCode": division_code, "year": year},
        )
        if isinstance(data, list):
            return data
        return data.get("items", [])

    def get_teams(self, year: int) -> List[NyrrStandingsTeam]:
        """
        Get all teams registered for a given year's club standings.

        Endpoint: POST ClubStandings/getTeams
        """
        data = self._post("ClubStandings/getTeams", {"year": year})
        items = data if isinstance(data, list) else data.get("items", [])
        return [NyrrStandingsTeam.from_api(item) for item in items]


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class NyrrApiError(Exception):
    """Raised when the NYRR API returns an error or unexpected shape."""


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
