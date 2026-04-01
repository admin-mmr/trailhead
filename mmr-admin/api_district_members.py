"""
District-based member view for group leaders.
Allows filtering by district, selecting members, and exporting as CSV.
"""

from flask import Blueprint, jsonify, request, Response
from functools import wraps
import csv
import io
import os
import zipfile
from datetime import datetime
from db import get_conn, query, execute
from auth import login_required

district_members_bp = Blueprint('district_members', __name__, url_prefix='/api/district')


def _build_member_export_query(district=None, status=None, type_filter=None, expired_only=False, active_only=False):
    """
    Build a parameterized SQL query to export members with flexible filtering.

    Args:
        district (str): Filter by specific district (e.g., 'Manhattan')
        status (str): Filter by status ('active', 'not active', 'pending')
        type_filter (str): Filter by membership type ('Individual', 'Family')
        expired_only (bool): If True, only return members with Expiration < today
        active_only (bool): If True, only return members with Expiration >= today

    Returns:
        tuple: (sql_query, params_list) for use with query(sql, params)
    """
    sql = """
        SELECT
            District,
            MemberID,
            CONCAT(FirstName, ' ', LastName) as Name,
            Expiration,
            Gender,
            WeChatID,
            Email,
            Type,
            FamilyID,
            PaymentDate,
            MembershipFeePaid,
            PaymentTransaction
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

    if type_filter:
        sql += " AND Type = %s"
        params.append(type_filter)

    if expired_only:
        sql += " AND Expiration < CURDATE()"
    elif active_only:
        sql += " AND Expiration >= CURDATE()"

    sql += " ORDER BY District, LastName, FirstName"

    return sql, params


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
    - renewed: filter by renewal status (yes/no, optional) — yes if Expiration >= MEMBERSHIP_YEAR_END
    - limit: number of records (default 500)
    """
    try:
        district = request.args.get('district', '').strip()
        status = request.args.get('status', '').strip()
        renewed = request.args.get('renewed', '').strip().lower()  # 'yes', 'no', or ''
        limit = min(int(request.args.get('limit', 500)), 5000)

        # Get membership year end from env (e.g., "2027-03-31")
        year_end_str = os.environ.get('MEMBERSHIP_YEAR_END', '')
        year_end_date = None
        if year_end_str:
            try:
                year_end_date = datetime.strptime(year_end_str, '%Y-%m-%d').date()
            except ValueError:
                pass

        sql = """
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

        sql += " ORDER BY District, LastName, FirstName LIMIT %s"
        params.append(limit)

        members = query(sql, params)

        # Format dates for JSON serialization
        for member in members:
            if member['LastLoginDate']:
                member['LastLoginDate'] = member['LastLoginDate'].isoformat()
            if member['LastModified']:
                member['LastModified'] = member['LastModified'].isoformat()
            if member['Expiration']:
                member['Expiration'] = member['Expiration'].isoformat()

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

        if include_all and district:
            # Export all members in this district
            sql = """
                SELECT
                    District,
                    MemberID,
                    CONCAT(FirstName, ' ', LastName) as Name,
                    Expiration,
                    WeChatID,
                    Email,
                    MembershipType as Type,
                    FamilyID,
                    PaymentDate,
                    MembershipFeePaid,
                    PaymentTransaction
                FROM members
                WHERE District = %s
                ORDER BY LastName, FirstName
            """
            rows = query(sql, [district])
        elif member_ids:
            # Export selected members
            placeholders = ','.join(['%s'] * len(member_ids))
            sql = f"""
                SELECT
                    District,
                    MemberID,
                    CONCAT(FirstName, ' ', LastName) as Name,
                    Expiration,
                    WeChatID,
                    Email,
                    MembershipType as Type,
                    FamilyID,
                    PaymentDate,
                    MembershipFeePaid,
                    PaymentTransaction
                FROM members
                WHERE MemberID IN ({placeholders})
                ORDER BY District, LastName, FirstName
            """
            rows = query(sql, member_ids)
        else:
            return jsonify({'success': False, 'error': 'No members selected'}), 400

        # Generate CSV with UTF-8-sig encoding for Excel compatibility with Chinese characters
        output = io.StringIO()
        writer = csv.DictWriter(
            output,
            fieldnames=[
                'District',
                'Member ID',
                'Name',
                'Expiration',
                'WeChat ID',
                'Email',
                'Type',
                'Family ID',
                'Payment Date',
                'Membership Fee Paid',
                'Payment Transaction'
            ]
        )

        writer.writeheader()
        for row in rows:
            expiration = row['Expiration'].strftime('%Y-%m-%d') if row['Expiration'] else ''
            payment_date = row['PaymentDate'].strftime('%Y-%m-%d') if row['PaymentDate'] else ''

            writer.writerow({
                'District': row['District'] or '',
                'Member ID': row['MemberID'],
                'Name': row['Name'],
                'Expiration': expiration,
                'WeChat ID': row['WeChatID'] or '',
                'Email': row['Email'] or '',
                'Type': row['Type'] or '',
                'Family ID': row['FamilyID'] or '',
                'Payment Date': payment_date,
                'Membership Fee Paid': row['MembershipFeePaid'] or '',
                'Payment Transaction': row['PaymentTransaction'] or ''
            })

        # Encode with UTF-8-sig for Excel to recognize Unicode characters properly
        csv_content = output.getvalue().encode('utf-8-sig')
        return Response(
            csv_content,
            mimetype='text/csv; charset=utf-8',
            headers={'Content-Disposition': f'attachment;filename=members_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv'}
        )

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@district_members_bp.route('/export-all-districts', methods=['POST'])
@login_required
def export_all_districts():
    """
    Export members from all districts as separate CSVs in a ZIP file.
    Body: {
        "status": "active/not active/pending/empty" (optional),
        "renewed": "yes/no/empty" (optional)
    }
    Returns ZIP file with one CSV per district.
    """
    try:
        data = request.get_json() or {}
        status_filter = data.get('status', '').strip()
        renewed_filter = data.get('renewed', '').strip().lower()

        # Get membership year end from env
        year_end_str = os.environ.get('MEMBERSHIP_YEAR_END', '')
        year_end_date = None
        if year_end_str:
            try:
                year_end_date = datetime.strptime(year_end_str, '%Y-%m-%d').date()
            except ValueError:
                pass

        # Fetch all districts
        sql = """
            SELECT DISTINCT District
            FROM members
            WHERE District IS NOT NULL AND District != ''
            ORDER BY District
        """
        district_rows = query(sql)
        districts = [row['District'] for row in district_rows]

        if not districts:
            return jsonify({'success': False, 'error': 'No districts found'}), 400

        # Create ZIP file in memory
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
            for district in districts:
                # Build query for this district with filters
                sql = """
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
                """
                params = [district]

                if status_filter:
                    sql += " AND Status = %s"
                    params.append(status_filter)

                if renewed_filter and year_end_date:
                    if renewed_filter == 'yes':
                        sql += " AND Expiration >= %s"
                        params.append(year_end_date)
                    elif renewed_filter == 'no':
                        sql += " AND Expiration < %s"
                        params.append(year_end_date)

                sql += " ORDER BY LastName, FirstName"
                members = query(sql, params)

                # Create CSV for this district
                csv_buffer = io.StringIO()
                writer = csv.DictWriter(
                    csv_buffer,
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
                for row in members:
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

                # Add CSV to ZIP with UTF-8-sig encoding for Chinese characters
                csv_filename = f"{district.replace('/', '_')}_members.csv"
                csv_content = csv_buffer.getvalue().encode('utf-8-sig')
                zf.writestr(csv_filename, csv_content)

        # Return ZIP as downloadable file
        zip_buffer.seek(0)
        return Response(
            zip_buffer.getvalue(),
            mimetype='application/zip',
            headers={'Content-Disposition': f'attachment;filename=all_districts_members_{datetime.now().strftime("%Y%m%d_%H%M%S")}.zip'}
        )

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
