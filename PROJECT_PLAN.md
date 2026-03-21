# MMR Trailhead — Project Plan 2026

High-level roadmap for upcoming features and infrastructure improvements.

---

## ✅ Completed: Member Schema Migration (March 2026)

### Scope
Member schema refactored to remove unused NYRRMemberID and add NYRR runner identification fields.

### Changes Deployed
- **Members Table**:
  - ❌ DROP: `NYRRMemberID` column (no longer tracked in Google Sheets canonical header)
  - ✅ ADD: `NYRRRunnerName VARCHAR(100)` — member-provided name for NYRR bib lookup
  - ✅ ADD: `YearBorn SMALLINT` — birth year for age disambiguation when names collide

- **TypeScript Types** (`types/index.ts`):
  - Removed `nyrrId` field from Member interface
  - Added `nyrrRunnerName: string`
  - Added `yearBorn: number`

- **Database Functions** (`lib/db/members.ts`):
  - Updated `rowToMember()` mapping
  - Updated `findOrCreateMember()` and `updateMemberProfile()` params
  - Added auto-update for NYRR fields during member creation

- **Google Sheets Sync** (`basecamp/ops/sync_sheets_to_mysql.py`):
  - 🐛 **Bug #1**: Fixed MemberID generation — changed from `UUID()` to stored procedure `CALL generate_member_id()`
  - 🐛 **Bug #2**: Fixed snapshot comparison — now loads blob data for proper "added" vs "existing" detection
  - 🐛 **Bug #3**: Fixed sync_metadata initialization — changed to `INSERT...ON DUPLICATE KEY UPDATE`
  - ✨ Expanded column_mapping with full canonical header (26 fields)
  - ✨ Added `YearBorn` int coercion for type safety

- **API Routes Updated**:
  - `app/api/payments/submit/route.ts` — replaced `nyrrId` with `nyrrRunnerName`
  - `app/api/admin/sync-status/route.ts` — fixed type casting for db.execute results

- **Performance**:
  - Replaced 7 native `<img>` elements with Next.js `<Image />` component across 5 files
  - Eliminated all ESLint warnings (0 warnings goal achieved)

### Verification
✅ `npm run typecheck` — 0 errors
✅ `npm run lint` — 0 warnings
✅ `npm run build` — successful

### Commits
- `eeccd71` — schema: remove NYRRMemberID, add NYRRRunnerName + YearBorn
- `2a03d61` — fix: 'use client' directive placement and ESLint suppression

---

## Epic 1: Bi-directional Data Sync (Google Sheets ↔ MySQL)

**Status**: In Progress (Foundation Complete)
**Priority**: High
**Reason**: Currently Google Sheets is SSOT, but we need MySQL as SSOT to support multiple auth methods and real-time member portal.

### Problem Statement

- **Web-apps** and **GAS** both write to Google Sheets independently
- **Photo-manager** reads from Google Sheets via GAS
- **MySQL** is the long-term SSOT but is out of sync with Google Sheets
- No audit trail of which system made changes
- Manual sync required; no automated detection of changes

### Solution Design

```
Google Sheets (temporary SSOT during migration)
    ↓ [version check + modified timestamp]
Azure Blob Storage (snapshot)
    ↓ [detect new/changed rows]
MySQL (eventual SSOT)
    ↓ [activity log]
Azure Blob Storage (audit trail)
    ↓ [sync back]
Google Sheets (keep in sync)
```

### Phase 1: Remote Version Check & Snapshot

#### 1.1 Detect Google Sheets Changes

**Task**: Add version/modified-time check to `basecamp/python/google_workspace.py`

```python
class GoogleSheetsClient:
    def get_sheet_metadata(self, spreadsheet_id):
        """Get modified time and revision ID"""
        file = self.drive_service.files().get(
            fileId=spreadsheet_id,
            fields='modifiedTime,revisions'
        ).execute()
        return {
            'modified_time': file['modifiedTime'],
            'revision_id': file.get('revisions', [{}])[-1].get('id'),
        }

    def has_changed_since(self, spreadsheet_id, last_check_time):
        """Check if sheet was modified after last_check_time"""
        metadata = self.get_sheet_metadata(spreadsheet_id)
        return datetime.fromisoformat(metadata['modified_time']) > last_check_time
```

**Acceptance**: Function successfully retrieves modified time from Google Drive API.

