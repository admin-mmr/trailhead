/**
 * mmrUtils — shared UI utilities for mmr-admin static panels.
 *
 * Exposed as window.mmrUtils so all static JS files can use:
 *   const { fmt, fmtDate, fmtMoney, STATUS_COLORS, Badge } = window.mmrUtils;
 *
 * Dependencies: React (window.React), ReactDOM (window.ReactDOM)
 */
(function () {
  'use strict';

  // ── Formatting helpers ─────────────────────────────────────────────────────

  function fmt(val, fallback) {
    if (fallback === undefined) fallback = '—';
    if (val === null || val === undefined || val === '') return fallback;
    return String(val);
  }

  function fmtDate(val) {
    if (!val) return '—';
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return String(val);
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (_) {
      return String(val);
    }
  }

  function fmtMoney(val) {
    if (val === null || val === undefined || val === '') return '—';
    const n = parseFloat(val);
    if (isNaN(n)) return String(val);
    return '$' + n.toFixed(2);
  }

  // ── Status color map ───────────────────────────────────────────────────────

  const STATUS_COLORS = {
    pending:   { bg: 'var(--yellow-bg,  #fef9c3)', color: 'var(--yellow-text,  #854d0e)' },
    matched:   { bg: 'var(--blue-bg,    #dbeafe)', color: 'var(--blue-text,    #1e40af)' },
    approved:  { bg: 'var(--green-bg,   #dcfce7)', color: 'var(--green-text,   #166534)' },
    rejected:  { bg: 'var(--red-bg,     #fee2e2)', color: 'var(--red-text,     #991b1b)' },
    error:     { bg: 'var(--orange-bg,  #ffedd5)', color: 'var(--orange-text,  #9a3412)' },
    active:    { bg: 'var(--green-bg,   #dcfce7)', color: 'var(--green-text,   #166534)' },
    inactive:  { bg: 'var(--gray-bg,    #f3f4f6)', color: 'var(--gray-text,    #374151)' },
    expired:   { bg: 'var(--red-bg,     #fee2e2)', color: 'var(--red-text,     #991b1b)' },
  };

  // ── Badge component ────────────────────────────────────────────────────────

  function Badge(_ref) {
    var label = _ref.label;
    var colors = STATUS_COLORS[String(label).toLowerCase()] || { bg: '#f3f4f6', color: '#374151' };
    return React.createElement('span', {
      style: {
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '9999px',
        fontSize: '0.75rem',
        fontWeight: 600,
        background: colors.bg,
        color: colors.color,
        textTransform: 'capitalize',
        whiteSpace: 'nowrap',
      },
    }, label);
  }

  // ── MemberID extractor ─────────────────────────────────────────────────────

  function extractMemberIds(text) {
    if (!text) return [];
    var matches = String(text).match(/\bA\d{4}\b/gi);
    return matches ? matches.map(function (m) { return m.toUpperCase(); }) : [];
  }

  // ── Authenticated API helper ───────────────────────────────────────────────
  // Shared with payments.js; kept here so DistrictMembersPanel can import it.

  async function api(path, options) {
    var opts = options || {};
    var method = opts.method || 'GET';
    var body   = opts.body;
    var fetchOpts = {
      method:      method,
      credentials: 'same-origin',
      headers:     { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) fetchOpts.body = JSON.stringify(body);

    var resp = await fetch(path, fetchOpts);
    if (!resp.ok) {
      var text = await resp.text();
      throw new Error('[' + resp.status + '] ' + text.slice(0, 200));
    }
    return resp.json();
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  window.mmrUtils = {
    fmt,
    fmtDate,
    fmtMoney,
    STATUS_COLORS,
    Badge,
    extractMemberIds,
    api,
  };

})();
