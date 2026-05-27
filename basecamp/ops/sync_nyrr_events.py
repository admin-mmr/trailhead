# type: ignore
#!/usr/bin/env python3
"""
NYRR Event Sync Pipeline — Phase 2

Port of web-apps/gas/nyrr/src/pipeline.ts to Python + MySQL.
Handles:
  1. Event discovery       — fetch new events from NYRR API, upsert into nyrr_events
  2. Registrant refresh    — re-scan upcoming events for new registrants
  3. Completed promotion   — flip is_upcoming when event date has passed
  4. Result ingestion      — fetch team runners + member-ID runners, upsert rows
  5. Auto-matching         — inline Tier 1 (known name) + Tier 2 (unique last name)
  6. Match propagation     — backfill mmr_member_id across all historical rows

Tables: nyrr_events, nyrr_event_runners, nyrr_processing_log

Layout: sync_nyrr_helpers / sync_nyrr_discovery / sync_nyrr_ingest /
        sync_nyrr_matching / sync_nyrr_backfill / sync_nyrr_events (this file)

Usage:
    # Daily recurring (batch of 10):
    python sync_nyrr_events.py --mode daily --batch-size 10

    # Weekly full run (no batch limit):
    python sync_nyrr_events.py --mode weekly

    # Manual single-event reprocess:
    python sync_nyrr_events.py --mode single --event-code 26WASH
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime
from typing import Any, Dict

import mysql.connector

# Add basecamp/python to import path so we can pull in nyrr_api.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'python'))

from nyrr_api import NyrrApiClient

from sync_nyrr_helpers import (
    get_db_connection,
    infer_birth_year,
    reset_event_statuses,
    update_matched_counts,
)
from sync_nyrr_discovery import (
    discover_events,
    enrich_stale_event_metadata,
    promote_completed_events,
    refresh_upcoming_registrants,
)
from sync_nyrr_ingest import (
    ingest_event_runners,
    process_pending_events,
)
from sync_nyrr_matching import run_auto_matcher
from sync_nyrr_reconcile import reconcile_slug_event_codes
from sync_nyrr_backfill import run_backfill_mmr_only

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# ===================================================================
# Orchestrators (called by __main__ / GitHub Actions)
# ===================================================================

def run_daily_pipeline(
    client: NyrrApiClient,
    conn: mysql.connector.MySQLConnection,
    batch_size: int = 10,
) -> Dict[str, Any]:
    """
    Daily pipeline (sync-nyrr-recurring.yml):
      1. Discover new events
      2. Promote completed events
      3. Refresh upcoming registrants
      4. Process pending events (batch limited)
      5. Auto-match inline (Tier 1 + 2)
      6. Update dashboard counters
      7. Infer birth years

    Returns: summary dict for logging.
    """
    logger.info('========== DAILY NYRR PIPELINE START ==========')
    summary: Dict[str, Any] = {
        'mode': 'daily',
        'batch_size': batch_size,
        'started_at': datetime.utcnow().isoformat(),
    }

    try:
        # Step 1: Discover new events
        summary['new_events'] = discover_events(client, conn)

        # Step 2: Promote completed
        summary['events_promoted'] = promote_completed_events(conn)

        # Step 2.5 (Bug L): reconcile slug-coded past-date rows to canonical
        # NYRR eventCodes. Must run AFTER promote and BEFORE process_pending
        # so newly-completed events get the right code before we fetch finishers.
        summary['slug_reconciliation'] = reconcile_slug_event_codes(client, conn)

        # Step 3: Refresh upcoming registrants
        summary['registrant_rows'] = refresh_upcoming_registrants(client, conn)

        # Step 4 + 5: Process pending (auto-match runs inline)
        events_processed, rows_written = process_pending_events(
            client, conn, batch_size=batch_size,
        )
        summary['events_processed'] = events_processed
        summary['rows_written'] = rows_written

        # Step 6: Ensure all matched counts are current
        update_matched_counts(conn)

        # Step 7: Infer birth years
        summary['birth_years_inferred'] = infer_birth_year(conn)

        summary['status'] = 'success'
        logger.info(f'========== DAILY PIPELINE SUCCESS: {summary} ==========')

    except Exception as e:
        summary['status'] = 'failed'
        summary['error'] = str(e)
        logger.error(f'========== DAILY PIPELINE FAILED: {e} ==========')
        raise

    finally:
        summary['finished_at'] = datetime.utcnow().isoformat()

    return summary


def run_weekly_pipeline(
    client: NyrrApiClient,
    conn: mysql.connector.MySQLConnection,
) -> Dict[str, Any]:
    """
    Weekly pipeline (sync-nyrr-weekly.yml):
      Same as daily but with NO batch limit on pending events.

    Returns: summary dict for logging.
    """
    logger.info('========== WEEKLY NYRR PIPELINE START ==========')
    summary: Dict[str, Any] = {
        'mode': 'weekly',
        'batch_size': None,
        'started_at': datetime.utcnow().isoformat(),
    }

    try:
        summary['new_events'] = discover_events(client, conn)
        # Enrich metadata for events with NULL distance_km/weather/photo_url
        # (pre-V030 rows or events whose enrichment failed on insert).
        # Weekly-only — daily pipeline skips this to stay fast.
        summary['events_enriched'] = enrich_stale_event_metadata(client, conn)
        summary['events_promoted'] = promote_completed_events(conn)
        # Bug L: reconcile slug-coded past-date rows before result ingestion.
        # Weekly mode also tries upcoming rows (NYRR sometimes publishes the
        # canonical code days before the event).
        summary['slug_reconciliation'] = reconcile_slug_event_codes(
            client, conn, include_upcoming=True,
        )
        summary['registrant_rows'] = refresh_upcoming_registrants(client, conn)

        events_processed, rows_written = process_pending_events(
            client, conn, batch_size=None,  # no limit
        )
        summary['events_processed'] = events_processed
        summary['rows_written'] = rows_written

        update_matched_counts(conn)
        summary['birth_years_inferred'] = infer_birth_year(conn)

        summary['status'] = 'success'
        logger.info(f'========== WEEKLY PIPELINE SUCCESS: {summary} ==========')

    except Exception as e:
        summary['status'] = 'failed'
        summary['error'] = str(e)
        logger.error(f'========== WEEKLY PIPELINE FAILED: {e} ==========')
        raise

    finally:
        summary['finished_at'] = datetime.utcnow().isoformat()

    return summary


def run_reconcile_only(
    client: NyrrApiClient,
    conn: mysql.connector.MySQLConnection,
    include_upcoming: bool = False,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Bug L: standalone slug→canonical reconciliation pass.

    Useful for backfilling existing slug rows without running the full pipeline.
    Returns the reconciliation summary directly.
    """
    logger.info('========== RECONCILE-ONLY START ==========')
    summary: Dict[str, Any] = {
        'mode': 'reconcile',
        'started_at': datetime.utcnow().isoformat(),
    }
    try:
        summary['slug_reconciliation'] = reconcile_slug_event_codes(
            client, conn,
            include_upcoming=include_upcoming,
            dry_run=dry_run,
        )
        summary['status'] = 'success'
        logger.info(f'========== RECONCILE-ONLY SUCCESS: {summary} ==========')
    except Exception as e:
        summary['status'] = 'failed'
        summary['error'] = str(e)
        logger.error(f'========== RECONCILE-ONLY FAILED: {e} ==========')
        raise
    finally:
        summary['finished_at'] = datetime.utcnow().isoformat()
    return summary


