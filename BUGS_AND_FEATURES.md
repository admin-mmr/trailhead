# 🐛 Bugs & 🚀 Features Tracker

**Purpose**: Quick reference for known issues and planned features
**Updated**: March 23, 2026
**Status**: Use GitHub Issues as source of truth; this is a quick summary

---

## 🔴 Critical Bugs (Block Production)

*None currently open. All critical bugs resolved as of March 23, 2026.*

---

## 🟡 Known Issues (Low Priority / Open)

- [ ] Pre-commit hook runs `npm run build` which can time out in Claude's VM — use `npx tsc --noEmit` for quick type checks instead
- [ ] `__tests__/lib/translations.test.ts` and `__tests__/lib/email-templates.test.ts` have stale references to removed OTP translation keys (`auth.send`, `auth.verify`, `auth.resend`) — pre-existing, does not affect the app build

---

## 🟢 Small Improvements (Nice to Have)

- [ ] Add Slack notifications for sync failures (currently email only)
- [ ] Add row-level audit logging to sync_changes table
- [ ] Create monitoring dashboard for sync health
- [ ] Implement retry logic for transient database failures
- [ ] Add data validation warnings to sync logs (e.g., common bad formats)

---

## 🚀 Planned Features

### Phase 1: Complete ✅ (March 22, 2026)
- [x] Google Sheets → MySQL sync
- [x] Snapshot-based change detection
- [x] Error handling & logging
- [x] GitHub Actions automation
- [x] Email failure notifications

### Phase 2: Complete ✅ (March 23, 2026)
- [x] Member authentication (NextAuth v5 — Google, Microsoft OAuth + email/password)
- [x] Member portal with active/expired/pending/inactive status handling
- [x] FAQ page for member self-service
- [x] First-time password setup flow for existing members
- [x] Forgot/reset password flow

### Phase 3: Upcoming
- [ ] **Photo Pipeline** — Integration with Face API + OCR
- [ ] **Admin Dashboard** — View sync status, member management
- [ ] **Bi-directional Sync** — MySQL updates back to Google Sheets
- [ ] **Activity Logging** — Track member actions in audit trail

### Phase 4: Future
- [ ] Payment processing integration (auto-verify Zelle/Venmo)
- [ ] Email digest/newsletters
- [ ] Mobile app companion
- [ ] Advanced reporting & analytics
- [ ] Backup/disaster recovery automation

---

## 📋 Current Sprint Items

### Sprint 26 (Next)
- [ ] End-to-end auth test: Google OAuth → /portal
- [ ] End-to-end auth test: email+password → /portal
- [ ] Run migration v9 on production DB (`mmr_migration_v9_social_auth.sql`)
- [ ] Deploy webapp to Azure production
- [ ] Monitor first week of member logins

---

## 🔧 Where to Track Issues

### Official Source of Truth
**GitHub Issues**: `https://github.com/admin-mmr/trailhead/issues`

Use GitHub Issues for:
- Bug reports with reproducible steps
- Feature requests with detailed requirements
- Tasks assigned to team members
- Long-term tracking with milestones

**Template**:
```markdown
## Bug Report: [Title]
**Severity**: Critical / High / Low
**Component**: webapp / sync / photos / etc

**Steps to Reproduce**:
1. ...
2. ...

**Expected**:
**Actual**:

**Environment**: Production / Staging / Local
```

### This File (Quick Summary)
This `BUGS_AND_FEATURES.md` is a **high-level summary** for:
- Quick reference without going to GitHub
- Onboarding new team members
- Status updates in meetings
- Documenting recently fixed items

---

## Recent Fixes Summary

### March 23, 2026 Session
| Issue | Severity | Status | Details |
|-------|----------|--------|---------|
| Homepage iframe (official website) shows blank | Low | ✅ Fixed | Removed iframe; replaced with plain link button |

### March 22–23, 2026 Session (Session 2 — Portal UX)
| Issue | Severity | Status | Details |
|-------|----------|--------|---------|
| Footer text hard to read; founding year wrong | Medium | ✅ Fixed | Contrast raised; year corrected to 2015 |
| Portal contact email not set | Low | ✅ Fixed | Set to `web@mmrunners.org` |
| No FAQ page for member portal | Medium | ✅ Fixed | `/faq` page created (9 items, bilingual) |
| No first-time password setup flow | High | ✅ Fixed | `/auth/setup-password` page added; linked from login |
| Stale contact emails sitewide | Medium | ✅ Fixed | Audited all files; updated to `admin@` / `web@mmrunners.org` |
| Active member showing "Pending" in portal | Critical | ✅ Fixed | Google Sheets syncs `'Active'` (capital A); normalized `.toLowerCase()` in `rowToMember` |
| `/membership/inactive` showed wrong contact email | Medium | ✅ Fixed | Updated to `admin@mmrunners.org` |

