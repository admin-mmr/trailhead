"""
Helpers for probe_finishers.py — the core finishers-filter probe call.

Extracted from probe_finishers.py to keep that module under the code-health
line limit. `probe_totalItems` is re-imported into probe_finishers so existing
importers (e.g. split_by_pace.py) keep working unchanged.
"""

from typing import Dict, Any, Optional

from nyrr_api import NyrrApiClient


def probe_totalItems(
    client: NyrrApiClient,
    event_code: str,
    search_string: Optional[str] = None,
    gender: Optional[str] = None,
    age_min: Optional[int] = None,
    age_max: Optional[int] = None,
    handicap: Optional[str] = None,
    state_province: Optional[str] = None,
    country_code: Optional[str] = None,
    team_code: Optional[str] = None,
    age_graded_perf_min: Optional[float] = None,
    age_graded_perf_max: Optional[float] = None,
    age_graded_place_min: Optional[int] = None,
    age_graded_place_max: Optional[int] = None,
    pace_min: Optional[str] = None,
    pace_max: Optional[str] = None,
    sort_column: str = "bib",
    sort_descending: bool = False,
) -> Dict[str, Any]:
    """
    Probe one finishers-filter call to get totalItems.

    Returns dict with:
      - totalItems: count from NYRR API
      - filters: dict of applied filters
      - status: 'ok' or 'error_400' (API limit hit)

    Full payload structure:
    {
        "eventCode": str,
        "searchString": str | null,
        "gender": "M" | "W" | "X" | null,
        "ageFrom": int | null,
        "ageTo": int | null,
        "handicap": str | null,
        "stateProvince": str | null,
        "countryCode": str | null,
        "teamCode": str | null,
        "ageGradedPerformanceFrom": float | null,
        "ageGradedPerformanceTo": float | null,
        "ageGradedPlaceFrom": int | null,
        "ageGradedPlaceTo": int | null,
        "sortColumn": str,
        "sortDescending": bool,
        "pageIndex": int,
        "pageSize": int,
    }
    """
    body: Dict[str, Any] = {
        "eventCode": event_code,
        "searchString": search_string,
        "gender": gender,
        "ageFrom": age_min,
        "ageTo": age_max,
        "handicap": handicap,
        "stateProvince": state_province,
        "countryCode": country_code,
        "teamCode": team_code,
        "ageGradedPerformanceFrom": age_graded_perf_min,
        "ageGradedPerformanceTo": age_graded_perf_max,
        "ageGradedPlaceFrom": age_graded_place_min,
        "ageGradedPlaceTo": age_graded_place_max,
        "paceFrom": pace_min,
        "paceTo": pace_max,
        "sortColumn": sort_column,
        "sortDescending": sort_descending,
        "pageIndex": 1,
        "pageSize": 1,
    }

    try:
        data = client._post("runners/finishers-filter", body)
        total = data.get("totalItems", 0)
        item : Dict[str, Any]=  data.get("items", [{}])[0] if data.get("items") else {}
        gender : str = item.get("gender", "-")
        # Extract pace from first item if available
        first_pace = item.get("pace") if item else None

        return {
            "totalItems": total,
            "gender": gender,
            "pace": first_pace,
            "filters": {k: v for k, v in {
                "searchString": search_string,
                "gender": gender,
                "ageFrom": age_min,
                "ageTo": age_max,
                "handicap": handicap,
                "ageGradedPerformanceFrom": age_graded_perf_min,
                "ageGradedPerformanceTo": age_graded_perf_max,
                "ageGradedPlaceFrom": age_graded_place_min,
                "ageGradedPlaceTo": age_graded_place_max,
                "paceFrom": pace_min,
                "paceTo": pace_max,
            }.items() if v is not None},
            "status": "ok",
        }
    except Exception as e:
        if "400" in str(e):
            return {
                "totalItems": None,
                "filters": {k: v for k, v in {
                    "searchString": search_string,
                    "gender": gender,
                    "ageFrom": age_min,
                    "ageTo": age_max,
                    "handicap": handicap,
                    "ageGradedPerformanceFrom": age_graded_perf_min,
                    "ageGradedPerformanceTo": age_graded_perf_max,
                    "ageGradedPlaceFrom": age_graded_place_min,
                    "ageGradedPlaceTo": age_graded_place_max,
                    "paceFrom": pace_min,
                    "paceTo": pace_max,
                }.items() if v is not None},
                "status": "error_400",
            }
        else:
            raise
