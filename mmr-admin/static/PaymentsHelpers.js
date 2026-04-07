/**
 * PaymentsHelpers.js — Shared formatting + intent helpers for Payments UI.
 *
 * Module-level utilities: formatters, colors, badge component, member ID extraction.
 * Must be loaded BEFORE PaymentsPanel.js in index.html.
 *
 * Exported to: window.PaymentsHelpers
 */

/* global React */

(function() {
  const fmt = (v) => v == null ? '—' : String(v);

  const fmtDate = (v) => {
    if (!v) return '—';
    try {
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
        const [year, month, day] = v.split('T')[0].split(' ')[0].split('-');
        const date = new Date(year, month - 1, day);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
      return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    catch { return String(v); }
  };

  const fmtMoney = (v) => v == null ? '—' : `$${Number(v).toFixed(2)}`;

  const STATUS_COLORS = {
    pending:  'var(--yellow)',
    matched:  'var(--accent)',
    approved: 'var(--green)',
    rejected: 'var(--red)',
    expired:  'var(--text2)',
    error:    'var(--red)',
  };

  const Badge = ({ status }) =>
    React.createElement('span', {
      style: {
        display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11,
        fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
        background: (STATUS_COLORS[status] || 'var(--text2)') + '22',
        color: STATUS_COLORS[status] || 'var(--text2)',
        border: `1px solid ${STATUS_COLORS[status] || 'var(--text2)'}44`,
      }
    }, status);

  function extractMemberIds(text) {
    if (!text) return [];
    const matches = [...String(text).matchAll(/\b([Aa]\d{4})\b/g)];
    return [...new Set(matches.map(m => m[1].toUpperCase()))];
  }

  function suggestIntent(amount) {
    const n = Number(amount) || 0;
    if (n >= 50) return 'Family Membership';
    if (n >= 30) return 'Individual Membership';
    return 'Individual Membership';
  }

  const PAYMENT_INTENTS = [
    'Individual Membership',
    'Family Membership',
    'Family Upgrade',
    'Event Registration',
    'Donation',
  ];

  window.PaymentsHelpers = {
    fmt, fmtDate, fmtMoney, STATUS_COLORS, Badge, extractMemberIds, suggestIntent, PAYMENT_INTENTS
  };
})();
