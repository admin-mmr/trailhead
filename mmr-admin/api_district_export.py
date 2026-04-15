"""
Member export functionality for district views.
Supports CSV and ZIP exports with flexible column selection and filtering.
"""

from flask import Blueprint, jsonify, request, Response
import csv
import io
import zipfile
from api_district_members import get_member_status_options
from datetime import datetime
from db import query
from auth import login_required

district_export_bp = Blueprint('district_export', __name__, url_prefix='/api/district')


def get_column_labels():
    """Map column keys to display labels for CSV headers."""
    return {
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
        'LastModified': 'Last Modified',
    }



def format_cell_value(col_key, row):
    """Format a cell value based on column type."""
    if col_key == 'MemberID':
        return row['MemberID']
    elif col_key == 'FirstName':
        return row['FirstName'] or ''
    elif col_key == 'LastName':
        return row['LastName'] or ''
    elif col_key == 'Name':
        # Compute Full Name from FirstName + LastName
        return f"{row['FirstName'] or ''} {row['LastName'] or ''}".strip()
    elif col_key == 'Expiration':
        return row['Expiration'].strftime('%Y-%m-%d') if row['Expiration'] else ''
    elif col_key == 'PaymentDate':
        return row['PaymentDate'].strftime('%Y-%m-%d') if row['PaymentDate'] else ''
    elif col_key == 'LastModified':
        return row['LastModified'].strftime('%Y-%m-%d %H:%M') if row['LastModified'] else ''
    elif col_key == 'WeChatID':
        return row['WeChatID'] or ''
    elif col_key == 'FamilyID':
        return row['FamilyID'] or ''
    else:
        # Direct column key
        return row.get(col_key, '') or ''


def apply_status_filter(sql, params, status_filter):
    """
    Apply membership status filter.
    Valid values come from INFORMATION_SCHEMA (via get_member_status_options).
    Values match the DB ENUM exactly — no translation or grouping.
    """
    status_filter = (status_filter or '').strip()
    if not status_filter:
        return sql, params, None
    _, valid_statuses = get_member_status_options()
    if status_filter in valid_statuses:
        sql += " AND Status = %s"
        params.append(status_filter)
    else:
        return sql, params, f'Invalid status: {status_filter}'
    return sql, params, None


