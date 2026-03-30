#!/usr/bin/env python3
"""
Binary pace splitting for large age+gender groups.

When an age+gender combo returns >500 runners, recursively split by pace
until each shard is <=500 items.

Usage:
  python3 split_by_pace.py --event M2025 --gender M --age-min 25 --age-max 29
  python3 split_by_pace.py --event H2026 --gender W --age-min 40 --age-max 49 --target 400

This finds the max pace and does binary splits on pace ranges.
"""

import argparse
import sys
import logging
from typing import Dict, Any, Optional, List, Tuple
from dataclasses import dataclass

from nyrr_api import NyrrApiClient
from probe_finishers import probe_totalItems

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
handler = logging.StreamHandler()
handler.setFormatter(logging.Formatter('%(levelname)-8s - %(message)s'))
logger.addHandler(handler)


@dataclass
class PaceShard:
    """Represents a pace range shard with total count."""
    pace_min: Optional[str]
    pace_max: Optional[str]
    total_items: int
    gender: Optional[str] = None
    age_min: Optional[int] = None
    age_max: Optional[int] = None


def pace_to_seconds(pace_str: str) -> int:
    """Convert HH:MM:SS or MM:SS pace to seconds. E.g., '05:30' -> 330, '00:05:30' -> 330."""
    parts = pace_str.split(':')
    if len(parts) == 2:
        # MM:SS format
        m, s = int(parts[0]), int(parts[1])
        return m * 60 + s
    elif len(parts) == 3:
        # HH:MM:SS format
        h, m, s = int(parts[0]), int(parts[1]), int(parts[2])
        return h * 3600 + m * 60 + s
    else:
        raise ValueError(f"Invalid pace format: {pace_str}. Expected MM:SS or HH:MM:SS")


def seconds_to_pace(seconds: int) -> str:
    """Convert seconds to 00:MM:SS pace. E.g., 330 -> '00:05:30'."""
    m = seconds // 60
    s = seconds % 60
    return f"00:{m:02d}:{s:02d}"


def get_max_pace(
    client: NyrrApiClient,
    event_code: str,
    gender: Optional[str] = None,
    age_min: Optional[int] = None,
    age_max: Optional[int] = None,
) -> Tuple[str, int]:
    """
    Get the maximum pace in the group by querying sorted by pace descending.
    Returns (max_pace_str, total_items).
    """
    # Query sorted by pace descending to get the slowest runner's pace
    result = probe_totalItems(
        client,
        event_code,
        gender=gender,
        age_min=age_min,
        age_max=age_max,
        sort_column="pace",
        sort_descending=True,  # Highest pace (slowest) first
    )

    if result['status'] != 'ok':
        raise RuntimeError(f"Failed to query max pace: {result}")

    total = result['totalItems']
    max_pace = result.get('pace')

    logger.info(f"  Total items in group: {total}")
    logger.info(f"  Max pace (slowest): {max_pace}")

    # Pad pace to 00:MM:SS format if needed
    if max_pace:
        if max_pace.count(':') == 1:
            # MM:SS format, pad with 00:
            max_pace = "00:" + max_pace
    else:
        logger.warning(f"  ⚠️  Could not extract max pace from first item, using fallback")
        max_pace = "00:20:00"

    return max_pace, total


def binary_split_pace(
    client: NyrrApiClient,
    event_code: str,
    pace_min: Optional[str],
    pace_max: str,
    gender: Optional[str],
    age_min: Optional[int],
    age_max: Optional[int],
    target_size: int = 500,
    depth: int = 0,
) -> List[PaceShard]:
    """
    Recursively binary-split pace range until each shard <= target_size.

    Returns list of PaceShard objects.
    """
    indent = "  " * depth

    # Query current range
    result = probe_totalItems(
        client,
        event_code,
        gender=gender,
        age_min=age_min,
        age_max=age_max,
        pace_min=pace_min,
        pace_max=pace_max,
    )

    if result['status'] != 'ok':
        logger.warning(f"{indent}⚠️  Error querying pace range {pace_min}-{pace_max}: {result}")
        return [PaceShard(pace_min, pace_max, 0, gender, age_min, age_max)]

    total = result['totalItems']
    logger.info(f"{indent}Pace {pace_min}-{pace_max}: {total} items")

    # Base case: shard is small enough
    if total <= target_size:
        logger.info(f"{indent}✅ Shard fits ({total} <= {target_size})")
        return [PaceShard(pace_min, pace_max, total, gender, age_min, age_max)]

    # Recursive case: split in half by pace
    logger.info(f"{indent}⚠️  Shard too large ({total} > {target_size}), splitting...")

    # Handle None pace_min
    if pace_min is None:
        pace_min = "00:00:00"

    pace_min_sec = pace_to_seconds(pace_min)
    pace_max_sec = pace_to_seconds(pace_max)
    mid_sec = (pace_min_sec + pace_max_sec) // 2
    mid_pace = seconds_to_pace(mid_sec)

    logger.info(f"{indent}  Split point: {mid_pace}")

    # Recurse on both halves
    left = binary_split_pace(
        client, event_code, pace_min, mid_pace,
        gender, age_min, age_max,
        target_size, depth + 1
    )
    right = binary_split_pace(
        client, event_code, mid_pace, pace_max,
        gender, age_min, age_max,
        target_size, depth + 1
    )

    return left + right


