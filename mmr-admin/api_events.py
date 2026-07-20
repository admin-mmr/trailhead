"""
NYRR Events routes for mmr-admin.

Blueprint: events_bp
Routes: /api/events, /api/events/<id>, /api/events/<id>/runners,
        /api/events/<id>/automatch, /api/stats, /api/stats/years,
        /api/discover, /api/discover-upcoming
"""

from __future__ import annotations

import os
from datetime import date

from flask import Blueprint, request, session

from auth import login_required, require_role
from db import query, execute, get_conn
from api_events_discovery import events_discovery_bp
from helpers import json_response

events_bp = Blueprint('events', __name__)

TEAM_CODE = 'MMR'


# ---------------------------------------------------------------------------
# Event listing & detail
# ---------------------------------------------------------------------------

@events_bp.route('/api/events')
@login_required
def api_events():
    """List all NYRR events with optional filters."""
    status = request.args.get('status')
    year = request.args.get('year', type=int)
    search = request.args.get('q', '')

    sql = "SELECT * FROM nyrr_events WHERE 1=1"
    params = []

    if status:
        sql += " AND processing_status = %s"
        params.append(status)
    if year:
        sql += " AND event_year = %s"
        params.append(year)
    if search:
        sql += " AND (event_name LIKE %s OR event_code LIKE %s)"
        params.extend([f'%{search}%', f'%{search}%'])

    sql += " ORDER BY event_date DESC"
    rows = query(sql, params)

    # Get live runner counts in ONE query (LEFT JOIN + GROUP BY, not N+1)
    event_ids = [r['id'] for r in rows]
    if event_ids:
        placeholders = ','.join(['%s'] * len(event_ids))
        counts_by_event = query(f"""
            SELECT
              nyrr_event_id,
              COUNT(*) as total,
              SUM(CASE WHEN team_code = 'MMR' THEN 1 ELSE 0 END) as mmr_count,
              SUM(CASE WHEN mmr_member_id IS NOT NULL THEN 1 ELSE 0 END) as matched_count
            FROM nyrr_event_runners
            WHERE nyrr_event_id IN ({placeholders})
            GROUP BY nyrr_event_id
        """, event_ids)

        counts_map = {c['nyrr_event_id']: c for c in counts_by_event}
        for r in rows:
            counts = counts_map.get(r['id'], {})
            r['result_count'] = counts.get('total') or 0
            r['mmr_runner_count'] = counts.get('mmr_count') or 0
            r['mmr_matched_count'] = counts.get('matched_count') or 0

            mmr = r.get('mmr_runner_count') or 0
            matched = r.get('mmr_matched_count') or 0
            r['match_pct'] = round(matched / mmr * 100, 1) if mmr > 0 else 0

    return json_response({'ok': True, 'data': rows})


@events_bp.route('/api/events/<int:event_id>')
@login_required
def api_event_detail(event_id):
    """Single event detail with live runner counts."""
    rows = query("SELECT * FROM nyrr_events WHERE id = %s", [event_id])
    if not rows:
        return json_response({'ok': False, 'error': 'Not found'}, 404)

    event = rows[0]

    # Get live counts from nyrr_event_runners
    live_counts = query("""
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN team_code = 'MMR' THEN 1 ELSE 0 END) as mmr_count,
          SUM(CASE WHEN mmr_member_id IS NOT NULL THEN 1 ELSE 0 END) as matched_count
        FROM nyrr_event_runners
        WHERE nyrr_event_id = %s
    """, [event_id])

    if live_counts:
        counts = live_counts[0]
        event['result_count'] = counts.get('total') or 0
        event['mmr_runner_count'] = counts.get('mmr_count') or 0
        event['mmr_matched_count'] = counts.get('matched_count') or 0

    return json_response({'ok': True, 'data': event})


@events_bp.route('/api/events/by-code/<event_code>')
@login_required
def api_event_detail_by_code(event_code):
    """Single event detail looked up by event_code string."""
    rows = query("SELECT * FROM nyrr_events WHERE event_code = %s", [event_code.upper()])
    if not rows:
        return json_response({'ok': False, 'error': 'Not found'}, 404)
    event = rows[0]
    live_counts = query("""
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN team_code = 'MMR' THEN 1 ELSE 0 END) as mmr_count,
          SUM(CASE WHEN mmr_member_id IS NOT NULL THEN 1 ELSE 0 END) as matched_count
        FROM nyrr_event_runners
        WHERE nyrr_event_id = %s
    """, [event['id']])
    if live_counts:
        counts = live_counts[0]
        event['result_count'] = counts.get('total') or 0
        event['mmr_runner_count'] = counts.get('mmr_count') or 0
        event['mmr_matched_count'] = counts.get('matched_count') or 0
    return json_response({'ok': True, 'data': event})


