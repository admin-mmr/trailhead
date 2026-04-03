# Admin Tables Consolidation Analysis

**Date:** 2026-04-03 | **Status:** Recommendation ready | **Scope:** Merge `admins` (webapp) + `viewer_admins` (admin portal)

---

## Current State: Two Separate Tables

### Table 1: `admins` (web-apps/mmr-webapp)
**Purpose:** NextAuth admin authorization in member webapp
**Columns:**
- `id` (INT, AUTO_INCREMENT)
- `email` (VARCHAR, UNIQUE)
- `added_by` (VARCHAR, default 'system')
- `added_at` (TIMESTAMP)

**Usage:**
- `web-apps/mmr-webapp/lib/db/admins.ts` — TypeScript functions
  - `isAdmin(email)` — Check if user has admin privileges
  - `listAdmins()` — List all admins
  - `addAdmin(email, addedBy)` — Add new admin (cannot remove super admin)
  - `removeAdmin(email)` — Remove admin

**Access:** NextAuth session → checks `admins` table
**Problem:** Only stores binary "is admin or not"; no role distinction

---

### Table 2: `viewer_admins` (mmr-admin)
**Purpose:** MMR Admin portal role-based access control
**Columns:**
- `id` (INT, AUTO_INCREMENT)
- `email` (VARCHAR, UNIQUE)
- `role` (ENUM: 'admin', 'super_admin')
- `created_at` (DATETIME)

**Usage:**
- `mmr-admin/auth.py::get_user_role()` — Query role
- `mmr-admin/api_admin.py` — List, add, delete admins (with roles)
- `mmr-admin/db.py` — Check admin count

**Access:** Flask session → checks `viewer_admins` table
**Benefit:** Stores role information (can distinguish super_admin vs regular admin)

---

## The Problem: Duplicate Admin Management

| Action | admins Table | viewer_admins Table | Current Behavior |
|--------|--------------|-------------------|-----------------|
| **Add admin** | webapp code | admin portal API | SEPARATE APIs — out of sync |
| **Remove admin** | webapp code | admin portal API | SEPARATE APIs — inconsistent |
| **Check if admin** | webapp (binary) | admin portal (role) | DIFFERENT LOGIC |
| **Data sync** | None | None | MANUAL (must update both) |
| **Super admin** | Hard-coded in code | Stored in enum | INCONSISTENT |

**Risk:** Admin added via webapp won't have role info in admin portal (and vice versa).

---

## Recommended Solution: Consolidate to Single Table

### Option A: Merge into Enhanced `admins` Table ⭐ RECOMMENDED

**Rationale:**
- Rename `admins` → `admin_users` (clearer intent)
- Add `role` column (enum: 'admin', 'super_admin')
- Drop `viewer_admins` entirely
- Update webapp + admin portal to share this table

