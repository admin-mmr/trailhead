"""
Runner match/unmatch & member search routes for mmr-admin.

Blueprint: runners_bp
Routes: /api/members/search, /api/runners/<id>/match, /api/runner/<id>/history
"""

from __future__ import annotations

import threading
import time
from typing import Any, Dict

from flask import Blueprint, request, session

from auth import login_required, require_role
from db import query, execute, get_conn
from helpers import json_response

runners_bp = Blueprint('runners', __name__)

# Runner history cache: {runner_id: (timestamp, data)}
_runner_history_cache: Dict[str, tuple] = {}
_runner_history_lock = threading.Lock()
RUNNER_HISTORY_CACHE_TTL = 3600  # 1 hour


# ---------------------------------------------------------------------------
# Member search (for manual matching)
# ---------------------------------------------------------------------------

@runners_bp.route('/api/members/search')
@login_required
def api_members_search():
    """
    Fuzzy-search the members table by name for manual NYRR runner matching.
    Returns up to 20 candidates ordered by exact-name match first, then active.
    """
    q = (request.args.get('q') or '').strip()
    if not q:
        return json_response({'ok': True, 'data': [], 'count': 0})

    like = f'%{q}%'
    try:
        rows = query("""
            SELECT
                MemberID            AS member_id,
                FirstName           AS first_name,
                LastName            AS last_name,
                CONCAT(FirstName, ' ', LastName) AS full_name,
                Email               AS email,
                Gender              AS gender,
                NYRRRunnerName      AS nyrr_runner_name,
                Status              AS status,
                YearBorn            AS year_born
            FROM members
            WHERE CONCAT(FirstName, ' ', LastName) LIKE %s
               OR NYRRRunnerName LIKE %s
               OR LastName LIKE %s
            ORDER BY
                (LOWER(CONCAT(FirstName, ' ', LastName)) = LOWER(%s)) DESC,
                (Status = 'active') DESC,
                LastName, FirstName
            LIMIT 20
        """, [like, like, like, q])
        return json_response({'ok': True, 'data': rows, 'count': len(rows)})
    except Exception as e:
        return json_response({'ok': False, 'error': str(e)[:300]}, 500)


# ---------------------------------------------------------------------------
# Manual match / unmatch
# ---------------------------------------------------------------------------

@runners_bp.route('/api/runners/<int:runner_row_id>/match', methods=['POST'])
@login_required
@require_role('admin')
def api_match_runner(runner_row_id):
    """Manually match a nyrr_event_runners row to an MMR member."""
    data = request.json or {}
    member_id = (data.get('member_id') or '').strip()
    if not member_id:
        return json_response({'ok': False, 'error': 'member_id required'}, 400)

    rows = query("SELECT * FROM nyrr_event_runners WHERE id = %s", [runner_row_id])
    if not rows:
        return json_response({'ok': False, 'error': 'Runner not found'}, 404)

    member_rows = query("SELECT MemberID FROM members WHERE MemberID = %s", [member_id])
    if not member_rows:
        return json_response({'ok': False, 'error': 'Member not found'}, 404)

    event_id = rows[0]['nyrr_event_id']
    user_email = session.get('user', {}).get('email', 'Viewer')

    try:
        execute("""
            UPDATE nyrr_event_runners
            SET mmr_member_id = %s,
                match_method  = 'manual',
                matched_by    = %s,
                matched_at    = NOW()
            WHERE id = %s
        """, [member_id, user_email, runner_row_id])

        execute("""
            UPDATE nyrr_events
            SET mmr_matched_count = (
                SELECT COUNT(*) FROM nyrr_event_runners
                WHERE nyrr_event_id = %s AND mmr_member_id IS NOT NULL
            )
            WHERE id = %s
        """, [event_id, event_id])

        updated = query("SELECT * FROM nyrr_event_runners WHERE id = %s", [runner_row_id])
        return json_response({'ok': True, 'data': updated[0] if updated else {}})
    except Exception as e:
        return json_response({'ok': False, 'error': str(e)[:300]}, 500)


@runners_bp.route('/api/runners/<int:runner_row_id>/match', methods=['DELETE'])
@login_required
@require_role('admin')
def api_unmatch_runner(runner_row_id):
    """Remove a match from a nyrr_event_runners row."""
    rows = query("SELECT nyrr_event_id FROM nyrr_event_runners WHERE id = %s", [runner_row_id])
    if not rows:
        return json_response({'ok': False, 'error': 'Runner not found'}, 404)

    event_id = rows[0]['nyrr_event_id']

    try:
        execute("""
            UPDATE nyrr_event_runners
            SET mmr_member_id = NULL,
                match_method  = 'unmatched',
                matched_by    = NULL,
                matched_at    = NULL
            WHERE id = %s
        """, [runner_row_id])

        execute("""
            UPDATE nyrr_events
            SET mmr_matched_count = (
                SELECT COUNT(*) FROM nyrr_event_runners
                WHERE nyrr_event_id = %s AND mmr_member_id IS NOT NULL
            )
            WHERE id = %s
        """, [event_id, event_id])

        return json_response({'ok': True, 'message': 'Match removed'})
    except Exception as e:
        return json_response({'ok': False, 'error': str(e)[:300]}, 500)


# ---------------------------------------------------------------------------
# Runner history (from NYRR API, cached)
# ---------------------------------------------------------------------------

@runners_bp.route('/api/runner/<runner_id>/history')
@login_required
def api_runner_history(runner_id):
    """Get runner's race history from NYRR API (cached 1 hour)."""
    from nyrr_api import NyrrApiClient

    try:
        with _runner_history_lock:
            cached = _runner_history_cache.get(runner_id)
            if cached:
                timestamp, data = cached
                if time.time() - timestamp < RUNNER_HISTORY_CACHE_TTL:
                    return json_response({'ok': True, 'data': data, 'cached': True})

        client = NyrrApiClient()
        races = client.get_runner_races(runner_id)

        with _runner_history_lock:
            _runner_history_cache[runner_id] = (time.time(), races)

        return json_response({'ok': True, 'data': races, 'cached': False})
    except Exception as e:
        return json_response({'ok': False, 'error': str(e)[:300]}, 500)
