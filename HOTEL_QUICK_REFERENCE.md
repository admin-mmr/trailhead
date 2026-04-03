# Hotel Quick Reference: Schema Export (No MySQL Needed!)

**Status:** ✅ Ready to use from hotel

---

## 🎯 Problem
You need to review/amend the V11 schema but hotel internet blocks direct MySQL access.

## ✅ Solution
Enhanced schema export endpoint returns full schema (tables + views + triggers) via HTTP.

---

## 🚀 Quick Start (One Command!)

```bash
# Download latest schema structure
curl https://<your-mmr-admin-url>/api/export-schema > db/schema_snapshot.sql

# View in terminal
cat db/schema_snapshot.sql

# Or open in editor
code db/schema_snapshot.sql
vim db/schema_snapshot.sql
nano db/schema_snapshot.sql
```

That's it! No MySQL client needed.

---

## 📋 What You'll Get

A SQL file with:
```
✅ Tables (all 20+ tables with columns, keys, indexes)
✅ Views (v_family_members, v_payment_audit, etc.)
✅ Triggers (if any exist; 3 new ones after V11 migration)
✅ Comments (column reference metadata)
✅ Timestamp (when export was created)
```

---

## 🔍 Quick Checks (From Hotel)

### Check 1: See submissions table columns
```bash
grep -A 40 "CREATE TABLE.*submissions" db/schema_snapshot.sql | head -50
```

### Check 2: Do views exist?
```bash
grep "CREATE VIEW" db/schema_snapshot.sql
# Count them:
grep -c "CREATE VIEW" db/schema_snapshot.sql
```

### Check 3: Are there triggers?
```bash
grep "CREATE TRIGGER" db/schema_snapshot.sql
```

### Check 4: Quick column reference
```bash
grep -A 10 "COLUMN REFERENCE" db/schema_snapshot.sql
```

---

## 📝 Workflow

```
1. Download schema from hotel
   ↓
2. Review submissions table (old vs new columns)
   ↓
3. Plan amendments (what needs to change)
   ↓
4. Return to office
   ↓
5. Run MIGRATION_V11_TRIGGERS_AND_RENAME.sql on staging
   ↓
6. Re-download schema
   ↓
7. Verify changes → commit
```

---

## 🔄 After Migration (Verify Changes)

**Before running migration:**
```bash
curl https://<url>/api/export-schema > before.sql
grep "EventID\|EventType" before.sql | head -5
# Should show old column names
```

**After migration:**
```bash
curl https://<url>/api/export-schema > after.sql
grep "SubmissionID\|SubmissionType" after.sql | head -5
# Should show new column names
```

---

## 🛠️ File Statistics

```bash
# How big is the schema?
curl https://<url>/api/export-schema | wc -l
# Typically 100-200 lines

# How many tables?
curl https://<url>/api/export-schema | grep -c "CREATE TABLE"

# How many views?
curl https://<url>/api/export-schema | grep -c "CREATE VIEW"

# How many triggers?
curl https://<url>/api/export-schema | grep -c "CREATE TRIGGER"
```

---

## 💾 Save Multiple Versions (Audit Trail)

```bash
# Version 1: Before migration
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
curl https://<url>/api/export-schema > "db/schema_v11_before_${TIMESTAMP}.sql"

# ... Run migration ...

# Version 2: After migration
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
curl https://<url>/api/export-schema > "db/schema_v11_after_${TIMESTAMP}.sql"

# Compare
diff db/schema_v11_before_*.sql db/schema_v11_after_*.sql | head -20
```

---

## 🌐 Browser Option (No Terminal Needed!)

If you prefer GUI:
1. Open browser: `https://<your-mmr-admin-url>/api/export-schema`
2. File downloads as `schema_snapshot.sql`
3. Open in text editor
4. Search for table names / column names

---

## 📧 Example Scenario

**You:** "I need to verify the submissions table has the new columns"
**Hotel workflow:**
```bash
# 1. Download
curl https://mmr-admin.azurewebsites.net/api/export-schema > schema.sql

# 2. Check
grep -A 30 "CREATE TABLE.*submissions" schema.sql

# 3. Look for column names:
# Should show: SubmissionID, SubmissionType, SubmittedAt, ApprovedAt, etc.
# If you still see: EventID, EventType, Timestamp → migration hasn't run yet
```

---

## ✋ Important Notes

**⚠️ Endpoint has no authentication** (returns schema structure, not data)
- Keep it private
- After done, optionally delete `mmr-admin/api_schema.py`

**💾 Schema file is read-only**
- Downloaded schema shows current state
- You review it locally; don't upload it
- Actual changes happen via MIGRATION_V11_TRIGGERS_AND_RENAME.sql (run on server)

---

## 🔧 Troubleshooting

### "Connection timed out"
**Problem:** Can't reach the endpoint
**Solution:**
- Check URL is correct: `https://<your-mmr-admin-url>/api/export-schema`
- Verify Azure web app is running
- Try in browser first to test connectivity

### "403 Forbidden"
**Problem:** Azure network restrictions
**Solution:**
- Endpoint may be blocked on hotel WiFi
- Try mobile hotspot or VPN

### "Empty file or just headers"
**Problem:** Schema download started but didn't complete
**Solution:**
- Try again: `curl https://<url>/api/export-schema > schema.sql`
- Check file size: `ls -lh schema.sql`
- Should be 50+ KB

---

## 📚 Full Documentation

For deep dives, see:
- `SCHEMA_EXPORT_GUIDE.md` — Detailed usage guide
- `SCHEMA_EXPORT_ENHANCEMENT.md` — Technical details
- `SCHEMA_EXPORT_CHANGES_SUMMARY.md` — Code changes explained

---

## ✅ Pre-Hotel Checklist

- [ ] Endpoint deployed to Azure ✅
- [ ] Can reach: `https://<your-mmr-admin-url>/api/export-schema` (test in browser)
- [ ] Download works: `curl ... > schema.sql`
- [ ] File has content: `wc -l schema.sql` (should be 100+ lines)
- [ ] Bookmark the guides (above)

---

**Ready?** → `curl https://<your-mmr-admin-url>/api/export-schema > schema.sql` and review from your hotel! 🏨

No MySQL access needed. No tools to install. Just curl + text editor. ✨
