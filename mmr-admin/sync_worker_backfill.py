"""
NYRR Step-3 team-code backfill.

Split out of sync_worker.py (Bug J — CLAUDE.md 400-LOC hard rule).

Public API
----------
TeamBackfiller(client, event_id, event_code)
  .run(teams)  →  (total_backfilled: int, total_inserted: int)

Connection discipline: connections are acquired *inside* _upsert_runners and
released immediately after commit so the pool slot is free during API calls.
"""

from __future__ import annotations

import logging
from typing import Any, List

import mysql.connector.errors

from db import get_conn

logger = logging.getLogger(__name__)


class TeamBackfiller:
    """Backfill team_code on nyrr_event_runners rows for each team in an event."""

    def __init__(self, client: Any, event_id: int, event_code: str) -> None:
        self.client     = client
        self.event_id   = event_id
        self.event_code = event_code

    def run(self, teams: List[Any]) -> tuple[int, int]:
        """Process all teams. Returns (total_backfilled, total_inserted)."""
        total_backfilled = 0
        total_inserted   = 0
        for team in teams:
            team_code = team.code
            all_runners = self.client.get_team_runners(self.event_code, team_code)
            u, i = self._process_team(team_code, all_runners)
            total_backfilled += u
            total_inserted   += i
        return total_backfilled, total_inserted

    # ------------------------------------------------------------------
    # Split-by-size → split-by-gender → split-by-age-group
    # ------------------------------------------------------------------

    def _process_team(self, team_code: str, all_runners: list, depth: int = 0) -> tuple[int, int]:
        indent = "    " * depth
        if len(all_runners) <= 500:
            return self._upsert_runners(team_code, all_runners)

        logger.info(f"{indent}├─ {team_code}: {len(all_runners)} runners > 500, splitting by gender...")
        updates = inserts = 0
        genders: dict = {}
        for runner in all_runners:
            g = runner.gender or 'null'
            genders.setdefault(g, []).append(runner)

        for g in ('M', 'W', 'X', 'null'):
            bucket = genders.get(g, [])
            if not bucket:
                continue
            if len(bucket) <= 500:
                u, i = self._upsert_runners(team_code, bucket)
            else:
                logger.info(f"{indent}│   └─ Still > 500 for gender={g}, splitting by age group...")
                u = i = 0
                age_groups: dict = {}
                for runner in bucket:
                    grp = (runner.age or 0) // 5 * 5
                    age_groups.setdefault(grp, []).append(runner)
                for grp in sorted(age_groups):
                    uu, ii = self._upsert_runners(team_code, age_groups[grp])
                    u += uu; i += ii
            updates += u; inserts += i
        return updates, inserts

    def _upsert_runners(self, team_code: str, runners: list) -> tuple[int, int]:
        """UPDATE existing rows by runner_id; INSERT any that Step-1 missed.

        Acquires and releases a pool connection per call so the slot is free
        while the caller is doing NYRR API work between teams.
        """
        if not runners:
            return 0, 0

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
            ON DUPLICATE KEY UPDATE team_code = VALUES(team_code), scan_timestamp = NOW()
        """

        conn = get_conn()
        cursor = conn.cursor()
        try:
            updates = 0
            missing = []
            for r in runners:
                try:
                    cursor.execute(update_sql, (team_code, self.event_id, str(r.runner_id)))
                    if cursor.rowcount > 0:
                        updates += cursor.rowcount
                    else:
                        missing.append(r)
                except mysql.connector.errors.DatabaseError as e:
                    logger.warning(f"Team-backfill UPDATE failed for runner {r.runner_id} ({team_code}): {e}")

            inserts = 0
            for r in missing:
                try:
                    cursor.execute(insert_sql, (
                        self.event_id, str(r.runner_id),
                        f"{r.first_name} {r.last_name}".strip(),
                        r.first_name, r.last_name,
                        r.age, r.gender,
                        getattr(r, 'city', '') or '',
                        r.state_province, r.bib,
                        r.overall_time, r.pace,
                        r.overall_place, r.gender_place,
                        team_code,
                    ))
                    inserts += cursor.rowcount or 0
                except mysql.connector.errors.DatabaseError as e:
                    logger.warning(f"Team-backfill INSERT failed for runner {r.runner_id} ({team_code}): {e}")

            conn.commit()
            return updates, inserts
        except Exception:
            conn.rollback()
            raise
        finally:
            cursor.close()
            conn.close()  # returns slot to pool
