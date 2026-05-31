"""
Database connection helpers and table initialization for mmr-admin.

This is a leaf module — it does NOT import from any other mmr-admin module.

Changes (2026-04-01 Sprint 1):
- Added MySQLConnectionPool (pool_size=5) — replaces per-query fresh connections
- Added db_cursor() context manager — auto-commit on success, rollback on error
- Added handle_mysql_error() — maps errno to HTTP status + user-friendly message
"""

from __future__ import annotations

import os
import threading
from contextlib import contextmanager
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import mysql.connector
from mysql.connector import Error as MySQLError  # noqa: F401 — re-exported
from mysql.connector.pooling import MySQLConnectionPool


# ---------------------------------------------------------------------------
# Parse DATABASE_URL from env
# ---------------------------------------------------------------------------

def _parse_database_url() -> Dict[str, Any]:
    """Extract host/user/password/database from DATABASE_URL env var."""
    db_url = os.environ.get('DATABASE_URL', '')
    if not db_url:
        return {}
    try:
        parsed = urlparse(db_url)
        return {
            'host': parsed.hostname or 'localhost',
            'user': parsed.username or 'root',
            'password': parsed.password or '',
            'database': (parsed.path or '/mmrdb').lstrip('/').split('?')[0],
            'ssl_disabled': 'ssl=true' not in db_url.lower(),
        }
    except Exception:
        return {}


_env_db = _parse_database_url()

# Current DB connection config — auto-configured from DATABASE_URL if
# available (populated by `source basecamp/load-env.sh` → Keychain).
_db_config: Dict[str, Any] = _env_db if _env_db else {
    'host': os.environ.get('MYSQL_HOST', 'localhost'),
    'user': os.environ.get('MYSQL_USER', 'root'),
    'password': os.environ.get('MYSQL_PASSWORD', ''),
    'database': os.environ.get('MYSQL_DATABASE', 'mmrdb'),
    'ssl_disabled': os.environ.get('MYSQL_SSL_DISABLED', 'false').lower() == 'true',
}
_db_config_lock = threading.Lock()

if _env_db:
    print(f'  DB: {_env_db["user"]}@{_env_db["host"]}/{_env_db["database"]} (from DATABASE_URL)')


# Pre-configured connection profiles
PRESETS = {
    'azure': {
        'host': 'mmr-mysql-v4.mysql.database.azure.com',
        'user': 'mmradmin',
        'password': _env_db.get('password', ''),  # from DATABASE_URL / Keychain
        'database': 'mmrdb',
        'ssl_disabled': False,
    },
    'local': {
        'host': 'localhost',
        'user': 'root',
        'password': '',
        'database': 'mmrdb',
        'ssl_disabled': True,
    },
}


# ---------------------------------------------------------------------------
# Connection pool
# ---------------------------------------------------------------------------

_pool: Optional[MySQLConnectionPool] = None
_pool_lock = threading.Lock()


def _get_pool() -> MySQLConnectionPool:
    """Return the shared connection pool, creating it on first call."""
    import logging
    logger = logging.getLogger(__name__)

    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                with _db_config_lock:
                    cfg = _db_config.copy()

                try:
                    logger.info(f'[DB] Creating connection pool: {cfg["user"]}@{cfg["host"]}/{cfg["database"]}')
                    _pool = MySQLConnectionPool(
                        pool_name='mmr_admin',
                        pool_size=8,          # headroom for sync-worker contention + concurrent API traffic
                        pool_reset_session=True,
                        host=cfg['host'],
                        user=cfg['user'],
                        password=cfg['password'],
                        database=cfg['database'],
                        ssl_disabled=cfg['ssl_disabled'],
                        charset='utf8mb4',
                        collation='utf8mb4_unicode_ci',
                        connect_timeout=10,   # fail fast instead of hanging
                    )
                    logger.info('[DB] Connection pool created successfully')
                except Exception as e:
                    logger.exception(f'[DB] Failed to create connection pool: {e}')
                    raise
    return _pool


