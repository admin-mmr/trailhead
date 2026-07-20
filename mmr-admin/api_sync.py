"""
NYRR data load (sync) worker for mmr-admin.
Optimal three-step workflow:
  1. runners/finishers-filter → Load all runners (all race data)
  2. teams/search            → Enumerate all teams in event
  3. teams/teamRunners (×584)→ Backfill team_code by bib

Blueprint: sync_bp
Routes: /api/load/<event_id> (POST), /api/load/<event_code>/status
"""

from __future__ import annotations

import logging
import traceback

import mysql.connector.errors

from flask import Blueprint, request

from auth import login_required
from db import query
from helpers import json_response
from sync_worker import start_sync, get_job_status, cancel_job, get_all_jobs
from nyrr_api import get_throttle_stats
from api_sync_membership import register_membership_sync_routes

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

sync_bp = Blueprint('sync', __name__)


@sync_bp.route('/api/load/<int:event_id>', methods=['POST'])
@login_required
def api_load_event(event_id):
    """
    Trigger three-step sync:
      Step 1: Load all finishers (runners/finishers-filter)
      Step 2: Enumerate teams (teams/search)
      Step 3: Backfill team_code (teams/teamRunners × each team)

    Runs in background thread.
    """
    logger.debug(f"🔄 api_load_event called: event_id={event_id}, request.json={request.json}")

    rows = query("SELECT * FROM nyrr_events WHERE id = %s", [event_id])
    if not rows:
        logger.warning(f"❌ Event not found: id={event_id}")
        return json_response({'ok': False, 'error': 'Event not found'}, 404)

    event = rows[0]
    event_code = event['event_code']
    force_reload = request.json.get('force_reload', False)
    # load_mode='mmr_only' (V029) overrides whatever the caller passes; the DB
    # is the authoritative source for how this event should be fetched.
    db_load_mode = event.get('load_mode', 'full')
    mmr_only = (db_load_mode == 'mmr_only') or bool(request.json.get('mmr_only', False))
    logger.info(f"📋 Event found: event_code={event_code}, force_reload={force_reload}, "
                f"mmr_only={mmr_only} (db_load_mode={db_load_mode!r})")

    start_sync(event_id, event_code, force_reload, mmr_only=mmr_only)
    return json_response({'ok': True, 'event_code': event_code, 'status': 'started'})


@sync_bp.route('/api/load/<event_code>/cancel', methods=['POST'])
@login_required
def api_sync_cancel(event_code):
    """Request cancellation of a running sync job."""
    job = get_job_status(event_code)
    if not job:
        return json_response({'ok': False, 'error': 'No job found'}), 404
    if job.get('status') != 'running':
        return json_response({'ok': False, 'error': f"Job is not running (status={job.get('status')})"}), 400
    cancel_job(event_code)
    logger.info(f"🛑 Cancel requested for {event_code}")
    return json_response({'ok': True, 'message': 'Cancel requested'})


@sync_bp.route('/api/load/<event_code>/status')
@login_required
def api_sync_status(event_code):
    """Get current sync job status."""
    job = get_job_status(event_code) or {'status': 'not_found', 'message': 'No sync job for this event'}
    return json_response(job)


@sync_bp.route('/api/nyrr/activity')
@login_required
def api_nyrr_activity():
    """Sync Activity rail feed: process-wide NYRR rate-limit health + in-flight
    load jobs. Read-only and cheap — safe to poll every few seconds.

    Note: only sees activity in THIS process (the admin web app). CLI / GitHub
    Action runs are separate processes and won't appear here.
    """
    jobs = get_all_jobs(active_only=True)
    return json_response({
        'ok': True,
        'throttle': get_throttle_stats(),
        'jobs': jobs,
        'active_count': len(jobs),
    })


# Membership-data sync routes (/api/sync/membership-fees,
# /api/sync/members-lastupdated) live in api_sync_membership.py and are
# attached to the shared blueprint here.
register_membership_sync_routes(sync_bp)
