# type: ignore
"""
NYRR Sync — Stage 3.5: slug→canonical reconciliation (Bug L).

Events discovered while *upcoming* (via the Haku widget) are stored with
slug-form event_code (e.g. 'rbc-brooklyn-half') and an events.nyrr.org
registration URL. After event_date passes, NYRR publishes results under a
canonical short code (e.g. 'H2026') at results.nyrr.org/event/<code>/finishers.

The admin Flask app has its own copy of this logic
(mmr-admin/sync_worker_reconcile.py) for in-sync + on-demand reconciliation.
This module mirrors it for the CLI / GitHub Actions pipelines, using the
same NyrrApiClient + mysql.connector cursor pattern as the rest of basecamp/ops.

Called from sync_nyrr_events.run_daily_pipeline / run_weekly_pipeline AFTER
promote_completed_events (which is when newly-past slug rows become eligible).
"""

from __future__ import annotations

import logging
import re as _re
from datetime import date
from typing import Any, Dict, Optional, Tuple

import mysql.connector

from nyrr_api import NyrrApiClient
from nyrr_api_models import NyrrEvent

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# URL helper — single source of truth
# ---------------------------------------------------------------------------

def canonical_results_url(canonical_code: str) -> str:
    return f"https://results.nyrr.org/event/{canonical_code}/finishers"


# ---------------------------------------------------------------------------
# Slug resolution (mirrors mmr-admin/sync_worker._resolve_slug_to_canonical)
# ---------------------------------------------------------------------------

def _norm(s: str) -> str:
    return _re.sub(r'[^a-z0-9 ]', '', s.lower()).strip()


def resolve_slug_to_event(
    client: NyrrApiClient,
    slug: str,
    event_name: str,
    event_year: int,
    *,
    threshold: float = 0.4,
) -> Optional[NyrrEvent]:
    """Look up a slug like 'rbc-brooklyn-half' in NYRR's events/search results
    for the relevant year and return the best-matching NyrrEvent (or None).
    Returning the full object lets callers sync ALL derived fields, not just code.
    """
    if not slug or '-' not in slug:
        return None
    if not event_year:
        return None

    try:
        events = client.search_events(year=event_year)
    except Exception as e:
        logger.warning(f"  [reconcile] events/search failed for year {event_year}: {e}")
        return None
    if not events:
        return None

    slug_words = set(_norm(slug.replace('-', ' ')).split())
    name_words = set(_norm(event_name).split()) if event_name else set()
    query_words = slug_words | name_words

    best_ev, best_score = None, 0.0
    for ev in events:
        ev_words = set(_norm(ev.event_name).split())
        if not ev_words:
            continue
        overlap = len(query_words & ev_words) / max(len(query_words), len(ev_words))
        if overlap > best_score:
            best_score, best_ev = overlap, ev

    if best_ev and best_score >= threshold:
        logger.info(f"  [reconcile] {slug!r} → {best_ev.event_code!r} (score={best_score:.2f})")
        return best_ev

    logger.warning(
        f"  [reconcile] {slug!r}: best score {best_score:.2f} < {threshold} — no match"
    )
    return None


def resolve_slug_to_canonical(
    client: NyrrApiClient,
    slug: str,
    event_name: str,
    event_year: int,
    *,
    threshold: float = 0.4,
) -> Optional[str]:
    """Thin wrapper kept for backward compatibility — prefer resolve_slug_to_event."""
    ev = resolve_slug_to_event(client, slug, event_name, event_year, threshold=threshold)
    return ev.event_code if ev else None


def _derive_updates(ev: NyrrEvent, slug: str, row: Dict[str, Any]) -> Dict[str, Any]:
    """Compute all DB field values derivable from a resolved NyrrEvent."""
    event_date = row.get('event_date')
    if event_date and (event_date if isinstance(event_date, date) else date.fromisoformat(str(event_date))) < date.today():
        is_upcoming = 0
    else:
        is_upcoming = row.get('is_upcoming', 1)

    return {
        'event_code':  ev.event_code,
        'event_url':   canonical_results_url(ev.event_code),
        'event_name':  ev.event_name or row.get('event_name'),
        'location':    ev.venue or row.get('location'),
        'distance':    ev.distance_name or row.get('distance'),
        'is_virtual':  1 if ev.is_virtual else 0,
        'is_upcoming': is_upcoming,
        'notes':       f"[reconciled: slug→canonical {slug}]",
    }


# ---------------------------------------------------------------------------
# Reconciliation pass
# ---------------------------------------------------------------------------

