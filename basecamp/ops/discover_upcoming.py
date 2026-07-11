#!/usr/bin/env python3
"""
Standalone Haku-widget upcoming-event discovery.

Replicates the /api/discover-upcoming route (api_events_discovery.py) without
the Flask/login layer so it can be run from the CLI:

    mmr
    python3 basecamp/ops/discover_upcoming.py            # insert new upcoming events
    python3 basecamp/ops/discover_upcoming.py --dry-run  # show what would be inserted

Requires NYRR_HAKU_API_KEY in the environment (source load-env.sh via `mmr`).
"""

import os
import re
import sys
import html as _html
import argparse
import requests
from datetime import datetime, date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'mmr-admin'))
from db import execute, query  # noqa: E402

NYRR_UPCOMING_API = "https://widget.hakuapp.com/v2/event_lists"
NYRR_UPCOMING_API_KEY = os.environ.get("NYRR_HAKU_API_KEY", "")


def fetch_widget_html() -> str:
    # Params + headers copied from the live nyrr.org widget request (the
    # old series_id/query_type params return HTTP 500).
    params = {
        "api_key": NYRR_UPCOMING_API_KEY,
        "widget_title": "Upcoming Events",
        "widget_scope": "Endurance, Ticketed, Volunteer, Trainings, Auction",
        "title_font_family": "Inter",
        "body_font_family": "Inter",
        "name_font_family": "Inter",
        "tag_font_family": "Inter",
        "price_font_family": "Inter",
        "filter_font_family": "Inter",
    }
    headers = {
        "accept": "text/html",
        "x-api-key": NYRR_UPCOMING_API_KEY,
        "origin": "https://www.nyrr.org",
        "referer": "https://www.nyrr.org/",
        "user-agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) "
                       "Chrome/149.0.0.0 Safari/537.36"),
    }
    resp = requests.get(NYRR_UPCOMING_API, params=params, headers=headers, timeout=20)
    print(f"  Haku GET {resp.url}")
    print(f"  -> HTTP {resp.status_code}, {len(resp.text)} bytes, "
          f"content-type={resp.headers.get('content-type')}")
    if resp.status_code != 200:
        print("  --- response body (first 1000 chars) ---")
        print(resp.text[:1000])
        print("  ----------------------------------------")
    return resp.text


def parse_blocks(html_text: str):
    """Yield a dict per widget block (current Haku markup, 2026).

    Each <div class="upcoming-event" ...> carries data-start-date="YYYY/MM/DD",
    data-sub-types, data-status; the registration slug lives in the
    events.nyrr.org/<slug> href. There is NO canonical NYRR event code
    pre-race, so the slug is used as event_code (reconcile maps it later).
    """
    blocks = re.split(r'<div class="upcoming-event"', html_text)
    for block in blocks[1:]:
        d = re.search(r'data-start-date="([^"]+)"', block)
        event_date_obj = None
        if d:
            try:
                event_date_obj = datetime.strptime(d.group(1), "%Y/%m/%d").date()
            except ValueError:
                event_date_obj = None

        s = re.search(r'events\.nyrr\.org/([^"?]+)', block)
        slug = s.group(1).strip('/') if s else None

        t = re.search(r'upcoming-race-title">([^<]+)<', block)
        title = _html.unescape(t.group(1).strip()) if t else 'Unknown'

        loc = re.search(r'upcoming-race-location">([^<]+)<', block)
        location = _html.unescape(loc.group(1).strip()) if loc else None

        st = re.search(r'data-sub-types="([^"]*)"', block)
        sub_types = st.group(1) if st else ''

        stat = re.search(r'data-status="([^"]*)"', block)
        status = stat.group(1) if stat else ''

        yield {
            'slug': slug, 'title': title, 'date': event_date_obj,
            'location': location, 'sub_types': sub_types, 'status': status,
        }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true',
                    help='show discovered events without inserting')
    ap.add_argument('--dump-html', metavar='PATH',
                    help='save raw widget HTML to PATH for parser debugging')
    ap.add_argument('--start-date', default='2026-07-01',
                    help='only load events on/after this date (YYYY-MM-DD)')
    ap.add_argument('--end-date', default='2026-08-31',
                    help='only load events on/before this date (YYYY-MM-DD)')
    ap.add_argument('--include-volunteers', action='store_true',
                    help='also load "- Volunteers" entries (default: races only)')
    ap.add_argument('--exclude-youth', action='store_true',
                    help='skip youth "Rising NYRR" entries')
    args = ap.parse_args()

    if not NYRR_UPCOMING_API_KEY:
        sys.exit("ERROR: NYRR_HAKU_API_KEY not set. Run `mmr` (source load-env.sh) first.")

    win_start = datetime.strptime(args.start_date, "%Y-%m-%d").date()
    win_end = datetime.strptime(args.end_date, "%Y-%m-%d").date()

    html = fetch_widget_html()
    if args.dump_html:
        with open(args.dump_html, 'w') as f:
            f.write(html)
        print(f"  Wrote {len(html)} bytes to {args.dump_html}")

    parsed = list(parse_blocks(html))
    if not parsed:
        print("No upcoming-event blocks found in widget response.")
        print("First 500 chars of response for debugging:")
        print(html[:500])
        return

    print(f"Widget returned {len(parsed)} total events. "
          f"Window: {win_start} .. {win_end}\n")

    inserted = skipped = filtered = 0
    for ev in parsed:
        slug, name, edate = ev['slug'], ev['title'], ev['date']
        if not slug or edate is None:
            filtered += 1
            continue
        if not (win_start <= edate <= win_end):
            filtered += 1
            continue
        is_volunteer = 'volunteer' in name.lower() or 'volunteer' in ev['sub_types'].lower()
        if is_volunteer and not args.include_volunteers:
            filtered += 1
            continue
        if args.exclude_youth and 'rising nyrr' in name.lower():
            filtered += 1
            continue

        exists = query("SELECT id FROM nyrr_events WHERE event_code = %s", [slug])
        flag = "EXISTS" if exists else ("DRY-RUN" if args.dry_run else "INSERT")
        print(f"  [{flag:7}] {str(edate)}  {ev['status']:16} {name}")
        print(f"            slug={slug}  types={ev['sub_types']}")
        if exists:
            skipped += 1
            continue
        if args.dry_run:
            continue
        try:
            execute("""
                INSERT INTO nyrr_events
                (event_code, event_name, event_url, location, event_date,
                 event_year, is_upcoming, is_virtual, processing_status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'Pending')
            """, (slug, name, f"https://events.nyrr.org/{slug}", ev['location'],
                  edate, edate.year, 1, 0))
            inserted += 1
        except Exception as e:
            print(f"    DB insert error for {slug!r}: {e}")

    print(f"\n{'(dry-run) ' if args.dry_run else ''}"
          f"Inserted: {inserted}  |  Already present: {skipped}  |  Filtered out: {filtered}")

    rows = query("""
        SELECT event_code, event_name, event_date, is_upcoming, processing_status
        FROM nyrr_events
        WHERE event_date BETWEEN %s AND %s
        ORDER BY event_date
    """, [win_start, win_end])
    print(f"\nEvents in DB for {win_start}..{win_end}: {len(rows)}")
    for r in rows:
        print(f"  {r['event_date']}  {r['event_code']:45} {r['event_name']}")


if __name__ == '__main__':
    main()
