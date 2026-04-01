#!/usr/bin/env python3
"""
Temporary schema export endpoint for database backups.

**IMPORTANT:** This endpoint is meant to be temporary. Delete after use.
It allows direct HTTP download of the MySQL schema (no data).

Usage:
    curl https://<web-app>/api/export-schema > db/schema_snapshot.sql
    # Then remove this file and the blueprint registration from app.py
"""

from flask import Blueprint, Response
import subprocess
import os

schema_bp = Blueprint('schema', __name__, url_prefix='/api')


@schema_bp.route('/export-schema', methods=['GET'])
def export_schema():
    """
    Export DB schema via mysqldump.
    Returns SQL DDL for all tables (no data).

    Response: text/plain SQL file ready to save.
    Error: JSON with error message if dump fails.
    """
    try:
        # Use login-path from ~/.mylogin.cnf or shell env
        result = subprocess.run(
            ['mysqldump', '--login-path=mmr', '--no-data', 'mmrdb'],
            capture_output=True,
            text=True,
            check=True,
            timeout=30
        )

        # Return as downloadable file
        return Response(
            result.stdout,
            mimetype='text/plain',
            headers={
                'Content-Disposition': 'attachment; filename="schema_snapshot.sql"'
            }
        )

    except subprocess.TimeoutExpired:
        return {'error': 'mysqldump timeout (>30s)'}, 504
    except subprocess.CalledProcessError as e:
        return {
            'error': f'mysqldump failed: {e.stderr}',
            'returncode': e.returncode
        }, 500
    except FileNotFoundError:
        return {
            'error': 'mysqldump not found. Install: brew install mysql-client'
        }, 500
    except Exception as e:
        return {'error': f'Unexpected error: {str(e)}'}, 500


@schema_bp.route('/export-schema-info', methods=['GET'])
def export_schema_info():
    """
    Quick info endpoint — schema export is available at /api/export-schema.

    REMINDER: This endpoint should be removed after schema is exported.
    """
    return {
        'endpoint': '/api/export-schema',
        'method': 'GET',
        'description': 'Downloads full MySQL schema (DDL only, no data)',
        'curl_example': 'curl https://<host>/api/export-schema > db/schema_snapshot.sql',
        'status': '⚠️  TEMPORARY — delete api_schema.py and remove blueprint registration after use'
    }, 200