def fix_stale_flags(
    conn: mysql.connector.MySQLConnection,
    *,
    dry_run: bool = False,
) -> dict:
    """Fix is_upcoming and is_virtual flags that are stale across all rows.

    Two rules:
      1. is_upcoming = 0  for every row whose event_date < TODAY
      2. is_virtual  = 1  for every row whose event_name contains 'Virtual'

    Returns: {upcoming_fixed, virtual_fixed, dry_run}
    """
    cur = conn.cursor(dictionary=True)
    cur.execute("SELECT COUNT(*) AS n FROM nyrr_events WHERE event_date < CURDATE() AND is_upcoming = 1")
    upcoming_count = cur.fetchone()['n']
    cur.execute("SELECT COUNT(*) AS n FROM nyrr_events WHERE event_name LIKE '%Virtual%' AND is_virtual = 0")
    virtual_count = cur.fetchone()['n']
    cur.close()

    result = {
        'upcoming_fixed': upcoming_count,
        'virtual_fixed':  virtual_count,
        'dry_run':        dry_run,
    }

    if dry_run:
        logger.info(
            f"[fix_stale_flags] DRY-RUN: would set is_upcoming=0 on "
            f"{upcoming_count} rows, is_virtual=1 on {virtual_count} rows"
        )
        return result

    upd = conn.cursor()
    if upcoming_count:
        upd.execute(
            "UPDATE nyrr_events SET is_upcoming = 0 WHERE event_date < CURDATE() AND is_upcoming = 1"
        )
        logger.info(f"[fix_stale_flags] ✅ is_upcoming=0 applied to {upcoming_count} past events")
    if virtual_count:
        upd.execute(
            "UPDATE nyrr_events SET is_virtual = 1 WHERE event_name LIKE '%Virtual%' AND is_virtual = 0"
        )
        logger.info(f"[fix_stale_flags] ✅ is_virtual=1 applied to {virtual_count} virtual events")
    upd.close()
    conn.commit()
    return result


def reconcile_slug_event_codes(
    client: NyrrApiClient,
    conn: mysql.connector.MySQLConnection,
    *,
    include_upcoming: bool = False,
    dry_run: bool = False,
) -> dict:
    """Scan nyrr_events for past-date slug-coded rows and resolve them.

    Also runs fix_stale_flags() to correct is_upcoming / is_virtual on all rows.

    Returns summary dict: {scanned, resolved, failed, skipped_duplicate, stale_flags}.
    """
    cursor = conn.cursor(dictionary=True)
    date_clause = "" if include_upcoming else "AND event_date < CURDATE()"
    cursor.execute(f"""
        SELECT id, event_code, event_name, event_year, event_date, location, distance, is_upcoming
          FROM nyrr_events
         WHERE event_code LIKE '%-%'
           {date_clause}
         ORDER BY event_date DESC
    """)
    rows = cursor.fetchall()
    cursor.close()

    summary = {
        'scanned':            len(rows),
        'resolved':           0,
        'failed':             0,
        'skipped_duplicate':  0,
        'dry_run':            dry_run,
        'stale_flags':        fix_stale_flags(conn, dry_run=dry_run),
    }
    logger.info(
        f"[reconcile] scanning {len(rows)} slug-coded "
        f"{'past+upcoming' if include_upcoming else 'past'} rows (dry_run={dry_run})"
    )

    upd_cursor = conn.cursor()
    for row in rows:
        ev = resolve_slug_to_event(
            client, row['event_code'], row['event_name'] or '', row['event_year'] or 0
        )
        if not ev:
            summary['failed'] += 1
            continue

        updates = _derive_updates(ev, row['event_code'], row)

        # Check for clash on UNIQUE(event_code).
        check_cur = conn.cursor()
        check_cur.execute(
            "SELECT id FROM nyrr_events WHERE event_code = %s AND id != %s",
            (updates['event_code'], row['id']),
        )
        if check_cur.fetchone():
            check_cur.close()
            logger.warning(
                f"  [reconcile] skip id={row['id']}: canonical {updates['event_code']!r} "
                f"already exists on another row — manual merge needed"
            )
            summary['skipped_duplicate'] += 1
            continue
        check_cur.close()

        if dry_run:
            logger.info(
                f"  [reconcile] DRY-RUN id={row['id']} {row['event_code']!r} → {updates['event_code']!r} | {updates}"
            )
            summary['resolved'] += 1
            continue

        upd_cursor.execute(
            """
            UPDATE nyrr_events
               SET event_code  = %s,
                   event_url   = %s,
                   event_name  = %s,
                   location    = %s,
                   distance    = %s,
                   is_virtual  = %s,
                   is_upcoming = %s,
                   notes       = CONCAT(IFNULL(notes,''), ' ', %s)
             WHERE id = %s
            """,
            (
                updates['event_code'],
                updates['event_url'],
                updates['event_name'],
                updates['location'],
                updates['distance'],
                updates['is_virtual'],
                updates['is_upcoming'],
                updates['notes'],
                row['id'],
            ),
        )
        logger.info(
            f"  [reconcile] ✅ id={row['id']} {row['event_code']!r} → {updates['event_code']!r} "
            f"is_virtual={updates['is_virtual']} is_upcoming={updates['is_upcoming']}"
        )
        summary['resolved'] += 1

    if not dry_run:
        conn.commit()
    upd_cursor.close()

    logger.info(
        f"[reconcile] done: scanned={summary['scanned']} resolved={summary['resolved']} "
        f"failed={summary['failed']} skipped_duplicate={summary['skipped_duplicate']}"
    )
    return summary
