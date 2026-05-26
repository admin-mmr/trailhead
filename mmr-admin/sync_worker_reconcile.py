"""
NYRR slug → canonical reconciliation (Bug L).

Events discovered while *upcoming* (via the Haku registration widget) are stored
with a slug-form `event_code` (e.g. 'rbc-brooklyn-half') and an
`events.nyrr.org/<slug>` registration URL. After event_date passes, NYRR
publishes results under a canonical short code (e.g. 'H2026', '26RHALFS3') at
`results.nyrr.org/event/<canonical>/finishers`.

Bug D's in-sync `_resolve_slug_to_canonical` only fires when a sync is
explicitly started AND only updates `event_code` (not `event_url`). This module
provides:

  - canonical_results_url(code)       — single source of truth for URL format
  - reconcile_one(client, row, ...)   — resolve + update one row
  - reconcile_slug_event_codes(...)   — scan all past-date slug rows + reconcile

Called from:
  - sync_worker._sync_worker (pre-sync hook, also updates event_url now)
  - api_events_discovery   (POST /api/discover/reconcile-slugs, admin trigger)
  - basecamp/ops daily/weekly pipelines (CLI / GitHub Actions cron)
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any, Dict, Optional

from db import execute, query
from nyrr_api import NyrrApiClient
from nyrr_api_models import NyrrEvent
from sync_worker import _resolve_slug_to_event  # returns full NyrrEvent, not just code

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# URL helpers
# ---------------------------------------------------------------------------

def canonical_results_url(canonical_code: str) -> str:
    """Single source of truth for the results URL format.

    Matches existing rows in nyrr_events (e.g. H2026 → /event/H2026/finishers).
    """
    return f"https://results.nyrr.org/event/{canonical_code}/finishers"


def _is_slug(event_code: Optional[str]) -> bool:
    """A slug is detected by the presence of '-' — canonical codes never have them."""
    return bool(event_code) and '-' in event_code


# ---------------------------------------------------------------------------
# Per-row reconciliation
# ---------------------------------------------------------------------------

def _derive_updates(ev: NyrrEvent, slug: str, row: Dict[str, Any]) -> Dict[str, Any]:
    """Compute all DB field values that can be derived from a resolved NyrrEvent.

    Returns a plain dict of column→value pairs ready for the UPDATE statement.
    Callers can log or apply these however they like.
    """
    canonical = ev.event_code
    new_url   = canonical_results_url(canonical)

    # is_upcoming: 0 for past events, preserve current value for upcoming.
    event_date = row.get('event_date')
    if event_date and (event_date if isinstance(event_date, date) else date.fromisoformat(str(event_date))) < date.today():
        is_upcoming = 0
    else:
        is_upcoming = row.get('is_upcoming', 1)  # leave untouched if still upcoming

    return {
        'event_code': canonical,
        'event_url':  new_url,
        'event_name': ev.event_name or row.get('event_name'),
        'location':   ev.venue or row.get('location'),
        'distance':   ev.distance_name or row.get('distance'),
        'is_virtual': 1 if ev.is_virtual else 0,
        'is_upcoming': is_upcoming,
        'notes': (
            f"[reconciled: slug→canonical {slug}]"
        ),
    }


def reconcile_one(
    client: NyrrApiClient,
    row: Dict[str, Any],
    *,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Attempt to resolve one slug-coded row to its canonical NYRR eventCode.

    On success, updates ALL derivable fields from the NYRR API response:
      event_code, event_url, event_name, location, distance, is_virtual, is_upcoming.

    `row` must contain: id, event_code, event_name, event_year, event_date.

    Returns a small dict for the caller's summary:
      {id, slug, canonical, status, message, updates}
      status ∈ {'resolved', 'unchanged', 'failed', 'dry-run'}
    """
    event_id   = row['id']
    slug       = row['event_code']
    event_name = row.get('event_name', '') or ''
    event_year = row.get('event_year') or 0

    result: Dict[str, Any] = {
        'id': event_id,
        'slug': slug,
        'canonical': None,
        'status': 'unchanged',
        'message': '',
        'updates': {},
    }

    if not _is_slug(slug):
        result['message'] = 'event_code is already canonical (no hyphens)'
        return result

    ev = _resolve_slug_to_event(client, slug, event_name, event_year)
    if not ev:
        result['status']  = 'failed'
        result['message'] = (
            f"events/search returned no confident match for slug={slug!r} "
            f"(name={event_name!r}, year={event_year})"
        )
        logger.warning(f"  [reconcile] {result['message']}")
        return result

    canonical = ev.event_code
    updates   = _derive_updates(ev, slug, row)
    result['canonical'] = canonical
    result['updates']   = updates

    if dry_run:
        result['status']  = 'dry-run'
        result['message'] = f"would apply: {updates}"
        logger.info(f"  [reconcile] DRY-RUN id={event_id} {slug!r} → {canonical!r} | {updates}")
        return result

    # Guard: another row may already hold the canonical code (e.g. discovery
    # later inserted the same event under its canonical code). Detect and skip
    # rather than violating the UNIQUE(event_code) constraint.
    clash = query(
        "SELECT id FROM nyrr_events WHERE event_code = %s AND id != %s",
        [canonical, event_id],
    )
    if clash:
        result['status']  = 'failed'
        result['message'] = (
            f"canonical {canonical!r} already exists on id={clash[0]['id']}; "
            f"slug row id={event_id} is a duplicate — needs manual merge"
        )
        logger.warning(f"  [reconcile] {result['message']}")
        return result

    execute(
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
        [
            updates['event_code'],
            updates['event_url'],
            updates['event_name'],
            updates['location'],
            updates['distance'],
            updates['is_virtual'],
            updates['is_upcoming'],
            updates['notes'],
            event_id,
        ],
    )

    result['status']  = 'resolved'
    result['message'] = (
        f"event_code: {slug!r} → {canonical!r}; "
        f"is_virtual={updates['is_virtual']} is_upcoming={updates['is_upcoming']}; "
        f"location={updates['location']!r} distance={updates['distance']!r}"
    )
    logger.info(f"  [reconcile] ✅ id={event_id} {slug!r} → {canonical!r} | all fields updated")
    return result


