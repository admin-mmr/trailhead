"""
District-based member query endpoints.
Fetch members and districts with filtering and sorting.
Export functionality moved to api_district_export.py
"""

from flask import Blueprint, jsonify, request
import os
from datetime import datetime
from db import query
from auth import login_required

district_members_bp = Blueprint('district_members', __name__, url_prefix='/api/district')


@district_members_bp.route('/list', methods=['GET'])
@login_required
def get_district_members():
    """
    Fetch members by district with flexible column selection and sorting.
    Query params:
    - district: filter by district (optional)
    - status: filter by status (active/not active/pending, optional)
    - renewed: filter by renewal status (yes/no, optional) — yes if Expiration >= MEMBERSHIP_YEAR_END
    - sortBy: column to sort by (default: District)
    - sortOrder: 'asc' or 'desc' (default: asc)
    - limit: number of records (default 500, max 5000)
    """
    try:
        district = request.args.get('district', '').strip()
        status = request.args.get('status', '').strip()
        renewed = request.args.get('renewed', '').strip().lower()
        sort_by = request.args.get('sortBy', 'District').strip()
        sort_order = request.args.get('sortOrder', 'asc').strip().lower()
        limit = min(int(request.args.get('limit', 500)), 5000)

        # Whitelist of safe columns to sort by
        safe_columns = {
            'District', 'MemberID', 'FirstName', 'LastName', 'Name', 'Expiration',
            'Gender', 'WeChatID', 'Email', 'Type', 'FamilyID', 'PaymentDate',
            'MembershipFeePaid', 'PaymentTransaction', 'Status', 'LastLogin'
        }
        if sort_by not in safe_columns:
            sort_by = 'District'
        if sort_order not in ('asc', 'desc'):
            sort_order = 'asc'

        # Get membership year end from env
        year_end_str = os.environ.get('MEMBERSHIP_YEAR_END', '')
        year_end_date = None
        if year_end_str:
            try:
                year_end_date = datetime.strptime(year_end_str, '%Y-%m-%d').date()
            except ValueError:
                pass

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
            sql += " AND Status = %s"
            params.append(status)

        if renewed and year_end_date:
            if renewed == 'yes':
                sql += " AND Expiration >= %s"
                params.append(year_end_date)
            elif renewed == 'no':
                sql += " AND Expiration < %s"
                params.append(year_end_date)

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
            if member.get('LastLogin'):
                member['LastLogin'] = member['LastLogin'].isoformat()
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
