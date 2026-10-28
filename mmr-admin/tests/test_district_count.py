"""
Tests for the bookmarkable district count page (api_district_count.py) and the
post-login return-to-page redirect it relies on (auth.py).

Run:
    cd mmr-admin
    python3 -m pytest tests/test_district_count.py -v
"""
from unittest.mock import patch

_BROOKLYN = [
    {'Status': 'active', 'n': 31},
    {'Status': 'inactive', 'n': 3},
    {'Status': 'lifetime', 'n': 1},
]


# ---------------------------------------------------------------------------
# Count page
# ---------------------------------------------------------------------------

class TestDistrictCountPage:
    def test_defaults_to_active(self, client, mock_query):
        mock_query.return_value = _BROOKLYN
        r = client.get('/district/Brooklyn')
        assert r.status_code == 200
        html = r.get_data(as_text=True)
        assert '<div class="num">31</div>' in html
        assert 'active members' in html

    def test_toggle_to_inactive(self, client, mock_query):
        mock_query.return_value = _BROOKLYN
        html = client.get('/district/Brooklyn?status=inactive').get_data(as_text=True)
        assert '<div class="num">3</div>' in html
        assert 'class="pill on" href="/district/Brooklyn?status=inactive"' in html

    def test_lifetime_not_folded_into_active(self, client, mock_query):
        """Exact Status values, matching the District panel — lifetime only
        shows up in the breakdown line, never in the active number."""
        mock_query.return_value = _BROOKLYN
        html = client.get('/district/Brooklyn').get_data(as_text=True)
        assert '<div class="num">31</div>' in html
        assert 'All statuses (35)' in html
        assert 'lifetime 1' in html

    def test_district_is_bound_param_not_interpolated(self, client, mock_query):
        mock_query.return_value = _BROOKLYN
        client.get("/district/Brooklyn' OR '1'='1")
        sql, params = mock_query.call_args[0]
        assert 'Brooklyn' not in sql
        assert params == ("Brooklyn' OR '1'='1",)

    def test_district_is_html_escaped(self, client, mock_query):
        mock_query.return_value = [{'Status': 'active', 'n': 1}]
        html = client.get('/district/<img src=x onerror=alert(1)>').get_data(as_text=True)
        assert '<img' not in html
        assert '&lt;img src=x onerror=alert(1)&gt;' in html

    def test_toggle_links_url_encode_district(self, client, mock_query):
        mock_query.return_value = [{'Status': 'active', 'n': 29}]
        html = client.get('/district/New Jersey (excl. JC)').get_data(as_text=True)
        assert 'href="/district/New%20Jersey%20%28excl.%20JC%29?status=inactive"' in html

    def test_missing_status_shows_zero(self, client, mock_query):
        mock_query.return_value = [{'Status': 'active', 'n': 2}]
        html = client.get('/district/Nassau?status=inactive').get_data(as_text=True)
        assert '<div class="num">0</div>' in html

    def test_unknown_status_is_400(self, client, mock_query):
        mock_query.return_value = _BROOKLYN
        r = client.get('/district/Brooklyn?status=<b>bogus</b>')
        assert r.status_code == 400
        assert '<b>bogus</b>' not in r.get_data(as_text=True)

    def test_unknown_district_is_404(self, client, mock_query):
        mock_query.return_value = []
        assert client.get('/district/Atlantis').status_code == 404


# ---------------------------------------------------------------------------
# Post-login redirect back to the bookmarked page
# ---------------------------------------------------------------------------

class TestLoginNext:
    def test_logged_out_visit_remembers_page(self, client):
        with patch('auth.DEV_BYPASS_AUTH', False):
            r = client.get('/district/Brooklyn?status=inactive')
        assert r.status_code == 302
        assert r.headers['Location'].endswith('/login')
        with client.session_transaction() as s:
            assert s['login_next'] == '/district/Brooklyn?status=inactive'

    def test_no_query_string_has_no_trailing_question_mark(self, client):
        with patch('auth.DEV_BYPASS_AUTH', False):
            client.get('/district/Brooklyn')
        with client.session_transaction() as s:
            assert s['login_next'] == '/district/Brooklyn'

    def test_api_401_does_not_overwrite_destination(self, client):
        with client.session_transaction() as s:
            s['login_next'] = '/district/Brooklyn'
        with patch('auth.DEV_BYPASS_AUTH', False):
            assert client.get('/api/district/districts').status_code == 401
        with client.session_transaction() as s:
            assert s['login_next'] == '/district/Brooklyn'

    def test_oauth_finish_redirects_to_saved_page(self, app):
        import auth
        with app.test_request_context():
            from flask import session
            session['login_next'] = '/district/Brooklyn?status=inactive'
            with patch('auth.get_user_role', return_value='admin'):
                r = auth._finish_oauth('someone@mmrunners.org')
            assert r.headers['Location'] == '/district/Brooklyn?status=inactive'
            assert 'login_next' not in session

    def test_oauth_finish_defaults_to_dashboard(self, app):
        import auth
        with app.test_request_context():
            with patch('auth.get_user_role', return_value='admin'):
                assert auth._finish_oauth('x@mmrunners.org').headers['Location'] == '/'

    def test_offsite_destinations_are_rejected(self, app):
        import auth
        from flask import session
        for bad in ('//evil.com', '/\\evil.com', 'https://evil.com', 'evil.com'):
            with app.test_request_context():
                session['login_next'] = bad
                assert auth._pop_login_next() == '/', bad

    def test_password_login_returns_next(self, client):
        with client.session_transaction() as s:
            s['login_next'] = '/district/Brooklyn'
        with patch('auth.query', return_value=[{'password_hash': 'h'}]), \
             patch('auth.bcrypt.checkpw', return_value=True), \
             patch('auth.get_user_role', return_value='admin'):
            r = client.post('/auth/password', json={'email': 'a@b.org', 'password': 'pw'})
        assert r.json['ok'] is True
        assert r.json['next'] == '/district/Brooklyn'