# ---------------------------------------------------------------------------
# Stale-flag correction (runs on ALL rows, not just slug-coded ones)
# ---------------------------------------------------------------------------

def fix_stale_flags(*, dry_run: bool = False) -> Dict[str, Any]:
    """Fix is_upcoming and is_virtual flags that are stale across all rows.

    Two rules applied unconditionally:
      1. is_upcoming = 0  for every row whose event_date < TODAY
         (the sync pipeline never clears this after discovery)
      2. is_virtual  = 1  for every row whose event_name contains 'Virtual'
         (NYRR API sets isVirtual but discovery doesn't always persist it)

    Returns: {upcoming_fixed, virtual_fixed, dry_run}
    """
    upcoming_rows = query(
        "SELECT id FROM nyrr_events WHERE event_date < CURDATE() AND is_upcoming = 1"
    )
    virtual_rows = query(
        "SELECT id FROM nyrr_events WHERE event_name LIKE '%Virtual%' AND is_virtual = 0"
    )

    result = {
        'upcoming_fixed': len(upcoming_rows),
        'virtual_fixed':  len(virtual_rows),
        'dry_run':        dry_run,
    }

    if dry_run:
        logger.info(
            f"[fix_stale_flags] DRY-RUN: would set is_upcoming=0 on "
            f"{len(upcoming_rows)} rows, is_virtual=1 on {len(virtual_rows)} rows"
        )
        return result

    if upcoming_rows:
        execute(
            "UPDATE nyrr_events SET is_upcoming = 0 WHERE event_date < CURDATE() AND is_upcoming = 1"
        )
        logger.info(f"[fix_stale_flags] ✅ is_upcoming=0 applied to {len(upcoming_rows)} past events")

    if virtual_rows:
        execute(
            "UPDATE nyrr_events SET is_virtual = 1 WHERE event_name LIKE '%Virtual%' AND is_virtual = 0"
        )
        logger.info(f"[fix_stale_flags] ✅ is_virtual=1 applied to {len(virtual_rows)} virtual events")

    return result


# ---------------------------------------------------------------------------
# Batch reconciliation (the public entry point)
# ---------------------------------------------------------------------------

def reconcile_slug_event_codes(
    client: Optional[NyrrApiClient] = None,
    *,
    include_upcoming: bool = False,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Scan nyrr_events for past-date rows whose event_code is still slug-form.

    For each row, attempt slug→canonical resolution via NYRR's events/search
    and rewrite both event_code and event_url. By default only past-date rows
    are touched (an upcoming event won't have a canonical results code yet).

    Args:
      client:           reuse an existing NyrrApiClient if you have one
      include_upcoming: also try to resolve slug-coded upcoming events
                        (useful when NYRR publishes canonical codes early)
      dry_run:          report planned changes without writing

    Returns:
      {scanned, resolved, failed, unchanged, stale_flags, details: [...]}
    """
    if client is None:
        client = NyrrApiClient()

    date_clause = "" if include_upcoming else "AND event_date < CURDATE()"
    rows = query(
        f"""
        SELECT id, event_code, event_name, event_year, event_date, event_url
          FROM nyrr_events
         WHERE event_code LIKE '%-%'
           {date_clause}
         ORDER BY event_date DESC
        """
    )

    summary: Dict[str, Any] = {
        'scanned':     len(rows),
        'resolved':    0,
        'failed':      0,
        'unchanged':   0,
        'dry_run':     dry_run,
        'stale_flags': fix_stale_flags(dry_run=dry_run),
        'details':     [],
    }

    logger.info(
        f"[reconcile_slug_event_codes] Scanning {len(rows)} slug-coded "
        f"{'past+upcoming' if include_upcoming else 'past'} rows "
        f"(dry_run={dry_run})"
    )

    for row in rows:
        outcome = reconcile_one(client, row, dry_run=dry_run)
        summary['details'].append(outcome)
        if outcome['status'] in ('resolved', 'dry-run'):
            summary['resolved'] += 1
        elif outcome['status'] == 'failed':
            summary['failed'] += 1
        else:
            summary['unchanged'] += 1

    logger.info(
        f"[reconcile_slug_event_codes] done: scanned={summary['scanned']} "
        f"resolved={summary['resolved']} failed={summary['failed']} "
        f"unchanged={summary['unchanged']}"
    )
    return summary
