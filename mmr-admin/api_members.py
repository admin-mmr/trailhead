"""
Member management routes for mmr-admin.

Blueprint: members_bp
Prefix: /api/members

Implements member operations:
  1. Search members by name/ID
  2. Update family — add/remove family members
  3. Change district
"""

from __future__ import annotations

import logging
from datetime import datetime
from flask import Blueprint, request, session

from auth import login_required, require_role
from db import query, execute
from helpers import json_response, handle_api_errors
from activity_logger import log_activity

logger = logging.getLogger(__name__)

members_bp = Blueprint('members', __name__)


# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────

def get_admin_id():
    """Get the admin email from the session (serves as admin ID)."""
    return session.get('user_email', 'unknown')


def get_member_by_id(member_id: str) -> dict | None:
    """Get a single member by ID."""
    rows = query("""
        SELECT MemberID, FirstName, LastName, Email, Type, FamilyID,
               District, Status, Expiration, MembershipFeePaid,
               PaymentDate, PaymentTransaction, LastUpdated
        FROM members
        WHERE MemberID = %s
    """, (member_id,))
    return rows[0] if rows else None


def get_family_members(family_id: str) -> list[dict]:
    """Get all members in a family."""
    return query("""
        SELECT MemberID, FirstName, LastName, Email, Type, FamilyID,
               District, Status, Expiration, MembershipFeePaid,
               PaymentDate, PaymentTransaction, LastUpdated
        FROM members
        WHERE FamilyID = %s
        ORDER BY Type DESC, MemberID ASC
    """, (family_id,))


# ─────────────────────────────────────────────────────────────────
# Search endpoint
# ─────────────────────────────────────────────────────────────────

@members_bp.route('/api/members/search')
@login_required
@require_role('admin')
@handle_api_errors
def api_members_search():
    """
    Search members by name or MemberID.
    Query params: ?q=<search_term>
    """
    q = request.args.get('q', '').strip().upper()
    if not q:
        return json_response({'ok': True, 'data': []})

    # Try exact match first, then LIKE
    logger.info(f'Search query: q="{q}"')

    members = query("""
        SELECT MemberID, FirstName, LastName, Email, Type, FamilyID,
               District, Status, Expiration, MembershipFeePaid,
               PaymentDate, PaymentTransaction
        FROM members
        WHERE UPPER(MemberID) = %s
           OR UPPER(FirstName) LIKE %s
           OR UPPER(LastName) LIKE %s
           OR UPPER(Email) LIKE %s
        ORDER BY LastName, FirstName
        LIMIT 50
    """, (q, f"%{q}%", f"%{q}%", f"%{q}%"))

    logger.info(f'Search results: {len(members)} members found for query "{q}"')
    return json_response({'ok': True, 'data': members})


# ─────────────────────────────────────────────────────────────────
# Family management
# ─────────────────────────────────────────────────────────────────

