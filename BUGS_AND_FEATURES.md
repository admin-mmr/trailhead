# 🐛 Bugs & 🚀 Features Tracker

**Purpose**: Quick reference for known issues and planned features
**Updated**: March 22, 2026
**Status**: Use GitHub Issues as source of truth; this is a quick summary

---

## 🔴 Critical Bugs (Block Production)

### 1. **Email Client Initialization Failure** (March 22, 2026)
- **Issue**: Forgot password API fails with "Cannot read properties of undefined (reading 'match')"
- **Status**: Unresolved
- **Impact**: Users cannot reset their passwords, blocking access to the portal
- **Error Details**:
http://localhost:3000/auth/forgot-password
page.tsx:17 
 POST http://localhost:3000/api/auth/forgot-password 500 (Internal Server Error)
handleSubmit	@	page.tsx:17

Server
 ✓ Compiled /api/auth/forgot-password in 688ms (779 modules)
[POST /api/auth/forgot-password] TypeError: Cannot read properties of undefined (reading 'match')
    at tryParseConnectionString (webpack-internal:///(rsc)/./node_modules/@azure/communication-common/dist/esm/credential/connectionString.js:12:21)
    at parseConnectionString (webpack-internal:///(rsc)/./node_modules/@azure/communication-common/dist/esm/credential/connectionString.js:26:36)
    at parseClientArguments (webpack-internal:///(rsc)/./node_modules/@azure/communication-common/dist/esm/credential/clientArguments.js:46:123)
    at new EmailClient (webpack-internal:///(rsc)/./node_modules/@azure/communication-email/dist/esm/emailClient.js:27:118)
    at getEmailClient (webpack-internal:///(rsc)/./lib/email/client.ts:17:18)
    at sendEmail (webpack-internal:///(rsc)/./lib/email/client.ts:22:25)
    at POST (webpack-internal:///(rsc)/./app/api/auth/forgot-password/route.ts:54:75)
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
    at async /Users/cathylin/github/mmr/trailhead/web-apps/mmr-webapp/node_modules/next/dist/compiled/next-server/app-route.runtime.dev.js:6:55038
    at async ek.execute (/Users/cathylin/github/mmr/trailhead/web-apps/mmr-webapp/node_modules/next/dist/compiled/next-server/app-route.runtime.dev.js:6:45808)
    at async ek.handle (/Users/cathylin/github/mmr/trailhead/web-apps/mmr-webapp/node_modules/next/dist/compiled/next-server/app-route.runtime.dev.js:6:56292)
    at async doRender (/Users/cathylin/github/mmr/trailhead/web-apps/mmr-webapp/node_modules/next/dist/server/base-server.js:1377:42)
    at async cacheEntry.responseCache.get.routeKind (/Users/cathylin/github/mmr/trailhead/web-apps/mmr-webapp/node_modules/next/dist/server/base-server.js:1599:28)
    at async DevServer.renderToResponseWithComponentsImpl (/Users/cathylin/github/mmr/trailhead/web-apps/mmr-webapp/node_modules/next/dist/server/base-server.js:1507:28)
    at async DevServer.renderPageComponent (/Users/cathylin/github/mmr/trailhead/web-apps/mmr-webapp/node_modules/next/dist/server/base-server.js:1931:24)
    at async DevServer.renderToResponseImpl (/Users/cathylin/github/mmr/trailhead/web-apps/mmr-webapp/node_modules/next/dist/server/base-server.js:1969:32)
    at async DevServer.pipeImpl (/Users/cathylin/github/mmr/trailhead/web-apps/mmr-webapp/node_modules/next/dist/server/base-server.js:920:25)
    at async NextNodeServer.handleCatchallRenderRequest (/Users/cathylin/github/mmr/trailhead/web-apps/mmr-webapp/node_modules/next/dist/server/next-server.js:272:17)
    at async DevServer.handleRequestImpl (/Users/cathylin/github/mmr/trailhead/web-apps/mmr-webapp/node_modules/next/dist/server/base-server.js:816:17)
    at async /Users/cathylin/github/mmr/trailhead/web-apps/mmr-webapp/node_modules/next/dist/server/dev/next-dev-server.js:339:20
    at async Span.traceAsyncFn (/Users/cathylin/github/mmr/trailhead/web-apps/mmr-webapp/node_modules/next/dist/trace/trace.js:154:20)
    at async DevServer.handleRequest (/Users/cathylin/github/mmr/trailhead/web-apps/mmr-webapp/node_modules/next/dist/server/dev/next-dev-server.js:336:24)
    at async invokeRender (/Users/cathylin/github/mmr/trailhead/web-apps/mmr-webapp/node_modules/next/dist/server/lib/router-server.js:174:21)
    at async handleRequest (/Users/cathylin/github/mmr/trailhead/web-apps/mmr-webapp/node_modules/next/dist/server/lib/router-server.js:353:24)
    at async requestHandlerImpl (/Users/cathylin/github/mmr/trailhead/web-apps/mmr-webapp/node_modules/next/dist/server/lib/router-server.js:377:13)
    at async Server.requestListener (/Users/cathylin/github/mmr/trailhead/web-apps/mmr-webapp/node_modules/next/dist/server/lib/start-server.js:141:13)
 POST /api/auth/forgot-password 500 in 2128ms

### 2. **Inactive Member's MemberID Not Displaying** (March 22, 2026)

http://localhost:3000/membership/inactive?from=%2Fportal&status=not+active
here we should display their basic member info: Name, MemberID, email. 

### 3. **renew page missing member info** (March 22, 2026)
-  ** Issue**: renew page now has the same Info page as join. But we already have info in members table. use that for existing members. 

### 4. **Apple, Miicrosoft, Facebook, Yahoo login not working** (March 22, 2026)
- **Issue**: Forgot to add client IDs and secrets for these providers in .env.local, so they fail to initialize. Add placeholders for now to avoid breaking the entire login page.
 GET /api/auth/signin?callbackUrl=%2Fauth%2Fcomplete 302 in 6ms
 GET /login?callbackUrl=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcomplete 200 in 31ms
 GET /.well-known/appspecific/com.chrome.devtools.json 404 in 45ms
 GET /api/auth/providers 200 in 33ms
 GET /api/auth/signin?callbackUrl=%2Fauth%2Fcomplete 302 in 14ms
 GET /login?callbackUrl=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcomplete 200 in 41ms
 GET /.well-known/appspecific/com.chrome.devtools.json 404 in 69ms
 GET /api/auth/providers 200 in 13ms
 GET /api/auth/signin?callbackUrl=%2Fauth%2Fcomplete 302 in 7ms
 GET /login?callbackUrl=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcomplete 200 in 27ms
 GET /.well-known/appspecific/com.chrome.devtools.json 404 in 51ms


### 5. **logout not working** (March 22, 2026)
- **Issue**: Logout button on portal page does not log the user out. 

### 6. **no member account icon shown indicating login status** (March 22, 2026)
- **Issue**: We should show a member icon in the top right corner when logged in, and show the login button when not logged in. Currently we always show the login button, which is confusing.

### 7. **expired member should still able to show profile and status as logined in** (March 22, 2026)
- **Issue**: If a member's status is "expired", they should still be able to log in and see their profile page, but with a message that their membership has expired and a prompt to renew. Currently, expired members are treated as "not active" and cannot log in at all, which is not ideal for user experience.

We need to block inactive member from most of the portal features. where can we draw the line? For example, they should still be able to log in, see their profile page, but with a message that their membership has expired and a prompt to renew. They can submit their renewal application, but they cannot access other features like photos, etc until they renew. They can submit payment proof. They can register for events and pay the non-member price, but they cannot access member-only events.

---

## 🟡 Known Issues (Low Priority)
### 1. **existing email to set up password in our system for the first time** (March 22, 2026)
- **Issue**: our system is new. add instruction for people using their existing email to create a password to enter our new portal. It is differnt from "Join us" because we have their MemberID, and other fields in members table. We just need them to set up a password for the first time.


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

### Phase 2: Upcoming
- [ ] **Bi-directional Sync** — MySQL updates back to Google Sheets
- [ ] **Member Authentication** — OAuth login for portal
- [ ] **Photo Pipeline** — Integration with Face API + OCR
- [ ] **Activity Logging** — Track member actions in audit trail
- [ ] **Admin Dashboard** — View sync status and health

### Phase 3: Future
- [ ] Payment processing integration
- [ ] Email digest/newsletters
- [ ] Mobile app companion
- [ ] Advanced reporting & analytics
- [ ] Backup/disaster recovery automation

---

## 📋 Current Sprint Items

(Track active work here)

### Sprint 25 (Current)
- [ ] Implement Azure staging slots (this session)
- [ ] Test full 4-table sync
- [ ] Enable scheduled GitHub Actions
- [ ] Monitor first week of production runs

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

### March 22, 2026 Session
| Issue | Severity | Status | Details |
|-------|----------|--------|---------|
| Snapshot not stored | Critical | ✅ Fixed | JSON stored in MySQL instead of Azure blob |
| NOT NULL validation | High | ✅ Fixed | Pre-insert validation added; rows skipped gracefully |
| ENUM validation | High | ✅ Fixed | Generic validator added; Source changed to VARCHAR |
| Date parsing | High | ✅ Fixed | 15+ formats + dateutil fallback implemented |
| Key field mapping | High | ✅ Fixed | Corrected TransactionID → MessageId |
| Keychain credential loading | Medium | ✅ Fixed | Use `-s` flag instead of `-l` |

**Impact**: All 4 data syncs now working (323 gmail_transactions, 97 payments, 104 events, 617 members)

---

## Backlog

### High Priority (Next Sprint)
- [ ] Full 4-table sync verification
- [ ] Enable scheduled GitHub Actions
- [ ] Create sync monitoring dashboard
- [ ] Document data validation rules

### Medium Priority (Next Month)
- [ ] Slack integration for alerts
- [ ] Row-level audit logging
- [ ] Retry logic for transient failures
- [ ] Database backup automation

### Low Priority (Q2 2026)
- [ ] Advanced filtering in member portal
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
When syncing gmail_transactions with empty TimeStamp, sync crashes with:
ERROR 1364 (HY000): Field 'TimeStamp' doesn't have a default value

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
3. Document in session summary (e.g., `SESSION_SUMMARY_MARCH22_2026.md`)

---

## Metrics

| Metric | Current | Goal |
|--------|---------|------|
| **Sync Success Rate** | ~99% (323/323 transactions) | 99.9% |
| **Data Freshness** | 6-hourly via GitHub Actions | Real-time (future) |
| **Mean Time to Recovery** | 30 min (manual intervention) | 5 min (auto-retry) |
| **Known Bugs** | 0 critical | 0 |

---

## Release Notes

### v1.0.0 (March 22, 2026) — Production Ready
✅ **Initial Release**
- Google Sheets → MySQL sync for 4 data sources
- Snapshot-based change detection
- Comprehensive date/datetime parsing (15+ formats)
- NOT NULL and ENUM validation
- GitHub Actions automation
- Email failure notifications

**Status**: Fully operational, ready for 24/7 automation

---

## Questions / Decisions Needed

- [ ] Should we set up separate databases for staging vs production? (Currently shared)
- [ ] What's the max acceptable sync latency? (Currently 6 hours)
- [ ] Should we implement automatic rollback on sync failure?
- [ ] Do we need member-facing notifications for updates?

---

## Links to Related Docs

- `SYNC_PIPELINE_COMPLETION.md` — Full sync system details
- `SESSION_SUMMARY_MARCH22_2026.md` — This session's achievements
- `PROJECT_PLAN.md` — Long-term roadmap
- `TROUBLESHOOTING_CHECKLIST.md` — Common issues & fixes

---

**Last Updated**: March 22, 2026
**Owner**: Development Team
**Review Cadence**: Weekly (add new bugs/features as discovered)