#### 1.2 Snapshot to Azure Blob Storage

**Task**: Create `basecamp/python/sync_snapshot.py`

```python
from azure.storage.blob import BlobServiceClient
from basecamp.python.google_workspace import GoogleSheetsClient
import json
from datetime import datetime

class SnapshotManager:
    def snapshot_sheet(self, spreadsheet_id, sheet_name):
        """
        1. Read Google Sheets data
        2. Compare hash to previous snapshot
        3. Upload to Azure Blob if changed
        4. Record timestamp
        """
        sheets_client = GoogleSheetsClient()
        data = sheets_client.get_sheet_data(spreadsheet_id, sheet_name)

        blob_client = BlobServiceClient.from_connection_string(
            os.environ['AZURE_STORAGE_CONNECTION_STRING']
        )

        snapshot = {
            'timestamp': datetime.utcnow().isoformat(),
            'spreadsheet_id': spreadsheet_id,
            'sheet_name': sheet_name,
            'data': data,
            'hash': hashlib.sha256(json.dumps(data).encode()).hexdigest()
        }

        # Upload to blob
        blob_name = f'snapshots/{sheet_name}/{snapshot["timestamp"]}.json'
        container_client = blob_client.get_container_client('mmr-snapshots')
        container_client.upload_blob(blob_name, json.dumps(snapshot))

        return snapshot

    def detect_changes(self, previous_snapshot, current_snapshot):
        """Compare two snapshots, return added/modified rows"""
        prev_rows = {row['email']: row for row in previous_snapshot['data']}
        curr_rows = {row['email']: row for row in current_snapshot['data']}

        added = [row for email, row in curr_rows.items() if email not in prev_rows]
        modified = [
            (prev_rows[email], curr_rows[email])
            for email in curr_rows
            if email in prev_rows and prev_rows[email] != curr_rows[email]
        ]
        deleted = [row for email, row in prev_rows.items() if email not in curr_rows]

        return {'added': added, 'modified': modified, 'deleted': deleted}
```

**Acceptance**: Snapshots are created in blob storage with timestamps and can detect row changes.

#### 1.3 Nightly Sync Job (GitHub Actions)

**Task**: Create `.github/workflows/sync-sheets-to-mysql.yml`

```yaml
name: Nightly Google Sheets → MySQL Sync

on:
  schedule:
    - cron: '0 2 * * *'  # 2 AM UTC daily

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      - name: Install dependencies
        run: pip install -r basecamp/requirements.txt
      - name: Run sync
        env:
          GOOGLE_APPLICATION_CREDENTIALS: ${{ secrets.GOOGLE_SERVICE_ACCOUNT }}
          AZURE_STORAGE_CONNECTION_STRING: ${{ secrets.AZURE_STORAGE_CONNECTION_STRING }}
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: python basecamp/ops/sync_sheets_to_mysql.py
```

**Acceptance**: Job runs nightly, creates snapshots, and syncs changes to MySQL.

### Phase 2: Activity Log & Bi-directional Sync

#### 2.1 MySQL Activity Log Table

**Task**: Create migration `basecamp/migrations/0004_activity_log.sql`

```sql
CREATE TABLE activity_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    entity_type ENUM('member', 'photo', 'payment', 'race') NOT NULL,
    entity_id INT NOT NULL,
    action ENUM('created', 'updated', 'deleted') NOT NULL,
    changed_fields JSON,  -- {field: {old: value, new: value}}
    source ENUM('google_sheets', 'web_app', 'photo_manager', 'system') NOT NULL,
    user_id INT,          -- NULL if system or GAS
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY (entity_type, entity_id, timestamp)
);
```

**Acceptance**: Table created and activity logging works for all write operations.

#### 2.2 Sync Changes Back to Google Sheets

**Task**: Create `basecamp/python/sync_mysql_to_sheets.py`

