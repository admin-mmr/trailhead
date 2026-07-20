"""
Hall of Fame admin routes — mmr-admin.

Series/event management CRUD split out of api_hof.py to keep each file
under the 400-line code-health limit. Routes are registered onto the
shared ``hof_bp`` blueprint via ``register_admin_routes(bp)`` so every
URL path is unchanged and ``from api_hof import hof_bp`` still exposes them.

Admin-only routes (login_required):
  POST  /api/hof/series                                — create a series
  PATCH /api/hof/series/<int:series_id>/assign-events  — bulk-assign event series_id
  GET   /api/hof/events                                — list events for series editor
  PATCH /api/hof/events/<int:event_id>/series          — set/clear a single event's series
  PATCH /api/hof/events/<int:event_id>/distance        — set a single event's distance
  POST  /api/hof/refresh-mmr-counts                    — recompute mmr_runner_count

Public (CORS-open) helper route:
  GET   /api/hof/distances                             — distinct distance labels
"""
from __future__ import annotations

import logging

from flask import request

from auth import login_required
from db import query, execute
from helpers import json_response

logger = logging.getLogger(__name__)


def register_admin_routes(bp):
    """Attach the HOF admin/management routes onto the shared blueprint."""
    # _cors lives in api_hof. Imported lazily (not at module top) to avoid a
    # circular import: api_hof imports this module at its bottom, and this call
    # only runs after api_hof has finished defining _cors.
    from api_hof import _cors

    @bp.route('/api/hof/series', methods=['POST'])
    @login_required
    def create_series():
        """Create a new race series."""
        body = request.get_json() or {}
        name       = (body.get('name') or '').strip()
        slug       = (body.get('slug') or '').strip().lower()
        distance_km = body.get('distance_km')
        notes      = body.get('notes')

        if not name or not slug:
            return json_response({'ok': False, 'error': 'name and slug are required'}, 400)

        # Check uniqueness (MySQL 5.7 INSERT will raise IntegrityError on duplicate slug,
        # but a pre-check gives a cleaner error message).
        existing = query("SELECT id FROM nyrr_event_series WHERE slug = %s", [slug])
        if existing:
            return json_response({'ok': False, 'error': f'Slug {slug!r} already exists'}, 409)

        execute(
            "INSERT INTO nyrr_event_series (name, slug, distance_km, notes, created_at, updated_at) "
            "VALUES (%s, %s, %s, %s, NOW(), NOW())",
            [name, slug, distance_km, notes],
        )
        new_row = query("SELECT * FROM nyrr_event_series WHERE slug = %s", [slug])
        return json_response({'ok': True, 'series': new_row[0] if new_row else None}, 201)

    @bp.route('/api/hof/series/<int:series_id>/assign-events', methods=['PATCH'])
    @login_required
    def assign_events(series_id):
        """Bulk-assign nyrr_events.series_id by event_name LIKE pattern.

        Body (preview):  { "pattern": "Brooklyn Half", "dry_run": true }
        Body (confirm):  { "event_codes": ["B2026", ...] }   # only these get assigned
        Body (legacy):   { "pattern": "Brooklyn Half", "dry_run": false }  # assigns all matches
        Returns: { matched: [{event_code, event_name, event_year}, ...], updated: N }
        """
        body        = request.get_json() or {}
        pattern     = (body.get('pattern') or '').strip()
        dry_run     = bool(body.get('dry_run', False))
        event_codes = body.get('event_codes')   # explicit selection from preview checkboxes

        series_rows = query("SELECT id, name FROM nyrr_event_series WHERE id = %s", [series_id])
        if not series_rows:
            return json_response({'ok': False, 'error': 'Series not found'}, 404)

        def _row(r):
            return {'event_code': r['event_code'], 'event_name': r['event_name'], 'event_year': r['event_year']}

        # ── Confirm path: assign only the explicitly selected events ──────────────
        if event_codes is not None:
            codes = [c for c in event_codes if c]
            if not codes:
                return json_response({'ok': False, 'error': 'No events selected'}, 400)
            placeholders = ', '.join(['%s'] * len(codes))
            matched = query(
                "SELECT id, event_code, event_name, event_year FROM nyrr_events "
                f"WHERE event_code IN ({placeholders}) ORDER BY event_year DESC, event_name",
                codes,
            )
            ids = [r['id'] for r in matched]
            for event_id in ids:
                execute("UPDATE nyrr_events SET series_id = %s WHERE id = %s", [series_id, event_id])
            logger.info(f"[hof] Assigned series_id={series_id} to {len(ids)} selected events")
            return json_response({
                'ok': True,
                'dry_run': False,
                'matched': [_row(r) for r in matched],
                'updated': len(ids),
            })

        # ── Pattern path: preview (dry_run) or legacy assign-all ─────────────────
        if not pattern:
            return json_response({'ok': False, 'error': 'pattern is required'}, 400)

        like_pattern = f"%{pattern}%"
        matched = query(
            "SELECT id, event_code, event_name, event_year FROM nyrr_events "
            "WHERE event_name LIKE %s ORDER BY event_year DESC, event_name",
            [like_pattern],
        )

        if dry_run or not matched:
            return json_response({
                'ok': True,
                'dry_run': True,
                'matched': [_row(r) for r in matched],
                'matched_count': len(matched),
            })

        ids = [r['id'] for r in matched]
        for event_id in ids:
            execute(
                "UPDATE nyrr_events SET series_id = %s WHERE id = %s",
                [series_id, event_id],
            )

        logger.info(f"[hof] Assigned series_id={series_id} to {len(ids)} events matching {pattern!r}")
        return json_response({
            'ok': True,
            'dry_run': False,
            'matched': [_row(r) for r in matched],
            'updated': len(ids),
        })

    @bp.route('/api/hof/events', methods=['GET'])
    @login_required
    def list_events_for_series_edit():
        """List nyrr_events for the series editor — all events, with their series assignment.

        Query params:
          year        — filter by event_year (int)
          unassigned  — if "1", only events with series_id IS NULL
          q           — name search (LIKE)
        """
        year       = request.args.get('year', type=int)
        unassigned = request.args.get('unassigned') == '1'
        q          = (request.args.get('q') or '').strip()

        where, params = ['1=1'], []
        if year:
            where.append('e.event_year = %s'); params.append(year)
        if unassigned:
            where.append('e.series_id IS NULL')
        if q:
            where.append('e.event_name LIKE %s'); params.append(f'%{q}%')

        rows = query(f"""
            SELECT e.id, e.event_code, e.event_name, e.event_year, e.event_date,
                   e.distance, e.processing_status, e.mmr_runner_count,
                   e.series_id, s.name AS series_name
              FROM nyrr_events e
              LEFT JOIN nyrr_event_series s ON s.id = e.series_id
             WHERE {' AND '.join(where)}
             ORDER BY e.event_date DESC, e.event_name
             LIMIT 300
        """, params)
        return json_response({'ok': True, 'events': rows})

    @bp.route('/api/hof/events/<int:event_id>/series', methods=['PATCH'])
    @login_required
    def set_event_series(event_id):
        """Set (or clear) series_id on a single event.

        Body: { "series_id": 3 }   — assign
              { "series_id": null } — clear
        """
        body      = request.get_json() or {}
        series_id = body.get('series_id')   # None = clear

        if series_id is not None:
            exists = query("SELECT id FROM nyrr_event_series WHERE id = %s", [series_id])
            if not exists:
                return json_response({'ok': False, 'error': 'Series not found'}, 404)

        execute("UPDATE nyrr_events SET series_id = %s WHERE id = %s", [series_id, event_id])
        logger.info(f"[hof] event_id={event_id} series_id → {series_id}")
        return json_response({'ok': True, 'event_id': event_id, 'series_id': series_id})

    @bp.route('/api/hof/events/<int:event_id>/distance', methods=['PATCH'])
    @login_required
    def set_event_distance(event_id):
        """Update the distance label for a single event.

        Body: { "distance": "Half Marathon" }
        """
        body     = request.get_json() or {}
        distance = (body.get('distance') or '').strip() or None
        execute("UPDATE nyrr_events SET distance = %s WHERE id = %s", [distance, event_id])
        logger.info(f"[hof] event_id={event_id} distance → {distance!r}")
        return json_response({'ok': True, 'event_id': event_id, 'distance': distance})

    @bp.route('/api/hof/distances', methods=['GET', 'OPTIONS'])
    def get_distinct_distances():
        """Return distinct non-null distance values from nyrr_events, ordered by frequency."""
        if request.method == 'OPTIONS':
            return _cors(json_response({}))
        rows = query(
            "SELECT distance, COUNT(*) AS cnt FROM nyrr_events "
            "WHERE distance IS NOT NULL AND TRIM(distance) != '' "
            "GROUP BY distance ORDER BY cnt DESC"
        )
        return _cors(json_response({'ok': True, 'distances': [r['distance'] for r in rows]}))

    @bp.route('/api/hof/refresh-mmr-counts', methods=['POST'])
    @login_required
    def refresh_mmr_counts():
        """Recompute mmr_runner_count from nyrr_event_runners for Completed events.

        Targets events where processing_status='Completed' AND mmr_runner_count=0.
        Pass { "all": true } to rescan every Completed event regardless of current count.
        """
        body     = request.get_json() or {}
        scan_all = bool(body.get('all', False))

        where = "processing_status = 'Completed'"
        if not scan_all:
            where += " AND (mmr_runner_count IS NULL OR mmr_runner_count = 0)"

        events = query(f"SELECT id FROM nyrr_events WHERE {where}")
        if not events:
            return json_response({'ok': True, 'updated': 0, 'message': 'Nothing to refresh'})

        for ev in events:
            execute("""
                UPDATE nyrr_events
                   SET mmr_runner_count = (
                           SELECT COUNT(*) FROM nyrr_event_runners
                            WHERE nyrr_event_id = %s AND team_code = 'MMR'
                       ),
                       mmr_matched_count = (
                           SELECT COUNT(*) FROM nyrr_event_runners
                            WHERE nyrr_event_id = %s AND team_code = 'MMR'
                              AND mmr_member_id IS NOT NULL
                       )
                 WHERE id = %s
            """, [ev['id'], ev['id'], ev['id']])

        logger.info(f"[hof] refresh-mmr-counts: {len(events)} events (all={scan_all})")
        return json_response({'ok': True, 'updated': len(events)})
