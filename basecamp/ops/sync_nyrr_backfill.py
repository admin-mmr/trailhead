# type: ignore
"""
NYRR Historical Backfill — MMR-only (P1e).

Extracted from sync_nyrr_events.py to keep that file under 400 LOC.

Public API:
  run_backfill_mmr_only(client, conn, year_from, year_to, dry_run)
      Iterate years, probe MMR participation per event, upsert with
      load_mode='mmr_only', and ingest team runners.

Private helpers:
  _probe_mmr_participation(client, event_code) -> int
  _upsert_event_mmr_only(conn, ev) -> int
"""

from __future__ import annotations

import logging
import os
import sys
import time
from datetime import datetime
from typing import Any, Dict

import mysql.connector

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'python'))

from nyrr_api import NyrrApiClient

from sync_nyrr_helpers import update_matched_counts
from sync_nyrr_ingest import ingest_event_runners

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _probe_mmr_participation(client: NyrrApiClient, event_code: str) -> int:
    """Return NYRR's totalItems for the MMR team in this event (0 = no participation).

    Uses a pageSize=1 probe to avoid fetching all runner data.
    """
    try:
        resp = client._post("teams/teamRunners", {
            "eventCode": event_code,
            "teamCode": "MMR",
            "pageIndex": 1,
            "pageSize": 1,
        })
        return int(resp.get("totalItems", 0))
    except Exception as e:
        logger.warning(f"  [probe] teams/teamRunners probe failed for {event_code}: {e}")
        return 0


def _upsert_event_mmr_only(
    conn: mysql.connector.MySQLConnection,
    ev,  # NyrrEvent dataclass
) -> int:
    """Insert (or update) an nyrr_events row with load_mode='mmr_only'.

    Returns the event's DB id.
    """
    cur = conn.cursor(dictionary=True)
    cur.execute(
        "SELECT id, processing_status FROM nyrr_events WHERE event_code = %s",
        (ev.event_code,),
    )
    existing = cur.fetchone()
    cur.close()

    # Parse event_date/year from start_date_time for both branches.
    raw_dt = getattr(ev, 'start_date_time', None) or ''
    event_date = raw_dt[:10] if raw_dt else None
    event_year = int(raw_dt[:4]) if raw_dt else None

    if existing:
        # Already in DB — patch load_mode and any NULL metadata fields.
        upd = conn.cursor()
        upd.execute("""
            UPDATE nyrr_events
               SET load_mode              = 'mmr_only',
                   location               = COALESCE(location,   %s),
                   distance               = COALESCE(distance,   %s),
                   distance_km            = COALESCE(distance_km, %s),
                   event_date             = COALESCE(event_date,  %s),
                   event_year             = COALESCE(event_year,  %s),
                   is_virtual             = %s,
                   weather                = COALESCE(weather,    %s),
                   teams_count            = GREATEST(COALESCE(teams_count, 0), %s),
                   has_age_graded_results = %s,
                   photo_url              = COALESCE(photo_url,  %s)
             WHERE id = %s
        """, (
            ev.venue or None,
            ev.distance_name or None,
            ev.distance_dimension or None,
            event_date,
            event_year,
            int(ev.is_virtual),
            ev.weather or None,
            ev.teams_count or 0,
            int(ev.has_age_graded_results),
            ev.photo_url or None,
            existing['id'],
        ))
        conn.commit()
        upd.close()
        logger.info(f"  [upsert] {ev.event_code!r} already exists (id={existing['id']}); patched NULL fields")
        return existing['id']

    ins = conn.cursor()
    ins.execute("""
        INSERT INTO nyrr_events
            (event_code, event_name, event_url, location, distance, distance_km,
             event_date, event_year, is_upcoming, is_virtual,
             weather, teams_count, has_age_graded_results, photo_url,
             processing_status, load_mode, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 0, %s, %s, %s, %s, %s,
                'Pending', 'mmr_only', NOW(), NOW())
    """, (
        ev.event_code,
        ev.event_name,
        f"https://results.nyrr.org/event/{ev.event_code}/finishers",
        ev.venue or None,
        ev.distance_name or None,
        ev.distance_dimension or None,
        event_date,
        event_year,
        int(ev.is_virtual),
        ev.weather or None,
        ev.teams_count or 0,
        int(ev.has_age_graded_results),
        ev.photo_url or None,
    ))
    conn.commit()
    new_id = ins.lastrowid
    ins.close()
    logger.info(f"  [upsert] {ev.event_code!r} inserted (id={new_id}) load_mode=mmr_only")
    return new_id


