"""
Tests for connection lifecycle in diagnostics.py.

Before the fix, get_sheet_vs_db_counts(), test_db_connection(), and
dump_schema() all used bare get_conn() / conn.close() with no try/finally.
Any query exception would skip conn.close(), leaking the pool slot.

With pool_size=10, leaking 10 slots (e.g. from repeated diagnostic calls
that raise) still exhausts the pool.  These tests verify that conn.close()
is called in both the success and exception paths for all three functions.
"""
import pytest
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _make_cursor(rows=None, fetchone_val=None):
    cur = MagicMock()
    cur.fetchall.return_value = rows if rows is not None else []
    cur.fetchone.return_value = fetchone_val or {'cnt': 0}
    cur.rowcount = 0
    return cur


def _make_conn(rows=None, fetchone_val=None):
    conn = MagicMock()
    conn.cursor.return_value = _make_cursor(rows, fetchone_val)
    return conn


# ---------------------------------------------------------------------------
# get_sheet_vs_db_counts
# ---------------------------------------------------------------------------

class TestGetSheetVsDbCountsConnLifecycle:
    """conn.close() is called whether queries succeed or raise."""

    def test_close_called_on_success(self):
        mock_conn = _make_conn(fetchone_val={'cnt': 42})

        with patch('diagnostics.dbmod') as mock_db:
            mock_db.get_conn.return_value = mock_conn
            mock_db.get_db_config.return_value = {}

            import diagnostics
            diagnostics.get_sheet_vs_db_counts()

        mock_conn.close.assert_called_once()

    def test_close_called_on_query_exception(self):
        """Pool slot must be returned even when a query raises."""
        mock_conn = _make_conn()
        mock_conn.cursor.return_value.execute.side_effect = Exception('query failed')

        with patch('diagnostics.dbmod') as mock_db:
            mock_db.get_conn.return_value = mock_conn
            mock_db.get_db_config.return_value = {}

            import diagnostics
            # Function catches exceptions internally and returns an error dict
            result = diagnostics.get_sheet_vs_db_counts()

        mock_conn.close.assert_called_once()

    def test_no_pool_leak_across_multiple_calls(self):
        """Simulate repeated diagnostic calls; every slot must be returned."""
        conns = [_make_conn(fetchone_val={'cnt': i}) for i in range(5)]
        conn_iter = iter(conns)

        with patch('diagnostics.dbmod') as mock_db:
            mock_db.get_conn.side_effect = lambda: next(conn_iter)
            mock_db.get_db_config.return_value = {}

            import diagnostics
            for _ in range(5):
                diagnostics.get_sheet_vs_db_counts()

        for i, conn in enumerate(conns):
            conn.close.assert_called_once(), \
                f"conn #{i} close() not called — pool slot leaked"


# ---------------------------------------------------------------------------
# test_db_connection
# ---------------------------------------------------------------------------

class TestTestDbConnectionConnLifecycle:
    """test_db_connection() must close the connection regardless of outcome."""

    def _version_fetchone(self):
        """Cycle through the three fetchone() calls the function makes."""
        call_count = 0
        responses = [
            {'version': '5.7.0'},
            {'database': 'mmrdb'},
            {'count': 10},
        ]

        cur = MagicMock()

        def _fetchone():
            nonlocal call_count
            val = responses[call_count % len(responses)]
            call_count += 1
            return val

        cur.fetchone.side_effect = _fetchone
        return cur

    def test_close_called_on_success(self):
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = self._version_fetchone()

        with patch('diagnostics.dbmod') as mock_db:
            mock_db.get_conn.return_value = mock_conn

            import diagnostics
            result = diagnostics.test_db_connection()

        assert result['status'] == 'ok'
        mock_conn.close.assert_called_once()

    def test_close_called_on_query_exception(self):
        mock_conn = MagicMock()
        mock_conn.cursor.return_value.execute.side_effect = Exception('version query failed')

        with patch('diagnostics.dbmod') as mock_db:
            mock_db.get_conn.return_value = mock_conn

            import diagnostics
            result = diagnostics.test_db_connection()

        assert result['status'] == 'error'
        mock_conn.close.assert_called_once()

    def test_error_result_on_get_conn_failure(self):
        """If get_conn() itself raises, function returns error dict (no crash)."""
        with patch('diagnostics.dbmod') as mock_db:
            mock_db.get_conn.side_effect = Exception('pool exhausted')

            import diagnostics
            result = diagnostics.test_db_connection()

        assert result['status'] == 'error'
        assert 'pool exhausted' in result['error']


# ---------------------------------------------------------------------------
# dump_schema
# ---------------------------------------------------------------------------

class TestDumpSchemaConnLifecycle:
    """dump_schema() must close the connection regardless of outcome."""

    def _schema_cursor(self, tables=None):
        """Cursor that returns table names then CREATE TABLE strings."""
        cur = MagicMock()
        table_rows = [{'TABLE_NAME': t} for t in (tables or ['members', 'payments'])]
        create_rows = [{'Create Table': f'CREATE TABLE {t} (id INT)'}
                       for t in (tables or ['members', 'payments'])]

        fetch_all_calls = 0
        fetch_one_calls = 0

        def _fetchall():
            nonlocal fetch_all_calls
            fetch_all_calls += 1
            return table_rows

        def _fetchone():
            nonlocal fetch_one_calls
            idx = fetch_one_calls % len(create_rows)
            fetch_one_calls += 1
            return create_rows[idx]

        cur.fetchall.side_effect = _fetchall
        cur.fetchone.side_effect = _fetchone
        return cur

    def test_close_called_on_success(self):
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = self._schema_cursor()

        with patch('diagnostics.dbmod') as mock_db:
            mock_db.get_conn.return_value = mock_conn

            import diagnostics
            result = diagnostics.dump_schema()

        assert result['status'] == 'ok'
        mock_conn.close.assert_called_once()

    def test_close_called_on_query_exception(self):
        mock_conn = MagicMock()
        mock_conn.cursor.return_value.execute.side_effect = Exception('schema query failed')

        with patch('diagnostics.dbmod') as mock_db:
            mock_db.get_conn.return_value = mock_conn

            import diagnostics
            result = diagnostics.dump_schema()

        assert result['status'] == 'error'
        mock_conn.close.assert_called_once()

    def test_error_result_on_get_conn_failure(self):
        with patch('diagnostics.dbmod') as mock_db:
            mock_db.get_conn.side_effect = Exception('pool exhausted')

            import diagnostics
            result = diagnostics.dump_schema()

        assert result['status'] == 'error'
        assert 'pool exhausted' in result['error']
