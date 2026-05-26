"""
NYRR count reconciliation endpoints.

Compares stored NYRR finisher totals and live DB counts to identify
events where the sync is complete (or close enough to mark complete).
Also re-tags MMR runners without a full re-sync (recovery path when
something clobbers team_code).

Blueprint: nyrr_reconcile_bp
Routes:
  GET  /api/nyrr/reconcile                  — per-event DB counts (no API calls)
  POST /api/nyrr/reconcile/<id>/probe       — live NYRR probe + auto-mark Completed
  POST /api/nyrr/reconcile/<id>/tag-mmr     — re-tag team_code='MMR' for one event
  POST /api/nyrr/reconcile/tag-mmr-batch    — re-tag many past events (optional since=YYYY-MM-DD)
"""

from __future__ import annotations

import logging

from flask import Blueprint, request

from auth import login_required
from db import query, execute
from helpers import json_response
from nyrr_api import NyrrApiClient
from nyrr_api_models import NyrrTeam
from sync_worker_backfill import TeamBackfiller

MMR_TEAM_CODE = 'MMR'

logger = logging.getLogger(__name__)

nyrr_reconcile_bp = Blueprint('nyrr_reconcile', __name__)

# Gap threshold: if DB has >= this fraction of NYRR total, auto-mark Completed.
# Conversely, if a probe of an already-Completed row reveals coverage below this,
# demote it back to Pending so the next sync cron picks it up.
COMPLETE_THRESHOLD = 0.99


# ---------------------------------------------------------------------------
# GET /api/nyrr/reconcile
# ---------------------------------------------------------------------------

@nyrr_reconcile_bp.route('/api/nyrr/reconcile')
@login_required
def api_nyrr_reconcile_list():
    """Return per-event DB counts for all past events (no NYRR API calls)."""
    rows = query("""
        SELECT
            e.id,
            e.event_code,
            e.event_name,
            e.event_date,
            e.processing_status,
            e.nyrr_finisher_count,
            e.mmr_finisher_count,
            COUNT(r.id)                                          AS db_total,
            SUM(CASE WHEN r.team_code = 'MMR' THEN 1 ELSE 0 END) AS db_mmr
        FROM nyrr_events e
        LEFT JOIN nyrr_event_runners r ON r.nyrr_event_id = e.id
        WHERE e.event_date < CURDATE()
        GROUP BY e.id
        ORDER BY e.event_date DESC
    """)

    results = []
    for r in rows:
        nyrr_total = r['nyrr_finisher_count'] or 0
        nyrr_mmr   = r['mmr_finisher_count']      # may be NULL = never probed
        db_total   = r['db_total'] or 0
        db_mmr     = r['db_mmr'] or 0
        gap        = nyrr_total - db_total if nyrr_total else None
        pct        = round(db_total / nyrr_total * 100, 1) if nyrr_total else None
        results.append({
            'id':               r['id'],
            'event_code':       r['event_code'],
            'event_name':       r['event_name'],
            'event_date':       r['event_date'].isoformat() if r['event_date'] else None,
            'processing_status': r['processing_status'],
            'nyrr_total':       nyrr_total,   # stored from last sync/probe
            'nyrr_mmr':         nyrr_mmr,     # stored from last probe (NULL until probed)
            'db_total':         db_total,
            'db_mmr':           db_mmr,
            'gap':              gap,
            'pct':              pct,
        })

    return json_response({'ok': True, 'events': results})


# ---------------------------------------------------------------------------
# POST /api/nyrr/reconcile/<id>/probe
# ---------------------------------------------------------------------------

