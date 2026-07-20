"""
Member override history & revert routes for mmr-admin.

Routes register on the shared `members_status_bp` defined in
`api_members_status` (URL paths and blueprint are unchanged by the split):

  GET  /api/members/overrides/all            — all admin overrides (excl. REVERT)
  GET  /api/members/<id>/overrides           — override history for one member
  POST /api/members/<id>/revert-status       — revert member+family to OldValue
  POST /api/members/revert-override          — revert all ImpactedMemberIDs (SP)
"""
from __future__ import annotations

import logging
from datetime import datetime
from flask import request

from auth import login_required, require_role
from db import query, execute
from helpers import json_response, handle_api_errors
from activity_logger import log_activity

from api_members_status import members_status_bp, get_member_by_id, get_admin_id

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────
# Get Override History endpoint
# ─────────────────────────────────────────────────────────────────

@members_status_bp.route('/api/members/overrides/all')
@login_required
@require_role('admin')
@handle_api_errors
def api_get_all_overrides():
    """
    Return all admin override history, most recent first.
    Excludes REVERT audit entries so the table only shows original actions.
    Query params: limit (default 50, max 200)
    """
    limit = min(int(request.args.get('limit', 50)), 200)
    rows = query("""
        SELECT OverrideID, AdminEmail, TargetMemberID, ImpactedMemberIDs,
               ActionType, OldValue, NewValue, AdminNotes, Timestamp
        FROM admin_member_overrides
        WHERE ActionType != 'REVERT'
        ORDER BY Timestamp DESC
        LIMIT %s
    """, (limit,))

    for r in rows:
        if isinstance(r.get('Timestamp'), datetime):
            r['Timestamp'] = r['Timestamp'].isoformat()

    return json_response({'ok': True, 'data': rows})


@members_status_bp.route('/api/members/<member_id>/overrides')
@login_required
@require_role('admin')
@handle_api_errors
def api_get_member_overrides(member_id: str):
    """
    Return admin override history for a member (from admin_member_overrides).
    Most recent first.
    """
    rows = query("""
        SELECT OverrideID, AdminEmail, TargetMemberID, ImpactedMemberIDs,
               ActionType, OldValue, NewValue, AdminNotes, Timestamp
        FROM admin_member_overrides
        WHERE TargetMemberID = %s
           OR FIND_IN_SET(%s, ImpactedMemberIDs)
        ORDER BY Timestamp DESC
        LIMIT 20
    """, (member_id, member_id))

    # Serialize datetimes
    for r in rows:
        if isinstance(r.get('Timestamp'), datetime):
            r['Timestamp'] = r['Timestamp'].isoformat()

    return json_response({'ok': True, 'data': rows})


# ─────────────────────────────────────────────────────────────────
# Revert Status endpoint
# ─────────────────────────────────────────────────────────────────

@members_status_bp.route('/api/members/<member_id>/revert-status', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_revert_member_status(member_id: str):
    """
    Revert a member (and family) to the previous status recorded in
    admin_member_overrides. Looks up the override record and restores OldValue.

    POST body: { "override_id": 42, "note": "Reverting per request" }
    """
    data = request.get_json() or {}
    override_id = data.get('override_id')
    note = (data.get('note') or 'Status reverted by admin').strip()

    if not override_id:
        return json_response({'ok': False, 'error': 'override_id is required'}, 400)

    member = get_member_by_id(member_id)
    if not member:
        return json_response({'ok': False, 'error': f'Member {member_id} not found'}, 404)

    # Get the specific override record
    overrides = query(
        "SELECT * FROM admin_member_overrides WHERE OverrideID = %s AND TargetMemberID = %s",
        (override_id, member_id)
    )
    if not overrides:
        return json_response({'ok': False, 'error': 'Override record not found for this member'}, 404)

    override = overrides[0]
    old_status = override.get('OldValue')
    if not old_status:
        return json_response({'ok': False, 'error': 'No previous status recorded in override'}, 400)

    admin_id = get_admin_id()

    # Revert via sp_admin_update_member_status (cascades to family)
    # For lifetime revert, set Expiration back to NULL so normal expiry logic takes over
    new_expiration = None
    if old_status != 'lifetime' and member.get('Status') == 'lifetime':
        # Clear the lifetime sentinel date; restore to a sane default or NULL
        new_expiration = override.get('OldExpiration')  # may be None

    execute(
        "CALL sp_admin_update_member_status(%s, %s, %s, %s, %s)",
        (member_id, admin_id, old_status, new_expiration, note)
    )

    # Note: the SP appends a new revert entry to members.Notes.
    # The original override note is preserved in the audit log (admin_member_overrides)
    # so the history is fully traceable. Notes field shows the revert action.

    log_activity(
        action='member_status_revert',
        member_id=member_id,
        admin_email=admin_id,
        state=f'reverted_to={old_status},override_id={override_id}'
    )

    updated = get_member_by_id(member_id)
    return json_response({'ok': True, 'data': {
        'updated_member': updated,
        'reverted_to': old_status,
        'message': f'{member_id} status reverted to {old_status}'
    }})


# ─────────────────────────────────────────────────────────────────
# Revert Override endpoint (calls sp_revert_admin_override)
# Reverts ALL members in ImpactedMemberIDs, not just the target.
# ─────────────────────────────────────────────────────────────────

@members_status_bp.route('/api/members/revert-override', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_revert_override():
    """
    Revert all members impacted by a bad admin override using sp_revert_admin_override.
    Restores Status + Expiration from member_log and strips the Notes entry.
    Idempotent: safe to call multiple times with the same override_id.

    POST body: { "override_id": 42 }
    """
    data = request.get_json() or {}
    override_id = data.get('override_id')

    if not override_id:
        return json_response({'ok': False, 'error': 'override_id is required'}, 400)

    rows = query("CALL sp_revert_admin_override(%s)", (override_id,))
    result = rows[0] if rows else {}

    audit_error = result.get('audit_error')
    members_restored = result.get('members_restored', 0)

    admin_id = get_admin_id()
    # member_id intentionally omitted: activity_log.MemberID is VARCHAR(10)
    # and impacted_member_ids can be hundreds of members.
    # state kept short: activity_log.State is VARCHAR(50).
    log_activity(
        action='revert_admin_override',
        admin_email=admin_id,
        state=f'ov={override_id},n={members_restored}'
    )

    response = {
        'reverted_override_id':  result.get('reverted_override_id'),
        'members_restored':      members_restored,
        'impacted_member_ids':   result.get('impacted_member_ids'),
        'original_override_time': str(result.get('original_override_time', '')),
    }
    if audit_error:
        # Members were updated but the audit record failed to write.
        # Surface the error so the admin knows idempotency is not active.
        # They should also export members to Sheets to prevent sync overwrite.
        response['audit_error'] = audit_error
        response['warning'] = (
            'Members were restored but the audit record could not be saved. '
            'Export members to Google Sheets now to prevent Sheets sync from '
            'overwriting the restored status.'
        )

    return json_response({'ok': True, 'data': response})