```python
class ReverseSync:
    def sync_mysql_to_sheets(self):
        """
        Check activity_log for changes that originated in web-app or photo-manager
        (source != 'google_sheets') and update corresponding Google Sheets cells.
        """
        db = get_db()
        cursor = db.cursor()

        # Get unsynced changes
        cursor.execute("""
            SELECT entity_type, entity_id, changed_fields, source
            FROM activity_log
            WHERE source IN ('web_app', 'photo_manager', 'system')
            AND synced_to_sheets = FALSE
            ORDER BY timestamp ASC
        """)

        for entity_type, entity_id, changes, source in cursor.fetchall():
            if entity_type == 'member':
                member = get_member_by_id(entity_id)
                # Update corresponding row in Google Sheets
                self.update_sheet_member(member, changes)
                # Mark as synced
                cursor.execute(
                    "UPDATE activity_log SET synced_to_sheets = TRUE WHERE id = %s",
                    (entity_id,)
                )

        db.commit()
```

**Acceptance**: Changes made in the web app are reflected in Google Sheets within 1 hour.

#### 2.3 View MySQL Activity Log

**Task**: Create `/api/admin/activity-log` endpoint

```typescript
// web-apps/mmr-webapp/app/api/admin/activity-log/route.ts
export async function GET(req: NextRequest) {
  // Only admins can view
  const user = await getSession()
  if (user?.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '100')
  const entity = req.nextUrl.searchParams.get('entity')

  const query = `
    SELECT * FROM activity_log
    WHERE entity_type = ? OR ? IS NULL
    ORDER BY timestamp DESC
    LIMIT ?
  `

  const logs = await db.execute(query, [entity, entity, limit])
  return NextResponse.json(logs)
}
```

Create admin UI: `web-apps/mmr-webapp/app/admin/activity-log/page.tsx`

**Acceptance**: Admins can view activity log filtered by entity type, with ability to see what changed, when, and by whom.

---

## Epic 2: Multi-Provider Authentication (OAuth + Password)

**Status**: Planning
**Priority**: High
**Reason**: Current auth is email OTP only. Need to support social login (Google, Facebook, Microsoft, Apple) with OTP as fallback.

### Authentication Flow

```
Member visits /join
    ↓
Choose: Google | Facebook | Microsoft | Apple | Email (password)
    ↓
[OAuth provider] OR [Email/Password registration]
    ↓
Create account in MySQL (linked to provider)
    ↓
Issue JWT + set session cookie
    ↓
Redirect to /portal
```

### Phase 1: Google OAuth (Most Important)

#### 1.1 Set Up Google OAuth Credentials

**Task**: Configure in Google Cloud Console

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Project: `MMR`
3. **APIs & Services → Credentials**
4. Create **OAuth 2.0 Client ID** (Web application)
   - Authorized redirect URIs:
     - `http://localhost:3000/api/auth/callback/google`
     - `https://www.mmrunners.org/api/auth/callback/google`
5. Copy Client ID and Client Secret to GitHub Secrets:
   - `GOOGLE_OAUTH_CLIENT_ID`
   - `GOOGLE_OAUTH_CLIENT_SECRET`

**Acceptance**: OAuth credentials created and stored in GitHub Secrets.

#### 1.2 Add OAuth Columns to MySQL

**Task**: Migration `basecamp/migrations/0005_oauth_providers.sql`

```sql
ALTER TABLE members ADD COLUMN (
    google_oauth_id VARCHAR(255) UNIQUE,
    google_oauth_email VARCHAR(255),
    facebook_oauth_id VARCHAR(255) UNIQUE,
    microsoft_oauth_id VARCHAR(255) UNIQUE,
    apple_oauth_id VARCHAR(255) UNIQUE,
    password_hash VARCHAR(255),  -- For email/password auth
    oauth_provider ENUM('google', 'facebook', 'microsoft', 'apple', 'email') DEFAULT 'email',
    oauth_linked_at TIMESTAMP
);

CREATE INDEX idx_oauth_ids ON members(
    google_oauth_id, facebook_oauth_id, microsoft_oauth_id, apple_oauth_id
);
```

**Acceptance**: Members table supports multiple OAuth providers.

#### 1.3 Google OAuth Route

**Task**: Create `web-apps/mmr-webapp/app/api/auth/google/route.ts`

```typescript
import { signIn } from 'next-auth/react'
import GoogleProvider from 'next-auth/providers/google'

// Configure next-auth with Google provider
export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      // Check if user exists
      let member = await findMemberByEmail(user.email!)

      if (!member) {
        // Create new member from Google profile
        member = await createNewMember({
          email: user.email!,
          name: user.name!,
          google_oauth_id: profile.sub,
          oauth_provider: 'google',
        })
      } else if (!member.google_oauth_id) {
        // Link existing email-based account to Google
        await db.execute(
          'UPDATE members SET google_oauth_id = ? WHERE id = ?',
          [profile.sub, member.id]
        )
      }

      return true
    },

    async jwt({ token, user, account }) {
      if (user) {
        token.memberId = user.id
        token.status = user.status
      }
      return token
    },
  },
}

export const GET = (req, res) => signIn('google')
```