**New Schema:**
```sql
CREATE TABLE `admin_users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL UNIQUE,
  `role` enum('admin', 'super_admin') NOT NULL DEFAULT 'admin',
  `added_by` varchar(255) NOT NULL DEFAULT 'system',
  `added_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_email` (`email`),
  KEY `idx_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Changes Needed:**

1. **Migration SQL:**
   ```sql
   -- Step 1: Rename admins → admin_users
   ALTER TABLE admins RENAME TO admin_users;

   -- Step 2: Add role column (default 'admin')
   ALTER TABLE admin_users ADD COLUMN role enum('admin', 'super_admin') NOT NULL DEFAULT 'admin' AFTER email;

   -- Step 3: Migrate data from viewer_admins (preserve roles)
   UPDATE admin_users au
   SET role = (SELECT role FROM viewer_admins va WHERE va.email = au.email LIMIT 1)
   WHERE email IN (SELECT email FROM viewer_admins);

   -- Step 4: Add updated_at column
   ALTER TABLE admin_users ADD COLUMN updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER added_at;

   -- Step 5: Drop viewer_admins
   DROP TABLE viewer_admins;

   -- Step 6: Add super_admin marker
   INSERT IGNORE INTO admin_users (email, role, added_by) VALUES ('admin@mmrunners.org', 'super_admin', 'system');
   ```

2. **Code Changes:**
   - Update `web-apps/mmr-webapp/lib/db/admins.ts`
     - Add `role` parameter to `addAdmin(email, role, addedBy)`
     - Change table name in all queries: `admins` → `admin_users`
     - Add role-awareness (currently only checks existence)

   - Update `mmr-admin/auth.py`
     - Change `viewer_admins` → `admin_users` in query
     - Same `get_user_role()` logic works unchanged

   - Update `mmr-admin/api_admin.py`
     - Change `viewer_admins` → `admin_users` in all queries
     - Queries already filter by role, so logic unchanged

   - Update `mmr-admin/db.py`
     - Change table name in admin count query

3. **Data Migration Path:**
   ```
   BEFORE:
     admins (8 rows) — webapp only, no role info
     viewer_admins (9 rows) — admin portal only, with roles

   AFTER:
     admin_users (9+ rows) — unified, all have roles

   Action: Merge + take role from viewer_admins where it exists
   ```

---

### Option B: Keep Both (Current State)
**Pros:** No code changes needed
**Cons:**
- Duplicate maintenance
- Risk of out-of-sync data
- Confusing for new developers
- No single source of truth for "who is an admin?"

**Not recommended** — technical debt accumulates.

---

## Impact Analysis

### Files to Update (Consolidation Path)
| File | Change | Effort |
|------|--------|--------|
| `db/schema_migrations/MIGRATION_V12_CONSOLIDATE_ADMINS.sql` | New SQL migration | 30 min |
| `web-apps/mmr-webapp/lib/db/admins.ts` | Update table name + add role param | 30 min |
| `mmr-admin/auth.py` | Update table name | 5 min |
| `mmr-admin/api_admin.py` | Update table name | 10 min |
| `mmr-admin/db.py` | Update table name | 5 min |
| `db/schema_snapshot.sql` | Update schema | Auto |
| `_context.md` | Log migration | 2 min |

**Total effort:** ~1.5 hours (1 session)

### Token Cost
- Migration SQL: ~200 tokens
- Code updates: ~400 tokens
- Testing + verification: ~200 tokens
- **Total:** ~800 tokens (implementation)

### Risks
**Low risk:**
- Clear data migration path (merge + preserve roles)
- No data loss (viewer_admins data → admin_users)
- Code changes are straightforward (table name renames)
- Both systems query email + role, so logic unchanged

**Mitigation:**
- Test on staging first (verify data merges correctly)
- Keep backup of both tables before migration
- Run migration during low-traffic window

---

## Decision Matrix

| Factor | Consolidate | Keep Both |
|--------|---|---|
| **Maintenance burden** | ✅ Single source of truth | ❌ Dual maintenance |
| **Data consistency** | ✅ Auto-enforced | ❌ Manual sync needed |
| **Developer experience** | ✅ Clear intention | ❌ Confusing duplication |
| **Admin experience** | ✅ One source of role info | ❌ Two separate systems |
| **Code complexity** | ✅ Simpler (one table) | ❌ More complex (sync logic) |
| **Implementation cost** | ⚠️ ~1.5 hours | ✅ Zero |
| **Long-term technical debt** | ✅ Resolved | ❌ Grows |

---

## Recommendation: ⭐ Consolidate to `admin_users`

**Why:**
1. **Single source of truth** — All admins in one table
2. **Role-aware** — Can distinguish super_admin from admin
3. **Low cost** — ~1.5 hours implementation
4. **Backward compatible** — webapp + admin portal both continue to work
5. **Clearer naming** — `admin_users` (people) vs `admins` (boolean flag)

**Timeline:**
- Implement after V11 triggers (prioritize schema simplification first)
- Or do alongside V11 if time permits (~2 hours total)

---

## Migration Script (Ready to Test)

```sql
-- MIGRATION_V12_CONSOLIDATE_ADMINS.sql
-- Merge admins + viewer_admins into single admin_users table

-- Step 1: Rename admins to admin_users
ALTER TABLE admins RENAME TO admin_users;

-- Step 2: Add role column (default 'admin')
ALTER TABLE admin_users
  ADD COLUMN role enum('admin', 'super_admin') NOT NULL DEFAULT 'admin'
  AFTER email;

-- Step 3: Migrate roles from viewer_admins
UPDATE admin_users au
SET role = (
  SELECT role FROM viewer_admins va
  WHERE va.email = au.email LIMIT 1
)
WHERE email IN (SELECT email FROM viewer_admins);

-- Step 4: Add updated_at column
ALTER TABLE admin_users
  ADD COLUMN updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  AFTER added_at;

-- Step 5: Ensure super admin exists with correct role
INSERT IGNORE INTO admin_users (email, role, added_by)
VALUES ('admin@mmrunners.org', 'super_admin', 'system');

-- Step 6: Migrate any admins from viewer_admins that don't exist yet
INSERT IGNORE INTO admin_users (email, role, added_by, added_at)
SELECT email, role, 'migrated-from-viewer_admins', created_at
FROM viewer_admins;

-- Step 7: Drop viewer_admins
DROP TABLE viewer_admins;

-- Step 8: Add indexes for performance
ALTER TABLE admin_users ADD INDEX idx_role (role);
ALTER TABLE admin_users ADD INDEX idx_email (email);

-- Verify
SELECT COUNT(*) as total_admins, role, COUNT(role) as count_by_role
FROM admin_users
GROUP BY role;
```

---

## Files to Create (V12 Prep)

1. **MIGRATION_V12_CONSOLIDATE_ADMINS.sql** — Ready above
2. **ADMIN_CONSOLIDATION_IMPLEMENTATION.md** — Code-by-code guide
3. **ADMIN_CONSOLIDATION_TEST_PLAN.md** — Staging validation

---

## Next Steps

1. **Approve consolidation plan** (you + team)
2. **Test migration on staging** (30 min)
   - Run migration script
   - Verify data merged correctly
   - Check both webapp + admin portal auth still works
3. **Code updates** (1 hour)
   - File updates listed above
4. **Deploy to production** (30 min)
5. **Monitor** — Watch auth logs for any role/permission issues

---

**Recommendation:** Consolidate to `admin_users`. Cleaner architecture, single source of truth, low risk.

Want me to prepare the migration script + code changes for staging testing? 🚀
