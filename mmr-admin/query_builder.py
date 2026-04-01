"""
SQL query-building helpers for mmr-admin.

Replaces the repeated search/filter boilerplate in:
  api_payments.py (4×), api_sheets_sync.py (several routes).

Leaf module — no imports from other mmr-admin modules.
"""

from __future__ import annotations

from typing import List, Tuple


def add_search(
    sql:     str,
    params:  list,
    search:  str,
    columns: List[str],
) -> Tuple[str, list]:
    """
    Append a search WHERE clause to an existing SQL fragment.

    Each column in `columns` is matched with a LIKE %search% pattern.
    All column conditions are OR-ed together.

    Args:
        sql:     SQL string so far (must already have a WHERE clause).
        params:  Current parameter list (will be extended in place copy).
        search:  Raw search string (empty → no change).
        columns: List of column expressions, e.g. ['m.FirstName', 'CAST(Amount AS CHAR)'].

    Returns:
        (new_sql, new_params) tuple.

    Example:
        sql, params = add_search(sql, params, q, ['m.FirstName', 'm.LastName', 'p.MemberID'])
    """
    if not search or not columns:
        return sql, params

    like = f'%{search}%'
    clauses = ' OR '.join(f'{col} LIKE %s' for col in columns)
    new_sql    = sql + f' AND ({clauses})'
    new_params = list(params) + [like] * len(columns)
    return new_sql, new_params


def add_date_filter(
    sql:    str,
    params: list,
    column: str,
    days:   int,
) -> Tuple[str, list]:
    """
    Append a "within last N days" filter.

    Args:
        column: Fully-qualified column, e.g. 'p.PaymentDate'.
        days:   Number of days back from NOW().
    """
    new_sql    = sql + f' AND {column} >= DATE_SUB(NOW(), INTERVAL %s DAY)'
    new_params = list(params) + [days]
    return new_sql, new_params
