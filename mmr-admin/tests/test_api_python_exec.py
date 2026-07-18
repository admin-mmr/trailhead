"""
Tests for api_python_exec.py — list, run, execute_code, health.

Coverage target: api_python_exec.py 42% → ~90%
Uncovered lines: 54-85 (run_function), 112-177 (execute_code).

Run:
    cd mmr-admin
    python3 -m pytest tests/test_api_python_exec.py -v
"""
import pytest
from unittest.mock import patch, MagicMock


# ── GET /api/py-exec/list ────────────────────────────────────────────────────────

class TestListFunctions:
    def test_returns_functions_list(self, client, mock_query):
        r = client.get('/api/py-exec/list')
        assert r.status_code == 200
        j = r.get_json()
        assert 'functions' in j
        assert isinstance(j['functions'], list)

    def test_each_function_has_name_and_description(self, client, mock_query):
        r = client.get('/api/py-exec/list')
        for fn in r.get_json()['functions']:
            assert 'name' in fn
            assert 'description' in fn

    def test_names_are_strings(self, client, mock_query):
        r = client.get('/api/py-exec/list')
        for fn in r.get_json()['functions']:
            assert isinstance(fn['name'], str)


# ── POST /api/py-exec/run/<fn_name> ──────────────────────────────────────────────

class TestRunFunction:
    def _post(self, client, fn_name, body=None):
        return client.post(f'/api/py-exec/run/{fn_name}', json=body or {})

    def test_unknown_function_returns_404(self, client, mock_query):
        r = self._post(client, 'nonexistent_function')
        assert r.status_code == 404
        j = r.get_json()
        assert j['status'] == 'error'
        assert 'available' in j

    def test_404_includes_available_functions(self, client, mock_query):
        r = self._post(client, 'bogus')
        j = r.get_json()
        assert isinstance(j['available'], list)

    def test_known_function_executes_and_returns_result(self, client, mock_query):
        # Patch FUNCTIONS dict to have a controllable function
        fake_fn = MagicMock(return_value={'status': 'ok', 'data': 'test result'})
        fake_fn.__doc__ = 'Test function'
        with patch('api_python_exec.FUNCTIONS', {'test_fn': fake_fn}):
            r = self._post(client, 'test_fn')
        assert r.status_code == 200
        j = r.get_json()
        assert j['status'] == 'ok'
        assert j['function'] == 'test_fn'

    def test_result_includes_timing(self, client, mock_query):
        fake_fn = MagicMock(return_value={'status': 'ok'})
        fake_fn.__doc__ = 'A fn'
        with patch('api_python_exec.FUNCTIONS', {'timed_fn': fake_fn}):
            r = self._post(client, 'timed_fn')
        j = r.get_json()
        assert 'execution_time_ms' in j
        assert 'executed_at' in j

    def test_result_includes_function_name(self, client, mock_query):
        fake_fn = MagicMock(return_value={'status': 'ok'})
        fake_fn.__doc__ = 'fn'
        with patch('api_python_exec.FUNCTIONS', {'my_fn': fake_fn}):
            r = self._post(client, 'my_fn')
        assert r.get_json()['function'] == 'my_fn'

    def test_function_exception_returns_500(self, client, mock_query):
        def boom(**kw): raise RuntimeError('exploded')
        boom.__doc__ = 'Boom'
        with patch('api_python_exec.FUNCTIONS', {'boom': boom}):
            r = self._post(client, 'boom')
        assert r.status_code == 500
        j = r.get_json()
        assert j['status'] == 'error'
        assert 'exploded' in j['error']
        assert 'traceback' in j

    def test_function_receives_kwargs_from_body(self, client, mock_query):
        captured = {}
        def fn_with_kwargs(**kw):
            captured.update(kw)
            return {'status': 'ok'}
        fn_with_kwargs.__doc__ = 'fn'
        with patch('api_python_exec.FUNCTIONS', {'kwfn': fn_with_kwargs}):
            self._post(client, 'kwfn', {'kwargs': {'limit': 10, 'debug': True}})
        assert captured.get('limit') == 10
        assert captured.get('debug') is True

    def test_error_response_includes_error_type(self, client, mock_query):
        def typed_error(**kw): raise ValueError('bad value')
        typed_error.__doc__ = 'fn'
        with patch('api_python_exec.FUNCTIONS', {'typed': typed_error}):
            r = self._post(client, 'typed')
        j = r.get_json()
        assert j['error_type'] == 'ValueError'


