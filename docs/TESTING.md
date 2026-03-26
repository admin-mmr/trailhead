# Testing Guide

**Status**: ✅ Current
**Last Updated**: March 26, 2026
**Owner**: Development Team
**Purpose**: Comprehensive testing strategy and test case inventory
**Audience**: QA engineers, developers, DevOps

---

## Quick Summary

The project uses a **multi-layer testing approach** across Python, TypeScript/JavaScript, and end-to-end testing:

- **Unit tests** in each component (GAS scripts, web app, basecamp)
- **Integration tests** for sync pipelines and data flows
- **Manual testing** for UI workflows (login, payment, renewal)
- **Schema validation** for database migrations

---

## Table of Contents

1. [Test Suites by Component](#test-suites-by-component)
2. [Running Tests Locally](#running-tests-locally)
3. [Test Cases & Manual Testing](#test-cases--manual-testing)
4. [Continuous Integration (GitHub Actions)](#continuous-integration-github-actions)
5. [Test Coverage Goals](#test-coverage-goals)
6. [Adding New Tests](#adding-new-tests)

---

## Test Suites by Component

### Web App (Next.js / TypeScript)

**Location**: `web-apps/mmr-webapp/__tests__/`

#### Unit Tests

| File | Coverage | Last Updated |
|------|----------|--------------|
| `lib/auth-password.test.ts` | Password hashing/verification (bcryptjs) | 2026-03-22 |
| `lib/email-templates.test.ts` | Bilingual email template rendering | 2026-03-22 |
| `lib/access.test.ts` | Route access control (member/public/active tiers) | 2026-03-22 |
| `lib/translations.test.ts` | EN/ZH translation key validation | 2026-03-22 |

**Run**:
```bash
cd web-apps/mmr-webapp
npm test                          # Run all tests
npm test -- --watch              # Watch mode
npm test -- --coverage           # Coverage report
```

**Example Output**:
```
 PASS  __tests__/lib/auth-password.test.ts
 PASS  __tests__/lib/email-templates.test.ts
 PASS  __tests__/lib/access.test.ts
 PASS  __tests__/lib/translations.test.ts

Test Suites: 4 passed, 4 total
Tests:       30 passed, 30 total
```

---

### GAS Scripts (Google Apps Script / TypeScript)

**Location**: `web-apps/gas/membership/tests/`

#### Unit Tests

| File | Coverage | Last Updated |
|------|----------|--------------|
| `auth.test.ts` | OTP, email/password, social login | 2026-03-22 |
| `members.test.ts` | Member CRUD, status transitions | 2026-03-22 |
| `sheets.test.ts` | Google Sheets operations, column mapping | 2026-03-22 |
| `email.test.ts` | Email templates, bilingual support | 2026-03-22 |
| `family.test.ts` | Family grouping logic | 2026-03-22 |
| `jobs.test.ts` | Background job scheduling | 2026-03-22 |
| `admin.test.ts` | Admin operations, access control | 2026-03-22 |
| `payment-proof.test.ts` | Payment proof screenshot handling | 2026-03-22 |
| `upgrade.test.ts` | Member upgrade/renewal workflows | 2026-03-22 |
| `otp.test.ts` | OTP generation, validation (deprecated in v9) | 2026-03-22 |

**Run**:
```bash
cd web-apps/gas/membership
npm test                          # Run all tests
npm test -- --watch              # Watch mode
npm test auth.test.ts             # Single file
```

**Build Check**:
```bash
cd web-apps/gas/membership
npm run build
# Validates TypeScript, bundles to dist/
```

---

### Photo Manager (Python)

**Location**: `photo-manager/src/`

#### Unit Tests

| File | Coverage | Last Updated |
|------|----------|--------------|
| `test_azure.py` | Azure Face API, Computer Vision integration | 2026-03-20 |

**Run**:
```bash
cd photo-manager
python -m pytest src/test_azure.py -v
# or
python -m pytest                 # Run all tests
python -m pytest -k "face"       # Run tests matching "face"
```

---

### Basecamp (Python Sync & Utilities)

**Location**: `basecamp/ops/`, `basecamp/python/`

#### Python Module Testing

No formal test suite yet, but component testing via manual scripts:

**Schema Inspector**:
```bash
cd basecamp/ops
python schema_inspector.py
# Validates: table names, column types, foreign keys, indexes
```

**Sync Scripts**:
```bash
# Member sync (test with --dry-run)
python sync_sheets_to_mysql.py \
  --sheet "Active" \
  --table "members" \
  --spreadsheet-id "$SHEET_ID" \
  --key-field "MemberID" \
  --dry-run

# NYRR sync (dry-run not supported yet, use test mode)
python ops/sync_nyrr_events.py --mode daily --batch-size 1
```

---

## Running Tests Locally

### Prerequisites

**Web App**:
```bash
cd web-apps/mmr-webapp
npm install
```

**GAS Scripts**:
```bash
cd web-apps/gas/membership
npm install
```

**Photo Manager**:
```bash
cd photo-manager
pip install -r requirements.txt
pip install pytest  # if not already installed
```

**Basecamp**:
```bash
cd basecamp
pip install -r requirements.txt
```

### Full Test Suite (All Components)

```bash
# 1. Web App
cd web-apps/mmr-webapp && npm test

# 2. GAS Scripts
cd web-apps/gas/membership && npm test

# 3. Photo Manager
cd photo-manager && python -m pytest src/ -v

# 4. Web App Build Check
cd web-apps/mmr-webapp && npm run build

# 5. GAS Build Check
cd web-apps/gas/membership && npm run build
```

---

## Test Cases & Manual Testing

### Authentication (Web App)

#### Case 1: Email + Password Login

**Steps**:
1. Go to `http://localhost:3000/login`
2. Enter email and password (must have `password_hash` set in DB)
3. Click "Sign In"

**Expected**:
- Redirects to `/portal`
- Navbar shows member name + avatar icon
- `/api/members/me` returns member profile

**Status**: ✅ Tested 2026-03-22

**Setup** (if needed):
```bash
cd web-apps/mmr-webapp
node -e "const b=require('bcryptjs'); b.hash('TestPassword123!', 12).then(h => console.log(h))"
# Copy output, then:
mysql-mmr -e "UPDATE members SET password_hash='<hash>' WHERE Email='test@example.com';"
```

---

#### Case 2: Google OAuth

**Steps**:
1. Go to `http://localhost:3000/login`
2. Click "Continue with Google"
3. Sign in with Google test account
4. Consent to permissions

**Expected**:
- Redirects to `/portal`
- Session created with `provider='google'`
- Member record linked to Google account

**Status**: 🟡 Scaffolded, needs local testing

**Notes**:
- Requires `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env.local`
- OAuth callback: `/auth/complete`

---

#### Case 3: Microsoft/EntraID OAuth

**Steps**:
1. Go to `http://localhost:3000/login`
2. Click "Continue with Microsoft"
3. Sign in with Microsoft test account
4. Consent to permissions

**Expected**:
- Redirects to `/portal`
- Session created with `provider='microsoft'`
- Member record linked to Microsoft account

**Status**: 🟡 Scaffolded, needs local testing

---

#### Case 4: Forgot Password

**Steps**:
1. Go to `http://localhost:3000/auth/forgot-password`
2. Enter email address
3. Click "Send Reset Link"
4. Check email for reset token
5. Click link in email
6. Enter new password
7. Click "Reset Password"

**Expected**:
- Token email sent within 1 minute
- Token valid for 24 hours
- Redirects to `/login` after reset
- New password works on next login

**Status**: ✅ Tested 2026-03-22

---

#### Case 5: First-Time Password Setup

**Steps**:
1. Go to `http://localhost:3000/auth/setup-password`
2. Enter email address
3. Click "Send Setup Link"
4. Check email for token
5. Click link
6. Set password
7. Redirects to `/login`
8. Log in with new password

**Expected**:
- Same flow as forgot-password but different UI copy
- Email says "Complete Your Setup" instead of "Reset Your Password"
- No previous password required

**Status**: ✅ Tested 2026-03-22

---

### Portal (Member)

#### Case 1: View Member Profile (Active)

**Precondition**: Logged in as active member

**Steps**:
1. Go to `/portal/profile`
2. Verify name, email, MemberID, status displayed
3. Verify "Renew Membership" button visible

**Expected**:
- Profile loads in <1 second
- All fields visible
- Button links to `/membership/join`

**Status**: ✅ Tested 2026-03-22

---

#### Case 2: Expired Member Grace Access

**Precondition**: Member with `ExpiresAt` < today logged in

**Steps**:
1. Log in as expired member
2. Redirected to `/portal/profile` with amber banner
3. Click "Renew Now"

**Expected**:
- Banner says "Your membership has expired"
- Can access `/portal/profile` (grace access)
- Trying `/portal/photos` redirects to `/membership/inactive`
- "Renew Now" button links to `/membership/join?renew=true`

**Status**: ✅ Tested 2026-03-22

---

#### Case 3: Pending Member Inactive Page

**Precondition**: Member with `Status='Pending'` logged in

**Steps**:
1. Log in
2. Redirected to `/membership/inactive`

**Expected**:
- Shows message: "Your membership is pending approval"
- Shows member info (MemberID, email)
- Shows expected approval timeline
- No access to `/portal`

**Status**: ✅ Tested 2026-03-22

---

### Payment & Renewal

#### Case 1: Submit Payment Proof

**Steps**:
1. Go to `/portal/profile`
2. Click "Renew Membership" or "Add Payment Proof"
3. Upload Zelle/Venmo screenshot
4. Click "Submit Proof"

**Expected**:
- File uploaded to Azure Blob Storage
- Row created in `webapp_events` with `status='pending'`
- Email sent to `admin@mmrunners.org` with proof link
- Member sees "Proof submitted" message

**Status**: ✅ Tested 2026-03-22

---

#### Case 2: Admin Approves Payment

**Manual** (admin in GAS Scripts or MySQL):
```bash
mysql-mmr -e "UPDATE webapp_events SET status='approved' WHERE EventID='...' AND Status='pending';"
```

**Expected**:
- Member's status changes to 'Active'
- Member receives "Payment Approved" email
- Next login shows member in active state

**Status**: ✅ Tested 2026-03-22

---

### Data Sync (GitHub Actions)

#### Case 1: Members Sync (Every 6 Hours)

**Workflow**: `.github/workflows/sync-all-sheets-ordered.yml`

**Trigger**: Manual via GitHub Actions UI

**Expected Output**:
```
✓ Members in MySQL: 150
✓ Member status distribution: Active=120, Inactive=20, Pending=10
```

**Status**: ✅ Running in production

---

#### Case 2: NYRR Events Sync (Daily at 4 AM UTC)

**Workflow**: `.github/workflows/sync-nyrr-recurring.yml`

**Trigger**: Automatic daily 4 AM UTC (or manual)

**Expected Output**:
```
✓ NYRR Events in MySQL: 250
✓ NYRR Event Runners in MySQL: 8500
✓ Total runners: 8500 | Matched: 7200 | Unmatched MMR: 1300
✓ Remaining pending events: 5
```

**Status**: ✅ Implemented Phase 2 (2026-03-26)

---

#### Case 3: NYRR Weekly Full Sync (Sunday 2 AM UTC)

**Workflow**: `.github/workflows/sync-nyrr-weekly.yml`

**Trigger**: Automatic Sunday 2 AM UTC (or manual)

**Expected Output**:
```
✓ NYRR Events in MySQL: 250
✓ Events with runners: 100
✓ MMR match rate: 84.5%
```

**Status**: ✅ Implemented Phase 2 (2026-03-26)

---

## Continuous Integration (GitHub Actions)

All workflows defined in `.github/workflows/`:

| Workflow | Trigger | Status | Last Run |
|----------|---------|--------|----------|
| `sync-members-recurring.yml` | Every 6 hours + manual | ✅ Running | 2026-03-26 |
| `sync-nyrr-recurring.yml` | Daily 4 AM UTC + manual | ✅ Active | 2026-03-26 |
| `sync-nyrr-weekly.yml` | Sunday 2 AM UTC + manual | ✅ Active | 2026-03-26 |

**View Recent Runs**:
```bash
gh run list --repo trailhead --workflow sync-all-sheets-ordered.yml --limit 5
gh run view <run_id> --log
```

---

## Test Coverage Goals

### Current Status (March 2026)

| Component | Unit Tests | Integration | E2E | Coverage |
|-----------|-----------|------------|-----|----------|
| **Web App** | 4 suites | Manual | Manual | ~40% |
| **GAS Scripts** | 10 suites | Manual | Manual | ~60% |
| **Photo Manager** | 1 suite (Azure) | No | No | ~20% |
| **Basecamp** | None | Manual scripts | No | ~10% |

### Goals (By Q2 2026)

- [ ] Web app unit tests: **80%+ coverage**
- [ ] GAS scripts: **Maintain 60%+**
- [ ] Photo manager: **Add 50%+ coverage** (Azure Face, CV pipeline)
- [ ] Basecamp: **Add 40%+ coverage** (sync scripts, schema validation)
- [ ] E2E tests: **10+ critical user flows** (login, payment, renewal)

---

## Adding New Tests

### TypeScript/JavaScript (Jest)

1. Create file: `__tests__/lib/my-feature.test.ts`

```typescript
import { myFunction } from '@/lib/my-feature';

describe('myFunction', () => {
  test('should return true for valid input', () => {
    expect(myFunction('valid')).toBe(true);
  });

  test('should throw for invalid input', () => {
    expect(() => myFunction('invalid')).toThrow();
  });
});
```

2. Run: `npm test`

### Python (pytest)

1. Create file: `src/test_my_feature.py`

```python
from my_module import my_function

def test_returns_true_for_valid():
    assert my_function('valid') == True

def test_raises_for_invalid():
    with pytest.raises(ValueError):
        my_function('invalid')
```

2. Run: `python -m pytest src/test_my_feature.py`

---

## Related Documentation

- [`web-apps/mmr-webapp/DEVELOPMENT.md`](../web-apps/mmr-webapp/DEVELOPMENT.md) — Web app development setup
- [`basecamp/TEST_INDIVIDUAL_COMPONENTS.md`](../basecamp/TEST_INDIVIDUAL_COMPONENTS.md) — Component testing scripts
- [`docs/TROUBLESHOOTING.md`](TROUBLESHOOTING.md) — Common test failures
- [`docs/GITHUB_ACTIONS.md`](GITHUB_ACTIONS.md) — CI/CD setup and debugging

---

**Questions?** Check the test files directly in each component's directory.

*Last Updated: March 26, 2026*
*Maintained by: Development Team*
