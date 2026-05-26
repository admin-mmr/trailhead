# type: ignore
"""
NYRR Sync — Per-runner upsert + team-roster backfill helpers.

Split out of sync_nyrr_ingest.py to stay under the 400-LOC hard rule.

Functions
---------
upsert_runner(cursor, event_id, runner, event_date, *, is_upcoming, is_registered_only)
    INSERT … ON DUPLICATE KEY UPDATE for one nyrr_event_runners row.
    Critical detail: team_code is COALESCE-protected on UPDATE so an
    incoming NULL/empty value from finishers-filter (Pass 1 for completed
    events) does NOT clobber a previously-set 'MMR' tag.

backfill_team_runners(client, conn, event_id, event_code, team_code='MMR')
    Pass 3 — calls teams/teamRunners, UPDATEs team_code on matching rows
    by (event_id, nyrr_runner_id), INSERTs any runners Pass-1 missed.
    Idempotent. Used by both the CLI ingest pipeline and the admin
    "🏷 Re-tag" reconciliation endpoint (via TeamBackfiller).
"""

from __future__ import annotations

import logging
from typing import Any, Tuple

import mysql.connector

from nyrr_api import NyrrApiClient, NyrrFinisher
from sync_nyrr_helpers import TEAM_CODE

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pass 1 / Pass 2 per-row upsert
# ---------------------------------------------------------------------------

def upsert_runner(
    cursor,
    event_id: int,
    runner: NyrrFinisher,
    event_date: Any,
    is_upcoming: bool = False,
    is_registered_only: bool = False,
) -> int:
    """Upsert a single runner row.

    Returns cursor.rowcount from MySQL's ON DUPLICATE KEY UPDATE:
      1 = new row inserted
      2 = existing row updated with changed values
      0 = existing row matched but no values changed
    """
    full_name = f"{runner.first_name} {runner.last_name}".strip()
    cursor.execute("""
        INSERT INTO nyrr_event_runners
            (nyrr_event_id, nyrr_runner_id, runner_name, first_name, last_name,
             age, gender, city, state_province, bib_number,
             finish_time, pace, overall_place, gender_place,
             age_grade_time, age_grade_place, age_grade_percent,
             team_code, is_registered_only, scan_timestamp)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        ON DUPLICATE KEY UPDATE
            runner_name        = VALUES(runner_name),
            first_name         = VALUES(first_name),
            last_name          = VALUES(last_name),
            age                = VALUES(age),
            gender             = VALUES(gender),
            city               = VALUES(city),
            state_province     = VALUES(state_province),
            bib_number         = VALUES(bib_number),
            finish_time        = VALUES(finish_time),
            pace               = VALUES(pace),
            overall_place      = VALUES(overall_place),
            gender_place       = VALUES(gender_place),
            age_grade_time     = VALUES(age_grade_time),
            age_grade_place    = VALUES(age_grade_place),
            age_grade_percent  = VALUES(age_grade_percent),
            -- Preserve existing team_code when incoming value is NULL/empty.
            -- Finishers-filter (Pass 1 for completed events) doesn't return
            -- team info, so blindly writing VALUES(team_code) would clobber
            -- a previously-set 'MMR' tag with NULL on every re-ingest.
            team_code          = COALESCE(NULLIF(VALUES(team_code), ''), team_code),
            is_registered_only = VALUES(is_registered_only),
            scan_timestamp     = NOW()
    """, (
        event_id,
        str(runner.runner_id),
        full_name,
        runner.first_name,
        runner.last_name,
        runner.age,
        runner.gender,
        getattr(runner, 'city', '') or '',
        runner.state_province,
        runner.bib,
        runner.overall_time,
        runner.pace,
        runner.overall_place,
        runner.gender_place,
        getattr(runner, 'age_grade_time', '') or '',
        getattr(runner, 'age_grade_place', None),
        getattr(runner, 'age_grade_percent', None),
        runner.team_code or None,
        int(is_registered_only),
    ))
    return cursor.rowcount


# ---------------------------------------------------------------------------
# Pass 3 — team-roster backfill (authoritative source for team_code)
# ---------------------------------------------------------------------------

def backfill_team_runners(
    client: NyrrApiClient,
    conn: mysql.connector.MySQLConnection,
    event_id: int,
    event_code: str,
    team_code: str = TEAM_CODE,
) -> Tuple[int, int]:
    """
    Pass 3 — Tag/insert runners using the team-roster endpoint.

    Why this exists:
      For *completed* events, Pass 1 streams via finishers-filter which does
      NOT carry team info, so every row arrives with team_code = NULL.
      teams/teamRunners is the only authoritative source for the MMR roster
      on a given event. We call it after Pass 2 and either:
        - UPDATE existing row by (event_id, nyrr_runner_id) → set team_code
        - INSERT a new row if Pass 1 missed it (rare; MMR runner not in finisher
          shards yet, e.g. results still being published)

    Idempotent. Safe to re-run. For upcoming events this is a redundant
    re-tag of rows Pass 1 already wrote, but it's cheap so we always run it.

    Returns: (updated_rows, inserted_rows)
    """
    try:
        runners = client.get_team_runners(event_code, team_code)
    except Exception as e:
        logger.warning(f'  [pass3] get_team_runners failed for {event_code}/{team_code}: {e}')
        return (0, 0)

    if not runners:
        logger.info(f'  [pass3] team {team_code} has 0 runners in {event_code} '
                    f'(team did not register / no finishers under this banner)')
        return (0, 0)

    update_sql = """
        UPDATE nyrr_event_runners
           SET team_code = %s, scan_timestamp = NOW()
         WHERE nyrr_event_id = %s AND nyrr_runner_id = %s
    """
    insert_sql = """
        INSERT INTO nyrr_event_runners
          (nyrr_event_id, nyrr_runner_id, runner_name, first_name, last_name,
           age, gender, city, state_province, bib_number,
           finish_time, pace, overall_place, gender_place,
           team_code, scan_timestamp)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        ON DUPLICATE KEY UPDATE
            team_code      = VALUES(team_code),
            scan_timestamp = NOW()
    """

    cursor = conn.cursor()
    updated = inserted = 0
    try:
        for r in runners:
            rid = str(r.runner_id)
            cursor.execute(update_sql, (team_code, event_id, rid))
            if cursor.rowcount > 0:
                updated += 1
                continue
            # Pass-1 didn't capture this runner — insert with team_code set.
            cursor.execute(insert_sql, (
                event_id, rid,
                f"{r.first_name} {r.last_name}".strip(),
                r.first_name, r.last_name,
                r.age, r.gender,
                getattr(r, 'city', '') or '',
                r.state_province, r.bib,
                r.overall_time, r.pace,
                r.overall_place, r.gender_place,
                team_code,
            ))
            inserted += 1
        conn.commit()
    finally:
        cursor.close()

    logger.info(f'  [pass3] team {team_code}: {updated} re-tagged, '
                f'{inserted} inserted (missed by Pass 1)')
    return (updated, inserted)
