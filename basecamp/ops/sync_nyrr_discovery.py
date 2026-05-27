# type: ignore
"""
NYRR Sync — Stages 1-3.

  Stage 1: discover_events             — fetch events from NYRR API, upsert
  Stage 2: promote_completed_events    — flip is_upcoming when date passes
  Stage 3: refresh_upcoming_registrants — re-scan upcoming events for new runners

Split out of sync_nyrr_events.py so each file stays under the 400-LOC limit.
"""

from __future__ import annotations

import logging
import time
from datetime import date
from typing import List, Set

import mysql.connector

from nyrr_api import NyrrApiClient
from sync_nyrr_helpers import API_SLEEP_SECONDS, is_upcoming_event
from sync_nyrr_backfill import _enrich_event_metadata

logger = logging.getLogger(__name__)


# ===================================================================
# Stage 1: Event Discovery
# ===================================================================

def discover_events(
    client: NyrrApiClient,
    conn: mysql.connector.MySQLConnection,
) -> int:
    """
    Fetch all events from the NYRR API for the current year and previous year.
    Insert any we haven't seen before as Pending.

    Returns: number of new events inserted.
    """
    logger.info('[discover_events] Starting event discovery...')
    cursor = conn.cursor()

    # Load existing event codes into memory for fast dedup
    cursor.execute("SELECT event_code FROM nyrr_events")
    existing_codes: Set[str] = {row[0] for row in cursor.fetchall()}
    logger.info(f'[discover_events] {len(existing_codes)} existing events in DB')

    current_year = date.today().year
    years_to_scan = [current_year, current_year - 1]
    new_count = 0

    for year in years_to_scan:
        logger.info(f'[discover_events] Fetching events for year {year}...')
        try:
            api_events = client.search_events(year=year)
            logger.info(f'[discover_events] API returned {len(api_events)} events for {year}')
        except Exception as e:
            logger.error(f'[discover_events] Failed to fetch events for {year}: {e}')
            continue

        for ev in api_events:
            if ev.event_code in existing_codes:
                continue

            event_date_str = ev.start_date_time.split('T')[0] if ev.start_date_time else None
            event_date_obj = date.fromisoformat(event_date_str) if event_date_str else None
            upcoming = is_upcoming_event(event_date_obj) if event_date_obj else False
            event_year = event_date_obj.year if event_date_obj else year

            cursor.execute("""
                INSERT INTO nyrr_events
                    (event_code, event_name, event_url, location, distance,
                     distance_km, event_date, event_year, is_upcoming, is_virtual,
                     weather, teams_count, has_age_graded_results, photo_url,
                     processing_status, load_mode)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'Pending', 'full')
                ON DUPLICATE KEY UPDATE
                    event_name    = VALUES(event_name),
                    location      = COALESCE(location,  VALUES(location)),
                    distance      = COALESCE(distance,  VALUES(distance)),
                    distance_km   = COALESCE(distance_km, VALUES(distance_km)),
                    is_virtual    = VALUES(is_virtual),
                    weather       = COALESCE(weather, VALUES(weather)),
                    teams_count   = VALUES(teams_count),
                    has_age_graded_results = VALUES(has_age_graded_results),
                    photo_url     = COALESCE(photo_url, VALUES(photo_url)),
                    load_mode     = 'full',
                    updated_at    = CURRENT_TIMESTAMP
            """, (
                ev.event_code,
                ev.event_name,
                f"https://results.nyrr.org/event/{ev.event_code}/finishers",
                ev.venue or None,
                ev.distance_name or None,               # human-readable: "Half-Marathon"
                ev.distance_dimension or None,          # km float: 21.0824
                event_date_str,
                event_year,
                int(upcoming),
                int(ev.is_virtual),
                ev.weather or None,
                ev.teams_count or 0,
                int(ev.has_age_graded_results),
                ev.photo_url or None,
            ))

            existing_codes.add(ev.event_code)
            new_count += 1

            # Fetch events/details to populate distance_km, weather, photo_url,
            # teams_count, has_age_graded_results — events/search returns null/0
            # for all of these.
            event_id_row = cursor.lastrowid
            if event_id_row:
                _enrich_event_metadata(client, conn, event_id_row, ev.event_code)

        time.sleep(API_SLEEP_SECONDS)

    conn.commit()
    cursor.close()
    logger.info(f'[discover_events] Inserted {new_count} new events')
    return new_count


