"""
Tests for helpers.py — DateEncoder, json_response, handle_api_errors.

Coverage target: the uncovered branches in helpers.py (was 65%).
Lines 23-25 (bytes encoding), 60-70 (DB error 503), 81-89 (generic 500).

Run:
    cd mmr-admin
    python3 -m pytest tests/test_helpers.py -v
"""
import json
import pytest
from datetime import date, datetime
from unittest.mock import patch, MagicMock


# ── DateEncoder ───────────────────────────────────────────────────────────────

class TestDateEncoder:
    def setup_method(self):
        import sys, os
        sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
        from helpers import DateEncoder
        self.enc = DateEncoder()

    def test_date_serialized_to_isoformat(self):
        d = date(2026, 4, 28)
        result = json.dumps(d, cls=__import__('helpers').DateEncoder)
        assert '2026-04-28' in result

    def test_datetime_serialized_to_isoformat(self):
        dt = datetime(2026, 4, 28, 10, 30, 0)
        result = json.dumps(dt, cls=__import__('helpers').DateEncoder)
        assert '2026-04-28' in result
        assert '10:30:00' in result

    def test_bytes_decoded_to_string(self):
        b = b'hello world'
        result = json.dumps(b, cls=__import__('helpers').DateEncoder)
        assert 'hello world' in result

    def test_bytes_with_invalid_utf8_replaced(self):
        b = b'\xff\xfe'
        result = json.dumps(b, cls=__import__('helpers').DateEncoder)
        assert isinstance(result, str)   # no crash

    def test_unknown_type_uses_default_encoder(self):
        from helpers import DateEncoder
        enc = DateEncoder()
        with pytest.raises((TypeError, ValueError)):
            enc.default(object())   # not date/datetime/bytes → super().default() raises

    def test_dict_with_date_values_serialized(self):
        from helpers import DateEncoder
        data = {'expires': date(2027, 3, 31), 'count': 5}
        result = json.loads(json.dumps(data, cls=DateEncoder))
        assert result['expires'] == '2027-03-31'
        assert result['count'] == 5


# ── json_response ─────────────────────────────────────────────────────────────

class TestJsonResponse:
    """Needs Flask app context to call json_response."""

    def test_returns_200_by_default(self, client):
        from helpers import json_response
        with client.application.app_context():
            resp = json_response({'ok': True})
        assert resp.status_code == 200

    def test_custom_status_code(self, client):
        from helpers import json_response
        with client.application.app_context():
            resp = json_response({'error': 'not found'}, 404)
        assert resp.status_code == 404

    def test_content_type_is_json(self, client):
        from helpers import json_response
        with client.application.app_context():
            resp = json_response({'ok': True})
        assert 'application/json' in resp.content_type

    def test_date_in_response_serialized(self, client):
        from helpers import json_response
        with client.application.app_context():
            resp = json_response({'expires': date(2027, 1, 1)})
        body = json.loads(resp.data)
        assert body['expires'] == '2027-01-01'

    def test_503_status_code(self, client):
        from helpers import json_response
        with client.application.app_context():
            resp = json_response({'error': 'db down'}, 503)
        assert resp.status_code == 503


# ── handle_api_errors ─────────────────────────────────────────────────────────

class TestHandleApiErrors:
    """
    Verifies the decorator:
      - passes through clean results unchanged
      - returns 503 JSON for DB (MySQLError) exceptions
      - returns 500 JSON for all other exceptions
    """

    def test_clean_function_passes_through(self, client):
        from helpers import handle_api_errors
        from helpers import json_response

        @handle_api_errors
        def view():
            return json_response({'ok': True})

        with client.application.app_context():
            resp = view()
        assert json.loads(resp.data)['ok'] is True

    def test_generic_exception_returns_500(self, client):
        from helpers import handle_api_errors

        @handle_api_errors
        def view():
            raise ValueError('something went wrong')

        with client.application.app_context():
            resp = view()
        assert resp.status_code == 500
        body = json.loads(resp.data)
        assert body['ok'] is False
        assert 'something went wrong' in body['error']

    def test_db_error_returns_503(self, client):
        from helpers import handle_api_errors
        from db import MySQLError

        @handle_api_errors
        def view():
            raise MySQLError('Connection refused', errno=2003)

        with client.application.app_context():
            resp = view()
        assert resp.status_code == 503
        body = json.loads(resp.data)
        assert body['ok'] is False
        assert body.get('db_error') is True

    def test_error_message_truncated_to_300_chars(self, client):
        from helpers import handle_api_errors

        @handle_api_errors
        def view():
            raise RuntimeError('x' * 1000)

        with client.application.app_context():
            resp = view()
        body = json.loads(resp.data)
        assert len(body['error']) <= 300

    def test_decorator_preserves_function_name(self):
        from helpers import handle_api_errors

        @handle_api_errors
        def my_special_view():
            pass

        assert my_special_view.__name__ == 'my_special_view'

    def test_args_and_kwargs_forwarded(self, client):
        from helpers import handle_api_errors, json_response

        @handle_api_errors
        def view(a, b=0):
            return json_response({'sum': a + b})

        with client.application.app_context():
            resp = view(3, b=4)
        assert json.loads(resp.data)['sum'] == 7
