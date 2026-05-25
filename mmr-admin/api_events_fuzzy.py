"""
NYRR Tier-4 fuzzy-match routes.

Extracted from api_events.py (Bug I / K split).
Fuzzy match runs off-thread (see fuzzy_worker.py) so large events
don't OOM the request worker.

Routes
------
POST /api/events/<id>/fuzzy-match         start background job
GET  /api/events/<id>/fuzzy-match/status  poll job status
"""

from __future__ import annotations

from flask import Blueprint
from auth import login_required, require_role
from helpers import json_response
from fuzzy_worker import start_fuzzy_job, get_fuzzy_status
from db import query

events_fuzzy_bp = Blueprint('events_fuzzy', __name__)


@events_fuzzy_bp.route('/api/events/<int:event_id>/fuzzy-match', methods=['POST'])
@login_required
@require_role('admin')
def api_start_fuzzy_match(event_id):
    """Kick off background Tier-4 rapidfuzz matching for an event.

    Returns immediately with a job key. Poll
    GET /api/events/<id>/fuzzy-match/status until status == 'done' | 'error'.
    """
    rows = query("SELECT id FROM nyrr_events WHERE id = %s", [event_id])
    if not rows:
        return json_response({'ok': False, 'error': 'Event not found'}, 404)

    key = start_fuzzy_job(event_id)
    return json_response({'ok': True, 'job_key': key,
                          'message': 'Tier-4 fuzzy match started in background. '
                                     'Poll /fuzzy-match/status for progress.'})


@events_fuzzy_bp.route('/api/events/<int:event_id>/fuzzy-match/status', methods=['GET'])
@login_required
def api_fuzzy_match_status(event_id):
    """Poll the status of a background fuzzy-match job."""
    status = get_fuzzy_status(str(event_id))
    if status is None:
        return json_response({'ok': False, 'error': 'No fuzzy-match job found for this event'}, 404)
    return json_response({'ok': True, **status})