@district_export_bp.route('/export-csv', methods=['POST'])
@login_required
def export_csv():
    """
    Export selected members to CSV with flexible columns.
    Body: {
        "memberIds": ["M001", "M002", ...],
        "includeAll": false,
        "district": "Manhattan",
        "columns": ["District", "MemberID", "Name", "Email", ...],  // column KEYS
        "filters": {"status": "active"}
    }
    """
    try:
        data = request.get_json()
        member_ids = data.get('memberIds', [])
        include_all = data.get('includeAll', False)
        district = data.get('district', '')
        selected_columns = data.get('columns', [])
        filters = data.get('filters', {})

        column_labels = get_column_labels()
        if not selected_columns:
            selected_columns = ['District', 'MemberID', 'Name', 'Expiration', 'Email', 'Type']

        # Build query
        sql = """
            SELECT
                District, MemberID, FirstName, LastName, Expiration, Gender,
                WeChatID, Email, Type, FamilyID, PaymentDate, MembershipFeePaid,
                PaymentTransaction, Status, UpdatedAt as LastModified
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

        # Apply filters
        status_filter = filters.get('status', '').strip()
        sql, params, err = apply_status_filter(sql, params, status_filter)
        if err:
            return jsonify({'success': False, 'error': err}), 400

        sql += " ORDER BY District, LastName, FirstName"
        rows = query(sql, params)

        # Generate CSV
        output = io.StringIO()
        csv_headers = [column_labels.get(col, col) for col in selected_columns]
        writer = csv.DictWriter(output, fieldnames=csv_headers)
        writer.writeheader()

        for row in rows:
            row_data = {}
            for col_key, col_label in zip(selected_columns, csv_headers):
                row_data[col_label] = format_cell_value(col_key, row)
            writer.writerow(row_data)

        csv_content = output.getvalue().encode('utf-8-sig')
        return Response(
            csv_content,
            mimetype='text/csv; charset=utf-8',
            headers={'Content-Disposition': f'attachment;filename=members_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv'}
        )

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@district_export_bp.route('/export-all-districts', methods=['POST'])
@login_required
def export_all_districts():
    """
    Export members from all districts as separate CSVs in a ZIP file.
    Body: {
        "status": "active/expired/inactive/pending/pending_upgrade/lifetime/empty" (optional),
        "columns": ["District", "MemberID", "Name", ...] (optional, column KEYS)
    }
    """
    try:
        data = request.get_json() or {}
        status_filter = data.get('status', '').strip()
        selected_columns = data.get('columns', [])

        column_labels = get_column_labels()
        if not selected_columns:
            selected_columns = ['District', 'MemberID', 'Name', 'Email', 'Status', 'LastModified', 'Expiration']

        # Fetch all districts
        district_rows = query("SELECT DISTINCT District FROM members WHERE District IS NOT NULL AND District != '' ORDER BY District")
        districts = [row['District'] for row in district_rows]

        if not districts:
            return jsonify({'success': False, 'error': 'No districts found'}), 400

        # Validate status once before looping
        if status_filter:
            _, _, err = apply_status_filter("", [], status_filter)
            if err:
                return jsonify({'success': False, 'error': err}), 400

        # Create ZIP
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
            for district in districts:
                sql = """
                    SELECT District, MemberID, FirstName, LastName, Expiration, Gender,
                           WeChatID, Email, Type, FamilyID, PaymentDate, MembershipFeePaid,
                           PaymentTransaction, Status, UpdatedAt as LastModified
                    FROM members WHERE District = %s
                """
                params = [district]
                sql, params, _ = apply_status_filter(sql, params, status_filter)
                sql += " ORDER BY LastName, FirstName"
                members = query(sql, params)

                # Create CSV for district
                csv_buffer = io.StringIO()
                csv_headers = [column_labels.get(col, col) for col in selected_columns]
                writer = csv.DictWriter(csv_buffer, fieldnames=csv_headers)
                writer.writeheader()

                for row in members:
                    row_data = {}
                    for col_key, col_label in zip(selected_columns, csv_headers):
                        row_data[col_label] = format_cell_value(col_key, row)
                    writer.writerow(row_data)

                # Add to ZIP
                csv_filename = f"{district.replace('/', '_')}_members.csv"
                csv_content = csv_buffer.getvalue().encode('utf-8-sig')
                zf.writestr(csv_filename, csv_content)

        zip_buffer.seek(0)
        return Response(
            zip_buffer.getvalue(),
            mimetype='application/zip',
            headers={'Content-Disposition': f'attachment;filename=all_districts_members_{datetime.now().strftime("%Y%m%d_%H%M%S")}.zip'}
        )

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@district_export_bp.route('/export-all-sheet', methods=['POST'])
@login_required
def export_all_sheet():
    """
    Export all members from all districts as a single CSV sheet.
    Body: {
        "status": "active/expired/inactive/pending/pending_upgrade/lifetime/empty" (optional),
        "columns": ["District", "MemberID", "Name", ...] (optional, column KEYS)
    }
    """
    try:
        data = request.get_json() or {}
        status_filter = data.get('status', '').strip()
        selected_columns = data.get('columns', [])

        column_labels = get_column_labels()
        if not selected_columns:
            selected_columns = ['District', 'MemberID', 'Name', 'Email', 'Status', 'LastModified', 'Expiration']

        # Build query for all members
        sql = """
            SELECT District, MemberID, FirstName, LastName, Expiration, Gender,
                   WeChatID, Email, Type, FamilyID, PaymentDate, MembershipFeePaid,
                   PaymentTransaction, Status, UpdatedAt as LastModified
            FROM members WHERE 1=1
        """
        params = []

        sql, params, err = apply_status_filter(sql, params, status_filter)
        if err:
            return jsonify({'success': False, 'error': err}), 400

        sql += " ORDER BY District, LastName, FirstName"
        members = query(sql, params)

        if not members:
            return jsonify({'success': False, 'error': 'No members found'}), 400

        # Generate single CSV
        csv_buffer = io.StringIO()
        csv_headers = [column_labels.get(col, col) for col in selected_columns]
        writer = csv.DictWriter(csv_buffer, fieldnames=csv_headers)
        writer.writeheader()

        for row in members:
            row_data = {}
            for col_key, col_label in zip(selected_columns, csv_headers):
                row_data[col_label] = format_cell_value(col_key, row)
            writer.writerow(row_data)

        csv_content = csv_buffer.getvalue().encode('utf-8-sig')
        return Response(
            csv_content,
            mimetype='text/csv; charset=utf-8',
            headers={'Content-Disposition': f'attachment;filename=all_members_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv'}
        )

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
