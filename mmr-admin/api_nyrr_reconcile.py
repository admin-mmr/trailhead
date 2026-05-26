"""
NYRR count reconciliation endpoints.

Compares stored NYRR finisher totals and live DB counts to identify
events where the sync is complete (or close enough to mark complete).

Blueprint: nyrr_reconcile_bp
Routes:
  GET  /api/nyrr/reconcile          — per-event DB counts (fast, no API calls)
  POST /api/nyrr/reconcile/<id>/probe — live NYRR probe for one event;
                                        auto-marks Completed if gap within threshold
"""

from __future__ import annotations

import logging

from flask import Blueprint, request

from auth import login_required
from db import query, execute
from helpers import json_response
from nyrr_api import NyrrApiClient

logger = logging.getLogger(__name__)

nyrr_reconcile_bp = Blueprint('nyrr_reconcile', __name__)

# Gap threshold: if DB has >= this fraction of NYRR total, auto-mark complete
COMPLETE_THRESHOLD = 0.98


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
            'nyrr_total':       nyrr_total,   # stored from last sync
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

    # Auto-mark complete if DB coverage meets threshold
    marked_complete = False
    if nyrr_total > 0 and db_total >= nyrr_total * COMPLETE_THRESHOLD:
        execute("""
            UPDATE nyrr_events
               SET processing_status   = 'Completed',
                   nyrr_finisher_count = %s,
                   notes = CONCAT(IFNULL(notes, ''), ' [reconciled: ', %s, '/', %s, ' runners]')
             WHERE id = %s AND processing_status != 'Completed'
        """, [nyrr_total, db_total, nyrr_total, event_id])
        marked_complete = True
        logger.info(f"✅ Reconcile: {event_code} marked Completed ({db_total}/{nyrr_total})")

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
    })
