# MMR Admin Sync Tab — Complete Implementation

**Status:** ✅ Framework complete and committed
**Latest commit:** `731b4a6` (GAS integration guide)

---

## 📋 What Was Built

### Three Sync Operations

1. **MySQL → Google** (Members, Events, Payments)
   - Smart versioning: append new records, update if MySQL is newer
   - Detailed logs and email reports

2. **Import Transactions from Google**
   - Fetch gmail_transactions from Sheets
   - Insert new MessageIds, update Notes if Memo differs

3. **Google → MySQL (Dry Run)**
   - Compare Sheets ↔ MySQL
   - Display differences (no changes made)

### Plus: Bug Fix
- ✅ Fixed `payment_actions.py`: write to Notes instead of Source (3 locations)

---

## 📁 Key Files

| File | Purpose | Size |
|------|---------|------|
| `mmr-admin/api_sheets_sync.py` | Backend endpoints (5 endpoints, async jobs) | 20KB |
| `mmr-admin/templates/index.html` | SyncPanel UI (3 tabs, real-time polling) | +150 lines |
| `mmr-admin/app.py` | Blueprint registration | +2 lines |
| `SYNC_IMPLEMENTATION.md` | Feature specification & GAS plan | Reference |
| `mmr-admin/SYNC_TAB_ARCHITECTURE.md` | API specs, data flows, response formats | Reference |
| `SYNC_TAB_NEXT_STEPS.md` | Step-by-step GAS integration guide | Quick start |

---

## 🚀 Quick Reference

### Access the Sync Tab
```
Admin Portal → Sync tab (top navigation)
```

### Three Subtabs

**1. MySQL → Google**
- Click: "Sync Members" / "Sync Events" / "Sync Payments"
- Displays real-time progress with logs

**2. Import Transactions**
- Click: "Import Now"
- Fetches and syncs gmail_transactions

**3. Google → MySQL (Dry Run)**
- Click: "Start Dry-Run"
- Shows differences without making changes

---

## 🔧 Backend API

### Endpoints (all POST except status)

```bash
POST /api/sync/mysql-to-google/members     → {job_id}
POST /api/sync/mysql-to-google/events      → {job_id}
POST /api/sync/mysql-to-google/payments    → {job_id}
POST /api/sync/import-transactions         → {job_id}
POST /api/sync/dry-run                     → {job_id}
GET  /api/sync/status/<job_id>             → {status, message, progress, result}
```

### Job Response Format

```json
{
  "ok": true,
  "data": {
    "status": "done|error|running",
    "message": "Human readable status",
    "progress": 100,
    "result": {
      "operation": "members_to_sheets",
      "inserted": 10,
      "updated": 5,
      "log": "Detailed sync log here..."
    }
  }
}
```

---

## 📊 Data Flow

```
Admin clicks "Sync Members"
    ↓
POST /api/sync/mysql-to-google/members
    ↓ Returns {job_id: "sync_12345..."}
    ↓
Frontend polls /api/sync/status/{job_id} every 1 second
    ↓
Backend worker thread:
  1. Fetch all members from MySQL
  2. Call GAS webhook (TODO) to get Sheets data
  3. Compare by MemberID with versioning logic
  4. Call GAS webhook to append/update Sheets
  5. Collect logs and send email report
    ↓
UI shows progress bar, final status, logs
```

---

## 🎯 Current Status

### ✅ Complete
- Framework architecture
- All 5 endpoints wired
- SyncPanel UI with 3 subtabs
- Real-time job polling
- Email report infrastructure
- Bug fixes (gmail_transactions)
- Full documentation + guides

### ⏳ Pending (GAS Integration)
- Webhook calls to fetch Sheets data
- Webhook calls to push updates to Sheets
- Actual sync logic (append/update/compare)

---

## 🔗 Next Steps

See **`SYNC_TAB_NEXT_STEPS.md`** for:
- Step 1: Implement `_call_gas_webhook()` helper
- Steps 2-5: Replace TODOs with GAS integration code
- GAS webhook actions checklist (10 actions)
- Testing checklist

**Estimated effort:** 2-4 hours to integrate GAS webhooks

---

## 📚 Documentation

| Document | Content |
|----------|---------|
| **SYNC_IMPLEMENTATION.md** | Full feature spec, database schema, testing checklist |
| **SYNC_TAB_ARCHITECTURE.md** | Visual diagrams, API specs, response formats, threading model |
| **SYNC_TAB_NEXT_STEPS.md** | Code snippets, GAS checklist, copy-paste ready |
| **This file** | Quick reference |

---

## 🐛 Bug Fixes Applied

**File:** `mmr-admin/payment_actions.py`

| Before | After | Impact |
|--------|-------|--------|
| `Source = 'AutoMatch'` | `Notes = 'AutoMatch'` | ✅ Fixed auto-approve tracking |
| `Source = 'Manual'` | `Notes = 'Manual'` | ✅ Fixed manual approve tracking |
| `Source = 'Admin-Created'` | `Notes = 'Admin-Created'` | ✅ Fixed admin create tracking |

---

## 🔐 Security & Access

- **Access:** Admin-only (checked in UI and endpoints)
- **Async:** Non-blocking background jobs (daemon threads)
- **Thread-safe:** Job tracking uses locks
- **Error handling:** Graceful degradation (email fails but sync continues)

---

## 📧 Email Reports

**Sent to:** `admin@mmrunners.org`
**Subject:** `MMR Sync Report: {operation}`
**Content:**
- Summary line (e.g., "✅ Synced 150 members, 0 errors")
- Details (row-by-row list of changes, up to 50 rows)
- Full log (complete operation log)

---

## 🚢 Deployment

1. ✅ Code is committed and ready
2. ⏳ Requires GAS webhook integration (see NEXT_STEPS.md)
3. Requires `SheetsWebhookUrl` in MySQL `config` table
4. No new dependencies (uses existing `requests`, Flask)

---

## 📞 Support

For questions about:
- **Architecture:** See `SYNC_TAB_ARCHITECTURE.md`
- **Implementation:** See `SYNC_IMPLEMENTATION.md`
- **GAS Integration:** See `SYNC_TAB_NEXT_STEPS.md`
- **Bug fixes:** See `payment_actions.py` line 199-204, 404-409, 498-503

---

**Framework Status:** ✅ Ready for GAS integration
**Last Updated:** 2026-03-31 02:23 UTC
**Commits:** 5 (984b0aa → 731b4a6)
