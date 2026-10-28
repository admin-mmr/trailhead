"""
Bookmarkable member-count page for one district.

Blueprint: district_count_bp

Routes:
  GET /district/<district>?status=active|inactive  — server-rendered count page

e.g. https://admin.mmrunners.org/district/Brooklyn — the toggle is a plain link
(?status=inactive), so every view is itself a shareable URL and needs no JS.
"""
from __future__ import annotations

from html import escape
from urllib.parse import quote

from flask import Blueprint, request

from auth import login_required, require_role
from db import query

district_count_bp = Blueprint('district_count', __name__)

# Pills shown on the page. Values match members.Status exactly — no grouping,
# so 'lifetime'/'expired' are NOT folded into active/inactive (they appear in
# the breakdown line instead).
TOGGLE_STATUSES = ('active', 'inactive')


def get_district_status_counts(district: str) -> dict[str, int]:
    """{Status: count} for one district. Exact match — District has no
    normalisation ('Great Neck' and 'Great Neck Long Island' are distinct)."""
    rows = query("""
        SELECT Status, COUNT(*) AS n
        FROM members
        WHERE District = %s
        GROUP BY Status
    """, (district,))
    return {r['Status']: int(r['n']) for r in rows}


@district_count_bp.route('/district/<district>')
@login_required
@require_role('admin')
def district_count_page(district: str):
    status = request.args.get('status', 'active').strip()
    if status not in TOGGLE_STATUSES:
        return _html(f'<p class="err">Unknown status "{escape(status)}". '
                     f'Use one of: {", ".join(TOGGLE_STATUSES)}.</p>', district), 400

    counts = get_district_status_counts(district)
    if not counts:
        return _html(f'<p class="err">No members found in district '
                     f'"{escape(district)}".</p>', district), 404

    pills = ''.join(
        f'<a class="pill{" on" if s == status else ""}" '
        f'href="/district/{quote(district, safe="")}?status={s}">{s} · {counts.get(s, 0)}</a>'
        for s in TOGGLE_STATUSES
    )
    breakdown = ' · '.join(f'{escape(s)} {n}' for s, n in sorted(counts.items()))
    body = f"""
      <div class="num">{counts.get(status, 0)}</div>
      <div class="lbl">{escape(status)} members</div>
      <nav>{pills}</nav>
      <p class="sub">All statuses ({sum(counts.values())}): {breakdown}</p>"""
    return _html(body, district)


def _html(body: str, district: str) -> str:
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{escape(district)} members · MMR Admin</title>
<style>
  body {{ font-family: system-ui, sans-serif; background: #f6f7f9; color: #1f2937;
         margin: 0; display: grid; place-items: center; min-height: 100vh; }}
  main {{ background: #fff; border-radius: 12px; padding: 32px 40px; text-align: center;
         box-shadow: 0 1px 3px rgba(0,0,0,.08); min-width: 260px; }}
  h1 {{ font-size: 18px; margin: 0 0 16px; }}
  .num {{ font-size: 64px; font-weight: 700; line-height: 1; }}
  .lbl {{ color: #6b7280; margin: 6px 0 20px; }}
  nav {{ display: flex; gap: 8px; justify-content: center; }}
  .pill {{ padding: 6px 14px; border-radius: 999px; border: 1px solid #d1d5db;
          color: #374151; text-decoration: none; font-size: 14px; }}
  .pill.on {{ background: #2563eb; border-color: #2563eb; color: #fff; }}
  .sub {{ color: #9ca3af; font-size: 12px; margin: 20px 0 0; }}
  .err {{ color: #b91c1c; }}
  .home {{ display: block; margin-top: 16px; font-size: 12px; color: #6b7280; }}
</style></head>
<body><main>
  <h1>District: {escape(district)}</h1>{body}
  <a class="home" href="/">← MMR Admin</a>
</main></body></html>"""
