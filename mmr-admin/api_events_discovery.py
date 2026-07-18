"""
NYRR Event Discovery — Routes for discovering events from public APIs.
Extracted from api_events.py to keep routes modular.
"""

import os
import re
import requests
from datetime import datetime, date, timedelta
from flask import Blueprint, request, jsonify
from auth import login_required
from db import execute, query

events_discovery_bp = Blueprint('events_discovery', __name__)

# NYRR API constants
NYRR_UPCOMING_API = "https://widget.hakuapp.com/v2/event_lists"
NYRR_UPCOMING_API_KEY = os.environ.get("NYRR_HAKU_API_KEY", "")


@events_discovery_bp.route('/api/discover/reconcile-slugs', methods=['POST'])
@login_required
def api_reconcile_slugs():
    """Bug L: scan past-date rows whose event_code is still slug-form and
    resolve them to canonical NYRR eventCodes via events/search.

    Query params:
      include_upcoming=1  also try slug-coded upcoming rows (default off)
      dry_run=1           report planned changes without writing (default off)
    """
    try:
        from sync_worker_reconcile import reconcile_slug_event_codes
        include_upcoming = request.args.get('include_upcoming', '0') in ('1', 'true', 'yes')
        dry_run          = request.args.get('dry_run', '0') in ('1', 'true', 'yes')
        summary = reconcile_slug_event_codes(
            include_upcoming=include_upcoming,
            dry_run=dry_run,
        )
        return jsonify({'ok': True, **summary})
    except Exception as e:
        import traceback
        print(f'[reconcile-slugs] Error: {e}\n{traceback.format_exc()}', flush=True)
        return jsonify({'ok': False, 'error': str(e)}), 500


def discover_current_events():
    """Scan events/search (rmsprodapi.nyrr.org — no key, no bot-gate) for the
    current + prior year and insert any not yet in nyrr_events.

    This is the only discovery source that actually works unattended (server
    to server): the Haku widget and nyrr.org itself sit behind Queue-it bot
    protection that blocks non-browser requests outright, key or no key.
    Trade-off: events/search only lists a race once NYRR posts it toward the
    results system, so lead time is shorter than a true 12-month lookahead.

    Callable from both the HTTP route and the scheduler. Returns a summary dict.
    """
    from nyrr_api import NyrrApiClient
    client = NyrrApiClient()

    # search_events() returns List[NyrrEvent] (dataclasses) — use attribute access,
    # not .get(). Also supports `year`, not `limit`/`status` (Bug E fix).
    current_year = date.today().year
    years_to_scan = [current_year, current_year - 1]

    inserted = 0
    for year in years_to_scan:
        try:
            events = client.search_events(year=year)
        except Exception as fetch_err:
            print(f"[discover] Failed to fetch events for {year}: {fetch_err}", flush=True)
            continue

        for ev in events:
            event_code = ev.event_code
            event_name = ev.event_name
            # NyrrEvent stores ISO datetime in start_date_time (e.g. "2026-05-17T07:00:00")
            event_date = ev.start_date_time.split('T')[0] if ev.start_date_time else None
            is_virtual = ev.is_virtual

            if not event_code:
                continue

            # Check if already in DB
            existing = query(
                "SELECT id FROM nyrr_events WHERE event_code = %s",
                [event_code]
            )

            if existing:
                continue  # Skip existing

            # Parse event_date to check if upcoming
            upcoming = False
            event_date_obj = None
            try:
                if event_date:
                    event_date_obj = datetime.strptime(event_date, "%Y-%m-%d").date()
                    upcoming = (event_date_obj > date.today()) if event_date_obj else False
            except ValueError:
                pass

            # Extract year
            event_year = event_date_obj.year if event_date_obj else year

            # Insert
            try:
                execute("""
                    INSERT INTO nyrr_events
                    (event_code, event_name, event_date, event_year, is_upcoming, is_virtual, processing_status)
                    VALUES (%s, %s, %s, %s, %s, %s, 'Pending')
                """,
                    (event_code, event_name, event_date, event_year, int(upcoming), int(is_virtual))
                )
                inserted += 1
            except Exception as insert_err:
                print(f"[discover] DB insert error for {event_code}: {insert_err}", flush=True)
                pass

    return {'ok': True, 'discovered': inserted, 'events': inserted}


@events_discovery_bp.route('/api/discover', methods=['POST'])
@login_required
def api_discover_events():
    """
    Discover upcoming events from NYRR's events/search API and insert into
    nyrr_events. This finds events from the public schedule that aren't yet
    in our DB.
    """
    try:
        return jsonify(discover_current_events())

    except Exception as e:
        import traceback
        print(f'[discover] Error: {e}\n{traceback.format_exc()}', flush=True)
        return jsonify({'ok': False, 'error': str(e)}), 500


