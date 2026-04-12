"""
Unit tests for mmr-admin/db.py

Tests cover:
- handle_mysql_error(): errno → HTTP status + message mapping
- db_cursor() context manager: commit on success, rollback on exception
- update_db_config(): resets pool so new connections pick up new config
- query() / execute(): rollback on exception (no silent partial commits)
"""
import pytest
from unittest.mock import MagicMock, patch, call, PropertyMock


# ---------------------------------------------------------------------------
# handle_mysql_error
# ---------------------------------------------------------------------------

class TestHandleMysqlError:
    """handle_mysql_error maps MySQL errno to correct HTTP status and message."""

    def _make_error(self, errno, msg='test error'):
        from mysql.connector import Error as MySQLError
        e = MySQLError(msg)
        e.errno = errno
        return e

    def test_duplicate_entry_1062(self):
        from db import handle_mysql_error
        body, status = handle_mysql_error(self._make_error(1062))
        assert status == 409
        assert 'Duplicate' in body['error']
        assert body['db_error'] is True
        assert body['errno'] == 1062

    def test_fk_violation_1452(self):
        from db import handle_mysql_error
        body, status = handle_mysql_error(self._make_error(1452))
        assert status == 422
        assert 'foreign key' in body['error'].lower() or 'Referenced' in body['error']

    def test_invalid_enum_1265(self):
        from db import handle_mysql_error
        body, status = handle_mysql_error(self._make_error(1265))
        assert status == 422
        assert 'ENUM' in body['error'] or 'allowed' in body['error']

    def test_bad_type_1366(self):
        from db import handle_mysql_error
        body, status = handle_mysql_error(self._make_error(1366))
        assert status == 422

    def test_cannot_connect_2003(self):
        from db import handle_mysql_error
        body, status = handle_mysql_error(self._make_error(2003))
        assert status == 503
        assert body['db_error'] is True

    def test_lock_timeout_1205(self):
        from db import handle_mysql_error
        body, status = handle_mysql_error(self._make_error(1205))
        assert status == 503
        assert 'retry' in body['error'].lower() or 'busy' in body['error'].lower()

    def test_unknown_errno_returns_500(self):
        from db import handle_mysql_error
        body, status = handle_mysql_error(self._make_error(9999))
        assert status == 500
        assert body['ok'] is False

    def test_detail_includes_original_message(self):
        from db import handle_mysql_error
        e = self._make_error(1062, 'Duplicate entry foo for key PRIMARY')
        body, _ = handle_mysql_error(e)
        assert 'Duplicate entry foo' in body['detail']

    def test_detail_truncated_at_500_chars(self):
        from db import handle_mysql_error
        long_msg = 'x' * 600
        e = self._make_error(1062, long_msg)
        body, _ = handle_mysql_error(e)
        assert len(body['detail']) <= 500


# ---------------------------------------------------------------------------
# db_cursor context manager
# ---------------------------------------------------------------------------

class TestDbCursor:
    """db_cursor() commits on clean exit and rolls back on exception."""

    def _mock_conn(self):
        conn = MagicMock()
        cursor = MagicMock()
        cursor.nextset.return_value = None  # prevent infinite loop in _drain_results
        conn.cursor.return_value = cursor
        return conn

    @patch('db.get_conn')
    def test_commits_on_success(self, mock_get_conn):
        conn = self._mock_conn()
        mock_get_conn.return_value = conn

        from db import db_cursor
        with db_cursor() as cur:
            cur.execute('SELECT 1')

        conn.commit.assert_called_once()
        conn.rollback.assert_not_called()
        conn.close.assert_called_once()

    @patch('db.get_conn')
    def test_rollback_on_exception(self, mock_get_conn):
        conn = self._mock_conn()
        mock_get_conn.return_value = conn

        from db import db_cursor
        with pytest.raises(ValueError):
            with db_cursor() as cur:
                raise ValueError('simulated failure')

        conn.rollback.assert_called_once()
        conn.commit.assert_not_called()
        conn.close.assert_called_once()

    @patch('db.get_conn')
    def test_cursor_closed_even_on_exception(self, mock_get_conn):
        conn = self._mock_conn()
        mock_get_conn.return_value = conn

        from db import db_cursor
        with pytest.raises(RuntimeError):
            with db_cursor() as cur:
                raise RuntimeError('boom')

        conn.cursor.return_value.close.assert_called_once()

    @patch('db.get_conn')
    def test_mysql_error_rolls_back_and_reraises(self, mock_get_conn):
        from mysql.connector import Error as MySQLError
        conn = self._mock_conn()
        conn.cursor.return_value.execute.side_effect = MySQLError('DB error')
        mock_get_conn.return_value = conn

        from db import db_cursor
        with pytest.raises(MySQLError):
            with db_cursor() as cur:
                cur.execute('BAD SQL')

        conn.rollback.assert_called_once()


# ---------------------------------------------------------------------------
# execute() — rollback on failure
# ---------------------------------------------------------------------------

class TestExecute:
    """execute() rolls back and re-raises on any exception."""

    @patch('db.get_conn')
    def test_commits_on_success(self, mock_get_conn):
        conn = MagicMock()
        cursor = MagicMock()
        cursor.rowcount = 1
        cursor.nextset.return_value = None  # prevent infinite loop in _drain_results
        conn.cursor.return_value = cursor
        mock_get_conn.return_value = conn

        from db import execute
        result = execute('UPDATE members SET Status=%s WHERE MemberID=%s', ['active', 'A0001'])
        assert result == 1
        conn.commit.assert_called_once()
        conn.rollback.assert_not_called()

    @patch('db.get_conn')
    def test_rollback_on_mysql_error(self, mock_get_conn):
        from mysql.connector import Error as MySQLError
        conn = MagicMock()
        conn.cursor.return_value.execute.side_effect = MySQLError('1265')
        mock_get_conn.return_value = conn

        from db import execute
        with pytest.raises(MySQLError):
            execute('UPDATE members SET Status=%s WHERE MemberID=%s', ['BadStatus', 'A0001'])

        conn.rollback.assert_called_once()
        conn.commit.assert_not_called()


# ---------------------------------------------------------------------------
# update_db_config resets pool
# ---------------------------------------------------------------------------

class TestUpdateDbConfig:
    def test_resets_pool_on_config_change(self):
        import db as db_module
        original_pool = db_module._pool

        db_module.update_db_config({'host': 'new-host.example.com'})

        assert db_module._pool is None  # pool was reset
        assert db_module._db_config['host'] == 'new-host.example.com'

        # Restore
        db_module._db_config['host'] = original_pool or 'localhost'
        db_module._pool = original_pool