def main():
    parser = argparse.ArgumentParser(
        description="Binary-split large age+gender groups by pace until each shard <=500",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
EXAMPLES:
  # Check M25-29 group (1092 items), split by pace
  python3 split_by_pace.py --event M2025 --gender M --age-min 25 --age-max 29

  # Custom target size
  python3 split_by_pace.py --event H2026 --gender W --age-min 40 --age-max 49 --target 400

  # Female 35-39
  python3 split_by_pace.py --event M2025 --gender W --age-min 35 --age-max 39
        """
    )

    parser.add_argument('--event', required=True, help='Event code (e.g., M2025)')
    parser.add_argument('--gender', required=True, choices=['M', 'W', 'X'], help='Gender filter')
    parser.add_argument('--age-min', type=int, required=True, help='Age minimum')
    parser.add_argument('--age-max', type=int, required=True, help='Age maximum')
    parser.add_argument('--target', type=int, default=500, help='Target shard size (default: 500)')
    parser.add_argument('--debug', action='store_true', help='Enable DEBUG logging')

    args = parser.parse_args()

    if args.debug:
        logger.setLevel(logging.DEBUG)

    client = NyrrApiClient()

    logger.info(f"🔍 Analyzing {args.event} gender={args.gender} age={args.age_min}-{args.age_max}")
    logger.info(f"   Target shard size: {args.target}")
    logger.info(f"{'='*80}")

    try:
        # Get max pace and total
        max_pace, total_items = get_max_pace(
            client,
            args.event,
            gender=args.gender,
            age_min=args.age_min,
            age_max=args.age_max,
        )

        logger.info(f"  Max pace estimate: {max_pace}")
        logger.info(f"{'='*80}\n")

        if total_items <= args.target:
            logger.info(f"✅ Group is already small enough ({total_items} <= {args.target})")
            logger.info(f"   No splitting needed.")
            return

        # Binary split by pace
        logger.info(f"🔪 Starting binary pace split...\n")
        shards = binary_split_pace(
            client,
            args.event,
            pace_min="00:00:00",
            pace_max=max_pace,
            gender=args.gender,
            age_min=args.age_min,
            age_max=args.age_max,
            target_size=args.target,
        )

        logger.info(f"\n{'='*80}")
        logger.info(f"📊 RESULTS:")
        logger.info(f"   Input: {args.event} {args.gender} age {args.age_min}-{args.age_max} ({total_items} items)")
        logger.info(f"   Output shards: {len(shards)}")
        logger.info(f"{'='*80}")

        for i, shard in enumerate(shards, 1):
            pace_range = f"{shard.pace_min}-{shard.pace_max}" if shard.pace_min else f"0:00-{shard.pace_max}"
            status = "✅" if shard.total_items <= args.target else "⚠️"
            logger.info(f"  {i}. Pace {pace_range}: {shard.total_items} items {status}")

        # Summary
        ok_count = sum(1 for s in shards if s.total_items <= args.target)
        logger.info(f"\n   Ready to fetch: {ok_count}/{len(shards)} shards")

        if ok_count < len(shards):
            logger.warning(f"   ⚠️  {len(shards) - ok_count} shards still >target (may need deeper split)")
        else:
            logger.info(f"   ✅ All shards ready for fetch!")

        # Output filter JSON for each shard
        logger.info(f"\n{'='*80}")
        logger.info(f"📋 FILTER JSON FOR EACH SHARD (copy-paste to API):\n")
        for i, shard in enumerate(shards, 1):
            pace_filter = {}
            if shard.pace_min:
                pace_filter['paceFrom'] = shard.pace_min
            if shard.pace_max:
                pace_filter['paceTo'] = shard.pace_max

            logger.info(f"  # Shard {i}: {shard.total_items} items")
            logger.info(f"  {{")
            logger.info(f'    "eventCode": "{args.event}",')
            logger.info(f'    "gender": "{shard.gender}",')
            logger.info(f'    "ageFrom": "{shard.age_min}",')
            logger.info(f'    "ageTo": "{shard.age_max}",')
            for k, v in pace_filter.items():
                logger.info(f'    "{k}": "{v}",')
            logger.info(f"  }}\n")

    except Exception as e:
        logger.error(f"❌ Error: {type(e).__name__}: {e}")
        if '--debug' in sys.argv:
            import traceback
            logger.error(f"\nTraceback:\n{traceback.format_exc()}")
        sys.exit(1)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        logger.warning("\n⚠️  Interrupted by user")
        sys.exit(130)
