"""
Hall of Fame backend — mmr-admin.

Blueprint: hof_bp
Prefix: /api/hof

Public read routes (CORS open):
  GET  /api/hof/series                          — list all series
  GET  /api/hof/series/<slug>                   — 8-category HOF for a series
  GET  /api/hof/event/<event_code>              — single-event HOF

Admin-only routes (login_required) live in api_hof_admin.py and are
registered onto this same blueprint (see bottom of file):
  POST  /api/hof/series                          — create a series
  PATCH /api/hof/series/<int:series_id>/assign-events — bulk-assign event series_id
  GET   /api/hof/events                          — list events for series editor
  PATCH /api/hof/events/<int:event_id>/series    — set/clear a single event's series
  PATCH /api/hof/events/<int:event_id>/distance  — set a single event's distance
  GET   /api/hof/distances                       — distinct distance labels
  POST  /api/hof/refresh-mmr-counts              — recompute mmr_runner_count

HOF categories (8): M/W × Open / 40+ / 50+ / 60+
Best time = MIN finish_time over nyrr_event_runners WHERE team_code='MMR'.
Top-3 podium per category, best-effort (skips runners with no finish_time).
"""
from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional

from flask import Blueprint, request, make_response

from db import query
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
            ANY_VALUE(e.event_name) AS event_name,
            ANY_VALUE(e.event_year) AS event_year,
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


def _run_hof_for_scope(where_clause: str, params: list) -> tuple[List[Dict[str, Any]], List[Dict]]:
    """Run all 8 HOF categories and return (results, debug_timings)."""
    results = []
    timings = []
    t_total = time.time()
    for cat in _CATEGORIES:
        sql, sql_params = _build_hof_sql(
            where_clause, params,
            gender=cat['gender'],
            min_age=cat['min_age'],
            limit=3,
        )
        t0 = time.time()
        rows = query(sql, sql_params)
        elapsed_ms = round((time.time() - t0) * 1000)
        timings.append({'category': cat['label'], 'ms': elapsed_ms, 'rows': len(rows)})
        logger.debug('[hof] %s → %dms, %d rows', cat['label'], elapsed_ms, len(rows))
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
    timings.append({'category': '__total__', 'ms': round((time.time() - t_total) * 1000), 'rows': None})
    return results, timings


# ---------------------------------------------------------------------------
# Public routes — GET /api/hof/*
# ---------------------------------------------------------------------------

@hof_bp.route('/api/hof/series', methods=['GET', 'OPTIONS'])
@handle_api_errors
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
@handle_api_errors
def get_series_hof(slug):
    """8-category Hall of Fame for a series (all editions combined)."""
    if request.method == 'OPTIONS':
        return _cors('', 204)

    series_rows = query(
        """
        SELECT
            s.id,
            s.name,
            s.slug,
            s.distance_km,
            s.notes,
            COUNT(e.id)                            AS event_count,
            SUM(e.processing_status = 'Completed') AS events_completed
        FROM nyrr_event_series s
        LEFT JOIN nyrr_events e ON e.series_id = s.id
        WHERE s.slug = %s
        GROUP BY s.id, s.name, s.slug, s.distance_km, s.notes
        """,
        [slug],
    )
    if not series_rows:
        return _cors(json_response({'ok': False, 'error': 'Series not found'}), 404)

    series = series_rows[0]
    categories, timings = _run_hof_for_scope(
        where_clause="e.series_id = %s",
        params=[series['id']],
    )
    return _cors(json_response({'ok': True, 'series': series, 'categories': categories, 'debug_timings': timings}))


@hof_bp.route('/api/hof/event/<event_code>', methods=['GET', 'OPTIONS'])
@handle_api_errors
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
    categories, timings = _run_hof_for_scope(
        where_clause="r.nyrr_event_id = %s",
        params=[event['id']],
    )
    return _cors(json_response({'ok': True, 'event': event, 'categories': categories, 'debug_timings': timings}))


# ---------------------------------------------------------------------------
# Admin routes — POST/PATCH /api/hof/* — defined in api_hof_admin.py and
# registered onto hof_bp here so app.py's `from api_hof import hof_bp` keeps
# exposing every route. Import is deferred to the bottom of the module so that
# api_hof_admin's `from api_hof import _cors` resolves cleanly.
# ---------------------------------------------------------------------------

from api_hof_admin import register_admin_routes  # noqa: E402

register_admin_routes(hof_bp)
