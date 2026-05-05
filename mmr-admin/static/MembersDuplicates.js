/**
 * MembersDuplicates.js — Duplicate member detection UI.
 *
 * Shows three collapsible sections (name / phone / wechat) where each section
 * lists groups of members that appear to be duplicates. Admin can:
 *   • "Open member" — jump to Edit Member tab for that MemberID
 *   • "Mark not a duplicate" — dismiss the group via POST /api/members/duplicates/dismiss
 *
 * No auto-merge functionality (FK risk).
 *
 * Requires: api() global, React globals (useState, useEffect, useCallback)
 * Exported: window.MembersDuplicates
 */

/* global React, useState, useEffect, useCallback, api */

(function () {
  const e = React.createElement;

  // ── Member card ─────────────────────────────────────────────────────────────
  const MemberCard = ({ member }) =>
    e('div', {
      style: {
        flex: '1 1 200px', minWidth: 180, padding: '10px 14px',
        border: '1px solid var(--border)', borderRadius: 'var(--radius)',
        background: 'var(--surface2)', fontSize: 12,
      }
    },
      e('div', { style: { fontWeight: 700, fontSize: 13, marginBottom: 4, color: 'var(--accent)' } },
        member.MemberID),
      e('div', { style: { fontWeight: 600, marginBottom: 2 } },
        `${member.FirstName || ''} ${member.LastName || ''}`.trim()),
      member.Email    && e('div', { style: { color: 'var(--text2)' } }, member.Email),
      member.PhoneNumber && e('div', { style: { color: 'var(--text2)' } }, `📞 ${member.PhoneNumber}`),
      member.WeChatID && e('div', { style: { color: 'var(--text2)' } }, `💬 ${member.WeChatID}`),
      e('div', { style: { marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' } },
        e('span', {
          style: {
            fontSize: 11, padding: '1px 7px', borderRadius: 99,
            background: member.Status === 'active' ? 'rgba(74,222,128,0.15)' : 'rgba(148,163,184,0.15)',
            color:      member.Status === 'active' ? 'var(--green)' : 'var(--text2)',
          }
        }, member.Status || '—'),
        member.MemberType && e('span', {
          style: { fontSize: 11, padding: '1px 7px', borderRadius: 99, background: 'rgba(56,189,248,0.1)', color: 'var(--accent)' }
        }, member.MemberType),
        member.FamilyID && e('span', {
          style: { fontSize: 11, padding: '1px 7px', borderRadius: 99, background: 'rgba(167,139,250,0.12)', color: 'var(--purple)' }
        }, `Family ${member.FamilyID}`),
      ),
      member.Expiration && e('div', {
        style: { marginTop: 4, fontSize: 11, color: 'var(--text2)' }
      }, `Expires: ${member.Expiration.slice(0, 10)}`),
      member.District && e('div', {
        style: { fontSize: 11, color: 'var(--text2)' }
      }, `District ${member.District}`),
    );

  // ── Duplicate group row ──────────────────────────────────────────────────────
  const DupGroup = ({ group, onDismiss, onOpenMember, dismissing }) =>
    e('div', {
      style: {
        marginBottom: 12, padding: '12px 14px',
        border: '1px solid var(--border)', borderRadius: 'var(--radius)',
        background: 'var(--surface)',
      }
    },
      // header
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 } },
        e('div', null,
          e('span', { style: { fontWeight: 600, fontSize: 13 } }, group.display),
          e('span', {
            style: { marginLeft: 8, fontSize: 11, color: 'var(--text2)' }
          }, `${group.members.length} members`),
        ),
        e('div', { style: { display: 'flex', gap: 8 } },
          ...group.members.map(m =>
            e('button', {
              key: m.MemberID,
              className: 'btn btn-sm btn-outline',
              onClick: () => onOpenMember(m.MemberID),
              style: { fontSize: 11, padding: '2px 8px' },
            }, `Open ${m.MemberID}`)
          ),
          e('button', {
            className: 'btn btn-sm',
            onClick: () => onDismiss(group.dup_type, group.dup_key),
            disabled: dismissing,
            title: 'Mark as not a duplicate — hides this pair from future scans',
            style: {
              fontSize: 11, padding: '2px 10px',
              background: 'var(--surface2)', color: 'var(--text2)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              cursor: dismissing ? 'not-allowed' : 'pointer',
            },
          }, dismissing ? '…' : '✕ Not a duplicate'),
        ),
      ),
      // member cards side-by-side
      e('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
        ...group.members.map(m => e(MemberCard, { key: m.MemberID, member: m }))
      ),
    );

  // ── Section (collapsible) ────────────────────────────────────────────────────
  const Section = ({ title, icon, groups, onDismiss, onOpenMember, dismissingKey }) => {
    const [open, setOpen] = useState(true);
    return e('div', { style: { marginBottom: 24 } },
      e('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          marginBottom: open ? 12 : 0,
          padding: '8px 0', borderBottom: '1px solid var(--border)',
        },
        onClick: () => setOpen(v => !v),
      },
        e('span', { style: { fontSize: 15 } }, icon),
        e('span', { style: { fontWeight: 700, fontSize: 14 } }, title),
        e('span', {
          style: {
            fontSize: 11, padding: '1px 8px', borderRadius: 99,
            background: groups.length > 0 ? 'rgba(251,191,36,0.15)' : 'rgba(74,222,128,0.1)',
            color: groups.length > 0 ? 'var(--yellow)' : 'var(--green)',
          }
        }, groups.length > 0 ? `${groups.length} group${groups.length > 1 ? 's' : ''}` : '✓ clean'),
        e('span', { style: { marginLeft: 'auto', color: 'var(--text2)', fontSize: 12 } }, open ? '▼' : '▶'),
      ),
      open && (groups.length === 0
        ? e('div', { style: { padding: '12px 0', color: 'var(--text2)', fontSize: 13 } },
            'No duplicates found.')
        : groups.map(g =>
            e(DupGroup, {
              key: g.dup_key,
              group: g,
              onDismiss,
              onOpenMember,
              dismissing: dismissingKey === `${g.dup_type}|${g.dup_key}`,
            })
          )
      ),
    );
  };

  // ── Main panel ───────────────────────────────────────────────────────────────
  const MembersDuplicates = ({ onOpenMember }) => {
    const [data, setData]         = useState({ name: [], phone: [], wechat: [] });
    const [loading, setLoading]   = useState(true);
    const [error, setError]       = useState(null);
    const [dismissingKey, setDismissingKey] = useState(null);
    const [toast, setToast]       = useState('');

    const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 4000); };

    const load = useCallback(() => {
      setLoading(true);
      setError(null);
      api('/api/members/duplicates?type=all').then(r => {
        setLoading(false);
        if (r && r.ok) {
          setData(r.data || { name: [], phone: [], wechat: [] });
        } else {
          setError(r?.error || 'Failed to load duplicates');
        }
      }).catch(err => {
        setLoading(false);
        setError(err.message);
      });
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleDismiss = useCallback((dup_type, dup_key) => {
      const key = `${dup_type}|${dup_key}`;
      setDismissingKey(key);
      api('/api/members/duplicates/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dup_type, dup_key }),
      }).then(r => {
        setDismissingKey(null);
        if (r && r.ok) {
          showToast(`✓ Dismissed — won't appear again`);
          // Remove group from local state immediately (no re-fetch needed)
          setData(prev => ({
            ...prev,
            [dup_type]: prev[dup_type].filter(g => g.dup_key !== dup_key),
          }));
        } else {
          showToast(`✗ ${r?.error || 'Dismiss failed'}`);
        }
      }).catch(err => {
        setDismissingKey(null);
        showToast(`✗ ${err.message}`);
      });
    }, []);

    const totalGroups = (data.name?.length || 0) + (data.phone?.length || 0) + (data.wechat?.length || 0);

    return e('div', { style: { padding: '4px 0' } },
      // Toast
      toast && e('div', {
        style: {
          position: 'fixed', top: 16, right: 16, zIndex: 200,
          background: 'var(--surface)', border: '1px solid var(--accent)',
          borderRadius: 'var(--radius)', padding: '10px 16px',
          fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }
      }, toast),

      // Header
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 } },
        e('div', null,
          e('h3', { style: { margin: 0, fontSize: 15, fontWeight: 700 } }, '🔁 Duplicate Members'),
          !loading && e('span', { style: { fontSize: 12, color: 'var(--text2)', marginTop: 2, display: 'block' } },
            totalGroups > 0
              ? `${totalGroups} potential duplicate group${totalGroups > 1 ? 's' : ''} found`
              : '✓ No duplicates detected'),
        ),
        e('button', {
          className: 'btn btn-sm btn-outline',
          onClick: load,
          disabled: loading,
          style: { fontSize: 12 },
        }, loading ? 'Scanning…' : '↺ Refresh'),
      ),

      // Error
      error && e('div', {
        style: { padding: 16, background: 'rgba(248,113,113,0.1)', border: '1px solid var(--red)', borderRadius: 'var(--radius)', marginBottom: 16, color: 'var(--red)', fontSize: 13 }
      }, `Error: ${error}`),

      // Loading skeleton
      loading && e('div', { style: { color: 'var(--text2)', fontSize: 13, padding: 24, textAlign: 'center' } },
        'Scanning for duplicates…'),

      // Sections
      !loading && !error && e('div', null,
        e(Section, {
          title: 'Same Name', icon: '👤',
          groups: data.name || [],
          onDismiss: handleDismiss,
          onOpenMember: onOpenMember || (() => {}),
          dismissingKey,
        }),
        e(Section, {
          title: 'Same Phone Number', icon: '📞',
          groups: data.phone || [],
          onDismiss: handleDismiss,
          onOpenMember: onOpenMember || (() => {}),
          dismissingKey,
        }),
        e(Section, {
          title: 'Same WeChat ID', icon: '💬',
          groups: data.wechat || [],
          onDismiss: handleDismiss,
          onOpenMember: onOpenMember || (() => {}),
          dismissingKey,
        }),
      ),
    );
  };

  window.MembersDuplicates = MembersDuplicates;
})();
