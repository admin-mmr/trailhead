"""
Database connection helpers and table initialization for nyrr-viewer.

This is a leaf module — it does NOT import from any other nyrr-viewer module.
"""

from __future__ import annotations

import os
import threading
from typing import Any, Dict, List
from urllib.parse import urlparse

import mysql.connector
from mysql.connector import Error as MySQLError  # noqa: F401 — re-exported


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
# Connection & query helpers
# ---------------------------------------------------------------------------

def get_conn():
    """Return a new MySQL connection using current config."""
    with _db_config_lock:
        cfg = _db_config.copy()
    return mysql.connector.connect(
        host=cfg['host'],
        user=cfg['user'],
        password=cfg['password'],
        database=cfg['database'],
        ssl_disabled=cfg['ssl_disabled'],
        charset='utf8mb4',
        collation='utf8mb4_unicode_ci',
    )


def query(sql: str, params=None, dictionary=True) -> List[Dict]:
    """Execute a SELECT and return all rows."""
    conn = get_conn()
    cur = conn.cursor(dictionary=dictionary)
    cur.execute(sql, params or [])
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return rows


def execute(sql: str, params=None) -> int:
    """Execute an INSERT/UPDATE/DELETE and return affected row count."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(sql, params or [])
    affected = cur.rowcount
    conn.commit()
    cur.close()
    conn.close()
    return affected


def get_db_config() -> Dict[str, Any]:
    """Return a copy of the current DB config (thread-safe)."""
    with _db_config_lock:
        return _db_config.copy()


def update_db_config(new_config: Dict[str, Any]) -> None:
    """Update the global DB config (thread-safe)."""
    with _db_config_lock:
        _db_config.update(new_config)


# ---------------------------------------------------------------------------
# Table initialization
# ---------------------------------------------------------------------------

def init_tables() -> None:
    """Create required tables if they don't exist (called once at startup)."""
    _init_viewer_admins_table()
    _init_viewer_user_settings_table()


def _init_viewer_admins_table():
    """Create viewer_admins table if it doesn't exist and seed a super_admin."""
    try:
        execute("""
            CREATE TABLE IF NOT EXISTS viewer_admins (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) NOT NULL UNIQUE,
                role ENUM('admin','super_admin') NOT NULL DEFAULT 'admin',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
    except Exception as e:
        print(f'Warning: Could not create viewer_admins table: {e}')
        return

    try:
        rows = query("SELECT COUNT(*) as cnt FROM viewer_admins")
        if rows and rows[0]['cnt'] == 0:
            execute("""
                INSERT IGNORE INTO viewer_admins (email, role)
                VALUES (%s, %s)
            """, ('admin@mmrunners.org', 'super_admin'))
    except Exception as e:
        print(f'Warning: Could not seed viewer_admins: {e}')


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
