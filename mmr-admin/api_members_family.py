"""
Family management routes for mmr-admin.

Blueprint: members_family_bp
Prefix: /api/members

Routes:
  GET  /api/members/<id>/family          — get all members in a family
  POST /api/members/family/add-member    — add a member to a family
  POST /api/members/family/remove-member — remove a member from a family
"""
from __future__ import annotations

import logging
from datetime import datetime
from flask import Blueprint, request

from auth import login_required, require_role
from db import execute, db_cursor
from helpers import json_response, handle_api_errors
from activity_logger import log_activity
from api_members import get_admin_id, get_member_by_id, get_family_members

logger = logging.getLogger(__name__)

members_family_bp = Blueprint('members_family', __name__)


@members_family_bp.route('/api/members/<member_id>/family')
@login_required
@require_role('admin')
@handle_api_errors
def api_get_family(member_id: str):
    """
    Get family info for a member.
    Member must be Family type with a FamilyID set.
    """
    member = get_member_by_id(member_id)
    if not member:
        return json_response({'ok': False, 'error': f'Member {member_id} not found'}, 404)

    if member['Type'] != 'Family':
        return json_response({
            'ok': False,
            'error': f'Member {member_id} is not a Family member (Type: {member["Type"]})'
        }, 400)

    family_id = member['FamilyID']
    if not family_id:
        return json_response({
            'ok': False,
            'error': f'Member {member_id} is Family type but has no FamilyID'
        }, 400)

    family_members = get_family_members(family_id)

    return json_response({'ok': True, 'data': {
        'family_id': family_id,
        'primary_member': member,
        'members': family_members,
    }})


@members_family_bp.route('/api/members/family/add-member', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_add_member_to_family():
    """
    Add a member to a family.

    POST body:
    {
      "primary_member_id": "M001",  // Must be Family type
      "new_member_id": "M002"       // Member to add
    }

    The new member inherits: FamilyID, Status, Expiration,
    MembershipFeePaid, PaymentDate, PaymentTransaction.
    Type is set to "Family".
    """
    data = request.get_json() or {}
    primary_id = data.get('primary_member_id', '').strip()
    new_member_id = data.get('new_member_id', '').strip()

    if not primary_id or not new_member_id:
        return json_response({'ok': False, 'error': 'Missing primary_member_id or new_member_id'}, 400)

    primary = get_member_by_id(primary_id)
    if not primary:
        return json_response({'ok': False, 'error': f'Primary member {primary_id} not found'}, 404)

    if primary['Type'] != 'Family':
        return json_response({
            'ok': False,
            'error': f'Primary member {primary_id} must be Family type, got {primary["Type"]}'
        }, 400)

    if not primary['FamilyID']:
        return json_response({'ok': False, 'error': f'Primary member {primary_id} has no FamilyID'}, 400)

    new_member = get_member_by_id(new_member_id)
    if not new_member:
        return json_response({'ok': False, 'error': f'Member {new_member_id} not found'}, 404)

    admin_id = get_admin_id()
    now = datetime.utcnow()

    with db_cursor() as cur:
        cur.execute("SET @internal_proc = 1")
        cur.execute("""
            UPDATE members
            SET FamilyID = %s,
                Type = 'Family',
                Status = %s,
                Expiration = %s,
                MembershipFeePaid = %s,
                PaymentDate = %s,
                PaymentTransaction = %s,
                UpdatedAt = %s
            WHERE MemberID = %s
        """, (
            primary['FamilyID'],
            primary['Status'],
            primary['Expiration'],
            primary['MembershipFeePaid'],
            primary['PaymentDate'],
            primary['PaymentTransaction'],
            now,
            new_member_id
        ))
        cur.execute("SET @internal_proc = NULL")

    log_activity(
        action='member_family_add',
        member_id=new_member_id,
        admin_email=admin_id,
        state=f'primary={primary_id},family_id={primary["FamilyID"]}'
    )

    updated_member = get_member_by_id(new_member_id)
    family_members = get_family_members(primary['FamilyID'])

    return json_response({'ok': True, 'data': {
        'updated_member': updated_member,
        'members': family_members,
        'message': f'{new_member_id} added to family {primary["FamilyID"]}'
    }})


@members_family_bp.route('/api/members/family/remove-member', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_remove_member_from_family():
    """
    Remove a member from a family and revert to their previous state.

    POST body:
    {
      "member_id": "M002",
      "old_state": {
        "Type": "Individual",
        "FamilyID": null,
        "Status": "...",
        "Expiration": "...",
        "MembershipFeePaid": "...",
        "PaymentDate": "...",
        "PaymentTransaction": "..."
      }
    }
    """
    data = request.get_json() or {}
    member_id = data.get('member_id', '').strip()
    old_state = data.get('old_state', {})

    if not member_id:
        return json_response({'ok': False, 'error': 'Missing member_id'}, 400)
    if not old_state:
        return json_response({'ok': False, 'error': 'Missing old_state'}, 400)

    member = get_member_by_id(member_id)
    if not member:
        return json_response({'ok': False, 'error': f'Member {member_id} not found'}, 404)

    family_id = member['FamilyID']
    admin_id = get_admin_id()
    now = datetime.utcnow()

    with db_cursor() as cur:
        cur.execute("SET @internal_proc = 1")
        cur.execute("""
            UPDATE members
            SET Type = %s,
                Status = %s,
                FamilyID = %s,
                Expiration = %s,
                MembershipFeePaid = %s,
                PaymentDate = %s,
                PaymentTransaction = %s,
                UpdatedAt = %s
            WHERE MemberID = %s
        """, (
            old_state.get('Type'),
            old_state.get('Status'),
            old_state.get('FamilyID'),
            old_state.get('Expiration'),
            old_state.get('MembershipFeePaid'),
            old_state.get('PaymentDate'),
            old_state.get('PaymentTransaction'),
            now,
            member_id
        ))
        cur.execute("SET @internal_proc = NULL")

    log_activity(
        action='member_family_remove',
        member_id=member_id,
        admin_email=admin_id,
        state=f'family_id={family_id},restored_type={old_state.get("Type")}'
    )

    updated_member = get_member_by_id(member_id)
    remaining_members = get_family_members(family_id) if family_id else []

    return json_response({'ok': True, 'data': {
        'updated_member': updated_member,
        'members': remaining_members,
        'message': f'{member_id} removed from family and reverted'
    }})