def _reset_pool() -> None:
    """Destroy the pool so it is rebuilt with updated config on next call."""
    global _pool
    with _pool_lock:
        _pool = None


def get_conn():
    """Return a connection from the pool."""
    import logging
    logger = logging.getLogger(__name__)

    try:
        pool = _get_pool()
        logger.debug('[DB] Getting connection from pool...')
        conn = pool.get_connection()
        logger.debug('[DB] Got connection successfully')
        return conn
    except Exception as e:
        logger.exception(f'[DB] Failed to get connection: {e}')
        error_msg = str(e)
        # Provide user-friendly error messages
        if 'Can\'t connect to MySQL server' in error_msg or 'Connection refused' in error_msg:
            raise Exception('Cannot connect to database server. Check DATABASE_URL and network connectivity.')
        elif 'No more connections available' in error_msg:
            raise Exception('Database connection pool exhausted. Please retry.')
        elif 'Unknown database' in error_msg or 'doesn\'t exist' in error_msg:
            raise Exception('Database does not exist. Check DATABASE_URL database name.')
        else:
            raise Exception(f'MySQL Connection not available: {error_msg[:200]}')



# ---------------------------------------------------------------------------
# Context manager — recommended for multi-statement / write operations
# ---------------------------------------------------------------------------

@contextmanager
def db_cursor(dictionary: bool = True):
    """
    Context manager that yields a cursor and handles commit/rollback.

    Usage:
        with db_cursor() as cur:
            cur.execute("INSERT INTO members ...")
            cur.execute("UPDATE payments ...")
        # auto-committed on exit; rolled back if an exception is raised

    For read-only queries use query() directly — it's simpler.
    """
    conn = get_conn()
    cur = conn.cursor(dictionary=dictionary)
    try:
        yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()  # returns connection to pool


# ---------------------------------------------------------------------------
# Simple query helpers (unchanged API, now pool-backed)
# ---------------------------------------------------------------------------

def _drain_results(cur) -> None:
    """Consume all remaining result sets so the connection can be safely returned
    to the pool. Required after CALL statements which produce multiple result sets;
    leaving them unread prevents pool_reset_session from working, leaking the slot."""
    try:
        while cur.nextset():
            pass
    except Exception:
        pass


def query(sql: str, params=None, dictionary=True) -> List[Dict]:
    """Execute a SELECT and return all rows."""
    conn = get_conn()
    cur = conn.cursor(dictionary=dictionary)
    try:
        cur.execute(sql, params or [])
        rows = cur.fetchall()
        _drain_results(cur)  # consume any extra result sets (e.g. from CALL)
        return rows
    finally:
        cur.close()
        try:
            if conn and conn.is_connected():
                conn.close()
        except Exception as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f"Error while closing connection: {e}")


def execute(sql: str, params=None) -> int:
    """Execute an INSERT/UPDATE/DELETE/CALL and return affected row count."""
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute(sql, params or [])
        affected = cur.rowcount
        _drain_results(cur)  # consume any result sets from CALL statements
        conn.commit()
        return affected
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        try:
            if conn and conn.is_connected():
                conn.close()
        except Exception as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f"Error while closing connection: {e}")


def get_db_config() -> Dict[str, Any]:
    """Return a copy of the current DB config (thread-safe)."""
    with _db_config_lock:
        return _db_config.copy()


def update_db_config(new_config: Dict[str, Any]) -> None:
    """Update the global DB config and reset pool so new connections use it."""
    global _db_config
    with _db_config_lock:
        _db_config.update(new_config)
    _reset_pool()  # force pool rebuild with new config


# ---------------------------------------------------------------------------
# Typed MySQL error handler
# ---------------------------------------------------------------------------

