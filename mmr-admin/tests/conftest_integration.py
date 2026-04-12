"""
Integration test conftest — uses testcontainers to spin up a real MySQL 5.7 instance.

Prerequisites:
    pip3 install testcontainers[mysql]
    Docker Desktop running locally

Usage:
    pytest mmr-admin/tests/ -m integration --run-integration
    pytest mmr-admin/tests/test_integration_payments.py --run-integration -v

Skip behaviour:
    If Docker is not running the tests are automatically skipped (no failure).
    Regular mock-based tests are never affected.
"""

import os
import pathlib
import pytest
import mysql.connector

# Guard: skip everything if testcontainers is not installed
try:
    from testcontainers.mysql import MySqlContainer
    _TC_AVAILABLE = True
except ImportError:
    _TC_AVAILABLE = False

SCHEMA_SQL = pathlib.Path(__file__).parent.parent.parent / "db" / "schema_integration.sql"
import platform as _platform
# mysql:5.7 has no ARM64 image (EOL Oct 2023); use mysql:8.0 on Apple Silicon
# MySQL 8.0 is syntax-compatible with 5.7 for triggers, procs, and DML we test
MYSQL_IMAGE = "mysql:8.0" if _platform.machine() in ("arm64", "aarch64") else "mysql:5.7"
MYSQL_DATABASE = "mmrdb"
MYSQL_ROOT_PASSWORD = "test_root"
MYSQL_USER = "test_user"
MYSQL_PASSWORD = "test_pass"


def _split_statements(sql: str) -> list[str]:
    """
    Split a SQL file on statement boundaries, handling DELIMITER switches
    used for triggers and stored procedures.
    """
    statements = []
    current_delim = ";"
    current_stmt: list[str] = []

    for line in sql.splitlines():
        stripped = line.strip()

        # Handle DELIMITER directive
        if stripped.upper().startswith("DELIMITER"):
            # flush anything buffered
            stmt = "\n".join(current_stmt).strip()
            if stmt:
                statements.append(stmt)
            current_stmt = []
            parts = stripped.split()
            current_delim = parts[1] if len(parts) > 1 else ";"
            continue

        current_stmt.append(line)

        # Check if line ends with the current delimiter
        if stripped.endswith(current_delim):
            stmt = "\n".join(current_stmt).strip()
            # Strip trailing delimiter
            if stmt.endswith(current_delim):
                stmt = stmt[: -len(current_delim)].rstrip()
            if stmt:
                statements.append(stmt)
            current_stmt = []

    # Flush remainder
    stmt = "\n".join(current_stmt).strip()
    if stmt:
        statements.append(stmt)

    return [s for s in statements if s and not s.startswith("--")]


def _load_schema(conn: mysql.connector.MySQLConnection) -> None:
    """Execute schema_integration.sql against the container connection."""
    sql = SCHEMA_SQL.read_text(encoding="utf-8")
    stmts = _split_statements(sql)
    cursor = conn.cursor()
    for stmt in stmts:
        s = stmt.strip()
        if not s or s.startswith("--"):
            continue
        try:
            cursor.execute(s)
            # Drain any results (procedures/triggers return nothing but cursor
            # must be clean before next execute)
            try:
                cursor.fetchall()
            except Exception:
                pass
        except mysql.connector.Error as exc:
            # Re-raise with context for easier debugging
            raise RuntimeError(f"Schema load failed on statement:\n{s[:200]}\nError: {exc}") from exc
    conn.commit()
    cursor.close()


def _docker_available() -> bool:
    """Return True if Docker daemon is reachable."""
    try:
        import subprocess
        result = subprocess.run(
            ["docker", "info"], capture_output=True, timeout=5
        )
        return result.returncode == 0
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Session-scoped container — started once, shared across all integration tests
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def mysql_container(request):
    """
    Start a MySQL 5.7 testcontainer for the session.
    Skipped automatically if:
      - --run-integration flag not passed
      - testcontainers library not installed
      - Docker Desktop not running
    """
    if not request.config.getoption("--run-integration", default=False):
        pytest.skip("Pass --run-integration to run integration tests")

    if not _TC_AVAILABLE:
        pytest.skip("testcontainers not installed: pip3 install testcontainers[mysql]")

    if not _docker_available():
        pytest.skip("Docker not running — start Docker Desktop first")

    with MySqlContainer(
        image=MYSQL_IMAGE,
        root_password=MYSQL_ROOT_PASSWORD,
        dbname=MYSQL_DATABASE,
        username=MYSQL_USER,
        password=MYSQL_PASSWORD,
    ) as container:
        yield container


@pytest.fixture(scope="session")
def db_session(mysql_container):
    """
    Return a mysql.connector connection with the full schema loaded.
    Shared across all integration tests in the session.
    """
    host = mysql_container.get_container_host_ip()
    port = int(mysql_container.get_exposed_port(3306))

    # MySQL 8.0 enables binary logging by default, which blocks trigger/proc
    # creation without SUPER privilege. Set the flag as root before schema load.
    root_conn = mysql.connector.connect(
        host=host, port=port,
        database=MYSQL_DATABASE,
        user="root", password=MYSQL_ROOT_PASSWORD,
        autocommit=True,
    )
    cur = root_conn.cursor()
    cur.execute("SET GLOBAL log_bin_trust_function_creators = 1")
    cur.close()
    root_conn.close()

    conn = mysql.connector.connect(
        host=host, port=port,
        database=MYSQL_DATABASE,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        autocommit=False,
    )
    _load_schema(conn)
    yield conn
    conn.close()


@pytest.fixture()
def db(db_session):
    """
    Per-test transactional fixture.
    Each test runs inside a transaction that is rolled back on teardown,
    so tests are fully isolated without dropping/recreating the schema.
    """
    db_session.start_transaction()
    yield db_session
    db_session.rollback()


# ---------------------------------------------------------------------------
# Helper: execute a query and return rows as list-of-dicts
# ---------------------------------------------------------------------------

def query(conn, sql: str, params=None) -> list[dict]:
    cursor = conn.cursor(dictionary=True)
    cursor.execute(sql, params or [])
    rows = cursor.fetchall()
    cursor.close()
    return rows


def execute(conn, sql: str, params=None) -> int:
    """Execute DML and return lastrowid or rowcount."""
    cursor = conn.cursor()
    cursor.execute(sql, params or [])
    result = cursor.lastrowid or cursor.rowcount
    cursor.close()
    return result
