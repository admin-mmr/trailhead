#!/usr/bin/env python3
"""
Probe NYRR finishers-filter totalItems with different filter combinations.

Endpoint: POST /runners/finishers-filter
Full payload available fields: eventCode, searchString, gender, ageMinimum, ageMaximum,
handicap, stateProvince, countryCode, teamCode, sortColumn, sortDescending, pageIndex, pageSize

Usage:
  python3 probe_finishers.py --event <event_code> [options]
  python3 probe_finishers.py --event H2026 --filters        # Comprehensive test matrix
  python3 probe_finishers.py --event H2026 --gender M       # Single filter
  python3 probe_finishers.py --event H2026 --search "1"     # searchString only
  python3 probe_finishers.py --event H2026 --state NY       # State filter
  python3 probe_finishers.py --event H2026 --age-min 30 --age-max 39  # Age range
  python3 probe_finishers.py --event H2026 --gender M --state NY --age-min 30 --age-max 39

This helps identify which filter fields reduce totalItems below the 500 API cap.
"""

import argparse
import sys
import logging

from nyrr_api import NyrrApiClient
# probe_totalItems moved to probe_finishers_helpers.py — re-imported here so
# existing importers (e.g. split_by_pace.py) keep `from probe_finishers import
# probe_totalItems` working unchanged.
from probe_finishers_helpers import probe_totalItems

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
handler = logging.StreamHandler()
handler.setFormatter(logging.Formatter('%(levelname)-8s - %(message)s'))
logger.addHandler(handler)


