"""
NYRR Event Discovery — Routes for discovering events from public APIs.
Extracted from api_events.py to keep routes modular.
"""

import os
import re
import requests
from datetime import datetime, date
from flask import Blueprint, request, jsonify
from auth import login_required
from db import execute, query

events_discovery_bp = Blueprint('events_discovery', __name__)

# NYRR API constants
NYRR_UPCOMING_API = "https://widget.hakuapp.com/v2/event_lists"
NYRR_UPCOMING_API_KEY = os.environ.get("NYRR_HAKU_API_KEY", "")


@events_discovery_bp.route('/api/discover', methods=['POST'])
@login_required
def api_discover_events():
    """
    Discover upcoming events from eventbrite and insert into nyrr_events.
    This finds events from the public schedule that aren't yet in our DB.
    """
    try:
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

        return jsonify({'ok': True, 'discovered': inserted, 'events': inserted})

    except Exception as e:
        import traceback
        print(f'[discover] Error: {e}\n{traceback.format_exc()}', flush=True)
        return jsonify({'ok': False, 'error': str(e)}), 500


@events_discovery_bp.route('/api/discover-upcoming', methods=['POST'])
@login_required
def api_discover_upcoming():
    """Fetch upcoming/announced events from the NYRR public widget API.

    The NYRR announces upcoming events in their public widget, which we scrape
    to discover events before they appear in the official event list.
    """
    try:
        if not NYRR_UPCOMING_API_KEY:
            return jsonify({'ok': False, 'error': 'NYRR_HAKU_API_KEY not configured'}), 400

        # Fetch HTML from the widget API
        url = (f"{NYRR_UPCOMING_API}?api_key={NYRR_UPCOMING_API_KEY}"
               f"&series_id=1&query_type=upcoming_races")
        headers = {
            'Accept': 'application/json',
            'x-api-key': NYRR_UPCOMING_API_KEY,
        }
        response = requests.get(url, headers=headers, timeout=10)
        html = response.text

        # Split on each upcoming-event block
        blocks = re.split(r'<div\s+class="upcoming-event"', html)

        inserted = 0
        for block in blocks[1:]:  # Skip first empty split
            try:
                # Extract event code
                m = re.search(r'data-event-code="([^"]+)"', block)
                code = m.group(1) if m else None
                if not code:
                    continue

                # Check if already in DB
                existing = query("SELECT id FROM nyrr_events WHERE event_code = %s", [code])
                if existing:
                    continue

                # Extract name
                m = re.search(r'class="upcoming-race-title"[^>]*>([^<]+)<', block)
                name = m.group(1) if m else 'Unknown'

                # Extract date
                m = re.search(r'class="upcoming-race-date"[^>]*>([^<]+)<', block)
                date_str = m.group(1) if m else ''

                # Parse date (format: "Mon, Jan 01, 2025")
                event_date_obj = None
                try:
                    event_date_obj = datetime.strptime(date_str, "%a, %b %d, %Y").date()
                except ValueError:
                    event_date_obj = None

                # Determine if upcoming
                upcoming = (event_date_obj > date.today()) if event_date_obj else True

                # Extract year
                event_year = event_date_obj.year if event_date_obj else datetime.now().year

                # Try to insert
                try:
                    execute("""
                        INSERT INTO nyrr_events
                        (event_code, event_name, event_date, event_year, is_upcoming, is_virtual, processing_status)
                        VALUES (%s, %s, %s, %s, %s, %s, 'Pending')
                    """,
                        (code, name, event_date_obj, event_year, int(upcoming), 0)
                    )
                    inserted += 1
                except Exception as db_err:
                    print(f'[discover-upcoming] DB insert error for code={code!r} (len={len(code)}): {db_err}', flush=True)
                    pass

            except Exception as block_err:
                print(f'[discover-upcoming] Block parse error: {block_err}', flush=True)
                pass

        return jsonify({'ok': True, 'discovered': inserted})

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f'[discover-upcoming] Error: {e}\n{tb}', flush=True)
        return jsonify({'ok': False, 'error': str(e)}), 500