Update `/login` page to show Google button.

**Acceptance**: Members can sign in with Google account.

#### 1.4 Facebook OAuth (Similar to Google)

**Task**: Add FacebookProvider to next-auth config

**Acceptance**: Members can sign in with Facebook.

#### 1.5 Microsoft OAuth

**Task**: Add AzureADProvider to next-auth config

**Acceptance**: Members can sign in with Microsoft account.

#### 1.6 Apple OAuth

**Task**: Add AppleProvider to next-auth config

**Acceptance**: Members can sign in with Apple ID.

### Phase 2: Email/Password Option

#### 2.1 Password Registration & Reset

**Task**: Create `web-apps/mmr-webapp/app/api/auth/register/route.ts`

```typescript
import bcrypt from 'bcrypt'

export async function POST(req: NextRequest) {
  const { email, password, name } = await req.json()

  // Validate
  if (!email || !password || password.length < 12) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  // Check existing
  const existing = await findMemberByEmail(email)
  if (existing) {
    return NextResponse.json({ error: 'Email already registered' }, { status: 409 })
  }

  // Hash password
  const hash = await bcrypt.hash(password, 12)

  // Create member
  const member = await createNewMember({
    email,
    name,
    password_hash: hash,
    oauth_provider: 'email',
  })

  // Issue JWT
  const token = await issueJWT(member)

  return NextResponse.json({ token }, { status: 201 })
}
```

Create password reset flow using email link.

**Acceptance**: Members can register with email/password and reset forgotten passwords.

### Phase 3: OTP as Fallback

#### 3.1 OTP Route

**Task**: Create `web-apps/mmr-webapp/app/api/auth/otp/route.ts`

```typescript
export async function POST(req: NextRequest) {
  const { email } = await req.json()

  // Generate 6-digit OTP
  const otp = Math.random().toString().slice(2, 8)
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 minutes

  // Store in Redis or DB
  await cache.set(`otp:${email}`, otp, { ttl: 15 * 60 })

  // Send email
  await sendOTPEmail(email, otp)

  return NextResponse.json({ message: 'OTP sent' })
}
```

Update `/login` page: "Can't access your account? Use OTP instead."

**Acceptance**: Members can use OTP as fallback if OAuth fails.

---

## Epic 3: Activity Logging (All Member Actions)

**Status**: Planning
**Priority**: High
**Reason**: Need audit trail for compliance and debugging.

### Loggable Actions

- Member signup/login (which method)
- Profile update (email, address, etc.)
- Photo upload/view/delete
- Payment submitted/confirmed
- Membership renewed
- Access denied (e.g., inactive member trying to access portal)
- Admin actions (modify member, send email, etc.)

### Implementation

#### 3.1 Logging Utility

**Task**: Create `web-apps/mmr-webapp/lib/activity.ts`

