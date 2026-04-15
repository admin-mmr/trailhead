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
import re
import pathlib
import pytest
import mysql.connector

# Guard: skip everything if testcontainers is not installed
try:
    from testcontainers.mysql import MySqlContainer
    _TC_AVAILABLE = True
except ImportError:
    _TC_AVAILABLE = False

SCHEMA_SQL = pathlib.Path(__file__).parent.parent.parent.parent / "db" / "schema_integration.sql"
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

        # Don't accumulate standalone comment/blank lines — they cause the
        # final statement filter (`not s.startswith("--")`) to drop every DDL
        # block that follows a comment section.
        if not stripped or stripped.startswith("--"):
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


def _load_schema(conn: mysql.connector.MySQLConnection, host: str, port: int) -> None:
    """
    Load schema_integration.sql via the mysql CLI (one subprocess call).

    This is dramatically faster than individual cursor.execute() round-trips —
    1880 statements via Python can take 60-120s; the CLI pipes them in ~5s.

    Falls back to the statement-by-statement approach if mysql CLI is absent,
    reporting each error immediately rather than stopping at the first one.
    """
    import shutil
    import subprocess
    import tempfile

    # Strip DEFINER clauses and skip DB-level statements before writing temp file
    sql = SCHEMA_SQL.read_text(encoding="utf-8")
    sql = re.sub(r'\bDEFINER\s*=\s*`[^`]+`@`[^`]+`\s*', '', sql)

    if shutil.which("mysql"):
        # Fast path: pipe through CLI in one shot
        print(f"\n⏳ Loading schema via mysql CLI ({SCHEMA_SQL.name}, {len(sql)//1024}KB)...")
        with tempfile.NamedTemporaryFile(mode="w", suffix=".sql", delete=False) as f:
            # Suppress CREATE DATABASE / USE — container already has the DB
            for line in sql.splitlines():
                upper = line.strip().upper()
                if upper.startswith("CREATE DATABASE") or upper.startswith("USE "):
                    continue
                f.write(line + "\n")
            tmp_path = f.name

        # Force TCP so the CLI doesn't fall back to Unix socket when host is 'localhost'.
        # Pipe the file via stdin — `source` is an interactive-only command and
        # fails when passed via --execute.
        cli_host = "127.0.0.1" if host in ("localhost", "127.0.0.1") else host
        try:
            with open(tmp_path) as sql_file:
                result = subprocess.run(
                    [
                        "mysql",
                        "--protocol=TCP",
                        "--connect-timeout=10",
                        f"--host={cli_host}", f"--port={port}",
                        f"--user={MYSQL_USER}", f"--password={MYSQL_PASSWORD}",
                        MYSQL_DATABASE,
                    ],
                    stdin=sql_file,
                    capture_output=True, text=True,
                    timeout=120,
                )
        except subprocess.TimeoutExpired:
            print("❌ Schema load timed out (120s) — mysql CLI likely can't reach the container")
            raise RuntimeError("Schema load timed out — check container port and TCP connectivity")
        finally:
            import os as _os
            _os.path.exists(tmp_path) and _os.unlink(tmp_path)

        if result.returncode != 0:
            print(f"❌ Schema load error:\n{result.stderr}")
            raise RuntimeError(f"Schema load failed:\n{result.stderr}")

        conn.commit()
        print("✅ Schema loaded")
        return

    # Slow fallback: statement by statement with incremental error reporting
    print(f"\n⏳ Loading schema statement-by-statement (mysql CLI not found)...")
    stmts = _split_statements(sql)
    cursor = conn.cursor()
    errors = []
    for i, stmt in enumerate(stmts, 1):
        s = stmt.strip()
        if not s or s.startswith("--"):
            continue
        upper = s.upper().lstrip()
        if upper.startswith("CREATE DATABASE") or upper.startswith("USE "):
            continue
        try:
            cursor.execute(s)
            try:
                cursor.fetchall()
            except Exception:
                pass
        except mysql.connector.Error as exc:
            msg = f"  [{i}/{len(stmts)}] ❌ {exc}\n    → {s[:120]}"
            print(msg)
            errors.append(msg)
    conn.commit()
    cursor.close()

    if errors:
        raise RuntimeError(
            f"Schema load finished with {len(errors)} error(s):\n" + "\n".join(errors)
        )
    print(f"✅ Schema loaded ({len(stmts)} statements)")


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

    # Ryuk (testcontainers reaper) can hang on macOS — disable it
    os.environ.setdefault("TESTCONTAINERS_RYUK_DISABLED", "true")

    if not _TC_AVAILABLE:
        pytest.skip("testcontainers not installed: pip3 install testcontainers[mysql]")

    if not _docker_available():
        pytest.skip("Docker not running — start Docker Desktop first")

    container = MySqlContainer(
        image=MYSQL_IMAGE,
        root_password=MYSQL_ROOT_PASSWORD,
        dbname=MYSQL_DATABASE,
        username=MYSQL_USER,
        password=MYSQL_PASSWORD,
    )
    # Bound startup wait to 60s (API varies by testcontainers version)
    try:
        container.with_startup_timeout(60)   # testcontainers >= 4.x
    except AttributeError:
        container._timeout = 60              # testcontainers 3.x fallback
    with container as c:
        yield c


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
    # Allow test_user to create objects with a foreign DEFINER (needed for
    # CREATE ... DEFINER=`mmradmin`@`%` VIEW/TRIGGER statements in the schema).
    # SET_USER_ID is the MySQL 8.0 replacement for the old SUPER requirement.
    cur.execute(f"GRANT SET_USER_ID ON *.* TO '{MYSQL_USER}'@'%'")
    # Create the mmradmin definer user so triggers/procedures execute without
    # error 1449 ("definer does not exist"). SET_USER_ID only covers CREATE;
    # MySQL still validates the definer on every invocation at runtime.
    cur.execute(f"CREATE USER IF NOT EXISTS 'mmradmin'@'%' IDENTIFIED BY 'placeholder'")
    cur.execute(f"GRANT ALL PRIVILEGES ON `{MYSQL_DATABASE}`.* TO 'mmradmin'@'%'")
    # Match the schema's collation so string literals don't collide with
    # utf8mb4_0900_ai_ci (MySQL 8.0 default)
    cur.execute(f"ALTER DATABASE `{MYSQL_DATABASE}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
    cur.close()
    root_conn.close()

    conn = mysql.connector.connect(
        host=host, port=port,
        database=MYSQL_DATABASE,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        autocommit=False,
        # use_pure=True forces the Python implementation instead of the C extension.
        # The C extension (_mysql_connector) refuses rollback/reset while result sets
        # from stored procedures are pending, causing "Commands out of sync" errors
        # that corrupt the shared session connection across tests.
        use_pure=True,
    )
    _load_schema(conn, host, port)
    yield conn
    conn.close()


def _drain_and_reset(conn) -> None:
    """
    Drain any pending result sets and roll back any open transaction.

    Layered recovery — each step is a fallback for the one before:
    1. rollback()              — clean path; works when connection is healthy
    2. autocommit toggle       — SET autocommit=1 implicitly commits/closes any
                                 open transaction AND flushes pending result sets
                                 on MySQL's side, then we restore autocommit=0
    3. cmd_reset_connection()  — COM_RESET_CONNECTION: nuclear option, clears
                                 everything including session variables
    """
    try:
        conn.rollback()
        return
    except Exception:
        pass

    try:
        conn.autocommit = True
        conn.autocommit = False
        return
    except Exception:
        pass

    try:
        conn.cmd_reset_connection()
    except Exception:
        pass


@pytest.fixture()
def db(db_session):
    """
    Per-test transactional fixture.
    Each test runs inside a transaction that is rolled back on teardown,
    so tests are fully isolated without dropping/recreating the schema.

    _drain_and_reset() guards both entry and exit so a stored procedure
    that leaks result sets (causing "Commands out of sync") cannot corrupt
    subsequent tests.
    """
    _drain_and_reset(db_session)       # recover from any prior dirty state
    if db_session.in_transaction:
        db_session.rollback()          # last-resort: force-close a stuck transaction
    db_session.start_transaction()
    yield db_session
    _drain_and_reset(db_session)       # clean up after this test


# ---------------------------------------------------------------------------
# Helper: execute a query and return rows as list-of-dicts
# ---------------------------------------------------------------------------

def _drain_cursor(cursor) -> None:
    """Consume any result sets left on the cursor after execute/callproc.

    Stored procedures called via CALL or callproc() can return multiple result
    sets. If they aren't all consumed the connection enters "Commands out of
    sync" state and every subsequent command fails until the connection is reset.
    """
    try:
        while cursor.nextset():
            try:
                cursor.fetchall()
            except Exception:
                pass
    except Exception:
        pass


def query(conn, sql: str, params=None) -> list[dict]:
    cursor = conn.cursor(dictionary=True)
    cursor.execute(sql, params or [])
    rows = cursor.fetchall()
    _drain_cursor(cursor)
    cursor.close()
    return rows


def execute(conn, sql: str, params=None) -> int:
    """Execute DML and return lastrowid or rowcount."""
    cursor = conn.cursor()
    cursor.execute(sql, params or [])
    result = cursor.lastrowid or cursor.rowcount
    _drain_cursor(cursor)
    cursor.close()
    return result