@nyrr_reconcile_bp.route('/api/nyrr/reconcile/<int:event_id>/probe', methods=['POST'])
@login_required
def api_nyrr_reconcile_probe(event_id):
    """
    Hit NYRR API to get live finisher + MMR counts for one event.
    If DB total >= COMPLETE_THRESHOLD of NYRR total, mark event Completed.
    Returns updated counts + whether it was marked complete.
    """
    rows = query("SELECT id, event_code FROM nyrr_events WHERE id = %s", [event_id])
    if not rows:
        return json_response({'ok': False, 'error': 'Event not found'}, 404)

    event_code = rows[0]['event_code']
    client = NyrrApiClient()

    # Live NYRR probes (pageSize=1, just reads totalItems)
    nyrr_total = client._post('runners/finishers-filter', {
        'eventCode': event_code, 'pageIndex': 1, 'pageSize': 1,
    }).get('totalItems', 0)

    nyrr_mmr = client._post('runners/finishers-filter', {
        'eventCode': event_code, 'teamCode': 'MMR', 'pageIndex': 1, 'pageSize': 1,
    }).get('totalItems', 0)

    # DB counts
    db_row = query("""
        SELECT
            COUNT(*)                                             AS db_total,
            SUM(CASE WHEN team_code = 'MMR' THEN 1 ELSE 0 END)  AS db_mmr
        FROM nyrr_event_runners
        WHERE nyrr_event_id = %s
    """, [event_id])
    db_total = db_row[0]['db_total'] or 0 if db_row else 0
    db_mmr   = db_row[0]['db_mmr']   or 0 if db_row else 0

    gap = nyrr_total - db_total if nyrr_total else None
    pct = round(db_total / nyrr_total * 100, 1) if nyrr_total else None

    # Always persist what we just learned from NYRR, regardless of threshold.
    # (Previously only nyrr_finisher_count was written, and only on auto-complete.)
    execute("""
        UPDATE nyrr_events
           SET nyrr_finisher_count = %s,
               mmr_finisher_count  = %s
         WHERE id = %s
    """, [nyrr_total, nyrr_mmr, event_id])

    # Auto-mark complete if DB coverage meets threshold; otherwise demote a stale
    # Completed row back to Pending so the next sync cron will re-fetch it.
    # (These two branches are mutually exclusive: completion gate is >= threshold;
    # demote gate is < threshold AND currently Completed.)
    marked_complete = False
    demoted         = False
    if nyrr_total > 0 and db_total >= nyrr_total * COMPLETE_THRESHOLD:
        execute("""
            UPDATE nyrr_events
               SET processing_status = 'Completed',
                   notes = CONCAT(IFNULL(notes, ''), ' [reconciled: ', %s, '/', %s, ' runners]')
             WHERE id = %s AND processing_status != 'Completed'
        """, [db_total, nyrr_total, event_id])
        marked_complete = True
        logger.info(f"✅ Reconcile: {event_code} marked Completed ({db_total}/{nyrr_total})")
    elif nyrr_total > 0 and db_total < nyrr_total * COMPLETE_THRESHOLD:
        affected = execute("""
            UPDATE nyrr_events
               SET processing_status = 'Pending',
                   notes = CONCAT(IFNULL(notes, ''), ' [demoted: ', %s, '/', %s, ' runners, ',
                                  ROUND(%s / %s * 100, 1), '%% < ',
                                  ROUND(%s * 100, 0), '%% threshold]')
             WHERE id = %s AND processing_status = 'Completed'
        """, [db_total, nyrr_total, db_total, nyrr_total, COMPLETE_THRESHOLD, event_id])
        if affected:
            demoted = True
            logger.info(f"⬇️  Reconcile: {event_code} demoted Completed→Pending "
                        f"({db_total}/{nyrr_total}, {pct}% < {int(COMPLETE_THRESHOLD*100)}%)")

    return json_response({
        'ok':             True,
        'event_code':     event_code,
        'nyrr_total':     nyrr_total,
        'nyrr_mmr':       nyrr_mmr,
        'db_total':       db_total,
        'db_mmr':         db_mmr,
        'gap':            gap,
        'pct':            pct,
        'marked_complete': marked_complete,
        'demoted':         demoted,
    })


# ---------------------------------------------------------------------------
# Shared helper — actually run the team-roster backfill for one event
# ---------------------------------------------------------------------------

def _reconcile_event_mmr(client: NyrrApiClient, event_id: int, event_code: str) -> dict:
    """
    Call teams/teamRunners for MMR + UPDATE/INSERT each row's team_code.
    Then refresh nyrr_events.mmr_runner_count so the UI sees the new total.
    Returns: {event_code, before_mmr, updated, inserted, after_mmr}.
    """
    before = query(
        "SELECT COUNT(*) AS n FROM nyrr_event_runners "
        "WHERE nyrr_event_id = %s AND team_code = %s",
        [event_id, MMR_TEAM_CODE],
    )
    before_mmr = before[0]['n'] if before else 0

    # TeamBackfiller iterates over a list of team objects — pass MMR alone.
    backfiller = TeamBackfiller(client, event_id, event_code)
    updated, inserted = backfiller.run([NyrrTeam(team_code=MMR_TEAM_CODE)])

    # Refresh the per-event counter so the UI doesn't show a stale '0 MMR'.
    execute("""
        UPDATE nyrr_events
           SET mmr_runner_count = (
               SELECT COUNT(*) FROM nyrr_event_runners
                WHERE nyrr_event_id = %s AND team_code = %s
           )
         WHERE id = %s
    """, [event_id, MMR_TEAM_CODE, event_id])

    after = query(
        "SELECT COUNT(*) AS n FROM nyrr_event_runners "
        "WHERE nyrr_event_id = %s AND team_code = %s",
        [event_id, MMR_TEAM_CODE],
    )
    after_mmr = after[0]['n'] if after else 0

    return {
        'event_code': event_code,
        'before_mmr': before_mmr,
        'updated':    updated,
        'inserted':   inserted,
        'after_mmr':  after_mmr,
    }