# ── POST /api/py-exec/code ───────────────────────────────────────────────────────

class TestExecuteCode:
    def _post(self, client, code):
        return client.post('/api/py-exec/code', json={'code': code})

    def test_empty_code_returns_400(self, client, mock_query):
        r = self._post(client, '')
        assert r.status_code == 400
        j = r.get_json()
        assert j['status'] == 'error'
        assert 'No code' in j['error']

    def test_missing_code_key_returns_400(self, client, mock_query):
        r = client.post('/api/py-exec/code', json={})
        assert r.status_code == 400

    def test_simple_code_executes(self, client, mock_query):
        r = self._post(client, 'x = 1 + 1')
        assert r.status_code == 200
        j = r.get_json()
        assert j['status'] == 'ok'

    def test_print_output_captured(self, client, mock_query):
        r = self._post(client, 'print("hello world")')
        assert r.status_code == 200
        j = r.get_json()
        assert 'hello world' in j.get('output_text', '')

    def test_output_lines_is_list(self, client, mock_query):
        r = self._post(client, 'print("line1")\nprint("line2")')
        j = r.get_json()
        assert isinstance(j.get('output'), list)

    def test_result_includes_timing(self, client, mock_query):
        r = self._post(client, 'pass')
        j = r.get_json()
        assert 'execution_time_ms' in j
        assert 'executed_at' in j

    def test_result_includes_debug_info(self, client, mock_query):
        r = self._post(client, 'x = 42')
        j = r.get_json()
        assert 'debug' in j
        debug = j['debug']
        assert 'code_length' in debug
        assert 'available_helpers' in debug

    def test_syntax_error_returns_400(self, client, mock_query):
        r = self._post(client, 'def broken(:')
        assert r.status_code == 400
        j = r.get_json()
        assert j['status'] == 'error'
        assert j['error_type'] == 'SyntaxError'
        assert 'line' in j

    def test_runtime_error_returns_500(self, client, mock_query):
        r = self._post(client, 'raise ValueError("oops")')
        assert r.status_code == 500
        j = r.get_json()
        assert j['status'] == 'error'
        assert 'oops' in j['error']
        assert 'traceback' in j

    def test_runtime_error_type_included(self, client, mock_query):
        r = self._post(client, 'raise TypeError("wrong type")')
        j = r.get_json()
        assert j['error_type'] == 'TypeError'

    def test_available_helpers_in_exec_env(self, client, mock_query):
        # 'query' and 'execute' should be available in the execution environment
        r = self._post(client, 'print(type(query).__name__)')
        j = r.get_json()
        # Should not error — 'query' is in the exec namespace
        assert j['status'] == 'ok'
        # 'magicmock' accepted: the mock_query fixture patches db.query, so the
        # exec env sees the mock under tests. The point is that `query` resolves.
        out = j.get('output_text', '').lower()
        assert any(t in out for t in ('function', 'method', 'magicmock'))

    def test_multiline_code_works(self, client, mock_query):
        code = '\n'.join([
            'total = 0',
            'for i in range(5):',
            '    total += i',
            'print(total)',
        ])
        r = self._post(client, code)
        assert r.status_code == 200
        assert '10' in r.get_json().get('output_text', '')

    def test_no_output_gives_empty_output_text(self, client, mock_query):
        r = self._post(client, 'x = 1')
        j = r.get_json()
        assert j['status'] == 'ok'
        assert j.get('output_text', '') == ''


# ── GET /api/py-exec/health ───────────────────────────────────────────────────────

class TestPyExecHealth:
    def test_returns_ok(self, client, mock_query):
        r = client.get('/api/py-exec/health')
        assert r.status_code == 200
        j = r.get_json()
        assert j['status'] == 'ok'

    def test_service_name_in_response(self, client, mock_query):
        r = client.get('/api/py-exec/health')
        assert r.get_json()['service'] == 'py-exec'

    def test_timestamp_present(self, client, mock_query):
        r = client.get('/api/py-exec/health')
        assert 'timestamp' in r.get_json()

    def test_available_functions_listed(self, client, mock_query):
        r = client.get('/api/py-exec/health')
        j = r.get_json()
        assert 'available_functions' in j
        assert isinstance(j['available_functions'], list)
