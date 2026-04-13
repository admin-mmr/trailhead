"""
District and admin field-update routes for mmr-admin.

Blueprint: members_district_bp
Prefix: /api/members, /api/districts

Routes:
  GET  /api/districts                       — list all districts
  POST /api/members/<id>/district           — change a member's district
  POST /api/members/<id>/mark-unused        — mark an ID as unused
"""
from __future__ import annotations

import logging
from datetime import datetime
from flask import Blueprint, request

from auth import login_required, require_role
from db import query, execute
from helpers import json_response, handle_api_errors
from activity_logger import log_activity
from api_members import get_admin_id, get_member_by_id

logger = logging.getLogger(__name__)

members_district_bp = Blueprint('members_district', __name__)


@members_district_bp.route('/api/districts')
@login_required
@require_role('admin')
@handle_api_errors
def api_get_districts():
    """Get all unique districts from the members table."""
    districts = query("""
        SELECT DISTINCT District
        FROM members
        WHERE District IS NOT NULL AND District != ''
        ORDER BY District ASC
    """)
    return json_response({'ok': True, 'data': [d['District'] for d in districts]})


@members_district_bp.route('/api/members/<member_id>/district', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_change_member_district(member_id: str):
    """
    Change a member's district.

    POST body: { "district": "District 1" }
    """
    data = request.get_json() or {}
    new_district = data.get('district', '').strip()

    if not new_district:
        return json_response({'ok': False, 'error': 'District is required'}, 400)

    member = get_member_by_id(member_id)
    if not member:
        return json_response({'ok': False, 'error': f'Member {member_id} not found'}, 404)

    districts_result = query("""
        SELECT DISTINCT District FROM members WHERE District = %s
    """, (new_district,))

    if not districts_result:
        return json_response({
            'ok': False,
            'error': f'District "{new_district}" not found in member records'
        }, 400)

    admin_id = get_admin_id()
    now = datetime.utcnow()
    old_district = member['District']

    execute("""
        UPDATE members SET District = %s, UpdatedAt = %s WHERE MemberID = %s
    """, (new_district, now, member_id))

    log_activity(
        action='member_district_change',
        member_id=member_id,
        admin_email=admin_id,
        state=f'old_district={old_district},new_district={new_district}'
    )

    updated_member = get_member_by_id(member_id)
    return json_response({'ok': True, 'data': {
        'updated_member': updated_member,
        'message': f'District changed from "{old_district}" to "{new_district}"'
    }})


@members_district_bp.route('/api/members/<member_id>/mark-unused', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_mark_member_unused(member_id: str):
    """
    Mark a member ID as unused/reserved.

    Sets: Status=inactive, FirstName=Unused, LastName=<MemberID>,
          Email=<memberid>@mmrunners.org, Type=Individual, FamilyID=NULL
    Registers the action in admin_member_overrides.
    """
    member = get_member_by_id(member_id)
    if not member:
        return json_response({'ok': False, 'error': f'Member {member_id} not found'}, 404)

    admin_email = get_admin_id()
    now = datetime.utcnow()
    new_email = f'{member_id.lower()}@mmrunners.org'
    old_status = member.get('Status', '')

    execute("""
        UPDATE members
        SET Status    = 'inactive',
            FirstName = 'Unused',
            LastName  = %s,
            Email     = %s,
            Type      = 'Individual',
            FamilyID  = NULL,
            UpdatedAt = %s
        WHERE MemberID = %s
    """, (member_id, new_email, now, member_id))

    execute("""
        INSERT INTO admin_member_overrides
            (AdminEmail, TargetMemberID, ImpactedMemberIDs, ActionType, OldValue, NewValue, AdminNotes)
        VALUES (%s, %s, %s, 'INACTIVE_SET', %s, 'inactive', 'Marked as unused ID')
    """, (admin_email, member_id, member_id, old_status))

    log_activity(
        action='member_mark_unused',
        member_id=member_id,
        admin_email=admin_email,
        state=f'old_status={old_status},new_status=inactive'
    )

    updated_member = get_member_by_id(member_id)
    return json_response({'ok': True, 'data': {
        'updated_member': updated_member,
        'message': f'Member ID {member_id} marked as unused'
    }})