# ---------------------------------------------------------------------------
# POST /api/nyrr/reconcile/<id>/tag-mmr   (single event)
# ---------------------------------------------------------------------------

@nyrr_reconcile_bp.route('/api/nyrr/reconcile/<int:event_id>/tag-mmr', methods=['POST'])
@login_required
def api_nyrr_tag_mmr_one(event_id):
    """Re-tag MMR runners for one event via teams/teamRunners. No full re-sync."""
    rows = query("SELECT id, event_code FROM nyrr_events WHERE id = %s", [event_id])
    if not rows:
        return json_response({'ok': False, 'error': 'Event not found'}, 404)

    event_code = rows[0]['event_code']
    try:
        result = _reconcile_event_mmr(NyrrApiClient(), event_id, event_code)
    except Exception as e:
        logger.exception(f'tag-mmr failed for {event_code}: {e}')
        return json_response({'ok': False, 'event_code': event_code, 'error': str(e)}, 500)

    logger.info(
        f'🏃 MMR reconcile: {event_code} '
        f'{result["before_mmr"]} → {result["after_mmr"]} '
        f'(+{result["updated"]} re-tagged, +{result["inserted"]} inserted)'
    )
    return json_response({'ok': True, **result})


# ---------------------------------------------------------------------------
# POST /api/nyrr/reconcile/tag-mmr-batch  (many past events)
# ---------------------------------------------------------------------------

@nyrr_reconcile_bp.route('/api/nyrr/reconcile/tag-mmr-batch', methods=['POST'])
@login_required
def api_nyrr_tag_mmr_batch():
    """
    Re-tag MMR across many past events.

    Body (JSON, all optional):
      since  : 'YYYY-MM-DD'  — only events with event_date >= since (default = 2024-01-01)
      until  : 'YYYY-MM-DD'  — only events with event_date <= until (default = today)
      limit  : int           — cap number of events processed (default 200)
      only_zero_mmr : bool   — only events where mmr_runner_count = 0 (default True; the recovery case)

    Synchronous: iterates events and returns a per-event summary. For very large
    backlogs use 'limit' + run multiple times, or call the single-event endpoint
    from the UI per-row.
    """
    body  = request.get_json(silent=True) or {}
    since = body.get('since', '2024-01-01')
    until = body.get('until')
    limit = int(body.get('limit', 200))
    only_zero_mmr = bool(body.get('only_zero_mmr', True))

    sql  = ("SELECT id, event_code, event_date, mmr_runner_count "
            "FROM nyrr_events WHERE event_date >= %s ")
    args = [since]
    if until:
        sql  += "AND event_date <= %s "
        args.append(until)
    else:
        sql  += "AND event_date <= CURDATE() "
    if only_zero_mmr:
        sql  += "AND (mmr_runner_count IS NULL OR mmr_runner_count = 0) "
    sql += "ORDER BY event_date DESC LIMIT %s"
    args.append(limit)

    targets = query(sql, args)
    if not targets:
        return json_response({'ok': True, 'processed': 0, 'events': [], 'note': 'no candidates'})

    client  = NyrrApiClient()
    results = []
    fail_count = 0
    for ev in targets:
        try:
            r = _reconcile_event_mmr(client, ev['id'], ev['event_code'])
            results.append({'ok': True, **r})
        except Exception as e:
            fail_count += 1
            logger.warning(f'tag-mmr-batch: {ev["event_code"]} failed: {e}')
            results.append({'ok': False, 'event_code': ev['event_code'], 'error': str(e)})

    logger.info(f'🏃 MMR batch reconcile: processed {len(results)} events ({fail_count} failed)')
    return json_response({
        'ok':        True,
        'processed': len(results),
        'failed':    fail_count,
        'events':    results,
    })
