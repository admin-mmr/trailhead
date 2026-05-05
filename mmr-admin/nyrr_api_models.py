"""
NYRR API — response dataclasses + exception type.

Split out from nyrr_api.py to keep individual files under the 400-LOC budget
(CLAUDE.md hard rule). External callers can keep importing these names from
`nyrr_api` — the parent module re-exports them — or from this module directly.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


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
# Exceptions
# ---------------------------------------------------------------------------

class NyrrApiError(Exception):
    """Raised when the NYRR API returns an error or unexpected shape."""
