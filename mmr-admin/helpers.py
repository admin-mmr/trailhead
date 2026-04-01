"""
Shared helpers for mmr-admin: JSON encoding, response builder, error handlers,
and the @handle_api_errors route decorator.

This is a leaf module — it does NOT import from any other mmr-admin module.
"""

from __future__ import annotations

import functools
import json
from datetime import date, datetime

from flask import Flask


class DateEncoder(json.JSONEncoder):
    """JSON encoder that handles datetime, date, and bytes."""
    def default(self, obj):
        if isinstance(obj, (datetime, date)):
            return obj.isoformat()
        if isinstance(obj, bytes):
            return obj.decode('utf-8', errors='replace')
        return super().default(obj)


def json_response(data, status=200):
    """Build a Flask JSON response using DateEncoder."""
    from flask import current_app
    return current_app.response_class(
        json.dumps(data, cls=DateEncoder, default=str),
        status=status,
        mimetype='application/json',
    )


def handle_api_errors(fn):
    """
    Route decorator that wraps a Flask view in a try/except and returns
    a JSON error response instead of an HTML 500 page.

    Usage:
        @payments_bp.route('/api/payments/...')
        @login_required
        @require_role('admin')
        @handle_api_errors
        def my_route():
            # raises → clean JSON error
            ...

    DB errors (MySQLError) get status 503; all others get 500.
    """
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except Exception as e:
            # Import here to avoid circular imports (db → helpers would be a cycle)
            try:
                from db import MySQLError
                if isinstance(e, MySQLError):
                    return json_response({'ok': False, 'error': str(e)[:300], 'db_error': True}, 503)
            except ImportError:
                pass
            return json_response({'ok': False, 'error': str(e)[:300]}, 500)
    return wrapper


def register_error_handlers(app: Flask) -> None:
    """Register global error handlers on the Flask app."""
    from db import MySQLError

    @app.errorhandler(MySQLError)
    def handle_db_error(e):
        """Return a clean JSON error instead of a 500 HTML page."""
        msg = str(e)
        if "Can't connect" in msg or '2003' in msg:
            return json_response({
                'ok': False,
                'error': 'Not connected to database',
                'detail': 'Go to Settings to configure your database connection.',
                'db_error': True,
            }, 503)
        return json_response({'ok': False, 'error': msg[:300], 'db_error': True}, 500)

    @app.errorhandler(Exception)
    def handle_generic_error(e):
        """Catch-all so the API never returns HTML error pages."""
        return json_response({'ok': False, 'error': str(e)[:300]}, 500)

    @app.after_request
    def add_cors(resp):
        resp.headers['Content-Type'] = resp.headers.get('Content-Type', 'application/json')
        return resp
