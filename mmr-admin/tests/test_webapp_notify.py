"""
Tests for webapp_notify.py — the Flask → Next.js notification bridge.

The contract that matters: this module is called AFTER a family regrouping has
already been committed, so it must never raise. Every failure mode below is
asserted to come back as a dict, not an exception, because an exception here
would turn a completed database change into a 500 and invite an admin to redo an
operation that already happened.
"""
import json
import os
import sys
import unittest
import urllib.error
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import webapp_notify  # noqa: E402


class _Resp:
    """Minimal stand-in for the urlopen context manager."""

    def __init__(self, payload, status=200):
        self._payload = payload
        self.status = status

    def read(self):
        return json.dumps(self._payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class TestNotifyFamilyUpdated(unittest.TestCase):

    def setUp(self):
        self._env = patch.dict(os.environ, {
            'JOB_SECRET': 'test-secret',
            'MMR_WEBAPP_URL': 'https://example.test',
        })
        self._env.start()

    def tearDown(self):
        self._env.stop()

    def test_posts_family_payload_with_bearer_auth(self):
        with patch('urllib.request.urlopen', return_value=_Resp({'ok': True, 'data': {'sent': 3}})) as m:
            result = webapp_notify.notify_family_updated('B001', ['A0003'], 'add-A0003')

        self.assertTrue(result['ok'])
        req = m.call_args[0][0]
        self.assertEqual(req.full_url, 'https://example.test/api/notifications/family-updated')
        self.assertEqual(req.get_header('Authorization'), 'Bearer test-secret')
        body = json.loads(req.data)
        self.assertEqual(body, {
            'familyId': 'B001',
            'addedMemberIds': ['A0003'],
            'dedupeSuffix': 'add-A0003',
        })

    def test_omits_dedupe_suffix_when_not_given(self):
        with patch('urllib.request.urlopen', return_value=_Resp({'ok': True})) as m:
            webapp_notify.notify_family_updated('B001', ['A0003'])

        self.assertNotIn('dedupeSuffix', json.loads(m.call_args[0][0].data))

    def test_missing_added_ids_becomes_empty_list(self):
        with patch('urllib.request.urlopen', return_value=_Resp({'ok': True})) as m:
            webapp_notify.notify_family_updated('B001')

        self.assertEqual(json.loads(m.call_args[0][0].data)['addedMemberIds'], [])

    def test_skips_without_job_secret_instead_of_failing(self):
        # An unconfigured deploy must degrade to "no email", not to an exception
        # in the middle of an admin action.
        with patch.dict(os.environ, {'JOB_SECRET': ''}):
            with patch('urllib.request.urlopen') as m:
                result = webapp_notify.notify_family_updated('B001', ['A0003'])

        self.assertFalse(result['ok'])
        self.assertTrue(result['skipped'])
        m.assert_not_called()

    def test_http_error_is_reported_not_raised(self):
        err = urllib.error.HTTPError(
            url='https://example.test', code=401, msg='Unauthorized',
            hdrs=None, fp=MagicMock(read=lambda: b'{"error":"Invalid token"}'),
        )
        with patch('urllib.request.urlopen', side_effect=err):
            result = webapp_notify.notify_family_updated('B001', ['A0003'])

        self.assertFalse(result['ok'])
        self.assertIn('401', result['error'])
        self.assertIn('Invalid token', result['error'])

    def test_network_failure_is_reported_not_raised(self):
        with patch('urllib.request.urlopen', side_effect=OSError('connection refused')):
            result = webapp_notify.notify_family_updated('B001', ['A0003'])

        self.assertFalse(result['ok'])
        self.assertIn('connection refused', result['error'])

    def test_unparseable_response_body_does_not_raise(self):
        broken = MagicMock()
        broken.read.return_value = b'<html>gateway timeout</html>'
        broken.status = 200
        broken.__enter__ = lambda s: s
        broken.__exit__ = lambda s, *a: False

        with patch('urllib.request.urlopen', return_value=broken):
            result = webapp_notify.notify_family_updated('B001', ['A0003'])

        self.assertFalse(result['ok'])

    def test_rejects_empty_family_id_without_calling_out(self):
        with patch('urllib.request.urlopen') as m:
            result = webapp_notify.notify_family_updated('')

        self.assertFalse(result['ok'])
        m.assert_not_called()

    def test_defaults_to_production_url(self):
        with patch.dict(os.environ, {'MMR_WEBAPP_URL': ''}, clear=False):
            del os.environ['MMR_WEBAPP_URL']
            with patch('urllib.request.urlopen', return_value=_Resp({'ok': True})) as m:
                webapp_notify.notify_family_updated('B001')

        self.assertTrue(m.call_args[0][0].full_url.startswith('https://www.mmrunners.org'))

    def test_trailing_slash_in_url_does_not_double_up(self):
        with patch.dict(os.environ, {'MMR_WEBAPP_URL': 'https://example.test/'}):
            with patch('urllib.request.urlopen', return_value=_Resp({'ok': True})) as m:
                webapp_notify.notify_family_updated('B001')

        self.assertEqual(
            m.call_args[0][0].full_url,
            'https://example.test/api/notifications/family-updated',
        )


if __name__ == '__main__':
    unittest.main()