# ---------------------------------------------------------------------------
# Public orchestrator
# ---------------------------------------------------------------------------

def run_backfill_mmr_only(
    client: NyrrApiClient,
    conn: mysql.connector.MySQLConnection,
    year_from: int = 2015,
    year_to: int = 2024,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """
    P1e: Backfill historical events (year_from–year_to) for MMR runners only.

    For each year:
      1. Fetch all events via events/search?year=Y
      2. Probe each event for MMR participation (teams/teamRunners pageSize=1)
      3. Upsert into nyrr_events with load_mode='mmr_only' and status=Pending
      4. Ingest MMR runners via ingest_event_runners(mmr_only=True)

    Events already in the DB are updated to load_mode='mmr_only' but not re-fetched
    if they are already Completed.
    """
    logger.info(f'========== BACKFILL MMR-ONLY START ({year_from}–{year_to}) ==========')
    summary: Dict[str, Any] = {
        'mode': 'backfill-mmr-only',
        'year_from': year_from,
        'year_to': year_to,
        'dry_run': dry_run,
        'started_at': datetime.utcnow().isoformat(),
        'events_discovered': 0,
        'events_with_mmr': 0,
        'events_ingested': 0,
        'rows_written': 0,
    }

    # Local import avoids circular dependency at module load time.
    from sync_nyrr_matching import run_auto_matcher

    try:
        for year in range(year_from, year_to + 1):
            logger.info(f'  [backfill] Searching events for year={year}...')
            try:
                events = client.search_events(year=year)
            except Exception as e:
                logger.error(f'  [backfill] search_events(year={year}) failed: {e}')
                continue

            logger.info(f'  [backfill] Year {year}: {len(events)} events found')
            summary['events_discovered'] += len(events)

            for ev in events:
                mmr_count = _probe_mmr_participation(client, ev.event_code)
                if mmr_count == 0:
                    logger.info(f'    └─ {ev.event_code!r}: MMR=0, skipping')
                    time.sleep(0.2)
                    continue

                logger.info(f'    └─ {ev.event_code!r}: MMR={mmr_count} ✅')
                summary['events_with_mmr'] += 1

                if dry_run:
                    continue

                event_id = _upsert_event_mmr_only(conn, ev)

                # Skip re-fetching events already successfully completed.
                cur = conn.cursor(dictionary=True)
                cur.execute(
                    "SELECT processing_status FROM nyrr_events WHERE id = %s", (event_id,)
                )
                row = cur.fetchone()
                cur.close()
                if row and row['processing_status'] == 'Completed':
                    logger.info(f'    └─ {ev.event_code!r}: already Completed, skipping fetch')
                    continue

                # Reset to Pending so ingest_event_runners will process it.
                upd = conn.cursor()
                upd.execute(
                    "UPDATE nyrr_events SET processing_status='Pending' WHERE id=%s",
                    (event_id,),
                )
                conn.commit()
                upd.close()

                ev_dict = {
                    'id': event_id,
                    'event_code': ev.event_code,
                    'event_name': ev.event_name,
                    'event_date': getattr(ev, 'event_date', None),
                    'is_upcoming': False,
                    'load_mode': 'mmr_only',
                }
                rows = ingest_event_runners(client, conn, ev_dict,
                                            triggered_by='backfill-mmr-only',
                                            mmr_only=True)
                run_auto_matcher(conn, event_id=event_id)
                update_matched_counts(conn, event_id=event_id)

                summary['events_ingested'] += 1
                summary['rows_written'] += rows
                logger.info(f'    └─ {ev.event_code!r}: {rows} MMR runners ingested')
                time.sleep(0.5)

        summary['status'] = 'success'
        logger.info(f'========== BACKFILL MMR-ONLY DONE: {summary} ==========')
    except Exception as e:
        summary['status'] = 'failed'
        summary['error'] = str(e)
        logger.error(f'========== BACKFILL MMR-ONLY FAILED: {e} ==========')
        raise
    finally:
        summary['finished_at'] = datetime.utcnow().isoformat()

    return summary