def run_single_event(
    client: NyrrApiClient,
    conn: mysql.connector.MySQLConnection,
    event_code: str,
    triggered_by: str = 'Manual',
) -> Dict[str, Any]:
    """
    Reprocess a single event by event_code.
    """
    logger.info(f'========== SINGLE EVENT: {event_code} ==========')
    cursor = conn.cursor(dictionary=True)
    cursor.execute(
        "SELECT id, event_code, event_name, event_date, is_upcoming "
        "FROM nyrr_events WHERE event_code = %s",
        (event_code,)
    )
    event = cursor.fetchone()
    cursor.close()

    if not event:
        raise ValueError(f'Event "{event_code}" not found in nyrr_events')

    rows = ingest_event_runners(client, conn, event, triggered_by=triggered_by)
    matched = run_auto_matcher(conn, event_id=event['id'])
    update_matched_counts(conn, event_id=event['id'])

    # Post-run counts
    cur2 = conn.cursor(dictionary=True)
    cur2.execute("""
        SELECT
            COUNT(*) AS total,
            SUM(team_code = 'MMR') AS mmr
        FROM nyrr_event_runners
        WHERE nyrr_event_id = %s
    """, (event['id'],))
    counts = cur2.fetchone() or {}
    cur2.close()
    total_runners = counts.get('total') or 0
    mmr_runners   = counts.get('mmr') or 0

    logger.info(
        f'  Runners in DB: {total_runners} total, {mmr_runners} MMR, '
        f'{matched} auto-matched'
    )

    return {
        'mode': 'single',
        'event_code': event_code,
        'rows_written': rows,
        'total_runners': total_runners,
        'mmr_runners': mmr_runners,
        'auto_matched': matched,
        'status': 'success',
    }


