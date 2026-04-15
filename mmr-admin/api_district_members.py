"""
District-based member query endpoints.
Fetch members and districts with filtering and sorting.
Export functionality moved to api_district_export.py
"""

from flask import Blueprint, jsonify, request
import os
from datetime import datetime
from db import query, get_enum_values
from auth import login_required

def get_member_status_options():
    """
    Return frontend-ready status options derived from the DB ENUM.
    Values match the Status column exactly — no translation or grouping.
    """
    raw = get_enum_values('members', 'Status')
    options = [{'value': '', 'label': 'All Statuses'}]
    for v in raw:
        options.append({'value': v, 'label': v})
    return options, set(raw)

district_members_bp = Blueprint('district_members', __name__, url_prefix='/api/district')


@district_members_bp.route('/list', methods=['GET'])
@login_required
def get_district_members():
    """
    Fetch members by district with flexible column selection and sorting.
    Query params:
    - district: filter by district (optional)
    - status: filter by Status column value (active/expired/inactive/pending/pending_upgrade/lifetime, optional)
    - sortBy: column to sort by (default: District)
    - sortOrder: 'asc' or 'desc' (default: asc)
    - limit: number of records (default 500, max 5000)
    """
    try:
        district = request.args.get('district', '').strip()
        status = request.args.get('status', '').strip()
        sort_by = request.args.get('sortBy', 'District').strip()
        sort_order = request.args.get('sortOrder', 'asc').strip().lower()
        limit = min(int(request.args.get('limit', 500)), 5000)

        # Whitelist of safe columns to sort by
        safe_columns = {
            'District', 'MemberID', 'FirstName', 'LastName', 'Name', 'Expiration',
            'Gender', 'WeChatID', 'Email', 'Type', 'FamilyID', 'PaymentDate',
            'MembershipFeePaid', 'PaymentTransaction', 'Status', 'LastModified'
        }
        if sort_by not in safe_columns:
            sort_by = 'District'
        if sort_order not in ('asc', 'desc'):
            sort_order = 'asc'

        sql = """
            SELECT
                District,
                MemberID,
                FirstName,
                LastName,
                CONCAT(FirstName, ' ', LastName) as Name,
                Expiration,
                Gender,
                WeChatID,
                Email,
                Type,
                FamilyID,
                PaymentDate,
                MembershipFeePaid,
                PaymentTransaction,
                Status,
                UpdatedAt as LastModified
            FROM members
            WHERE 1=1
        """
        params = []

        if district:
            sql += " AND District = %s"
            params.append(district)

        if status:
            _, valid_statuses = get_member_status_options()
            if status in valid_statuses:
                sql += " AND Status = %s"
                params.append(status)
            else:
                return jsonify({'success': False, 'error': f'Invalid status: {status}'}), 400

        # Build ORDER BY safely
        if sort_by == 'Name':
            sql += f" ORDER BY LastName {sort_order}, FirstName {sort_order}"
        else:
            sql += f" ORDER BY {sort_by} {sort_order}"

        sql += " LIMIT %s"
        params.append(limit)

        members = query(sql, params)

        # Format dates for JSON serialization
        for member in members:
            if member.get('LastModified'):
                member['LastModified'] = member['LastModified'].isoformat()
            if member.get('Expiration'):
                member['Expiration'] = member['Expiration'].isoformat()
            if member.get('PaymentDate'):
                member['PaymentDate'] = member['PaymentDate'].isoformat()

        return jsonify({
            'success': True,
            'count': len(members),
            'members': members
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@district_members_bp.route('/districts', methods=['GET'])
@login_required
def get_districts():
    """Fetch unique district list for dropdown."""
    try:
        sql = """
            SELECT DISTINCT District
            FROM members
            WHERE District IS NOT NULL AND District != ''
            ORDER BY District
        """

        rows = query(sql)
        districts = [row['District'] for row in rows]

        return jsonify({
            'success': True,
            'districts': districts
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@district_members_bp.route('/member-status-values', methods=['GET'])
@login_required
def get_member_status_values():
    """
    Return Status ENUM values from INFORMATION_SCHEMA, shaped for the frontend dropdown.
    Values match the DB ENUM exactly — no translation or grouping.

    Response:
      {
        "success": true,
        "raw": ["active", "expired", "inactive", "lifetime", "pending", "pending_upgrade"],
        "options": [
          {"value": "",                "label": "All Statuses"},
          {"value": "active",          "label": "active"},
          {"value": "expired",         "label": "expired"},
          {"value": "inactive",        "label": "inactive"},
          {"value": "lifetime",        "label": "lifetime"},
          {"value": "pending",         "label": "pending"},
          {"value": "pending_upgrade", "label": "pending_upgrade"}
        ]
      }
    """
    try:
        options, raw = get_member_status_options()
        return jsonify({'success': True, 'raw': sorted(raw), 'options': options})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