@members_bp.route('/api/members/<member_id>/family')
@login_required
@require_role('admin')
@handle_api_errors
def api_get_family(member_id: str):
    """
    Get family info for a member.
    If the member is a Family member, return all family members.
    If not, return null/error.
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


@members_bp.route('/api/members/family/add-member', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_add_member_to_family():
    """
    Add a member to a family.

    POST body:
    {
      "primary_member_id": "M001",  // Must be Family type
      "new_member_id": "M002",       // Member to add
    }

    The new member will be assigned to the same:
    - FamilyID
    - Expiration
    - MembershipFeePaid
    - PaymentDate
    - PaymentTransaction
    - Type → will be set to "Family"
    """
    data = request.get_json() or {}
    primary_id = data.get('primary_member_id', '').strip()
    new_member_id = data.get('new_member_id', '').strip()

    if not primary_id or not new_member_id:
        return json_response({'ok': False, 'error': 'Missing primary_member_id or new_member_id'}, 400)

    # Get the primary (family head)
    primary = get_member_by_id(primary_id)
    if not primary:
        return json_response({'ok': False, 'error': f'Primary member {primary_id} not found'}, 404)

    if primary['Type'] != 'Family':
        return json_response({
            'ok': False,
            'error': f'Primary member {primary_id} must be Family type, got {primary["Type"]}'
        }, 400)

    if not primary['FamilyID']:
        return json_response({
            'ok': False,
            'error': f'Primary member {primary_id} has no FamilyID'
        }, 400)

    # Get the member to add
    new_member = get_member_by_id(new_member_id)
    if not new_member:
        return json_response({'ok': False, 'error': f'Member {new_member_id} not found'}, 404)

    # Save old state for potential removal
    old_state = {
        'Type': new_member['Type'],
        'FamilyID': new_member['FamilyID'],
        'Expiration': new_member['Expiration'],
        'MembershipFeePaid': new_member['MembershipFeePaid'],
        'PaymentDate': new_member['PaymentDate'],
        'PaymentTransaction': new_member['PaymentTransaction'],
    }

    # Update the member to be part of the family
    admin_id = get_admin_id()
    now = datetime.utcnow()

    execute("""
        UPDATE members
        SET FamilyID = %s,
            Type = 'Family',
            Expiration = %s,
            MembershipFeePaid = %s,
            PaymentDate = %s,
            PaymentTransaction = %s,
            LastUpdated = %s
        WHERE MemberID = %s
    """, (
        primary['FamilyID'],
        primary['Expiration'],
        primary['MembershipFeePaid'],
        primary['PaymentDate'],
        primary['PaymentTransaction'],
        now,
        new_member_id
    ))

    # Log the action
    log_activity('member_family_add', {
        'primary_member_id': primary_id,
        'new_member_id': new_member_id,
        'family_id': primary['FamilyID'],
        'admin': admin_id,
        'old_state': old_state,
    })

    # Get updated member for response
    updated_member = get_member_by_id(new_member_id)
    family_members = get_family_members(primary['FamilyID'])

    return json_response({'ok': True, 'data': {
        'updated_member': updated_member,
        'family_members': family_members,
        'message': f'{new_member_id} added to family {primary["FamilyID"]}'
    }})


@members_bp.route('/api/members/family/remove-member', methods=['POST'])
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

    # Get current member
    member = get_member_by_id(member_id)
    if not member:
        return json_response({'ok': False, 'error': f'Member {member_id} not found'}, 404)

    family_id = member['FamilyID']

    # Revert to old state
    admin_id = get_admin_id()
    now = datetime.utcnow()

    execute("""
        UPDATE members
        SET Type = %s,
            FamilyID = %s,
            Expiration = %s,
            MembershipFeePaid = %s,
            PaymentDate = %s,
            PaymentTransaction = %s,
            LastUpdated = %s
        WHERE MemberID = %s
    """, (
        old_state.get('Type'),
        old_state.get('FamilyID'),
        old_state.get('Expiration'),
        old_state.get('MembershipFeePaid'),
        old_state.get('PaymentDate'),
        old_state.get('PaymentTransaction'),
        now,
        member_id
    ))

    # Log the action
    log_activity('member_family_remove', {
        'member_id': member_id,
        'family_id': family_id,
        'admin': admin_id,
        'restored_state': old_state,
    })

    # Get updated members
    updated_member = get_member_by_id(member_id)
    remaining_members = get_family_members(family_id) if family_id else []

    return json_response({'ok': True, 'data': {
        'updated_member': updated_member,
        'remaining_family_members': remaining_members,
        'message': f'{member_id} removed from family and reverted'
    }})


# ─────────────────────────────────────────────────────────────────
# District management
# ─────────────────────────────────────────────────────────────────

@members_bp.route('/api/districts')
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


@members_bp.route('/api/members/<member_id>/district', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_change_member_district(member_id: str):
    """
    Change a member's district.

    POST body:
    {
      "district": "District 1"
    }
    """
    data = request.get_json() or {}
    new_district = data.get('district', '').strip()

    if not new_district:
        return json_response({'ok': False, 'error': 'District is required'}, 400)

    # Get the member
    member = get_member_by_id(member_id)
    if not member:
        return json_response({'ok': False, 'error': f'Member {member_id} not found'}, 404)

    # Validate that the district exists
    districts_result = query("""
        SELECT DISTINCT District
        FROM members
        WHERE District = %s
    """, (new_district,))

    if not districts_result:
        return json_response({
            'ok': False,
            'error': f'District "{new_district}" not found in member records'
        }, 400)

    # Update the district
    admin_id = get_admin_id()
    now = datetime.utcnow()

    old_district = member['District']

    execute("""
        UPDATE members
        SET District = %s,
            LastUpdated = %s
        WHERE MemberID = %s
    """, (new_district, now, member_id))

    # Log the action
    log_activity('member_district_change', {
        'member_id': member_id,
        'old_district': old_district,
        'new_district': new_district,
        'admin': admin_id,
    })

    # Get updated member
    updated_member = get_member_by_id(member_id)

    return json_response({'ok': True, 'data': {
        'updated_member': updated_member,
        'message': f'District changed from "{old_district}" to "{new_district}"'
    }})
