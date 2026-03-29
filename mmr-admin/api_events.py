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

    # Calculate LIVE counts from nyrr_event_runners table instead of cached columns
    for r in rows:
        event_id = r.get('id')

        # Query live counts
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


@events_bp.route('/api/events/<int:event_id>/runners')
@login_required
def api_event_runners(event_id):
    """Runners for an event with optional filters."""
    team = request.args.get('team')
    matched_only = request.args.get('matched') == '1'
    unmatched_only = request.args.get('unmatched') == '1'
    search = request.args.get('q', '')

    sql = """
        SELECT er.*, e.event_code, e.event_name, e.event_date
        FROM nyrr_event_runners er
        JOIN nyrr_events e ON e.id = er.nyrr_event_id
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
# Auto-match
# ---------------------------------------------------------------------------

@events_bp.route('/api/events/<int:event_id>/automatch', methods=['POST'])
@login_required
@require_role('admin')
def api_run_automatch(event_id):
    """
    Re-run Tier-1 + Tier-2 auto-match on an already-loaded event.
    Only updates currently unmatched rows.
    """
    rows = query("SELECT id FROM nyrr_events WHERE id = %s", [event_id])
    if not rows:
        return json_response({'ok': False, 'error': 'Event not found'}, 404)

    try:
        conn = get_conn()
        cursor = conn.cursor()

        # Tier 1: Match by NYRRRunnerName
        cursor.execute("""
            UPDATE nyrr_event_runners er
            INNER JOIN members m
                ON LOWER(TRIM(er.runner_name)) = LOWER(TRIM(m.NYRRRunnerName))
            SET er.mmr_member_id = m.MemberID,
                er.match_method = 'auto_name',
                er.matched_by = 'Viewer',
                er.matched_at = NOW()
            WHERE er.mmr_member_id IS NULL
              AND m.NYRRRunnerName IS NOT NULL
              AND m.NYRRRunnerName != ''
              AND er.nyrr_event_id = %s
        """, (event_id,))
        t1_matched = cursor.rowcount

        # Tier 2: Match by first + last name when exactly one member matches
        cursor.execute("""
            UPDATE nyrr_event_runners er
            INNER JOIN (
                SELECT LOWER(TRIM(FirstName)) AS fn, LOWER(TRIM(LastName)) AS ln,
                       MAX(MemberID) AS MemberID
                FROM members
                WHERE FirstName IS NOT NULL AND FirstName != ''
                  AND LastName IS NOT NULL AND LastName != ''
                GROUP BY LOWER(TRIM(FirstName)), LOWER(TRIM(LastName))
                HAVING COUNT(*) = 1
            ) uniq ON LOWER(TRIM(er.first_name)) = uniq.fn
                  AND LOWER(TRIM(er.last_name)) = uniq.ln
            SET er.mmr_member_id = uniq.MemberID,
                er.match_method = 'auto_firstlast',
                er.matched_by = 'Viewer',
                er.matched_at = NOW()
            WHERE er.mmr_member_id IS NULL
              AND er.first_name IS NOT NULL AND er.first_name != ''
              AND er.last_name IS NOT NULL AND er.last_name != ''
              AND er.nyrr_event_id = %s
        """, (event_id,))
        t2_matched = cursor.rowcount
        matched = t1_matched + t2_matched

        # Refresh matched count on the event
        cursor.execute("""
            UPDATE nyrr_events
            SET mmr_matched_count = (
                SELECT COUNT(*) FROM nyrr_event_runners
                WHERE nyrr_event_id = %s AND mmr_member_id IS NOT NULL
            )
            WHERE id = %s
        """, (event_id, event_id))

        conn.commit()
        cursor.close()

        parts = []
        if t1_matched: parts.append(f'{t1_matched} by NYRR name')
        if t2_matched: parts.append(f'{t2_matched} by first/last name')
        detail = f' ({", ".join(parts)})' if parts else ''
        return json_response({'ok': True, 'matched': matched,
                               'message': f'Auto-matched {matched} runner(s){detail}.'})
    except Exception as e:
        return json_response({'ok': False, 'error': str(e)[:300]}, 500)


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

@events_bp.route('/api/discover', methods=['POST'])
@login_required
def api_discover_events():
    """Fetch events from NYRR API for a given year and insert any new ones."""
    from nyrr_api import NyrrApiClient

    year = request.json.get('year', date.today().year) if request.is_json else date.today().year

    try:
        client = NyrrApiClient()
        api_events_list = client.search_events(year=year)
    except Exception as e:
        return json_response({'ok': False, 'error': f'NYRR API error: {e}'}, 502)

    conn = get_conn()
    cursor = conn.cursor()

    cursor.execute("SELECT event_code FROM nyrr_events")
    existing = {r[0] for r in cursor.fetchall()}

    new_count = 0
    for ev in api_events_list:
        if ev.event_code in existing:
            continue

        event_date_str = ev.start_date_time.split('T')[0] if ev.start_date_time else None
        try:
            event_date_obj = date.fromisoformat(event_date_str) if event_date_str else None
        except ValueError:
            event_date_obj = None
        upcoming = (event_date_obj > date.today()) if event_date_obj else False
        event_year = event_date_obj.year if event_date_obj else year

        cursor.execute("""
            INSERT INTO nyrr_events
                (event_code, event_name, event_url, location, distance,
                 event_date, event_year, is_upcoming, is_virtual, processing_status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'Pending')
            ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP
        """, (
            ev.event_code,
            ev.event_name,
            f"https://results.nyrr.org/events/{ev.event_code}",
            ev.venue,
            ev.distance_unit_code,
            event_date_str,
            event_year,
            int(upcoming),
            int(ev.is_virtual),
        ))
        existing.add(ev.event_code)
        new_count += 1

    conn.commit()
    cursor.close()
    conn.close()

    return json_response({
        'ok': True,
        'year': year,
        'api_total': len(api_events_list),
        'new_inserted': new_count,
    })


# ---------------------------------------------------------------------------
# Discover upcoming (future) events from NYRR widget API
# ---------------------------------------------------------------------------

NYRR_UPCOMING_API = "https://widget.hakuapp.com/v2/event_lists"
NYRR_UPCOMING_API_KEY = os.environ.get("NYRR_HAKU_API_KEY", "")


@events_bp.route('/api/discover-upcoming', methods=['POST'])
@login_required
def api_discover_upcoming():
    """Fetch upcoming/announced events from the NYRR public widget API.

    The Haku widget API returns HTML (not JSON).  We parse the structured
    ``<div class="upcoming-event" data-*>`` blocks to extract event info.
    """
    import re, traceback
    try:
        import requests as req_lib
        url = (f"{NYRR_UPCOMING_API}?api_key={NYRR_UPCOMING_API_KEY}"
               f"&widget_scope=Endurance&widget_title=Upcoming%20Races")
        resp = req_lib.get(url, headers={
            'x-api-key': NYRR_UPCOMING_API_KEY,
            'Origin': 'https://www.nyrr.org',
            'Referer': 'https://www.nyrr.org/',
        }, timeout=30)
        resp.raise_for_status()
        html = resp.text
    except Exception as e:
        tb = traceback.format_exc()
        print(f'[discover-upcoming] NYRR API error: {e}\n{tb}', flush=True)
        return json_response({'ok': False, 'error': f'NYRR widget API error: {e}'}, 502)

    # ---- parse HTML widget into event dicts ----
    all_events = []
    # Split on each upcoming-event block
    blocks = re.split(r'<div\s+class="upcoming-event"', html)
    for block in blocks[1:]:  # skip preamble before first event
        ev = {}
        # data attributes on the opening div
        m = re.search(r'data-start-date="([^"]*)"', block)
        ev['start_date'] = m.group(1).replace('/', '-') if m else None
        m = re.search(r'data-location="([^"]*)"', block)
        ev['location'] = m.group(1).title() if m else ''
        m = re.search(r'data-sub-types="([^"]*)"', block)
        ev['distance'] = m.group(1) if m else ''
        m = re.search(r'data-status="([^"]*)"', block)
        ev['status'] = m.group(1) if m else ''
        # event name
        m = re.search(r'class="upcoming-race-title"[^>]*>([^<]+)<', block)
        ev['name'] = m.group(1).strip() if m else ''
        # event URL → also used to derive event_code
        m = re.search(r'href="(https://events\.nyrr\.org/[^"]+)"', block)
        ev['url'] = m.group(1) if m else ''
        ev['code'] = ev['url'].rstrip('/').split('/')[-1] if ev['url'] else ''
        if ev['code']:
            all_events.append(ev)

    # ---- insert new events into DB ----
    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute("SELECT event_code FROM nyrr_events")
    existing = {r[0] for r in cursor.fetchall()}

    new_count = 0
    for ev in all_events:
        code = ev['code']
        if code in existing:
            continue

        event_date_str = ev['start_date']
        try:
            event_date_obj = date.fromisoformat(event_date_str) if event_date_str else None
        except ValueError:
            event_date_obj = None
        event_year = event_date_obj.year if event_date_obj else date.today().year

        try:
            cursor.execute("""
                INSERT INTO nyrr_events
                    (event_code, event_name, event_url, location, distance,
                     event_date, event_year, is_upcoming, is_virtual, processing_status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, 1, 0, 'Pending')
                ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP
            """, (code, ev['name'], ev['url'], ev['location'], ev['distance'],
                  event_date_str, event_year))
            existing.add(code)
            new_count += 1
        except Exception as db_err:
            print(f'[discover-upcoming] DB insert error for code={code!r} (len={len(code)}): {db_err}', flush=True)

    conn.commit()
    cursor.close()
    conn.close()

    return json_response({
        'ok': True,
        'api_total': len(all_events),
        'new_inserted': new_count,
    })