# ===================================================================
# CLI Entry Point
# ===================================================================

def main() -> None:
    parser = argparse.ArgumentParser(
        description='NYRR Event Sync Pipeline — Phase 2'
    )
    parser.add_argument(
        '--mode', choices=['daily', 'weekly', 'single', 'reconcile', 'backfill-mmr-only'],
        default='daily',
        help='Pipeline mode (default: daily). "reconcile" runs only the '
             'Bug L slug→canonical pass. "backfill-mmr-only" loads MMR team '
             'runners for historical events (pre-2025 by default).',
    )
    parser.add_argument(
        '--batch-size', type=int, default=10,
        help='Max events per run in daily mode (default: 10)',
    )
    parser.add_argument(
        '--event-code', type=str, default=None,
        help='Event code for single-event mode',
    )
    parser.add_argument(
        '--triggered-by', type=str, default='System',
        help='Who triggered this run (default: System)',
    )
    parser.add_argument(
        '--include-upcoming', action='store_true',
        help='reconcile mode: also try to resolve slug-coded upcoming rows',
    )
    parser.add_argument(
        '--dry-run', action='store_true',
        help='reconcile/backfill-mmr-only mode: report planned changes without writing',
    )
    parser.add_argument(
        '--year-from', type=int, default=2015,
        help='backfill-mmr-only mode: first year to backfill (default: 2015)',
    )
    parser.add_argument(
        '--year-to', type=int, default=2024,
        help='backfill-mmr-only mode: last year to backfill (default: 2024)',
    )
    parser.add_argument(
        '--reprocess-all', action='store_true',
        help='weekly mode: reset all past Completed/Error events to Pending '
             'before running, so every event is re-fetched. Safe to re-run '
             '(upsert never duplicates rows).',
    )
    args = parser.parse_args()

    # Validate
    if args.mode == 'single' and not args.event_code:
        parser.error('--event-code is required for single mode')

    # Init API client + DB
    client = NyrrApiClient()
    conn = get_db_connection()

    try:
        if args.mode == 'daily':
            summary = run_daily_pipeline(client, conn, batch_size=args.batch_size)
        elif args.mode == 'weekly':
            if args.reprocess_all:
                reset_summary = reset_event_statuses(conn, dry_run=args.dry_run)
                logger.info(f'[reprocess-all] Reset summary: {reset_summary}')
            summary = run_weekly_pipeline(client, conn)
        elif args.mode == 'single':
            summary = run_single_event(
                client, conn, args.event_code,
                triggered_by=args.triggered_by,
            )
        elif args.mode == 'reconcile':
            summary = run_reconcile_only(
                client, conn,
                include_upcoming=args.include_upcoming,
                dry_run=args.dry_run,
            )
        elif args.mode == 'backfill-mmr-only':
            summary = run_backfill_mmr_only(
                client, conn,
                year_from=args.year_from,
                year_to=args.year_to,
                dry_run=args.dry_run,
            )
        else:
            parser.error(f'Unknown mode: {args.mode}')

        logger.info(f'Pipeline complete: {summary}')

        if summary.get('status') != 'success':
            sys.exit(1)

    except Exception as e:
        logger.error(f'Pipeline failed: {e}')
        sys.exit(1)

    finally:
        conn.close()


if __name__ == '__main__':
    main()