def main():
    parser = argparse.ArgumentParser(
        description="Probe NYRR finishers-filter totalItems with different filter combinations",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
AVAILABLE FILTER FIELDS:
  searchString, gender, ageFrom/ageTo, handicap, stateProvince, countryCode, teamCode,
  ageGradedPerformanceFrom/ageGradedPerformanceTo, ageGradedPlaceFrom/ageGradedPlaceTo

EXAMPLES:
  # Show base totalItems (no filters)
  python3 probe_finishers.py --event H2026

  # Single filters
  python3 probe_finishers.py --event H2026 --search "1"
  python3 probe_finishers.py --event H2026 --gender M
  python3 probe_finishers.py --event H2026 --state NY
  python3 probe_finishers.py --event H2026 --country US

  # Multiple filters
  python3 probe_finishers.py --event H2026 --search "1" --gender M
  python3 probe_finishers.py --event H2026 --gender M --state NY --age-min 30 --age-max 39

  # Age ranges (narrow filters)
  python3 probe_finishers.py --event H2026 --age-min 30 --age-max 39
  python3 probe_finishers.py --event H2026 --age-min 50 --age-max 100

  # Comprehensive test of all filter combinations (~40 probes)
  python3 probe_finishers.py --event H2026 --filters

  # Enable debug logging
  python3 probe_finishers.py --event H2026 --search "1" --debug

NOTE: This tool helps identify which filter combinations keep totalItems under 500.
Use the results to update api_sync.py's large-event strategy.
        """
    )

    parser.add_argument('--event', required=True, help='Event code (e.g., H2026)')
    parser.add_argument('--search', help='searchString filter (e.g., "1")')
    parser.add_argument('--gender', choices=['M', 'W', 'X'], help='Gender filter (M, W, or X)')
    parser.add_argument('--age-min', type=int, help='Minimum age')
    parser.add_argument('--age-max', type=int, help='Maximum age')
    parser.add_argument('--handicap', help='Handicap filter')
    parser.add_argument('--state', help='State/province filter (e.g., "NY")')
    parser.add_argument('--country', help='Country code filter (e.g., "US", "GB")')
    parser.add_argument('--team', help='Team code filter')
    parser.add_argument('--agp-min', type=float, help='Age graded performance minimum (e.g., 50)')
    parser.add_argument('--agp-max', type=float, help='Age graded performance maximum')
    parser.add_argument('--agp-place-min', type=int, help='Age graded place minimum (e.g., 50)')
    parser.add_argument('--agp-place-max', type=int, help='Age graded place maximum')
    parser.add_argument('--pace-min', help='Pace minimum (e.g., "00:05:00")')
    parser.add_argument('--pace-max', help='Pace maximum (e.g., "00:09:00")')
    parser.add_argument('--sort-by', choices=['bib', 'overallTime', 'overallPlace', 'firstName', 'lastName','gender', 'pace'],
                        default='bib', help='Sort column (default: bib)')
    parser.add_argument('--sort-desc', action='store_true', help='Sort descending')
    parser.add_argument('--filters', action='store_true',
                        help='Run comprehensive test of all filter combinations')
    parser.add_argument('--debug', action='store_true', help='Enable DEBUG logging')

    args = parser.parse_args()

    if args.debug:
        logger.setLevel(logging.DEBUG)

    client = NyrrApiClient()

    if args.filters:
        # Comprehensive test matrix
        logger.info(f"🔍 Running comprehensive filter test for event {args.event}...")
        logger.info(f"{'='*80}")

        results = []

        # Base case: no filters
        logger.info(f"\n📊 BASELINE (no filters):")
        result = probe_totalItems(client, args.event)
        results.append(result)
        if result['status'] == 'ok':
            logger.info(f"   totalItems: {result['totalItems']}")
        else:
            logger.warning(f"   ERROR: API returned 400 (hit limit)")

        # searchString variations
        logger.info(f"\n📊 searchString VARIATIONS:")
        for search_val in ["1", "2", "3", "5"]:
            result = probe_totalItems(client, args.event, search_string=search_val)
            results.append(result)
            if result['status'] == 'ok':
                logger.info(f"   searchString='{search_val}': {result['totalItems']} items")
            else:
                logger.warning(f"   searchString='{search_val}': ERROR (hit 400 limit)")

        # Gender variations
        logger.info(f"\n📊 gender VARIATIONS:")
        for gender_val in ["M", "W", "X"]:
            result = probe_totalItems(client, args.event, gender=gender_val)
            results.append(result)
            if result['status'] == 'ok':
                logger.info(f"   gender='{gender_val}': {result['totalItems']} items")
            else:
                logger.warning(f"   gender='{gender_val}': ERROR (hit 400 limit)")

        # Age range variations
        logger.info(f"\n📊 age range VARIATIONS:")
        age_ranges = [
            (None, None, "all ages"),
            (18, 29, "18-29"),
            (30, 39, "30-39"),
            (40, 49, "40-49"),
            (50, 59, "50-59"),
            (60, 100, "60+"),
        ]
        for age_min, age_max, label in age_ranges:
            result = probe_totalItems(client, args.event, age_min=age_min, age_max=age_max)
            results.append(result)
            if result['status'] == 'ok':
                logger.info(f"   age {label}: {result['totalItems']} items")
            else:
                logger.warning(f"   age {label}: ERROR (hit 400 limit)")

        # State/Province variations (if NY event, test US states)
        logger.info(f"\n📊 stateProvince VARIATIONS:")
        for state_val in ["NY", "NJ", "CT", "PA"]:
            result = probe_totalItems(client, args.event, state_province=state_val)
            results.append(result)
            if result['status'] == 'ok':
                logger.info(f"   state='{state_val}': {result['totalItems']} items")
            else:
                logger.warning(f"   state='{state_val}': ERROR (hit 400 limit)")

        # Combined filters — double filters
        logger.info(f"\n📊 COMBINED FILTERS (2-filter):")

        combos_2 = [
            ({"search_string": "1", "gender": "M"}, "searchString='1' + gender='M'"),
            ({"search_string": "1", "age_min": 30, "age_max": 39}, "searchString='1' + age 30-39"),
            ({"gender": "M", "age_min": 30, "age_max": 39}, "gender='M' + age 30-39"),
            ({"state_province": "NY", "gender": "M"}, "state='NY' + gender='M'"),
            ({"state_province": "NY", "age_min": 30, "age_max": 39}, "state='NY' + age 30-39"),
        ]

        for kwargs, label in combos_2:
            result = probe_totalItems(client, args.event, **kwargs)
            results.append(result)
            if result['status'] == 'ok':
                logger.info(f"   {label}: {result['totalItems']} items")
            else:
                logger.warning(f"   {label}: ERROR (hit 400 limit)")

        # Combined filters — triple filters
        logger.info(f"\n📊 COMBINED FILTERS (3-filter):")

        combos_3 = [
            ({"search_string": "1", "gender": "M", "age_min": 30, "age_max": 39},
             "searchString='1' + gender='M' + age 30-39"),
            ({"search_string": "1", "state_province": "NY", "gender": "M"},
             "searchString='1' + state='NY' + gender='M'"),
            ({"gender": "M", "state_province": "NY", "age_min": 30, "age_max": 39},
             "gender='M' + state='NY' + age 30-39"),
        ]

        for kwargs, label in combos_3:
            result = probe_totalItems(client, args.event, **kwargs)
            results.append(result)
            if result['status'] == 'ok':
                logger.info(f"   {label}: {result['totalItems']} items")
            else:
                logger.warning(f"   {label}: ERROR (hit 400 limit)")

        # Summary
        logger.info(f"\n{'='*80}")
        logger.info(f"📈 SUMMARY:")
        ok_results = [r for r in results if r['status'] == 'ok']
        error_results = [r for r in results if r['status'] == 'error_400']
        if ok_results:
            max_total = max(r['totalItems'] for r in ok_results)
            min_total = min(r['totalItems'] for r in ok_results)
            logger.info(f"   Successful probes: {len(ok_results)}")
            logger.info(f"   Min totalItems: {min_total}, Max totalItems: {max_total}")
            logger.info(f"   Below 500 cap: {sum(1 for r in ok_results if r['totalItems'] < 500)} combinations")

            # Find best filters (those that reduce to smallest result while > 0)
            under_500 = [r for r in ok_results if 0 < r['totalItems'] <= 500]
            if under_500:
                best = min(under_500, key=lambda r: r['totalItems'])
                logger.info(f"   ✅ BEST filter(s) for <500 results:")
                if best['filters']:
                    for k, v in best['filters'].items():
                        logger.info(f"      - {k}: {v}")
                    logger.info(f"      → yields {best['totalItems']} items")
        if error_results:
            logger.warning(f"   Error (400) responses: {len(error_results)}")
        logger.info(f"{'='*80}\n")

    else:
        # Single probe with provided filters
        logger.info(f"🔍 Probing totalItems for event {args.event}...")
        result = probe_totalItems(
            client,
            args.event,
            search_string=args.search,
            gender=args.gender,
            age_min=args.age_min,
            age_max=args.age_max,
            handicap=args.handicap,
            state_province=args.state,
            country_code=args.country,
            team_code=args.team,
            age_graded_perf_min=args.agp_min,
            age_graded_perf_max=args.agp_max,
            age_graded_place_min=args.agp_place_min,
            age_graded_place_max=args.agp_place_max,
            pace_min=args.pace_min,
            pace_max=args.pace_max,
            sort_column=args.sort_by,
            sort_descending=args.sort_desc,
        )

        if result['status'] == 'ok':
            logger.info(f"✅ totalItems: {result['totalItems']}")
            if result['filters']:
                logger.info(f"   Filters applied:")
                for k, v in result['filters'].items():
                    logger.info(f"     - {k}: {v}")
            else:
                logger.info(f"   (no filters applied)")

            if result['totalItems'] <= 500:
                logger.info(f"✅ Result fits under 500 API cap")
            else:
                logger.warning(f"⚠️  Result exceeds 500 API cap ({result['totalItems']} items)")
        else:
            logger.error(f"❌ API returned error (400): {result['status']}")
            logger.error(f"   Likely hit the 500-result limit with these filters:")
            if result['filters']:
                for k, v in result['filters'].items():
                    logger.error(f"     - {k}: {v}")
            logger.error(f"   Need to apply additional filters or use a different combination")


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        logger.warning("\n⚠️  Interrupted by user")
        sys.exit(130)
    except Exception as e:
        logger.error(f"❌ Error: {type(e).__name__}: {e}")
        if '--debug' in sys.argv:
            import traceback
            logger.error(f"\nTraceback:\n{traceback.format_exc()}")
        sys.exit(1)
