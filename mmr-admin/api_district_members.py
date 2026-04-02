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
            'MembershipFeePaid', 'PaymentTransaction', 'Status', 'LastLoginDate'
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
                LastLoginDate,
                LastUpdated as LastModified
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
            if member.get('LastLoginDate'):
                member['LastLoginDate'] = member['LastLoginDate'].isoformat()
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


@district_members_bp.route('/export-csv', methods=['POST'])
@login_required
def export_csv():
    """
    Export selected members to CSV with flexible columns.
    Body: {
        "memberIds": ["M001", "M002", ...],
        "includeAll": false,
        "district": "Manhattan",
        "columns": ["District", "MemberID", "Name", "Email", ...],  // column KEYS, not labels
        "filters": {"status": "active", "renewed": "yes"}
    }
    """
    try:
        data = request.get_json()
        member_ids = data.get('memberIds', [])
        include_all = data.get('includeAll', False)
        district = data.get('district', '')
        selected_columns = data.get('columns', [])
        filters = data.get('filters', {})

        # Map column keys to display labels for CSV headers
        column_labels = {
            'District': 'District',
            'MemberID': 'Member ID',
            'FirstName': 'First Name',
            'LastName': 'Last Name',
            'Name': 'Full Name',
            'Expiration': 'Expiration',
            'Gender': 'Gender',
            'WeChatID': 'WeChat ID',
            'Email': 'Email',
            'Type': 'Type',
            'FamilyID': 'Family ID',
            'PaymentDate': 'Payment Date',
            'MembershipFeePaid': 'Membership Fee Paid',
            'PaymentTransaction': 'Payment Transaction',
            'Status': 'Status',
            'LastLoginDate': 'Last Login',
            'LastModified': 'Last Modified',
        }

        # Validate columns
        valid_columns = list(column_labels.keys())
        if not selected_columns:
            selected_columns = ['District', 'MemberID', 'Name', 'Expiration', 'Email', 'Type']

        # Build select clause with all columns (for export, we need all data)
        sql = """
            SELECT
                District,
                MemberID,
                FirstName,
                LastName,
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
                LastLoginDate,
                LastUpdated as LastModified
            FROM members
            WHERE 1=1
        """
        params = []

        if include_all and district:
            sql += " AND District = %s"
            params.append(district)
        elif member_ids:
            placeholders = ','.join(['%s'] * len(member_ids))
            sql += f" AND MemberID IN ({placeholders})"
            params.extend(member_ids)
        else:
            return jsonify({'success': False, 'error': 'No members selected'}), 400

        # Apply filters if provided
        status_filter = filters.get('status', '').strip()
        renewed_filter = filters.get('renewed', '').strip().lower()

        if status_filter:
            sql += " AND Status = %s"
            params.append(status_filter)

        if renewed_filter:
            year_end_str = os.environ.get('MEMBERSHIP_YEAR_END', '')
            if year_end_str:
                try:
                    year_end_date = datetime.strptime(year_end_str, '%Y-%m-%d').date()
                    if renewed_filter == 'yes':
                        sql += " AND Expiration >= %s"
                    elif renewed_filter == 'no':
                        sql += " AND Expiration < %s"
                    params.append(year_end_date)
                except ValueError:
                    pass

        sql += " ORDER BY District, LastName, FirstName"
        rows = query(sql, params)

        # Generate CSV with column labels as headers
        output = io.StringIO()
        csv_headers = [column_labels.get(col, col) for col in selected_columns]
        writer = csv.DictWriter(output, fieldnames=csv_headers)

        writer.writeheader()
        for row in rows:
            row_data = {}
            for col_key, col_label in zip(selected_columns, csv_headers):
                if col_key == 'MemberID':
                    row_data[col_label] = row['MemberID']
                elif col_key == 'FirstName':
                    row_data[col_label] = row['FirstName'] or ''
                elif col_key == 'LastName':
                    row_data[col_label] = row['LastName'] or ''
                elif col_key == 'Name':
                    # Compute Full Name from FirstName + LastName
                    full_name = f"{row['FirstName'] or ''} {row['LastName'] or ''}".strip()
                    row_data[col_label] = full_name
                elif col_key == 'Expiration':
                    row_data[col_label] = row['Expiration'].strftime('%Y-%m-%d') if row['Expiration'] else ''
                elif col_key == 'PaymentDate':
                    row_data[col_label] = row['PaymentDate'].strftime('%Y-%m-%d') if row['PaymentDate'] else ''
                elif col_key == 'LastLoginDate':
                    row_data[col_label] = row['LastLoginDate'].strftime('%Y-%m-%d %H:%M') if row['LastLoginDate'] else ''
                elif col_key == 'LastModified':
                    row_data[col_label] = row['LastModified'].strftime('%Y-%m-%d %H:%M') if row['LastModified'] else ''
                elif col_key == 'WeChatID':
                    row_data[col_label] = row['WeChatID'] or ''
                elif col_key == 'FamilyID':
                    row_data[col_label] = row['FamilyID'] or ''
                else:
                    # Direct column key
                    row_data[col_label] = row.get(col_key, '') or ''

            writer.writerow(row_data)

        # Encode with UTF-8-sig for Excel
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
        "renewed": "yes/no/empty" (optional),
        "columns": ["District", "MemberID", "Name", ...] (optional, column KEYS not labels)
    }
    Returns ZIP file with one CSV per district.
    """
    try:
        data = request.get_json() or {}
        status_filter = data.get('status', '').strip()
        renewed_filter = data.get('renewed', '').strip().lower()
        selected_columns = data.get('columns', [])

        # Map column keys to display labels for CSV headers
        column_labels = {
            'District': 'District',
            'MemberID': 'Member ID',
            'FirstName': 'First Name',
            'LastName': 'Last Name',
            'Name': 'Full Name',
            'Expiration': 'Expiration',
            'Gender': 'Gender',
            'WeChatID': 'WeChat ID',
            'Email': 'Email',
            'Type': 'Type',
            'FamilyID': 'Family ID',
            'PaymentDate': 'Payment Date',
            'MembershipFeePaid': 'Membership Fee Paid',
            'PaymentTransaction': 'Payment Transaction',
            'Status': 'Status',
            'LastLoginDate': 'Last Login',
            'LastModified': 'Last Modified',
        }

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

        # Default columns if none selected (using column KEYS not labels)
        if not selected_columns:
            selected_columns = [
                'District', 'MemberID', 'Name', 'Email', 'Status',
                'LastLoginDate', 'LastModified', 'Expiration'
            ]

        # Create ZIP file in memory
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
            for district in districts:
                # Build query for this district with filters - fetch all columns
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
                        LastLoginDate,
                        LastUpdated as LastModified
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

                # Create CSV for this district with selected columns
                csv_buffer = io.StringIO()
                csv_headers = [column_labels.get(col, col) for col in selected_columns]
                writer = csv.DictWriter(csv_buffer, fieldnames=csv_headers)

                writer.writeheader()
                for row in members:
                    row_data = {}
                    for col_key, col_label in zip(selected_columns, csv_headers):
                        if col_key == 'MemberID':
                            row_data[col_label] = row['MemberID']
                        elif col_key == 'FirstName':
                            row_data[col_label] = row['FirstName'] or ''
                        elif col_key == 'LastName':
                            row_data[col_label] = row['LastName'] or ''
                        elif col_key == 'Name':
                            # Compute Full Name from FirstName + LastName
                            full_name = f"{row['FirstName'] or ''} {row['LastName'] or ''}".strip()
                            row_data[col_label] = full_name
                        elif col_key == 'Expiration':
                            row_data[col_label] = row['Expiration'].strftime('%Y-%m-%d') if row['Expiration'] else ''
                        elif col_key == 'PaymentDate':
                            row_data[col_label] = row['PaymentDate'].strftime('%Y-%m-%d') if row['PaymentDate'] else ''
                        elif col_key == 'LastLoginDate':
                            row_data[col_label] = row['LastLoginDate'].strftime('%Y-%m-%d %H:%M') if row['LastLoginDate'] else ''
                        elif col_key == 'LastModified':
                            row_data[col_label] = row['LastModified'].strftime('%Y-%m-%d %H:%M') if row['LastModified'] else ''
                        elif col_key == 'WeChatID':
                            row_data[col_label] = row['WeChatID'] or ''
                        elif col_key == 'FamilyID':
                            row_data[col_label] = row['FamilyID'] or ''
                        else:
                            # Direct column key
                            row_data[col_label] = row.get(col_key, '') or ''

                    writer.writerow(row_data)

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


@district_members_bp.route('/export-all-sheet', methods=['POST'])
@login_required
def export_all_sheet():
    """
    Export all members from all districts as a single CSV sheet.
    Body: {
        "status": "active/not active/pending/empty" (optional),
        "renewed": "yes/no/empty" (optional),
        "columns": ["District", "MemberID", "Name", ...] (optional, column KEYS not labels)
    }
    Returns single CSV file with all members.
    """
    try:
        data = request.get_json() or {}
        status_filter = data.get('status', '').strip()
        renewed_filter = data.get('renewed', '').strip().lower()
        selected_columns = data.get('columns', [])

        # Map column keys to display labels for CSV headers
        column_labels = {
            'District': 'District',
            'MemberID': 'Member ID',
            'FirstName': 'First Name',
            'LastName': 'Last Name',
            'Name': 'Full Name',
            'Expiration': 'Expiration',
            'Gender': 'Gender',
            'WeChatID': 'WeChat ID',
            'Email': 'Email',
            'Type': 'Type',
            'FamilyID': 'Family ID',
            'PaymentDate': 'Payment Date',
            'MembershipFeePaid': 'Membership Fee Paid',
            'PaymentTransaction': 'Payment Transaction',
            'Status': 'Status',
            'LastLoginDate': 'Last Login',
            'LastModified': 'Last Modified',
        }

        # Default columns if none selected (using column KEYS not labels)
        if not selected_columns:
            selected_columns = [
                'District', 'MemberID', 'Name', 'Email', 'Status',
                'LastLoginDate', 'LastModified', 'Expiration'
            ]

        # Get membership year end from env
        year_end_str = os.environ.get('MEMBERSHIP_YEAR_END', '')
        year_end_date = None
        if year_end_str:
            try:
                year_end_date = datetime.strptime(year_end_str, '%Y-%m-%d').date()
            except ValueError:
                pass

        # Build query to fetch all members with filters
        sql = """
            SELECT
                District,
                MemberID,
                FirstName,
                LastName,
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
                LastLoginDate,
                LastUpdated as LastModified
            FROM members
            WHERE 1=1
        """
        params = []

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

        sql += " ORDER BY District, LastName, FirstName"
        members = query(sql, params)

        if not members:
            return jsonify({'success': False, 'error': 'No members found'}), 400

        # Generate single CSV sheet
        csv_buffer = io.StringIO()
        csv_headers = [column_labels.get(col, col) for col in selected_columns]
        writer = csv.DictWriter(csv_buffer, fieldnames=csv_headers)

        writer.writeheader()
        for row in members:
            row_data = {}
            for col_key, col_label in zip(selected_columns, csv_headers):
                if col_key == 'MemberID':
                    row_data[col_label] = row['MemberID']
                elif col_key == 'FirstName':
                    row_data[col_label] = row['FirstName'] or ''
                elif col_key == 'LastName':
                    row_data[col_label] = row['LastName'] or ''
                elif col_key == 'Name':
                    # Compute Full Name from FirstName + LastName
                    full_name = f"{row['FirstName'] or ''} {row['LastName'] or ''}".strip()
                    row_data[col_label] = full_name
                elif col_key == 'Expiration':
                    row_data[col_label] = row['Expiration'].strftime('%Y-%m-%d') if row['Expiration'] else ''
                elif col_key == 'PaymentDate':
                    row_data[col_label] = row['PaymentDate'].strftime('%Y-%m-%d') if row['PaymentDate'] else ''
                elif col_key == 'LastLoginDate':
                    row_data[col_label] = row['LastLoginDate'].strftime('%Y-%m-%d %H:%M') if row['LastLoginDate'] else ''
                elif col_key == 'LastModified':
                    row_data[col_label] = row['LastModified'].strftime('%Y-%m-%d %H:%M') if row['LastModified'] else ''
                elif col_key == 'WeChatID':
                    row_data[col_label] = row['WeChatID'] or ''
                elif col_key == 'FamilyID':
                    row_data[col_label] = row['FamilyID'] or ''
                else:
                    # Direct column key
                    row_data[col_label] = row.get(col_key, '') or ''

            writer.writerow(row_data)

        # Return CSV as downloadable file with UTF-8-sig encoding
        csv_content = csv_buffer.getvalue().encode('utf-8-sig')
        return Response(
            csv_content,
            mimetype='text/csv; charset=utf-8',
            headers={'Content-Disposition': f'attachment;filename=all_members_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv'}
        )

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
