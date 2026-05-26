# type: ignore
"""
NYRR Sync — shared helpers.

Constants, DB connection, and stateless utility functions used across the
discovery / ingest / matching modules. Split out of sync_nyrr_events.py to
keep individual files under the 400-LOC budget (CLAUDE.md hard rule).
"""

from __future__ import annotations

import logging
import os
from datetime import date
from typing import Optional
from urllib.parse import urlparse

import mysql.connector

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TEAM_CODE = 'MMR'
API_SLEEP_SECONDS = 2.0  # polite delay between NYRR API calls


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def _db_params() -> dict:
    """Resolve DB connection params from MYSQL_* vars or DATABASE_URL fallback."""
    host = os.environ.get('MYSQL_HOST')
    if host:
        return {
            'host':     host,
            'user':     os.environ.get('MYSQL_USER'),
            'password': os.environ.get('MYSQL_PASSWORD'),
            'database': os.environ.get('MYSQL_DATABASE'),
        }
    # Fall back to DATABASE_URL (set by load-env.sh from macOS Keychain)
    db_url = os.environ.get('DATABASE_URL', '')
    parsed = urlparse(db_url)
    return {
        'host':     parsed.hostname or 'localhost',
        'user':     parsed.username or 'root',
        'password': parsed.password or '',
        'database': (parsed.path or '/mmrdb').lstrip('/').split('?')[0],
    }


def get_db_connection() -> mysql.connector.MySQLConnection:
    """Create a MySQL connection from environment variables."""
    params = _db_params()
    return mysql.connector.connect(
        **params,
        ssl_disabled=False,
        autocommit=False,
        charset='utf8mb4',
        collation='utf8mb4_unicode_ci',
    )


def normalize_name(name: str) -> str:
    """Case-insensitive, whitespace-collapsed name for matching."""
    return ' '.join(name.strip().lower().split())


def is_upcoming_event(event_date: date) -> bool:
    """Return True if event_date is in the future."""
    return event_date > date.today()


# ---------------------------------------------------------------------------
# Processing log + propagation
# ---------------------------------------------------------------------------

def append_processing_log(
    cursor,
    event_id: Optional[int],
    triggered_by: str,
    status: str,
    rows_written: int,
    error_details: str = '',
) -> None:
    """Append a row to nyrr_processing_log."""
    cursor.execute("""
        INSERT INTO nyrr_processing_log
            (nyrr_event_id, triggered_by, run_status, rows_written, error_details)
        VALUES (%s, %s, %s, %s, %s)
    """, (
        event_id,
        triggered_by,
        status,
        rows_written,
        error_details[:2000] if error_details else None,
    ))


def propagate_match(cursor, runner_name: str, mmr_member_id: str) -> int:
    """
    When a match is confirmed (auto or manual), backfill mmr_member_id
    across ALL nyrr_event_runners rows where runner_name matches
    (case-insensitive). This links a person across their entire race history
    with one confirmation.

    Also updates mmr_matched_count on affected nyrr_events.

    Returns: number of rows updated.
    """
    cursor.execute("""
        UPDATE nyrr_event_runners
        SET mmr_member_id = %s,
            match_method = COALESCE(match_method, 'auto_name'),
            matched_by = COALESCE(matched_by, 'System'),
            matched_at = COALESCE(matched_at, NOW())
        WHERE LOWER(TRIM(runner_name)) = LOWER(TRIM(%s))
          AND (mmr_member_id IS NULL OR mmr_member_id = '')
    """, (mmr_member_id, runner_name))
    propagated = cursor.rowcount

    if propagated > 0:
        logger.info(f'    [propagate] Backfilled {propagated} historical rows '
                     f'for "{runner_name}" → {mmr_member_id}')

    return propagated


def update_matched_counts(
    conn: mysql.connector.MySQLConnection,
    event_id: Optional[int] = None,
) -> None:
    """
    Recompute mmr_matched_count on nyrr_events from actual data.
    If event_id is provided, only update that event; otherwise update all.
    """
    cursor = conn.cursor()

    if event_id:
        cursor.execute("""
            UPDATE nyrr_events e
            SET mmr_matched_count = (
                SELECT COUNT(*)
                FROM nyrr_event_runners er
                WHERE er.nyrr_event_id = e.id
                  AND er.mmr_member_id IS NOT NULL
            )
            WHERE e.id = %s
        """, (event_id,))
    else:
        cursor.execute("""
            UPDATE nyrr_events e
            SET mmr_matched_count = (
                SELECT COUNT(*)
                FROM nyrr_event_runners er
                WHERE er.nyrr_event_id = e.id
                  AND er.mmr_member_id IS NOT NULL
            )
        """)

    conn.commit()
    cursor.close()


# ---------------------------------------------------------------------------
# Birth year inference (Section 6.5)
# ---------------------------------------------------------------------------

def infer_birth_year(
    conn: mysql.connector.MySQLConnection,
) -> int:
    """
    NYRR age + event_year → YearBornGuess.
    Updates members.YearBornGuess where we have age data and member match.

    Returns: number of members updated.
    """
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE members m
        INNER JOIN (
            SELECT er.mmr_member_id,
                   ROUND(AVG(e.event_year - er.age)) AS guess_year
            FROM nyrr_event_runners er
            INNER JOIN nyrr_events e ON e.id = er.nyrr_event_id
            WHERE er.mmr_member_id IS NOT NULL
              AND er.age IS NOT NULL
            GROUP BY er.mmr_member_id
        ) sub ON sub.mmr_member_id = m.MemberID
        SET m.YearBornGuess = sub.guess_year
        WHERE m.YearBornGuess IS NULL
    """)
    updated = cursor.rowcount
    conn.commit()
    cursor.close()

    if updated > 0:
        logger.info(f'[birth_year] Updated YearBornGuess for {updated} members')
    return updated
