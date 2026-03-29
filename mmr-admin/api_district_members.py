"""
District-based member view for group leaders.
Allows filtering by district, selecting members, and exporting as CSV.
"""

from flask import Blueprint, jsonify, request, Response
from functools import wraps
import csv
import io
from datetime import datetime
from db import get_connection
from auth import login_required

district_members_bp = Blueprint('district_members', __name__, url_prefix='/api/district')


def require_admin(f):
    """Decorator to check if user is admin."""
    @wraps(f)
    def decorated(*args, **kwargs):
        # TODO: Verify user is admin/group leader
        # For now, login_required is sufficient
        return f(*args, **kwargs)
    return decorated


@district_members_bp.route('/list', methods=['GET'])
@login_required
def get_district_members():
    """
    Fetch members by district.
    Query params:
    - district: filter by district (optional)
    - status: filter by status (active/not active/pending, optional)
    - limit: number of records (default 500)
    """
    try:
        district = request.args.get('district', '').strip()
        status = request.args.get('status', '').strip()
        limit = min(int(request.args.get('limit', 500)), 5000)

        conn = get_connection()
        cursor = conn.cursor(dictionary=True)

        query = """
            SELECT
                MemberID,
                CONCAT(FirstName, ' ', LastName) as Name,
                Email,
                WeChatID,
                PhoneNumber,
                District,
                Status,
                LastLoginDate,
                LastUpdated as LastModified,
                Expiration
            FROM members
            WHERE 1=1
        """
        params = []

        if district:
            query += " AND District = %s"
            params.append(district)

        if status:
            query += " AND Status = %s"
            params.append(status)

        query += " ORDER BY District, LastName, FirstName LIMIT %s"
        params.append(limit)

        cursor.execute(query, params)
        members = cursor.fetchall()

        # Format dates for JSON serialization
        for member in members:
            if member['LastLoginDate']:
                member['LastLoginDate'] = member['LastLoginDate'].isoformat()
            if member['LastModified']:
                member['LastModified'] = member['LastModified'].isoformat()
            if member['Expiration']:
                member['Expiration'] = member['Expiration'].isoformat()

        cursor.close()
        conn.close()

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
        conn = get_connection()
        cursor = conn.cursor()

        query = """
            SELECT DISTINCT District
            FROM members
            WHERE District IS NOT NULL AND District != ''
            ORDER BY District
        """

        cursor.execute(query)
        rows = cursor.fetchall()
        districts = [row[0] for row in rows]

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'districts': districts
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@district_members_bp.route('/export-csv', methods=['POST'])
@login_required
def export_csv():
    """
    Export selected members to CSV.
    Body: {
        "memberIds": ["M001", "M002", ...],
        "includeAll": false  // if true, export all from district instead of selected
    }
    """
    try:
        data = request.get_json()
        member_ids = data.get('memberIds', [])
        include_all = data.get('includeAll', False)
        district = data.get('district', '')

        conn = get_connection()
        cursor = conn.cursor(dictionary=True)

        if include_all and district:
            # Export all members in this district
            query = """
                SELECT
                    MemberID,
                    CONCAT(FirstName, ' ', LastName) as Name,
                    Email,
                    WeChatID,
                    PhoneNumber,
                    District,
                    Status,
                    LastLoginDate,
                    LastUpdated as ModifiedAt,
                    Expiration
                FROM members
                WHERE District = %s
                ORDER BY LastName, FirstName
            """
            cursor.execute(query, [district])
        elif member_ids:
            # Export selected members
            placeholders = ','.join(['%s'] * len(member_ids))
            query = f"""
                SELECT
                    MemberID,
                    CONCAT(FirstName, ' ', LastName) as Name,
                    Email,
                    WeChatID,
                    PhoneNumber,
                    District,
                    Status,
                    LastLoginDate,
                    LastUpdated as ModifiedAt,
                    Expiration
                FROM members
                WHERE MemberID IN ({placeholders})
                ORDER BY District, LastName, FirstName
            """
            cursor.execute(query, member_ids)
        else:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'No members selected'}), 400

        rows = cursor.fetchall()
        cursor.close()
        conn.close()

        # Generate CSV
        output = io.StringIO()
        writer = csv.DictWriter(
            output,
            fieldnames=[
                'Member ID',
                'Name',
                'Email',
                'WeChat ID',
                'Phone',
                'District',
                'Status',
                'Last Login',
                'Last Modified',
                'Expiration'
            ]
        )

        writer.writeheader()
        for row in rows:
            last_login = row['LastLoginDate'].strftime('%Y-%m-%d %H:%M') if row['LastLoginDate'] else 'Never'
            modified = row['ModifiedAt'].strftime('%Y-%m-%d %H:%M') if row['ModifiedAt'] else 'N/A'
            expiration = row['Expiration'].strftime('%Y-%m-%d') if row['Expiration'] else 'N/A'

            writer.writerow({
                'Member ID': row['MemberID'],
                'Name': row['Name'],
                'Email': row['Email'],
                'WeChat ID': row['WeChatID'] or '',
                'Phone': row['PhoneNumber'] or '',
                'District': row['District'],
                'Status': row['Status'],
                'Last Login': last_login,
                'Last Modified': modified,
                'Expiration': expiration
            })

        # Return as downloadable file
        output.seek(0)
        return Response(
            output.getvalue(),
            mimetype='text/csv',
            headers={'Content-Disposition': f'attachment;filename=members_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv'}
        )

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
