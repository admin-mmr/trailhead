/**
 * MemberTooltip.js — Member lookup + tooltip + chip components.
 *
 * Components:
 *   - MemberTooltip: Fixed-position tooltip with member details
 *   - MemberIdChip: Clickable member ID link with hover tooltip
 *   - fuzzyMatchMember: Predicate for member search filtering
 *   - _memberCache: Shared cache for member lookups
 *
 * Must be loaded BEFORE PaymentsPanel.js in index.html.
 * Depends on: PaymentsHelpers (for fmtDate, fmt)
 *
 * Exported to: window.MemberTooltip, window.MemberIdChip, window.fuzzyMatchMember, window._memberCache
 */

/* global React, useRef */

(function() {
  const { fmtDate, fmt } = window.PaymentsHelpers;

  const _memberCache = {};

  const MemberTooltip = ({ memberId, anchorRect, data }) => {
    if (!memberId || !anchorRect) return null;

    const TOOLTIP_WIDTH = 270;
    const TOOLTIP_HEIGHT = 160;
    const MARGIN = 6;
    const EDGE_PADDING = 8;

    let left = anchorRect.left - TOOLTIP_WIDTH / 2 + anchorRect.width / 2;
    left = Math.max(EDGE_PADDING, Math.min(left, window.innerWidth - TOOLTIP_WIDTH - EDGE_PADDING));

    let top = anchorRect.bottom + MARGIN;
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const spaceAbove = anchorRect.top;

    if (spaceBelow < TOOLTIP_HEIGHT + MARGIN && spaceAbove > TOOLTIP_HEIGHT + MARGIN) {
      top = anchorRect.top - TOOLTIP_HEIGHT - MARGIN;
    }

    return React.createElement('div', {
      style: {
        position: 'fixed', top, left, zIndex: 10000,
        background: 'var(--surface)', border: '1px solid var(--accent)',
        borderRadius: 8, padding: '10px 14px', fontSize: 12,
        boxShadow: '0 6px 24px rgba(0,0,0,0.8)', pointerEvents: 'auto',
        minWidth: 250, maxWidth: 320, willChange: 'transform',
      },
    },
      !data
        ? React.createElement('div', { style: { color: 'var(--text2)', padding: '8px 0', textAlign: 'center' } }, 'Loading member data…')
        : React.createElement(React.Fragment, null,
            React.createElement('div', { style: { fontWeight: 600, fontSize: 13, marginBottom: 2 } },
              `${data.FirstName || ''} ${data.LastName || ''}`.trim() || memberId,
            ),
            React.createElement('div', { style: { color: 'var(--text2)', fontSize: 11, marginBottom: 6 } }, memberId),
            React.createElement('div', {
              style: { display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 10, rowGap: 3, fontSize: 11 },
            },
              React.createElement('span', { style: { color: 'var(--text2)' } }, 'Expires'),
              React.createElement('span', null, fmtDate(data.Expiration)),
              React.createElement('span', { style: { color: 'var(--text2)' } }, 'Type'),
              React.createElement('span', null, fmt(data.Type)),
              data.Email
                ? React.createElement(React.Fragment, null,
                    React.createElement('span', { style: { color: 'var(--text2)' } }, 'Email'),
                    React.createElement('span', { style: { wordBreak: 'break-all' } }, data.Email),
                  ) : null,
              data.WeChatID
                ? React.createElement(React.Fragment, null,
                    React.createElement('span', { style: { color: 'var(--text2)' } }, 'WeChat'),
                    React.createElement('span', null, data.WeChatID),
                  ) : null,
              data.Gender
                ? React.createElement(React.Fragment, null,
                    React.createElement('span', { style: { color: 'var(--text2)' } }, 'Gender'),
                    React.createElement('span', null, data.Gender),
                  ) : null,
              data.District
                ? React.createElement(React.Fragment, null,
                    React.createElement('span', { style: { color: 'var(--text2)' } }, 'District'),
                    React.createElement('span', null, data.District),
                  ) : null,
            ),
          ),
    );
  };

  const MemberIdChip = ({ memberId, tooltipHandlers, onClick }) => {
    const ref = useRef(null);
    if (!memberId) return React.createElement('span', null, '—');
    return React.createElement('span', {
      ref,
      style: { cursor: 'pointer', color: 'var(--accent)', fontWeight: 500, display: 'inline', minWidth: 0 },
      onMouseEnter: () => {
        if (ref.current && tooltipHandlers?.onHover) {
          tooltipHandlers.onHover(memberId, ref.current.getBoundingClientRect());
        }
      },
      onMouseLeave: tooltipHandlers?.onLeave,
      onClick: (e) => { e.stopPropagation(); if (onClick) onClick(memberId); },
    }, memberId);
  };

  const fuzzyMatchMember = (query, member) => {
    if (!query) return true;
    const q = query.toLowerCase();
    const searchFields = [
      (member.FirstName || ''),
      (member.LastName || ''),
      (member.MemberID || ''),
      (member.Email || ''),
      (member.WeChatID || ''),
    ].join(' ').toLowerCase();
    return q.split(/\s+/).every(word => searchFields.includes(word));
  };

  window._memberCache = _memberCache;
  window.MemberTooltip = MemberTooltip;
  window.MemberIdChip = MemberIdChip;
  window.fuzzyMatchMember = fuzzyMatchMember;
})();
