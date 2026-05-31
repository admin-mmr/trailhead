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
# Auto-match helpers
# ---------------------------------------------------------------------------

def _backfill_member_name_and_year(cursor, event_id: int, match_method: str) -> None:
    """After a Tier match, push runner_name → NYRRRunnerName and infer YearBornGuess.

    Called identically after Tier 1, 2, and 3 — extracts the repeated UPDATE block.
    Only fills fields that are currently NULL/empty so we never overwrite known data.
    """
    cursor.execute("""
        UPDATE members m
        INNER JOIN nyrr_event_runners er ON m.MemberID = er.mmr_member_id
        SET m.NYRRRunnerName = er.runner_name,
            m.YearBornGuess = CASE WHEN m.YearBornGuess IS NULL THEN CAST(YEAR(CURDATE()) AS SIGNED) - er.age ELSE m.YearBornGuess END,
            m.UpdatedAt = NOW()
        WHERE er.match_method = %s
          AND er.nyrr_event_id = %s
          AND (m.NYRRRunnerName IS NULL OR m.NYRRRunnerName = '')
    """, (match_method, event_id))


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

    conn = None
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

        # After Tier 1: push runner_name → NYRRRunnerName and infer YearBornGuess
        if t1_matched > 0:
            _backfill_member_name_and_year(cursor, event_id, 'auto_name')

        # Tier 2: Match by first + last name when exactly one member matches
        # With age/gender validation (if member has YearBorn or YearBornGuess)
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
            INNER JOIN members m ON uniq.MemberID = m.MemberID
            SET er.mmr_member_id = uniq.MemberID,
                er.match_method = 'auto_firstlast',
                er.matched_by = 'Viewer',
                er.matched_at = NOW()
            WHERE er.mmr_member_id IS NULL
              AND er.first_name IS NOT NULL AND er.first_name != ''
              AND er.last_name IS NOT NULL AND er.last_name != ''
              AND er.nyrr_event_id = %s
              -- Age/gender validation: only if member has YearBorn or YearBornGuess
              AND (
                -- If member has YearBorn set, validate runner age matches
                (m.YearBorn IS NOT NULL AND ABS(CAST(YEAR(CURDATE()) AS SIGNED) - m.YearBorn - er.age) <= 1)
                -- OR if member has YearBornGuess, validate runner age matches
                OR (m.YearBorn IS NULL AND m.YearBornGuess IS NOT NULL AND ABS(CAST(YEAR(CURDATE()) AS SIGNED) - m.YearBornGuess - er.age) <= 1)
                -- OR if member has no birth year, skip validation
                OR (m.YearBorn IS NULL AND m.YearBornGuess IS NULL)
              )
              -- Optional: also check gender if both have gender data
              -- NYRR uses M/W/X; DB stores Male/Female/Other — normalize before compare
              AND (
                er.gender IS NULL
                OR m.Gender IS NULL
                OR CASE er.gender
                   WHEN 'M' THEN 'Male'
                   WHEN 'W' THEN 'Female'
                   WHEN 'X' THEN 'Other'
                   ELSE er.gender
                END = m.Gender
              )
        """, (event_id,))
        t2_matched = cursor.rowcount

        # After Tier 2: push runner_name → NYRRRunnerName and infer YearBornGuess
        if t2_matched > 0:
            _backfill_member_name_and_year(cursor, event_id, 'auto_firstlast')

        # Tier 3: Match by partial name (first name OR last name)
        # With age/gender validation (if member has YearBorn or YearBornGuess)
        cursor.execute("""
            UPDATE nyrr_event_runners er
            INNER JOIN members m ON (
                LOWER(TRIM(er.first_name)) = LOWER(TRIM(m.FirstName))
                OR LOWER(TRIM(er.last_name)) = LOWER(TRIM(m.LastName))
            )
            SET er.mmr_member_id = m.MemberID,
                er.match_method = 'auto_partial_name',
                er.matched_by = 'Viewer',
                er.matched_at = NOW()
            WHERE er.mmr_member_id IS NULL
              AND er.first_name IS NOT NULL AND er.first_name != ''
              AND er.last_name IS NOT NULL AND er.last_name != ''
              AND m.FirstName IS NOT NULL AND m.FirstName != ''
              AND m.LastName IS NOT NULL AND m.LastName != ''
              -- Age validation: require YearBorn or YearBornGuess for Tier 3 (partial name is too loose to skip)
              AND (
                -- If member has YearBorn set, validate runner age matches
                (m.YearBorn IS NOT NULL AND ABS(CAST(YEAR(CURDATE()) AS SIGNED) - m.YearBorn - er.age) <= 1)
                -- OR if member has YearBornGuess, validate runner age matches
                OR (m.YearBorn IS NULL AND m.YearBornGuess IS NOT NULL AND ABS(CAST(YEAR(CURDATE()) AS SIGNED) - m.YearBornGuess - er.age) <= 1)
                -- Note: no fallback for missing birth year — Tier 3 requires age confirmation
              )
              -- Optional: also check gender if both have gender data
              -- NYRR uses M/W/X; DB stores Male/Female/Other — normalize before compare
              AND (
                er.gender IS NULL
                OR m.Gender IS NULL
                OR CASE er.gender
                   WHEN 'M' THEN 'Male'
                   WHEN 'W' THEN 'Female'
                   WHEN 'X' THEN 'Other'
                   ELSE er.gender
                END = m.Gender
              )
              AND er.nyrr_event_id = %s
            LIMIT 5000
        """, (event_id,))
        t3_matched = cursor.rowcount

        # After Tier 3: push runner_name → NYRRRunnerName and infer YearBornGuess
        if t3_matched > 0:
            _backfill_member_name_and_year(cursor, event_id, 'auto_partial_name')

        # Tier 4 (fuzzy) is NOT run here — it's a background job to avoid OOM on
        # large events (25k runners × 1.5k members ≈ 37M comparisons).
        # Use POST /api/events/<id>/fuzzy-match to start it asynchronously.

        matched = t1_matched + t2_matched + t3_matched

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
        if t3_matched: parts.append(f'{t3_matched} by partial name')
        detail = f' ({", ".join(parts)})' if parts else ''
        return json_response({'ok': True, 'matched': matched,
                               'message': f'Auto-matched {matched} runner(s){detail}. '
                                          f'Run POST /api/events/{event_id}/fuzzy-match for Tier-4 fuzzy match.'})
    except Exception as e:
        if conn:
            conn.rollback()
        return json_response({'ok': False, 'error': str(e)[:300]}, 500)
    finally:
        if conn:
            conn.close()


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

