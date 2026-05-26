"""
NYRR API — endpoint methods (mixin).

Split out from nyrr_api.py to keep individual files under the 400-LOC budget
(CLAUDE.md hard rule). All methods are bound to the `NyrrApiClient` class via
the `_NyrrEndpointsMixin` base.

Mixin requires the following on `self` (provided by `NyrrApiClient`):
  - self._post(path, body)               → POST JSON, return parsed response
  - self._paginate(path, body, ...)      → POST + auto-paginate, return list
  - self._paginate_streaming(path, ...)  → POST + auto-paginate, yield pages

Section labels match nyrr-backend-migration-plan.docx.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from nyrr_api_models import (
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


class _NyrrEndpointsMixin:
    """Endpoint methods for NyrrApiClient. Not instantiated directly."""

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
        raw = self._paginate("runners/finishers-filter", body)
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
        raw = self._paginate("teams/teamRunners", body, dedup_key="runnerId")
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