@events_bp.route('/api/events/<int:event_id>/runners')
@login_required
def api_event_runners(event_id):
    """Runners for an event with optional filters."""
    team = request.args.get('team')
    matched_only = request.args.get('matched') == '1'
    unmatched_only = request.args.get('unmatched') == '1'
    search = request.args.get('q', '')

    sql = """
        SELECT er.*, e.event_code, e.event_name, e.event_date,
               m.Status        AS member_status,
               m.FirstName     AS member_first_name,
               m.LastName      AS member_last_name,
               m.Email         AS member_email,
               m.District      AS member_district,
               m.PhoneNumber   AS member_phone,
               m.Type          AS member_type,
               m.Gender        AS member_gender,
               m.Expiration    AS member_expiration,
               m.NYRRRunnerName AS member_nyrr_name
        FROM nyrr_event_runners er
        JOIN nyrr_events e ON e.id = er.nyrr_event_id
        LEFT JOIN members m ON m.MemberID = er.mmr_member_id
        WHERE er.nyrr_event_id = %s
    """
    params: list = [event_id]

    if team:
        sql += " AND er.team_code = %s"
        params.append(team)
    if matched_only:
        sql += " AND er.mmr_member_id IS NOT NULL"
    if unmatched_only:
        sql += " AND er.mmr_member_id IS NULL"
    if search:
        sql += " AND (er.runner_name LIKE %s OR er.last_name LIKE %s)"
        params.extend([f'%{search}%', f'%{search}%'])

    sql += " ORDER BY er.overall_place ASC, er.runner_name ASC"
    rows = query(sql, params)
    return json_response({'ok': True, 'data': rows, 'count': len(rows)})


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

@events_bp.route('/api/stats')
@login_required
def api_stats():
    """Dashboard summary stats with live runner counts."""
    # Get event counts and status breakdown
    event_rows = query("""
        SELECT
            COUNT(*) AS total_events,
            SUM(is_upcoming) AS upcoming_events,
            SUM(CASE WHEN processing_status = 'Pending' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN processing_status = 'InProgress' THEN 1 ELSE 0 END) AS in_progress,
            SUM(CASE WHEN processing_status = 'Completed' THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN processing_status = 'Error' THEN 1 ELSE 0 END) AS errors
        FROM nyrr_events
    """)

    # Get LIVE runner counts from nyrr_event_runners table
    runner_rows = query("""
        SELECT
            COUNT(*) AS total_runners,
            SUM(CASE WHEN team_code = 'MMR' THEN 1 ELSE 0 END) AS total_mmr_runners,
            SUM(CASE WHEN mmr_member_id IS NOT NULL THEN 1 ELSE 0 END) AS total_matched
        FROM nyrr_event_runners
    """)

    stats = event_rows[0] if event_rows else {}
    if runner_rows:
        runner_counts = runner_rows[0]
        stats['total_runners'] = runner_counts.get('total_runners') or 0
        stats['total_mmr_runners'] = runner_counts.get('total_mmr_runners') or 0
        stats['total_matched'] = runner_counts.get('total_matched') or 0

    return json_response({'ok': True, 'data': stats})


@events_bp.route('/api/stats/years')
@login_required
def api_stats_years():
    """Available event years."""
    rows = query("""
        SELECT DISTINCT event_year FROM nyrr_events
        WHERE event_year IS NOT NULL
        ORDER BY event_year DESC
    """)
    return json_response({'ok': True, 'data': [r['event_year'] for r in rows]})


# ---------------------------------------------------------------------------
# Discover events from NYRR API
# ---------------------------------------------------------------------------



# ---------------------------------------------------------------------------
# Auto-match (extracted to api_events_match.py to keep this file < 400 LOC).
# run_event_automatch is re-exported so `from api_events import ...` still works.
# ---------------------------------------------------------------------------
from api_events_match import run_event_automatch, register_match_routes  # noqa: E402

register_match_routes(events_bp)