# --- Haku "Upcoming Events" widget (current 2026 markup) -------------------
# NOTE: the old series_id/query_type params return HTTP 500 and the old markup
# exposed a data-event-code attribute that no longer exists. The live widget
# (as embedded on nyrr.org) uses widget_scope/widget_title params, requires the
# nyrr.org Origin/Referer, and exposes only a registration slug — used here as
# event_code (reconcile resolves it to the canonical code once results post).
_HAKU_PARAMS = {
    "widget_title": "Upcoming Events",
    "widget_scope": "Endurance, Ticketed, Volunteer, Trainings, Auction",
    "title_font_family": "Inter", "body_font_family": "Inter",
    "name_font_family": "Inter", "tag_font_family": "Inter",
    "price_font_family": "Inter", "filter_font_family": "Inter",
}
_HAKU_HEADERS = {
    "accept": "text/html",
    "origin": "https://www.nyrr.org",
    "referer": "https://www.nyrr.org/",
    "user-agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/149.0.0.0 Safari/537.36"),
}


def _parse_haku_blocks(html_text):
    """Yield a dict per <div class="upcoming-event"> block in the widget HTML."""
    import html as _html
    for block in re.split(r'<div class="upcoming-event"', html_text)[1:]:
        d = re.search(r'data-start-date="([^"]+)"', block)
        edate = None
        if d:
            try:
                edate = datetime.strptime(d.group(1), "%Y/%m/%d").date()
            except ValueError:
                edate = None
        s = re.search(r'events\.nyrr\.org/([^"?]+)', block)
        slug = s.group(1).strip('/') if s else None
        t = re.search(r'upcoming-race-title">([^<]+)<', block)
        title = _html.unescape(t.group(1).strip()) if t else 'Unknown'
        loc = re.search(r'upcoming-race-location">([^<]+)<', block)
        location = _html.unescape(loc.group(1).strip()) if loc else None
        st = re.search(r'data-sub-types="([^"]*)"', block)
        yield {'slug': slug, 'title': title, 'date': edate,
               'location': location, 'sub_types': st.group(1) if st else ''}


def discover_upcoming_events(start_date=None, end_date=None,
                             include_volunteers=False, exclude_youth=True):
    """Scrape NYRR's Haku 'Upcoming Events' widget and upsert new races.

    Callable from both the HTTP route and the scheduler. Defaults to a rolling
    next-12-months window. Returns a summary dict.
    """
    if not NYRR_UPCOMING_API_KEY:
        return {'ok': False, 'error': 'NYRR_HAKU_API_KEY not configured'}

    start_date = start_date or date.today()
    end_date = end_date or (date.today() + timedelta(days=365))

    params = dict(_HAKU_PARAMS, api_key=NYRR_UPCOMING_API_KEY)
    headers = dict(_HAKU_HEADERS, **{'x-api-key': NYRR_UPCOMING_API_KEY})
    resp = requests.get(NYRR_UPCOMING_API, params=params, headers=headers, timeout=20)
    if resp.status_code != 200:
        return {'ok': False, 'error': f'Haku widget HTTP {resp.status_code}'}

    discovered = skipped = filtered = 0
    for ev in _parse_haku_blocks(resp.text):
        slug, name, edate = ev['slug'], ev['title'], ev['date']
        if not slug or edate is None or not (start_date <= edate <= end_date):
            filtered += 1
            continue
        is_vol = 'volunteer' in name.lower() or 'volunteer' in ev['sub_types'].lower()
        if is_vol and not include_volunteers:
            filtered += 1
            continue
        if exclude_youth and 'rising nyrr' in name.lower():
            filtered += 1
            continue
        if query("SELECT id FROM nyrr_events WHERE event_code = %s", [slug]):
            skipped += 1
            continue
        try:
            execute("""
                INSERT INTO nyrr_events
                (event_code, event_name, event_url, location, event_date,
                 event_year, is_upcoming, is_virtual, processing_status)
                VALUES (%s, %s, %s, %s, %s, %s, 1, 0, 'Pending')
            """, (slug, name, f"https://events.nyrr.org/{slug}", ev['location'],
                  edate, edate.year))
            discovered += 1
        except Exception as insert_err:
            print(f"[discover-upcoming] insert error {slug!r}: {insert_err}", flush=True)

    return {'ok': True, 'discovered': discovered, 'skipped': skipped,
            'filtered': filtered,
            'window': [start_date.isoformat(), end_date.isoformat()]}


@events_discovery_bp.route('/api/discover-upcoming', methods=['POST'])
@login_required
def api_discover_upcoming():
    """Fetch upcoming/announced races from NYRR's public Haku widget."""
    try:
        body = request.get_json(silent=True) or {}
        result = discover_upcoming_events(
            include_volunteers=bool(body.get('include_volunteers', False)),
            exclude_youth=bool(body.get('exclude_youth', True)),
        )
        return jsonify(result), (200 if result.get('ok') else 400)
    except Exception as e:
        import traceback
        print(f'[discover-upcoming] Error: {e}\n{traceback.format_exc()}', flush=True)
        return jsonify({'ok': False, 'error': str(e)}), 500