# ===================================================================
# Stage 1b: Enrich stale event metadata (weekly pass)
# ===================================================================

def enrich_stale_event_metadata(
    client: NyrrApiClient,
    conn: mysql.connector.MySQLConnection,
    years: List[int] | None = None,
) -> int:
    """
    Call events/details for events that are missing distance_km, weather,
    photo_url, teams_count, or has_age_graded_results (columns added in V030).

    Runs after discover_events in the weekly pipeline so pre-V030 events
    and events that had a failed enrichment on insert get patched.

    `years` limits the sweep to specific event_years (default: current + prior).
    Returns: number of events enriched.
    """
    if years is None:
        current_year = date.today().year
        years = [current_year, current_year - 1]

    placeholders = ', '.join(['%s'] * len(years))
    cursor = conn.cursor(dictionary=True)
    cursor.execute(f"""
        SELECT id, event_code
          FROM nyrr_events
         WHERE event_year IN ({placeholders})
           AND (distance_km IS NULL OR weather IS NULL OR photo_url IS NULL
                OR teams_count = 0 OR has_age_graded_results IS NULL)
         ORDER BY event_date DESC
    """, tuple(years))
    stale = cursor.fetchall()
    cursor.close()

    if not stale:
        logger.info('[enrich_stale] No stale events found — all metadata current')
        return 0

    logger.info(f'[enrich_stale] {len(stale)} events need metadata enrichment')
    for row in stale:
        _enrich_event_metadata(client, conn, row['id'], row['event_code'])
        time.sleep(API_SLEEP_SECONDS)

    logger.info(f'[enrich_stale] Enrichment pass complete ({len(stale)} events)')
    return len(stale)


# ===================================================================
# Stage 2: Promote Completed Events
# ===================================================================

def promote_completed_events(conn: mysql.connector.MySQLConnection) -> int:
    """
    Flip is_upcoming=0 and processing_status='Pending' for events whose
    date has passed. This queues them for full result ingestion on the
    next processing pass.

    Returns: number of events promoted.
    """
    logger.info('[promote_completed] Checking for completed events to promote...')
    cursor = conn.cursor()

    cursor.execute("""
        UPDATE nyrr_events
        SET is_upcoming = 0,
            processing_status = 'Pending',
            notes = CONCAT(IFNULL(notes, ''), ' Promoted from upcoming — awaiting result ingestion.')
        WHERE is_upcoming = 1
          AND event_date < CURDATE()
          AND processing_status != 'Pending'
    """)
    promoted = cursor.rowcount
    conn.commit()
    cursor.close()

    logger.info(f'[promote_completed] Promoted {promoted} events')
    return promoted


# ===================================================================
# Stage 3: Registrant Refresh (upcoming events)
# ===================================================================

def refresh_upcoming_registrants(
    client: NyrrApiClient,
    conn: mysql.connector.MySQLConnection,
) -> int:
    """
    Re-scan upcoming events to capture new registrants from the team roster.

    Returns: total rows upserted across all upcoming events.
    """
    # Imported here to avoid a circular import at module load time:
    # sync_nyrr_ingest depends on this module's symbols too.
    from sync_nyrr_ingest import ingest_event_runners

    logger.info('[refresh_upcoming] Refreshing upcoming event registrants...')
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT id, event_code, event_name, event_date, is_upcoming
        FROM nyrr_events
        WHERE is_upcoming = 1
        ORDER BY event_date ASC
    """)
    upcoming_events = cursor.fetchall()
    cursor.close()

    logger.info(f'[refresh_upcoming] Found {len(upcoming_events)} upcoming events')
    total_rows = 0

    for ev in upcoming_events:
        rows = ingest_event_runners(
            client, conn, ev,
            triggered_by='System',
            is_registrant_refresh=True,
        )
        total_rows += rows
        time.sleep(API_SLEEP_SECONDS)

    logger.info(f'[refresh_upcoming] Total registrant rows upserted: {total_rows}')
    return total_rows
