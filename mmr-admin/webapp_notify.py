"""
Ask the Next.js webapp to send a member-facing email.

Why this indirection exists: family grouping is an admin operation and lives in
Flask, but every member-facing email template is TypeScript in
web-apps/mmr-webapp/lib/email/templates/ — bilingual HTML, brand layout, unit
tested. Re-implementing those templates in Python would guarantee the two copies
drifted, and members would get two different-looking emails from one club.

So Flask calls the webapp, which owns the templates and the notification_log
ledger. Auth is the shared JOB_SECRET bearer token (see lib/jobs/auth.ts).

Contract for every function here: NEVER raise. These are called after a family
change has already been committed. A mail failure must not turn a successful
regrouping into a 500 that makes an admin retry an operation that already
happened. Failures are logged and reported in the return value.

Environment:
    MMR_WEBAPP_URL  — defaults to https://www.mmrunners.org
    JOB_SECRET      — same value as the webapp's app setting. Unset = disabled
                      (we log once and skip, rather than failing the caller).
"""
from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request

logger = logging.getLogger(__name__)

DEFAULT_WEBAPP_URL = "https://www.mmrunners.org"
_TIMEOUT_SECONDS = 20


def _webapp_url() -> str:
    return os.environ.get("MMR_WEBAPP_URL", DEFAULT_WEBAPP_URL).rstrip("/")


def _post(path: str, payload: dict) -> dict:
    """POST JSON to the webapp. Returns {'ok': bool, ...}; never raises."""
    secret = os.environ.get("JOB_SECRET", "").strip()
    if not secret:
        logger.warning(
            "webapp_notify: JOB_SECRET not set — skipping %s (no email sent)", path
        )
        return {"ok": False, "skipped": True, "error": "JOB_SECRET not configured"}

    url = f"{_webapp_url()}{path}"
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {secret}",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT_SECONDS) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            parsed = json.loads(raw) if raw else {}
            logger.info("webapp_notify: %s → %s %s", path, resp.status, parsed.get("data"))
            return {"ok": True, **parsed}
    except urllib.error.HTTPError as exc:
        # Read the body — the webapp returns a JSON error worth logging, and a
        # 401 here means the two JOB_SECRET values disagree.
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        logger.error("webapp_notify: %s failed HTTP %s: %s", path, exc.code, detail)
        return {"ok": False, "error": f"HTTP {exc.code}: {detail}"}
    except Exception as exc:  # noqa: BLE001 — see the module docstring
        logger.exception("webapp_notify: %s failed", path)
        return {"ok": False, "error": str(exc)}


def notify_family_updated(
    family_id: str,
    added_member_ids: list[str] | None = None,
    dedupe_suffix: str | None = None,
) -> dict:
    """
    Email every member of `family_id` the full grouped roster.

    Args:
        family_id:        the family whose roster changed
        added_member_ids: members added by this change (flagged NEW in the email)
        dedupe_suffix:    stable per-operation string. The webapp refuses to send
                          the same (member, suffix) twice, so an admin who
                          double-clicks does not mail the household twice. Pass
                          None only when a resend is genuinely wanted.
    """
    if not family_id:
        return {"ok": False, "error": "family_id is required"}

    payload: dict = {"familyId": family_id, "addedMemberIds": added_member_ids or []}
    if dedupe_suffix:
        payload["dedupeSuffix"] = dedupe_suffix
    return _post("/api/notifications/family-updated", payload)
