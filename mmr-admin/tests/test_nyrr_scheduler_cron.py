"""
Schedule defaults for the in-app NYRR scheduler (nyrr_scheduler.py).

Why this exists: DISCOVERY_CRON / FINISHER_CRON are bare strings handed to
APScheduler's CronTrigger.from_crontab() at startup. A typo that is still a
*valid* crontab (e.g. '0 6 1 * *' when weekly was intended) silently changes
how often the pipeline runs, with no error anywhere — the only symptom is stale
data weeks later. P1L moved discovery monthly → weekly precisely because a
monthly scan left the member-portal calendar up to a month behind NYRR's
~8-week publication window, so the cadence is now load-bearing for a member-
facing feature and gets asserted here.
"""
import importlib
import os
from unittest.mock import patch

import pytest

from apscheduler.triggers.cron import CronTrigger


def _fresh_module(**env):
    """Re-import nyrr_scheduler with a patched environment (module reads env at import)."""
    with patch.dict(os.environ, env, clear=False):
        import nyrr_scheduler
        return importlib.reload(nyrr_scheduler)


@pytest.fixture(autouse=True)
def _restore_module():
    """Leave the module in its default state for other tests in the session."""
    yield
    with patch.dict(os.environ, {}, clear=False):
        for key in ('NYRR_DISCOVERY_CRON', 'NYRR_FINISHER_CRON'):
            os.environ.pop(key, None)
        import nyrr_scheduler
        importlib.reload(nyrr_scheduler)


def test_discovery_default_is_weekly():
    """Discovery must run weekly, not monthly — NYRR only publishes ~8 weeks out."""
    mod = _fresh_module()
    trigger = CronTrigger.from_crontab(mod.DISCOVERY_CRON)
    fields = {f.name: str(f) for f in trigger.fields}

    # day_of_week pinned + day-of-month wildcard == weekly.
    assert fields['day_of_week'] == '1', 'discovery should run on a fixed weekday (Monday)'
    assert fields['day'] == '*', 'a pinned day-of-month would make this monthly again'


def test_finisher_default_is_weekly_tuesday():
    """Finisher pipeline keeps the old GitHub cron: Tuesdays 02:00 UTC."""
    mod = _fresh_module()
    fields = {f.name: str(f) for f in CronTrigger.from_crontab(mod.FINISHER_CRON).fields}
    assert fields['day_of_week'] == '2'
    assert fields['hour'] == '2'


def test_discovery_and_finisher_do_not_collide():
    """Overlapping runs would have two workers writing nyrr_events at once."""
    mod = _fresh_module()
    disc = {f.name: str(f) for f in CronTrigger.from_crontab(mod.DISCOVERY_CRON).fields}
    fin = {f.name: str(f) for f in CronTrigger.from_crontab(mod.FINISHER_CRON).fields}
    assert (disc['day_of_week'], disc['hour']) != (fin['day_of_week'], fin['hour'])


@pytest.mark.parametrize('cron', ['0 6 * * 1', '0 6 1 * *', '*/30 * * * *'])
def test_defaults_are_overridable_via_env(cron):
    """Azure app settings must win over the in-code default."""
    mod = _fresh_module(NYRR_DISCOVERY_CRON=cron)
    assert mod.DISCOVERY_CRON == cron
    CronTrigger.from_crontab(mod.DISCOVERY_CRON)  # must stay parseable


def test_both_defaults_parse_as_crontabs():
    """Guards the startup crash path: from_crontab() raises on a malformed string."""
    mod = _fresh_module()
    for cron in (mod.DISCOVERY_CRON, mod.FINISHER_CRON):
        assert CronTrigger.from_crontab(cron) is not None
