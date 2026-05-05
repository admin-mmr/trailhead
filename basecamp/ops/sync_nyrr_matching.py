# type: ignore
"""
NYRR Sync — Stage 5 (Auto-Matching).

  run_auto_matcher       — orchestrate Tier 1 + Tier 2 + counter refresh
  _tier1_known_name      — match runner_name → members.NYRRRunnerName
  _tier2_unique_lastname — when exactly one active member shares the
                           last name, auto-link and write NYRRRunnerName
                           back so Tier 1 catches them next time

Split out of sync_nyrr_events.py so each file stays under the 400-LOC limit.
Uses propagation + counter helpers from sync_nyrr_helpers.
"""

from __future__ import annotations

import logging
from typing import Dict, List, Optional

import mysql.connector

from sync_nyrr_helpers import (
    TEAM_CODE,
    normalize_name,
    propagate_match,
    update_matched_counts,
)

logger = logging.getLogger(__name__)


def run_auto_matcher(
    conn: mysql.connector.MySQLConnection,
    event_id: Optional[int] = None,
) -> int:
    """
    Run Tier 1 + Tier 2 auto-matching.

    Tier 1 — Known Name Lookup (~70%):
        If a member's NYRRRunnerName is set (from a prior match), and the
        runner_name matches case-insensitively, link immediately.

    Tier 2 — Unique Last Name (~20%):
        Compare unmatched runner last names against active members. If exactly
        one member shares that last name, auto-link. Write NYRRRunnerName to
        the member so Tier 1 catches them next time.

    Returns: total matches made.
    """
    total_matched = 0

    # ---- Tier 1: Known NYRRRunnerName ----
    t1 = _tier1_known_name(conn, event_id)
    total_matched += t1
    logger.info(f'  [matcher.tier1] {t1} matches via known NYRRRunnerName')

    # ---- Tier 2: Unique last name ----
    t2 = _tier2_unique_lastname(conn, event_id)
    total_matched += t2
    logger.info(f'  [matcher.tier2] {t2} matches via unique last name')

    # Update mmr_matched_count on nyrr_events
    update_matched_counts(conn, event_id)

    return total_matched


def _tier1_known_name(
    conn: mysql.connector.MySQLConnection,
    event_id: Optional[int],
) -> int:
    """
    Tier 1: Match runners whose name matches a member's NYRRRunnerName.
    Uses case-insensitive comparison via LOWER().
    """
    cursor = conn.cursor()

    event_filter = "AND er.nyrr_event_id = %s" if event_id else ""
    params: list = []
    if event_id:
        params = [event_id]

    # Join unmatched runners against members where NYRRRunnerName is set
    # Column 25 in members table = NYRRRunnerName
    query = f"""
        UPDATE nyrr_event_runners er
        INNER JOIN members m
            ON LOWER(TRIM(er.runner_name)) = LOWER(TRIM(m.NYRRRunnerName))
        SET er.mmr_member_id = m.MemberID,
            er.match_method = 'auto_name',
            er.matched_by = 'System',
            er.matched_at = NOW()
        WHERE er.mmr_member_id IS NULL
          AND m.NYRRRunnerName IS NOT NULL
          AND m.NYRRRunnerName != ''
          {event_filter}
    """
    cursor.execute(query, params)
    matched = cursor.rowcount
    conn.commit()
    cursor.close()
    return matched


def _tier2_unique_lastname(
    conn: mysql.connector.MySQLConnection,
    event_id: Optional[int],
) -> int:
    """
    Tier 2: For unmatched runners, if exactly one active member shares
    the same last name, auto-link them.

    Also writes NYRRRunnerName to the member so Tier 1 catches them next time.
    """
    cursor = conn.cursor(dictionary=True)
    matched = 0

    event_filter = "AND er.nyrr_event_id = %s" if event_id else ""
    params: list = []
    if event_id:
        params = [event_id]

    # Get unmatched runners (team_code = MMR only — we don't try to match
    # runners from other clubs)
    query = f"""
        SELECT er.id, er.nyrr_event_id, er.runner_name, er.last_name, er.nyrr_runner_id
        FROM nyrr_event_runners er
        WHERE er.mmr_member_id IS NULL
          AND er.match_method IS NULL
          AND er.team_code = %s
          {event_filter}
    """
    cursor.execute(query, [TEAM_CODE] + params)
    unmatched = cursor.fetchall()

    if not unmatched:
        cursor.close()
        return 0

    # Load active members into memory for matching
    cursor.execute("""
        SELECT MemberID, FirstName, LastName, NYRRRunnerName, Status
        FROM members
        WHERE Status IN ('Active', 'Comp', 'Grace')
    """)
    members = cursor.fetchall()

    # Build a last-name → [member] index
    lastname_index: Dict[str, List[Dict]] = {}
    for m in members:
        ln = normalize_name(m['LastName']) if m.get('LastName') else ''
        if ln:
            lastname_index.setdefault(ln, []).append(m)

    cursor2 = conn.cursor()

    for runner in unmatched:
        runner_ln = normalize_name(runner['last_name']) if runner.get('last_name') else ''
        if not runner_ln:
            continue

        candidates = lastname_index.get(runner_ln, [])

        if len(candidates) == 1:
            # Unique last name match — auto-link
            member = candidates[0]
            member_id = member['MemberID']

            # Update this runner row
            cursor2.execute("""
                UPDATE nyrr_event_runners
                SET mmr_member_id = %s, match_method = 'auto_lastname',
                    matched_by = 'System', matched_at = NOW()
                WHERE id = %s
            """, (member_id, runner['id']))

            # Write NYRRRunnerName to member for future Tier 1 matches
            cursor2.execute("""
                UPDATE members
                SET NYRRRunnerName = %s
                WHERE MemberID = %s AND (NYRRRunnerName IS NULL OR NYRRRunnerName = '')
            """, (runner['runner_name'], member_id))

            # Propagate match across all historical rows with same runner_name
            propagate_match(cursor2, runner['runner_name'], member_id)

            matched += 1
            logger.info(f'    [tier2] ✓ {runner["runner_name"]} → {member_id} '
                         f'(unique last name "{runner_ln}")')

    conn.commit()
    cursor2.close()
    cursor.close()
    return matched
