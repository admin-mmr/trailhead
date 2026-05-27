"""
Hall of Fame backend — mmr-admin.

Blueprint: hof_bp
Prefix: /api/hof

Public read routes (CORS open):
  GET  /api/hof/series                          — list all series
  GET  /api/hof/series/<slug>                   — 8-category HOF for a series
  GET  /api/hof/event/<event_code>              — single-event HOF

Admin-only routes (login_required):
  POST  /api/hof/series                          — create a series
  PATCH /api/hof/series/<int:series_id>/assign-events — bulk-assign event series_id

HOF categories (8): M/W × Open / 40+ / 50+ / 60+
Best time = MIN finish_time over nyrr_event_runners WHERE team_code='MMR'.
Top-3 podium per category, best-effort (skips runners with no finish_time).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from flask import Blueprint, request, make_response

from auth import login_required
from db import query, execute
from helpers import json_response, handle_api_errors

logger = logging.getLogger(__name__)

hof_bp = Blueprint('hof', __name__)

# ---------------------------------------------------------------------------
# CORS helper — public HOF read endpoints are consumed by the Next.js webapp.
# ---------------------------------------------------------------------------

def _cors(resp, status: int = 200):
    """Wrap a JSON payload in a response with open CORS headers."""
    r = make_response(resp, status)
    r.headers['Access-Control-Allow-Origin'] = '*'
    r.headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
    r.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return r


# ---------------------------------------------------------------------------
# HOF category definitions
# ---------------------------------------------------------------------------

_CATEGORIES = [
    {'key': 'men_open',  'label': 'Men Open',    'label_zh': '男子公开组',  'gender': 'M', 'min_age': None},
    {'key': 'men_40',    'label': 'Men 40+',     'label_zh': '男子40岁以上', 'gender': 'M', 'min_age': 40},
    {'key': 'men_50',    'label': 'Men 50+',     'label_zh': '男子50岁以上', 'gender': 'M', 'min_age': 50},
    {'key': 'men_60',    'label': 'Men 60+',     'label_zh': '男子60岁以上', 'gender': 'M', 'min_age': 60},
    {'key': 'women_open','label': 'Women Open',  'label_zh': '女子公开组',  'gender': 'W', 'min_age': None},
    {'key': 'women_40',  'label': 'Women 40+',   'label_zh': '女子40岁以上', 'gender': 'W', 'min_age': 40},
    {'key': 'women_50',  'label': 'Women 50+',   'label_zh': '女子50岁以上', 'gender': 'W', 'min_age': 50},
    {'key': 'women_60',  'label': 'Women 60+',   'label_zh': '女子60岁以上', 'gender': 'W', 'min_age': 60},
]


# ---------------------------------------------------------------------------
# HOF query helpers
# ---------------------------------------------------------------------------

def _build_hof_sql(
    where_clause: str,
    params: list,
    gender: str,
    min_age: Optional[int],
    limit: int = 3,
) -> tuple[str, list]:
    """Return (sql, params) for top-N runners in one HOF category.

    Ranks by TIME_TO_SEC(finish_time) ascending (lower = faster).
    Deduplicates by mmr_member_id (or runner_name when unmatched) so one
    runner only appears once per category, with their personal best.
    MySQL 5.7: no window functions → use correlated subquery for best-per-runner.
    """
    age_clause = f"AND r.age >= {int(min_age)}" if min_age else ""
    # Build the subquery that finds each runner's best time in this event/series scope.
    dedup_sql = f"""
        SELECT
            r.runner_name,
            r.gender,
            r.age,
            r.mmr_member_id,
            e.event_name,
            e.event_year,
            MIN(TIME_TO_SEC(r.finish_time)) AS best_sec,
            MIN(r.finish_time)              AS best_time
        FROM nyrr_event_runners r
        JOIN nyrr_events e ON e.id = r.nyrr_event_id
        WHERE {where_clause}
          AND r.team_code = 'MMR'
          AND r.finish_time IS NOT NULL
          AND r.finish_time != ''
          AND r.gender = %s
          {age_clause}
        GROUP BY
            COALESCE(r.mmr_member_id, r.runner_name),
            r.runner_name,
            r.gender,
            r.age,
            r.mmr_member_id
        ORDER BY best_sec ASC
        LIMIT {int(limit)}
    """
    return dedup_sql, params + [gender]


def _run_hof_for_scope(where_clause: str, params: list) -> List[Dict[str, Any]]:
    """Run all 8 HOF categories and return the combined result list."""
    results = []
    for cat in _CATEGORIES:
        sql, sql_params = _build_hof_sql(
            where_clause, params,
            gender=cat['gender'],
            min_age=cat['min_age'],
            limit=3,
        )
        rows = query(sql, sql_params)
        podium = [
            {
                'runner_name': r['runner_name'],
                'mmr_member_id': r.get('mmr_member_id'),
                'age': r.get('age'),
                'finish_time': r['best_time'],
                'event_name': r['event_name'],
                'event_year': r['event_year'],
            }
            for r in rows
        ]
        results.append({
            **cat,
            'podium': podium,
            'best': podium[0] if podium else None,
        })
    return results


# ---------------------------------------------------------------------------
# Public routes — GET /api/hof/*
# ---------------------------------------------------------------------------

@hof_bp.route('/api/hof/series', methods=['GET', 'OPTIONS'])
def get_series_list():
    """List all series with event count and whether HOF data is available."""
    if request.method == 'OPTIONS':
        return _cors('', 204)

    rows = query("""
        SELECT
            s.id,
            s.name,
            s.slug,
            s.distance_km,
            s.notes,
            COUNT(e.id)                                         AS event_count,
            SUM(e.processing_status = 'Completed')             AS events_completed,
            SUM(r.mmr_team_runners > 0)                        AS events_with_mmr
        FROM nyrr_event_series s
        LEFT JOIN nyrr_events e ON e.series_id = s.id
        LEFT JOIN (
            SELECT nyrr_event_id, COUNT(*) AS mmr_team_runners
            FROM nyrr_event_runners
            WHERE team_code = 'MMR'
            GROUP BY nyrr_event_id
        ) r ON r.nyrr_event_id = e.id
        GROUP BY s.id, s.name, s.slug, s.distance_km, s.notes
        ORDER BY s.name
    """)
    return _cors(json_response({'ok': True, 'series': rows}))


@hof_bp.route('/api/hof/series/<slug>', methods=['GET', 'OPTIONS'])
def get_series_hof(slug):
    """8-category Hall of Fame for a series (all editions combined)."""
    if request.method == 'OPTIONS':
        return _cors('', 204)

    series_rows = query(
        "SELECT id, name, slug, distance_km, notes FROM nyrr_event_series WHERE slug = %s",
        [slug],
    )
    if not series_rows:
        return _cors(json_response({'ok': False, 'error': 'Series not found'}), 404)

    series = series_rows[0]
    categories = _run_hof_for_scope(
        where_clause="e.series_id = %s",
        params=[series['id']],
    )
    return _cors(json_response({'ok': True, 'series': series, 'categories': categories}))


@hof_bp.route('/api/hof/event/<event_code>', methods=['GET', 'OPTIONS'])
def get_event_hof(event_code):
    """8-category Hall of Fame scoped to a single race edition."""
    if request.method == 'OPTIONS':
        return _cors('', 204)

    event_rows = query(
        "SELECT id, event_code, event_name, event_year, series_id FROM nyrr_events WHERE event_code = %s",
        [event_code],
    )
    if not event_rows:
        return _cors(json_response({'ok': False, 'error': 'Event not found'}), 404)

    event = event_rows[0]
    categories = _run_hof_for_scope(
        where_clause="r.nyrr_event_id = %s",
        params=[event['id']],
    )
    return _cors(json_response({'ok': True, 'event': event, 'categories': categories}))


# ---------------------------------------------------------------------------
# Admin routes — POST/PATCH /api/hof/*
# ---------------------------------------------------------------------------

@hof_bp.route('/api/hof/series', methods=['POST'])
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


@hof_bp.route('/api/hof/series/<int:series_id>/assign-events', methods=['PATCH'])
@login_required
def assign_events(series_id):
    """Bulk-assign nyrr_events.series_id by event_name LIKE pattern.

    Body: { "pattern": "Brooklyn Half", "dry_run": false }
    Returns: { matched: [event_code, ...], updated: N }
    """
    body    = request.get_json() or {}
    pattern = (body.get('pattern') or '').strip()
    dry_run = bool(body.get('dry_run', False))

    if not pattern:
        return json_response({'ok': False, 'error': 'pattern is required'}, 400)

    series_rows = query("SELECT id, name FROM nyrr_event_series WHERE id = %s", [series_id])
    if not series_rows:
        return json_response({'ok': False, 'error': 'Series not found'}, 404)

    like_pattern = f"%{pattern}%"
    matched = query(
        "SELECT id, event_code, event_name FROM nyrr_events WHERE event_name LIKE %s",
        [like_pattern],
    )

    if dry_run or not matched:
        return json_response({
            'ok': True,
            'dry_run': True,
            'matched': [r['event_code'] for r in matched],
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
        'matched': [r['event_code'] for r in matched],
        'updated': len(ids),
    })


@hof_bp.route('/api/hof/events', methods=['GET'])
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


@hof_bp.route('/api/hof/events/<int:event_id>/series', methods=['PATCH'])
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


@hof_bp.route('/api/hof/events/<int:event_id>/distance', methods=['PATCH'])
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


@hof_bp.route('/api/hof/refresh-mmr-counts', methods=['POST'])
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
