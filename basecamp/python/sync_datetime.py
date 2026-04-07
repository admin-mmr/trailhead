"""
sync_datetime.py — DateTime parsing and comparison utilities.

Provides:
  - parse_datetime: Parse JS Date.toString() and ISO formats
  - datetimes_equal: Safe datetime comparison
  - to_mysql_datetime: Format for MySQL
  - _apply_gmt_offset: Helper for GMT offset parsing
"""

from __future__ import annotations
import re, logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

_GMT_OFFSET_RE = re.compile(r'GMT([+-])(\d{1,2}):?(\d{2})')

def _apply_gmt_offset(naive_dt, offset_str):
    """Parse 'GMT+08:00' and apply to naive datetime."""
    m = _GMT_OFFSET_RE.search(offset_str)
    if not m:
        return naive_dt
    sign, hours, minutes = m.groups()
    offset_seconds = int(hours) * 3600 + int(minutes) * 60
    if sign == '-':
        offset_seconds = -offset_seconds
    tz = timezone(timedelta(seconds=offset_seconds))
    return naive_dt.replace(tzinfo=tz)

def parse_datetime(value):
    """Parse datetime from JS Date.toString() or ISO format."""
    if not value or not isinstance(value, str):
        return None
    try:
        if 'T' in value:  # ISO format
            if value.endswith('Z'):
                return datetime.fromisoformat(value.replace('Z', '+00:00'))
            return datetime.fromisoformat(value)
        # JS Date.toString() format: 'Mon Apr 07 2025 14:30:45 GMT-0700'
        if 'GMT' in value:
            dt_part, tz_part = value.rsplit(' GMT', 1)
            dt = datetime.strptime(dt_part, '%a %b %d %Y %H:%M:%S')
            return _apply_gmt_offset(dt, 'GMT' + tz_part)
        return datetime.strptime(value[:19], '%Y-%m-%d %H:%M:%S')
    except Exception as e:
        logger.debug(f"parse_datetime failed: {e}")
        return None

def datetimes_equal(a, b):
    """Compare two datetimes allowing for timezone differences."""
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    try:
        a_dt = parse_datetime(a) if isinstance(a, str) else a
        b_dt = parse_datetime(b) if isinstance(b, str) else b
        if a_dt is None or b_dt is None:
            return str(a) == str(b)
        return (a_dt.replace(tzinfo=None) == b_dt.replace(tzinfo=None))
    except:
        return str(a) == str(b)

def to_mysql_datetime(value):
    """Convert any datetime to MySQL format (YYYY-MM-DD HH:MM:SS)."""
    if not value:
        return None
    try:
        dt = parse_datetime(value) if isinstance(value, str) else value
        if dt:
            return dt.strftime('%Y-%m-%d %H:%M:%S')
    except:
        pass
    return str(value) if value else None