# Maps MySQL errno → (HTTP status code, user-friendly message)
_MYSQL_ERROR_MAP: Dict[int, Tuple[int, str]] = {
    1062: (409,  "Duplicate entry — record already exists"),
    1048: (422,  "A required field is missing (NOT NULL violation)"),
    1054: (422,  "Unknown column — check field name spelling"),
    1146: (500,  "Table does not exist"),
    1205: (503,  "Database busy (lock timeout) — please retry"),
    1213: (503,  "Database deadlock — please retry"),
    1264: (422,  "Value out of range for column"),
    1265: (422,  "Invalid ENUM/SET value — value not in allowed list"),
    1366: (422,  "Incorrect data type — check integer/date format"),
    1406: (422,  "Value too long for column"),
    1451: (409,  "Cannot delete — record is referenced by another table"),
    1452: (422,  "Referenced record does not exist (foreign key violation)"),
    2003: (503,  "Cannot connect to database"),
    2006: (503,  "Database connection lost"),
    2013: (503,  "Database connection timed out"),
}


def handle_mysql_error(e: MySQLError) -> Tuple[Dict[str, Any], int]:
    """
    Map a MySQLError to a JSON-serialisable error dict and HTTP status code.

    Usage in a route:
        except MySQLError as e:
            body, status = handle_mysql_error(e)
            return json_response(body, status)
    """
    errno = getattr(e, 'errno', None)
    http_status, friendly_msg = _MYSQL_ERROR_MAP.get(errno, (500, "Database error"))
    return {
        'ok': False,
        'error': friendly_msg,
        'detail': str(e)[:500],
        'errno': errno,
        'db_error': True,
    }, http_status


# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Schema introspection
# ---------------------------------------------------------------------------

_enum_cache: Dict[str, List[str]] = {}


def get_enum_values(table: str, column: str) -> List[str]:
    """
    Return the ENUM values for a column by querying INFORMATION_SCHEMA.
    Result is cached for the lifetime of the process (schema rarely changes).

    Example:
        get_enum_values('members', 'Status')
        # ['active', 'expired', 'inactive', 'pending', 'pending_upgrade', 'lifetime']
    """
    cache_key = f"{table}.{column}"
    if cache_key in _enum_cache:
        return _enum_cache[cache_key]

    rows = query(
        """
        SELECT COLUMN_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = %s
          AND COLUMN_NAME  = %s
        """,
        [table, column],
    )
    if not rows:
        return []

    # COLUMN_TYPE looks like: enum('active','expired','inactive')
    raw = rows[0]['COLUMN_TYPE']  # e.g. "enum('active','expired',...)"
    import re
    values = re.findall(r"'([^']+)'", raw)
    _enum_cache[cache_key] = values
    return values


# ---------------------------------------------------------------------------
# Table initialization
# ---------------------------------------------------------------------------

def init_tables() -> None:
    """Create required tables if they don't exist (called once at startup)."""
    _init_viewer_admins_table()
    _init_viewer_user_settings_table()


def _init_viewer_admins_table():
    """Check if admin_users table exists; seed super_admin if needed.

    Note: admin_users table is created by MIGRATION_V008. This function
    only ensures the super_admin exists after migration.
    """
    try:
        rows = query("SELECT COUNT(*) as cnt FROM admin_users")
        if rows and rows[0]['cnt'] == 0:
            execute("""
                INSERT IGNORE INTO admin_users (email, role)
                VALUES (%s, %s)
            """, ('admin@mmrunners.org', 'super_admin'))
    except Exception as e:
        print(f'Warning: Could not seed admin_users: {e}')


def _init_viewer_user_settings_table():
    """Create viewer_user_settings table for per-user column visibility preferences."""
    try:
        execute("""
            CREATE TABLE IF NOT EXISTS viewer_user_settings (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) NOT NULL,
                table_name VARCHAR(255) NOT NULL,
                visible_columns JSON DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uq_user_table (email, table_name)
            )
        """)
    except Exception as e:
        print(f'Warning: Could not create viewer_user_settings table: {e}')
