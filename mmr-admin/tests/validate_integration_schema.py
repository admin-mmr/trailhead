"""
Standalone schema validator — run this BEFORE pytest to catch all schema
loading issues in one pass without spinning up full test fixtures.

Usage:
    python3 mmr-admin/tests/validate_integration_schema.py

Requires Docker running. Exits 0 on success, 1 on any failure.
Prints every statement that fails so you see all errors at once.
"""
import pytest  # noqa: F401 — signals import hook to skip this file (test-only dep)
import sys
import pathlib
import subprocess

# Guard
try:
    import mysql.connector
    from testcontainers.mysql import MySqlContainer
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("  pip install testcontainers[mysql] mysql-connector-python")
    sys.exit(1)

result = subprocess.run(["docker", "info"], capture_output=True, timeout=5)
if result.returncode != 0:
    print("Docker is not running. Start Docker Desktop first.")
    sys.exit(1)

import platform
MYSQL_IMAGE    = "mysql:8.0" if platform.machine() in ("arm64", "aarch64") else "mysql:5.7"
MYSQL_DATABASE = "mmrdb"
MYSQL_ROOT_PW  = "test_root"
MYSQL_USER     = "test_user"
MYSQL_PASSWORD = "test_pass"
SCHEMA_SQL     = pathlib.Path(__file__).parent.parent.parent / "db" / "schema_integration.sql"

EXPECTED_TABLES = [
    "config", "members", "payments", "submissions", "gmail_transactions",
    "member_log", "activity_log", "admin_users", "error_context",
    "sheets_sync_log", "sync_jobs", "nyrr_events", "nyrr_event_runners",
]
EXPECTED_VIEWS = [
    "v_last_successful_batch", "v_sync_summary", "v_payment_details",
    "v_payment_splits", "v_unresolved_errors",
]


def split_statements(sql: str) -> list[str]:
    statements, current_delim, current_stmt = [], ";", []
    for line in sql.splitlines():
        stripped = line.strip()
        if stripped.upper().startswith("DELIMITER"):
            stmt = "\n".join(current_stmt).strip()
            if stmt:
                statements.append(stmt)
            current_stmt = []
            parts = stripped.split()
            current_delim = parts[1] if len(parts) > 1 else ";"
            continue
        if not stripped or stripped.startswith("--"):
            continue
        current_stmt.append(line)
        if stripped.endswith(current_delim):
            stmt = "\n".join(current_stmt).strip()
            if stmt.endswith(current_delim):
                stmt = stmt[: -len(current_delim)].rstrip()
            if stmt:
                statements.append(stmt)
            current_stmt = []
    stmt = "\n".join(current_stmt).strip()
    if stmt:
        statements.append(stmt)
    return [s for s in statements if s and not s.startswith("--")]


def main():
    print(f"Starting {MYSQL_IMAGE} container...")
    errors = []

    with MySqlContainer(
        image=MYSQL_IMAGE,
        root_password=MYSQL_ROOT_PW,
        dbname=MYSQL_DATABASE,
        username=MYSQL_USER,
        password=MYSQL_PASSWORD,
    ) as container:
        host = container.get_container_host_ip()
        port = int(container.get_exposed_port(3306))

        # Root setup
        root = mysql.connector.connect(
            host=host, port=port, database=MYSQL_DATABASE,
            user="root", password=MYSQL_ROOT_PW, autocommit=True,
        )
        cur = root.cursor()
        cur.execute("SET GLOBAL log_bin_trust_function_creators = 1")
        cur.execute(f"ALTER DATABASE `{MYSQL_DATABASE}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
        cur.close(); root.close()

        # Load schema
        conn = mysql.connector.connect(
            host=host, port=port, database=MYSQL_DATABASE,
            user=MYSQL_USER, password=MYSQL_PASSWORD, autocommit=True,
        )
        sql = SCHEMA_SQL.read_text(encoding="utf-8")
        stmts = split_statements(sql)
        print(f"Executing {len(stmts)} statements...")

        cur = conn.cursor()
        for i, stmt in enumerate(stmts, 1):
            s = stmt.strip()
            upper = s.upper()
            if upper.startswith("CREATE DATABASE") or upper.startswith("USE "):
                continue
            try:
                cur.execute(s)
                try: cur.fetchall()
                except: pass
            except mysql.connector.Error as e:
                errors.append(f"  [{i}] {e}\n      SQL: {s[:120].replace(chr(10),' ')}")

        cur.close()

        # Verify expected tables exist
        cur = conn.cursor()
        cur.execute(f"SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='{MYSQL_DATABASE}' AND TABLE_TYPE='BASE TABLE'")
        found_tables = {r[0] for r in cur.fetchall()}
        cur.execute(f"SELECT TABLE_NAME FROM information_schema.VIEWS WHERE TABLE_SCHEMA='{MYSQL_DATABASE}'")
        found_views = {r[0] for r in cur.fetchall()}
        cur.close(); conn.close()

        missing_tables = [t for t in EXPECTED_TABLES if t not in found_tables]
        missing_views  = [v for v in EXPECTED_VIEWS  if v not in found_views]

    print()
    if errors:
        print(f"SCHEMA ERRORS ({len(errors)}):")
        for e in errors: print(e)
    else:
        print("All statements executed without error.")

    if missing_tables:
        print(f"\nMISSING TABLES: {missing_tables}")
    else:
        print(f"All {len(EXPECTED_TABLES)} expected tables present.")

    if missing_views:
        print(f"MISSING VIEWS: {missing_views}")
    else:
        print(f"All {len(EXPECTED_VIEWS)} expected views present.")

    ok = not errors and not missing_tables and not missing_views
    print("\nSchema validation:", "PASSED" if ok else "FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