### March 22, 2026 Session (Session 1 — Auth & Portal)
| Issue | Severity | Status | Details |
|-------|----------|--------|---------|
| Logout button not working | Critical | ✅ Fixed | Redirect used hardcoded `localhost`; fixed to derive origin from `req.url` |
| Inactive page showed no member info | High | ✅ Fixed | Fetches `/api/members/me` on mount; shows name, email, MemberID |
| Renew page re-asked for existing member info | Medium | ✅ Fixed | Pre-fills form from `/api/members/me` for logged-in members |
| Navbar always shows login button | Medium | ✅ Fixed | Shows `UserCircle` + first name when logged in |
| Expired members locked out entirely | High | ✅ Fixed | Expired members can log in, see profile + renewal prompt; blocked from active-only routes |

### March 22, 2026 Session (Sync & Data)
| Issue | Severity | Status | Details |
|-------|----------|--------|---------|
| Snapshot not stored | Critical | ✅ Fixed | JSON stored in MySQL instead of Azure blob |
| NOT NULL validation | High | ✅ Fixed | Pre-insert validation added; rows skipped gracefully |
| ENUM validation | High | ✅ Fixed | Generic validator added; Source changed to VARCHAR |
| Date parsing | High | ✅ Fixed | 15+ formats + dateutil fallback implemented |
| Key field mapping | High | ✅ Fixed | Corrected TransactionID → MessageId |
| Keychain credential loading | Medium | ✅ Fixed | Use `-s` flag instead of `-l` |

**Sync impact**: All 4 data syncs working (323 gmail_transactions, 97 payments, 104 events, 617 members)

---

## Backlog

### High Priority (Next Sprint)
- [ ] End-to-end auth testing in production
- [ ] Run DB migration v9 on production
- [ ] Deploy to Azure and monitor

### Medium Priority (Next Month)
- [ ] Slack integration for alerts
- [ ] Row-level audit logging
- [ ] Retry logic for transient failures
- [ ] Database backup automation

### Low Priority (Q2 2026)
- [ ] Admin dashboard for sync/member management
- [ ] Export to CSV/Excel
- [ ] Custom email templates
- [ ] API rate limiting

---

## How to Report a Bug

### In GitHub Issues
```
Title: [BUG] Sync fails with empty TimeStamp

Labels: bug, high-priority, sync
Assignee: @cathylin

Description:
When syncing gmail_transactions with empty TimeStamp, sync crashes.

Steps:
1. Create sheet row with empty TimeStamp
2. Run sync
3. See error

Expected: Row should be skipped with warning
Actual: Sync crashes
```

### In This File (Updates)
1. Move item from "Known Issues" → "Fixed" with date
2. Add to "Recent Fixes Summary"

---

## Metrics

| Metric | Current | Goal |
|--------|---------|------|
| **Sync Success Rate** | ~99% (323/323 transactions) | 99.9% |
| **Data Freshness** | 6-hourly via GitHub Actions | Real-time (future) |
| **Mean Time to Recovery** | 30 min (manual intervention) | 5 min (auto-retry) |
| **Known Critical Bugs** | 0 | 0 |

---

## Release Notes

### v1.1.0 (March 23, 2026) — Member Portal Launch
✅ **Portal UX & Auth Complete**
- NextAuth.js v5: Google + Microsoft OAuth + email/password login
- Member status tiers: active / expired / pending / inactive
- Expired member grace access: profile view + renewal prompt
- FAQ page (`/faq`) — 9 bilingual items
- First-time password setup flow (`/auth/setup-password`)
- Logout fixed; navbar shows member icon when logged in
- All contact emails audited and corrected
- Google Sheets status case mismatch fixed (`Active` → `active`)

### v1.0.0 (March 22, 2026) — Production Ready (Sync)
✅ **Initial Release**
- Google Sheets → MySQL sync for 4 data sources
- Snapshot-based change detection
- Comprehensive date/datetime parsing (15+ formats)
- NOT NULL and ENUM validation
- GitHub Actions automation
- Email failure notifications

---

## Questions / Decisions Needed

- [ ] Should we set up separate databases for staging vs production? (Currently shared)
- [ ] What's the max acceptable sync latency? (Currently 6 hours)
- [ ] Should we implement automatic rollback on sync failure?
- [ ] Do we need member-facing notifications for profile/status updates?

---

## Links to Related Docs

- `DOCUMENTATION_INDEX.md` — Architecture, key files, session log
- `SYNC_PIPELINE_COMPLETION.md` — Full sync system details
- `PROJECT_PLAN.md` — Long-term roadmap

---

**Last Updated**: March 23, 2026
**Owner**: Development Team
**Review Cadence**: Weekly (add new bugs/features as discovered)