```typescript
export async function logActivity(
  entityType: 'member' | 'photo' | 'payment' | 'race',
  entityId: number,
  action: 'created' | 'updated' | 'deleted' | 'accessed' | 'failed',
  details: Record<string, any>,
  userId?: number  // member.id or null if system
) {
  const query = `
    INSERT INTO activity_log
    (entity_type, entity_id, action, changed_fields, source, user_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `

  await db.execute(query, [
    entityType,
    entityId,
    action,
    JSON.stringify(details),
    'web_app',  // or 'photo_manager', 'system'
    userId || null,
  ])
}
```

#### 3.2 Log on Key Routes

**Task**: Add logging to API endpoints

Example: `/api/auth/login`
```typescript
try {
  const member = await authenticateMember(email, password)
  await logActivity('member', member.id, 'accessed', { action: 'login' }, member.id)
  // ... issue token
} catch (err) {
  await logActivity('member', 0, 'failed', { action: 'login_failed', error: err.message })
  // ... return error
}
```

Add to:
- `/api/auth/login` — login attempt
- `/api/auth/register` — signup
- `/api/photos/upload` — photo upload
- `/api/photos/delete` — photo delete
- `/api/payments/submit` — payment
- `/api/members/me` — profile update
- Middleware — access to `/portal/*` routes

**Acceptance**: All member actions logged with user ID, timestamp, and changed fields.

#### 3.3 Admin Activity Dashboard

**Task**: Create `web-apps/mmr-webapp/app/admin/activity/page.tsx`

- Filter by entity type, action, date range
- Search by member email
- Export to CSV
- Real-time log stream (WebSocket)

**Acceptance**: Admins can audit all member activity.

---

## Implementation Timeline

### ✅ March 2026 (COMPLETED)
- **Member Schema Migration**: Remove NYRRMemberID, add NYRRRunnerName + YearBorn
- **Sync Pipeline Fixes**: 3 critical bugs fixed in Google Sheets → MySQL sync
- **Code Quality**: 0 ESLint warnings, 0 TypeScript errors

### Month 1 (April 2026)
- **Week 1-2**: Bi-directional sync (Phase 1) — Snapshot + change detection
  - Schema foundation ready ✅
  - Next: Implement `get_sheet_metadata()` in `google_workspace.py`
  - Next: Create `sync_snapshot.py` with blob storage integration
- **Week 3-4**: Activity logging table + core logging

### Month 2 (May 2026)
- **Week 1-2**: Google OAuth + Email/Password
- **Week 3-4**: Facebook, Microsoft, Apple OAuth + OTP fallback

### Month 3 (June 2026)
- **Week 1-2**: Activity log admin dashboard
- **Week 3-4**: Testing, bug fixes, deployment

---

## Database Schema Changes Summary

```sql
-- Phase 1: Sync
CREATE TABLE activity_log (...)
CREATE TABLE sync_metadata (...)

-- Phase 2: OAuth
ALTER TABLE members ADD COLUMN google_oauth_id VARCHAR(255)
ALTER TABLE members ADD COLUMN facebook_oauth_id VARCHAR(255)
ALTER TABLE members ADD COLUMN microsoft_oauth_id VARCHAR(255)
ALTER TABLE members ADD COLUMN apple_oauth_id VARCHAR(255)
ALTER TABLE members ADD COLUMN password_hash VARCHAR(255)
ALTER TABLE members ADD COLUMN oauth_provider ENUM(...)

-- Phase 3: Activity logging
-- Already covered in Phase 1
```

---

## Dependencies & Tools

### New NPM Packages

```json
{
  "next-auth": "^5.0.0",
  "bcrypt": "^5.1.0",
  "azure-storage-blob": "^12.x"
}
```

### New Python Packages

```
azure-storage-blob>=12.0
google-cloud-drive>=1.0
```

### New GitHub Secrets

```
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
FACEBOOK_OAUTH_CLIENT_ID
FACEBOOK_OAUTH_CLIENT_SECRET
MICROSOFT_OAUTH_CLIENT_ID
MICROSOFT_OAUTH_CLIENT_SECRET
APPLE_OAUTH_CLIENT_ID
APPLE_OAUTH_CLIENT_SECRET
GOOGLE_SERVICE_ACCOUNT (for sync jobs)
```

---

## Risk & Mitigation

| Risk | Mitigation |
|------|-----------|
| OAuth provider outage | Fall back to OTP or password |
| Sync conflicts (same row changed in both) | Last-write-wins; log conflict in activity log |
| Activity log storage growth | Archive old logs to blob storage monthly |
| Oauth token leakage | Use refresh tokens, short expiry, secure storage |

---

## Success Metrics

- [ ] 80% of members use OAuth (vs. OTP/password)
- [ ] Sync lag < 1 hour between Google Sheets and MySQL
- [ ] Zero data loss in sync (verified by checksums)
- [ ] Activity log 100% coverage of member actions
- [ ] < 2% login failures after OAuth enabled

---

## See Also

- [`MONOREPO.md`](MONOREPO.md) — Architecture overview
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — How to deploy changes
- [`basecamp/migrations/`](basecamp/migrations/) — All schema changes
- [`web-apps/mmr-webapp/DEVELOPMENT.md`](web-apps/mmr-webapp/DEVELOPMENT.md) — Local dev setup

---

## License

MIT — see [`LICENSE`](LICENSE)
