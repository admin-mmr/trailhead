# Misty Mountain Runners Membership Web App — Product Requirements Document

_Last updated: 2026-03-02 (rev 3)_

---

## 1. Product Overview & Goals

### 1.1 Objective

Build a membership web application for Misty Mountain Runners that:

- Manages member authentication via email OTP (primary) for all members.
- Displays and updates member profiles and family groupings.
- Handles membership renewals and Individual→Family upgrades paid externally (Zelle, Venmo, PayPal).
- Matches bank/payment emails (from Gmail) to member submissions.
- Maintains clean Payment History for reporting and audit.

The app runs on **Google Apps Script (GAS)** with Google Sheets as the data store, managed via **CLASP** and GitHub.

### 1.2 Scope — Phase 1 (MVP)

In scope:
- Authentication: Email OTP for all members (Gmail and non-Gmail).
- Member self-service: view membership status/expiration, edit profile, submit payment proof.
- Membership payments: Individual Renewal, Family Renewal, and Family Upgrade — all paid externally via Zelle/Venmo/PayPal; member submits proof, admin approves.
- Data integration: Membership Master as source of truth; Fetch-Gmail payment data for reconciliation.
- Logging: detailed activity log for debugging and audit.

Non-goals for MVP:
- Google OAuth login (removed — OTP only for consistency).
- NYRR leaderboard/ranking, training plans, discount codes.
- Event registration beyond membership fees.

---

## 2. Tech Stack & Architecture

### 2.1 Tech Stack

- **Backend**: Google Apps Script (GAS), deployed as a web app.
- **Frontend**: HTML/CSS + vanilla JavaScript, served via `HtmlService`. Multi-template approach (separate HTML per view).
- **Data Store**: Google Sheets:
  - `Membership-Master-Main-3` (existing) as primary member database.
  - New sheets: `WebApp-Events`, `Payment-History`, `Auth-OTP`, `Config`, `WebApp-ActivityLog`.
  - Existing `Fetch-Gmail` sheet for Zelle/Venmo/PayPal payment data.
- **Language & Tooling**:
  - TypeScript with `strict: true`.
  - Build via `tsc` to `dist/` directory.
  - CLASP's `rootDir` points to `dist/` for `clasp push`.
- **Version Control**: GitHub repository, deployed via CLASP.

### 2.2 Architectural Principles

- **Separation of concerns**: backend handles business logic and persistence; frontend calls backend via typed API functions.
- **API contract**: all frontend-to-backend communication uses JSON strings. Every exposed GAS function has signature: `functionName(jsonRequest: string): string`.
- **No magic numbers**: all pricing, timing, and config values read from Config sheet.
- **Multiple small `.ts` files** organized by layer.
- **Existing IDs preserved**: FamilyID (`Bxxx`) and MemberID (`Axxxx`) — no new ID systems.
- **Trust payload email**: `getOrCreateMemberProfile` and all post-auth functions use `payload.email` exclusively. Do NOT use `Session.getActiveUser().getEmail()` after login — GAS may resolve to the script owner's account rather than the accessing user's account.

### 2.3 GAS-Specific Constraints

- All functions exposed to frontend must be in global scope (GAS does not support ES modules at runtime).
- TypeScript compiles to JS files that CLASP pushes. Use a bundler or manual global exports.
- `HtmlService.createHtmlOutputFromFile()` serves each template. Routing via `?page=` query parameter in `doGet(e)`.
- `google.script.run` on the frontend calls server functions. Use `withSuccessHandler` / `withFailureHandler`.

### 2.4 GAS Iframe Navigation (Important)

GAS web apps are served inside a **cross-origin iframe** at `script.googleusercontent.com`. Two constraints:

1. **Relative URLs are wrong**: `window.location.href = '?page=dashboard'` resolves against the inner iframe domain. Always use absolute URLs: `window.top.location.href = appBaseUrl + '?page=dashboard'`.

2. **`window.top` requires user gesture**: The iframe sandbox has `allow-top-navigation-by-user-activation`. Calling `window.top.location.href` from an async callback fails silently. **Solution**: after async auth success, show a "Continue →" button; navigate from the button's click handler.

3. **`appBaseUrl` injection**: `doGet` injects the real GAS URL server-side by replacing the placeholder `__SCRIPT_URL__` with `ScriptApp.getService().getUrl()` before serving each HTML template. URL params are injected as `__URL_PARAMS__` (JSON-serialized `e.parameter`).

### 2.5 Session & Identity Model

- After login, the member object is stored in `sessionStorage` as `member`.
- All post-auth API calls pass `payload.email` (from `sessionStorage`) to identify the caller.
- The backend trusts `payload.email` — it does NOT re-resolve identity via `Session.getActiveUser()` in any function other than the initial `handleGoogleLogin` (if enabled).
- The dashboard calls `getOrCreateMemberProfile` on load to refresh the cached member. If the server returns a different `memberID` than what is in `sessionStorage`, the frontend discards the server response and keeps the cached session (guard against admin-account fallback).

---

## 3. User Roles & Core Flows

### 3.1 Roles

- **Member**: club runner or family member. Can log in, view/update profile, submit membership payments, view status.
- **Admin**: board/operations volunteers. Approve payments, adjust Config, monitor events and activity logs.
- **System**: background/reconciliation scripts that auto-match payments and update history.

### 3.2 Authentication — Email OTP (All Members)

All members authenticate via Email OTP regardless of email domain.
The flow uses a **lookup-first** design: the database is checked before
any OTP is sent, so users with mistyped emails never receive a code.

#### State 1 — Email Entry

1. User enters email address and clicks "Continue →".
2. Frontend calls `lookupEmail(email)`.
3. Backend queries Membership Master by email (case-insensitive).
   - **Found** → go to State 2A (returning member).
   - **Not found** → go to State 2B-ask (new member intent check).

#### State 2A — Returning Member

4. Frontend shows: "Welcome back, [firstName] ([memberID])!"
5. User may already have a valid code in their inbox (valid for
   `OTP_Valid_Hours`). They can:
   - Type an existing code directly, or
   - Click "Send Me a New Code" → frontend calls `requestEmailOtp`.
6. User enters the 6-digit code → frontend calls `verifyEmailOtp`.
7. Backend verifies: Email + OTPCode match, not expired, `Used=FALSE`.
8. On success: mark `Used=TRUE`, update `LastLoginDate`, return
   `{ member, isNewMember: false }`.
   Frontend stores `member` in `sessionStorage`. Shows
   "Continue to Dashboard →" button.
9. On failure: show inline error, stay on State 2A (loop until correct).

#### State 2B-ask — New Member Intent

4. Frontend shows: "No account found for [email]. Are you a new member?"
5. Two choices:
   - **"Yes — Register Me →"**: frontend calls `requestEmailOtp` → OTP
     sent → move to State 2B-verify.
   - **"← No, go back and change email"**: return to State 1,
     clear email field.

#### State 2B-verify — New Member OTP

6. User enters the 6-digit code → frontend calls `verifyEmailOtp`.
7. Backend verifies: Email + OTPCode match, not expired, `Used=FALSE`.
8. On success: mark `Used=TRUE`, return `{ isNewMember: true, email }`
   (do **not** create a member record yet).
   Frontend stores `pending_email` in `sessionStorage`. Shows
   "Continue to Registration →" button.
9. On failure: show inline error, stay on State 2B-verify (loop).
10. "Resend Code" button available → calls `requestEmailOtp` again.

#### OTP Cleanup

A scheduled script deletes `Auth-OTP` rows older than `OTP_Cleanup_Days`
(default 7 days).

**Key design principles:**
- `lookupEmail` returns only `firstName` and `memberID` — never
  expiration, status, payment data, or any sensitive field.
- OTP is never sent to an unrecognized email unless the user explicitly
  confirms they intend to register. This prevents code spam on typos.
- `verifyEmailOtp` never auto-creates member records. Record creation
  only happens when the user explicitly submits the New Member
  registration form (`createNewMember`). This prevents ghost/incomplete
  records.
- After verification, both paths show a "Continue" button rather than
  navigating automatically. This is required because async API callbacks
  lack user activation, and `window.top.location.href` (needed to break
  out of the GAS iframe) requires a user gesture (see §2.4).


### 3.3 Member Profile & Family Flows

#### 3.3.1 MemberID Generation (A0001–A9999)

When creating a new member (email not found in Membership Master):
- Scan all existing `MemberID` values, parse numeric part after `A`.
- Find first unused integer from 1–9999, format as 4 digits (e.g., `A0201`).
- Set `Status = "not active"`, `Type = "Individual"` by default.

#### 3.3.2 FamilyID Generation (B001–B999)

When a member's `Type` changes to `"Family"` and they have no `FamilyID`:
- Scan all existing `FamilyID` values, parse numeric part after `B`.
- Find first unused integer from 1–999, format as 3 digits (e.g., `B036`).
- Store the new `FamilyID` on that member's row.

#### 3.3.3 Profile Retrieval

After authentication:
1. Query Membership Master by email.
2. If found, load: `MemberID`, `Status`, `Expiration`, `Email`, `First Name`, `Last Name`, `Type`, `FamilyID`, `Gender`, `WeChatID`, `District`, `Membership Fee Paid`, `Payment Date`, `Payment Transaction`, `Created`, `JoinYear`, `PhoneNumber`, `LastLoginDate`, `ProfileLastUpdated`.
3. Optionally return family members sharing the same `FamilyID`.
4. If not found: create new row with new `MemberID`, `Status="not active"`, `Type="Individual"`, `JoinYear=current year` (editable). Prompt to complete profile.

#### 3.3.4 Profile Editing

Members can update: `FirstName`, `LastName`, `PhoneNumber`, `WeChatID`, `District`, `JoinYear`, `Type`.

- `Type` is editable (Individual / Family) to support upgrade flows.
- When `Type` changes to `"Family"` and `FamilyID` is blank, system auto-assigns a new `FamilyID` (§3.3.2).
- Backend updates the matching row and sets `ProfileLastUpdated`.

#### 3.3.5 Family Semantics

- `Type="Family"` with a non-blank `FamilyID` means membership applies to all members sharing that `FamilyID`.
- When a Family renewal is approved, `Expiration` is updated for all rows with the same `FamilyID`.
- A Family Upgrade approval changes `Type` to `"Family"` and assigns a `FamilyID` without changing expiration (already active from the underlying Individual membership).

---

## 4. Membership Status & Type Model

### 4.1 Two Independent Dimensions

Every member has exactly two dimensions tracked on their Membership Master row:

| Dimension | Column | Possible Values |
|---|---|---|
| **Membership Type** | `Type` | `Individual` · `Family` |
| **Membership Status** | `Status` | `active` · `expired` · `not active` |

`pending` is **not stored** on the member row. It is **derived at display time** by checking for open `WebApp-Events` rows with `Status = "Pending"` or `"Matched"` for that member. This avoids sync drift between the events log and the master record.

### 4.2 Status Definitions

| Status | Meaning | Written By |
|---|---|---|
| `not active` | Never had a confirmed paid membership. Brand-new or legacy record with no payment history. | New member creation |
| `expired` | Was previously `active`; `Expiration` date is now in the past. | Nightly expiry-check job |
| `active` | Has a confirmed, non-expired membership. | `approveRenewal` after successful payment confirmation |

**Rule**: `Status` on Membership Master is only written by `approveRenewal` (→ `active`) and a scheduled expiry-check job (→ `expired`). It is never set to `pending`.

### 4.3 Payment Intent Types

`WebApp-Events` uses a `PaymentIntent` column (replacing the old `MembershipType` field) to precisely describe what the payment covers:

| `PaymentIntent` | Meaning | Expected Amount | Effect on Approval |
|---|---|---|---|
| `Individual Renewal` | Renewing as individual member | `Individual_Price` ($30) | Set `Type=Individual`, extend `Expiration` for this member |
| `Family Renewal` | Full family membership payment | `Family_Price` ($50) | Set `Type=Family`, assign/use `FamilyID`, extend `Expiration` for all family members |
| `Family Upgrade` | Delta payment to upgrade from Individual→Family | `Family_Upgrade_Price` ($20) | Set `Type=Family`, assign `FamilyID` if blank — do NOT change `Expiration` |

### 4.4 All Status/Type Combinations — Truth Table

| # | Scenario | `Type` (stored) | `Status` (stored) | Open `WebApp-Events`? | Dashboard Display | Available Actions |
|---|---|---|---|---|---|---|
| 1 | Individual, membership expired | `Individual` | `expired` | No | 🔴 Expired · Individual | Renew as Individual; Upgrade to Family |
| 2 | Family, membership expired | `Family` | `expired` | No | 🔴 Expired · Family | Renew as Family |
| 3 | Individual, $30 submitted, not confirmed | `Individual` | `expired` or `not active` | Yes — `Individual Renewal` | 🟡 Payment Pending · Individual Renewal | View submission; contact admin |
| 4 | Family, $50 submitted, not confirmed | `Family` | `expired` or `not active` | Yes — `Family Renewal` | 🟡 Payment Pending · Family Renewal | View submission; contact admin |
| 5 | Upgrading to Family, $30 submitted, not confirmed | `Individual` | `expired` or `not active` | Yes — `Individual Renewal` | 🟡 Payment Pending · Upgrade in progress | View submission |
| 6 | Upgrading to Family, $30 confirmed only ⚠️ | `Individual` | `active` | No | 🟠 Active Individual · Upgrade incomplete | Submit $20 Family Upgrade payment |
| 7 | Upgrading to Family, $20 upgrade submitted, not confirmed | `Individual` | `active` | Yes — `Family Upgrade` | 🟡 Payment Pending · Family Upgrade | View submission |
| 8 | Family, $50 confirmed | `Family` | `active` | No | 🟢 Active · Family | Renew; View family members |
| 9 | Individual, $30 confirmed | `Individual` | `active` | No | 🟢 Active · Individual | Renew; Upgrade to Family |
| 10 | Family, $30 + $20 both confirmed | `Family` | `active` | No | 🟢 Active · Family | Renew; View family members |

> **Case 6 note**: When an individual payment is confirmed but a family upgrade has not yet been submitted, the member is actively Individual. The dashboard shows a prompt to complete the family upgrade by submitting the $20 delta payment.

### 4.5 Dashboard Status Resolution Logic (Frontend)

The dashboard resolves display status in this order:

1. Call getOpenPaymentEvents(memberID) → check WebApp-Events for
Status = "Pending" or "Matched" for this member.
→ If found: show yellow "Payment Pending" badge + PaymentIntent label.
2. Otherwise, use stored member.Status + member.Type:
active   + Individual → green "Active · Individual"
active   + Family     → green "Active · Family"
expired  + Individual → red "Expired · Individual"
expired  + Family     → red "Expired · Family"
not active            → grey "Not Active"
3. Special case — active Individual with no pending upgrade event:
→ Show orange "Upgrade to Family" prompt if member.Type = Individual
and member.Status = active.

## 5. Data Model — Google Sheets

### 5.1 Membership Master (Existing)

Sheet: `Membership-Master-Main-3`

Existing columns: `MemberID` (Axxxx), `Status` (active / not active / expired), `Created`, `Expiration`, `Email`, `First Name`, `Last Name`, `Type` (Individual / Family), `FamilyID` (Bxxx), `Gender`, `WeChatID`, `District`, `WebApp`, `Payment CheckInfo`, `Last Updated`, `Membership Fee Paid`, `Payment Date`, `Payment Transaction`.

New columns (append at end):
- `JoinYear` (string YYYY) — auto-derived from earliest membership year or Created date; member can override.
- `PhoneNumber` (string).
- `LastLoginDate` (datetime).
- `ProfileLastUpdated` (datetime).
- `Notes` (string — admin/system notes).

**Status values** (updated): `active` · `expired` · `not active`.
- `active`: confirmed non-expired membership.
- `expired`: previously active; expiration date has passed.
- `not active`: never had a confirmed payment.

### 5.2 WebApp-Events

Sheet: `WebApp-Events`

Purpose: log of all payment submissions and signup events from the web app.

Columns:
- `EventID` — unique id (`EV-[timestamp]-[random]`).
- `EventType` — `"MembershipRenewal"` or `"MembershipSignup"`.
- `Timestamp` — submission time.
- `MemberID` — submitter's MemberID.
- `Email` — submitter email.
- `PaymentIntent` — **`"Individual Renewal"`**, **`"Family Renewal"`**, or **`"Family Upgrade"`** (replaces old `MembershipType` for submissions).
- `Amount` — numeric.
- `PaymentMethod` — `"Zelle"`, `"Venmo"`, or `"PayPal"`.
- `PayerName` — string.
- `MemoField` — string.
- `Last4Digits` — string (optional).
- `FamilyMemberEmails` — comma-separated (optional).
- `Status` — `"Pending"` · `"Matched"` · `"Approved"` · `"Rejected"` · `"Error"`.
- `MatchedMessageId` — MessageId from Fetch Gmail when matched.
- `MatchedTransactionNumber` — TransactionNumber from Fetch Gmail when matched.
- `AdminApprover` — admin email who approved/rejected.
- `ApprovalDate` — approval timestamp.
- `Notes` — string.

### 5.3 Payment-History

Sheet: `Payment-History`

Purpose: canonical log of all confirmed/processed payments.

Columns:
- `PaymentID` — unique id.
- `EventID` — link to `WebApp-Events.EventID` (if web-driven).
- `MemberID` — primary member.
- `PaymentDate` — date payment was accounted.
- `Amount` — numeric.
- `PaymentIntent` — `"Individual Renewal"` · `"Family Renewal"` · `"Family Upgrade"`.
- `PaymentMethod` — `"Zelle"`, `"Venmo"`, `"PayPal"`, `"Check"`, etc.
- `PayerName` — from bank/submitter.
- `MemoField` — original memo.
- `Last4Digits` — last four of transaction number.
- `TransactionReference` — TransactionNumber from Gmail sheet.
- `PeriodStart` — membership coverage start.
- `PeriodEnd` — membership coverage end.
- `ProcessedBy` — `"System"` or admin email.
- `ProcessedDate` — datetime row was created.
- `Source` — `"WebApp"`, `"Gmail-Auto"`, `"Manual-Admin"`.
- `Notes` — string.

### 5.4 Auth-OTP

Sheet: `Auth-OTP`

Columns: `Email`, `OTPCode`, `CreatedAt`, `ExpiresAt`, `Used` (boolean), `IPAddress` (optional).

Cleanup: scheduled script deletes rows where `CreatedAt` is older than `OTP_Cleanup_Days`.

### 5.5 Config

Sheet: `Config`

Columns: `Key`, `Value`, `Description`.

Keys (exact names as they appear in the sheet):

| Key | Default Value | Description |
|---|---|---|
| `IndividualPrice` | `30` | Price for individual membership |
| `FamilyPrice` | `50` | Price for family membership |
| `FamilyUpgradePrice` | `20` | Delta price to upgrade Individual → Family |
| `PaymentMethods` | `Zelle,Venmo,PayPal` | Comma-separated accepted payment methods |
| `ReminderDaysBefore` | `30` | Days before expiry to send renewal reminder |
| `MembershipRenewalYears` | `1` | Years added per renewal |
| `OTPValidHours` | `24` | Hours before OTP expires |
| `OTPCleanupDays` | `7` | Days before used/expired OTPs are deleted |
| `AdminEmails` | `admin@mmrunners.org` | Comma-separated admin email addresses |
| `AppBaseUrl` | _(set after first deploy)_ | Deployed GAS web app URL |
| `ZelleHandle` | `runningmmr@gmail.com` | Zelle payment handle shown to members |
| `VenmoHandle` | `@MistyMountainRunners` | Venmo payment handle shown to members |
| `PayPalHandle` | `runningmmr@gmail.com` | PayPal payment handle shown to members |
| `ZelleQRCodeFileId` | `1rcOOnmejgV0QH2f3NSDhiHP7wfJYqFKY` | Google Drive file ID for Zelle QR code image |
| `VenmoQRCodeFileId` | `1JNcOT2ZqUI5D3Dyw8o9ZWy8NrLz2UU77` | Google Drive file ID for Venmo QR code image |
| `PaymentProofFolderId` | `1I-FR4iTC8649XBzFSplyG2XARNBHwflz` | Google Drive folder ID where payment proof screenshots are stored |

### 5.6 WebApp-ActivityLog

Sheet: `WebApp-ActivityLog`

Columns: `LogID`, `Timestamp`, `SessionID`, `MemberID`, `Email`, `EventID` (optional), `Action`, `State` (JSON snippet), `ErrorCode` (optional), `ErrorMessage` (optional).

Action codes: `LOGIN_START`, `LOGIN_SUCCESS`,
`EMAIL_LOOKUP` (fired by `lookupEmail` for every email check found or not found. Useful for debugging wrong-email attempts), `EMAIL_LOOKUP_NOT_FOUND` (fired specifically when `lookupEmail` finds no matching row. Distinct from `EMAIL_LOOKUP` to allow easy filtering of unrecognized-email patterns in the activity log),
`OTP_REQUESTED`, `OTP_VERIFY_SUCCESS`, `OTP_VERIFY_FAIL`,
`RENEWAL_FORM_OPEN`, `RENEWAL_SUBMIT`,
`RECONCILE_MATCH_FOUND`, `RENEWAL_APPROVED`, `UPGRADE_APPROVED`,
`ERROR`


### 5.7 Fetch-Gmail (Existing)

Sheet: `Fetch-Gmail-data-in-Google-Spreadsheet-Active-4`

Existing columns: `TimeStamp`, `Sender`, `Amount`, `Memo`, `TransactionDate`, `TransactionNumber`, `MessageId`, `Subject`, `Original Memo`, `Notes`, `Processed`, `Source` (Zelle/Venmo/PayPal).

New column:
- `WebAppEventID` — links each matched payment to `WebApp-Events.EventID`.

---

## 6. API Design & Modules

### 6.1 API Envelope

```ts
interface ApiRequest<TPayload> {
  requestId: string;
  actorEmail?: string;
  payload: TPayload;
}

interface ApiResponseSuccess<TPayload> {
  ok: true;
  requestId: string;
  payload: TPayload;
}

interface ApiResponseError {
  ok: false;
  requestId: string;
  errorCode: string;
  errorMessage: string;
}
```

Frontend helper `callApi(functionName, payload)` wraps in `ApiRequest`, calls `google.script.run`, parses response.

### 6.2 Backend Modules (`src/`)

- **`config.ts`** — spreadsheet ID, sheet names, column indices (enums). Functions: `getConfigMap()`, `getConfigValue(key)`, `setConfigValue(key, value)`.
- **`types.ts`** — all shared interfaces: `Member`, `WebAppEvent`, `PaymentRecord`, `OtpRecord`, `ConfigMap`, `ActivityLogEntry`, `ApiRequest<T>`, `ApiResponseSuccess<T>`, `ApiResponseError`. `Member.status` type: `'active' | 'expired' | 'not active'`. `WebAppEvent.paymentIntent` type: `'Individual Renewal' | 'Family Renewal' | 'Family Upgrade'`.
- **`sheets.ts`** — helpers for reading/writing rows, mapping rows ↔ typed objects.
- **`auth.ts`** — Three exposed functions:
  - `lookupEmail(jsonRequest)`: pre-OTP email lookup. Queries Membership
    Master by email; returns `{ found: true, firstName, memberID }` or
    `{ found: false }`. Never returns sensitive fields (status,
    expiration, payment data). Logs `EMAIL_LOOKUP` activity. No OTP
    is generated or sent.
  - `requestEmailOtp(jsonRequest)`: generates a 6-digit OTP, writes to
    `Auth-OTP`, sends via `MailApp.sendEmail`. Logs `OTP_REQUESTED`.
  - `verifyEmailOtp(jsonRequest)`: validates Email + OTPCode, checks
    expiry and `Used` flag. On success marks `Used=TRUE`, looks up
    Membership Master, returns `{ member, isNewMember }`. Logs
    `OTP_VERIFY_SUCCESS` or `OTP_VERIFY_FAIL`. Does NOT auto-create
    member records.
- **`members.ts`** — `getOrCreateMemberProfile(jsonRequest)`, `updateMemberProfile(jsonRequest)`, `createNewMember(jsonRequest)`. Uses `payload.email` exclusively (never `Session.getActiveUser()`). Profile update supports `Type` field change + auto FamilyID assignment.
- **`renewal.ts`** — `submitRenewalRequest(jsonRequest)`, `reconcileWebAppWithGmail(jsonRequest?)`, `approveRenewal(jsonRequest)`, `rejectRenewal(jsonRequest)`. Approval logic branches on `PaymentIntent` (see §7.1).
- **`admin.ts`** — `getPendingEvents(jsonRequest)`, `getUnmatchedPayments(jsonRequest)`, `getConfig(jsonRequest)`, `updateConfigEntry(jsonRequest)`, `getPaymentProofs(jsonRequest)`. All gated by `Admin_Emails` config check.
- **`ui.ts`** — `doGet(e)`: routes `?page=` to HTML template; injects `__SCRIPT_URL__` and `__URL_PARAMS__` (serialized `e.parameter`).
- **`logger.ts`** — `auditLog(action, details)` appends to `WebApp-ActivityLog`.

---

## 7. Renewal \& Reconciliation Algorithms

### 7.1 `approveRenewal` — Three-Branch Logic

When an admin approves a `WebApp-Events` row, the logic branches on `PaymentIntent`:

#### Branch A: `Individual Renewal`

1. Load member row by `MemberID`.
2. Compute `newExpiration = max(today + Membership_Renewal_Years, currentExpiration)`.
3. Set `member.Type = "Individual"`.
4. Set `member.Status = "active"`, `member.Expiration = newExpiration`.
5. Update `Membership Fee Paid`, `Payment Date`, `Payment Transaction`, `Last Updated`.
6. Insert `Payment-History` row with `PaymentIntent = "Individual Renewal"`.
7. Log `RENEWAL_APPROVED`.

#### Branch B: `Family Renewal`

1. Load member row by `MemberID`.
2. If `member.FamilyID` is blank → generate new `FamilyID` (§3.3.2).
3. Compute `newExpiration = max(today + Membership_Renewal_Years, currentExpiration)`.
4. Set `member.Type = "Family"` on all members with this `FamilyID`.
5. Set `member.Status = "active"`, `member.Expiration = newExpiration` for all family members.
6. Insert `Payment-History` row with `PaymentIntent = "Family Renewal"`.
7. Log `RENEWAL_APPROVED`.

#### Branch C: `Family Upgrade`

1. Load member row by `MemberID`.
2. **Validate**: `member.Status` must be `"active"`. If not → reject with note: _"Family upgrade requires an active Individual membership first."_
3. If `member.FamilyID` is blank → generate new `FamilyID` (§3.3.2).
4. Set `member.Type = "Family"`. **Do NOT change `Expiration`** — keep existing active period.
5. Insert `Payment-History` row with `PaymentIntent = "Family Upgrade"`, `PeriodStart/PeriodEnd` matching existing expiration.
6. Log `UPGRADE_APPROVED`.

### 7.2 Reconciliation with Fetch-Gmail

1. Load `WebApp-Events` where `EventType="MembershipRenewal"` and `Status="Pending"` or `"Matched"`.
2. Load `Fetch-Gmail` rows where `Processed` is blank or `FALSE`.
3. For each pending event:
    - If `Last4Digits` provided: exact match on `TransactionNumber` + `Amount`.
    - Else fuzzy match: `Amount` match, `Source` matches `PaymentMethod`, date within ±3 days, `PayerName ≈ Sender` (case-insensitive), `Memo` or `Original Memo` contains `MemberID` or member name.
4. On match:
    - `WebApp-Events`: `Status="Matched"`, set `MatchedMessageId`, `MatchedTransactionNumber`.
    - `Fetch-Gmail`: `Processed=TRUE`, `WebAppEventID=EventID`.
    - Log `RECONCILE_MATCH_FOUND`.
5. Admin calls `approveRenewal` → runs §7.1 branch logic → `Status="Approved"`.
6. No match: keep `Pending` or set `Error`. Expose in admin UI for manual linking.

---

## 8. Frontend — Multi-Template Views

### 8.1 Routing

`doGet(e)` reads `e.parameter.page` and serves:


| `?page=` | Template |
| :-- | :-- |
| _(none)_ / `login` | `page_login.html` |
| `dashboard` | `page_dashboard.html` |
| `profile` | `page_profile.html` |
| `renewal` | `page_renewal.html` |
| `payment` | `page_payment.html` |
| `payment_proof` | `page_payment_proof.html` |
| `payment_history` | `page_payment_history.html` |
| `newmember` | `page_newmember.html` |
| `admin` | `page_admin.html` |

### 8.2 Login View (`page_login.html`)

Four sequential states rendered in a single card (mutually exclusive
display — only one visible at a time):

**State 1 — Email entry**
- Email input field (with Enter-key support).
- "Continue →" primary button → calls `lookupEmail`.
- "Sign in with Google" button above a divider (Google OAuth path,
  skips all OTP states and goes directly to the Continue button).
- Spinner on the button while the lookup is in flight.

**State 2A — Returning member**
- Green result box: "👋 Welcome back, [firstName]! · Member ID: [memberID]"
- OTP input (6-digit, `inputmode=numeric`, `autocomplete=one-time-code`).
- "Verify Code →" primary button → calls `verifyEmailOtp`.
- "Send Me a New Code" outline button → calls `requestEmailOtp`; shows
  inline success message "✓ Code sent to [email]" on success.
- "← Try a different email" ghost link → resets to State 1.
- Inline error message below OTP input on failed verify (stays in State 2A).

**State 2B-ask — New member intent**
- Blue result box: "✉️ No account found · [email]"
- "Are you a new member?" prompt text.
- "Yes — Register Me →" primary button → calls `requestEmailOtp`,
  then transitions to State 2B-verify on success.
- "← No, go back and change email" ghost link → resets to State 1.

**State 2B-verify — New member OTP**
- Blue result box: "✉️ Verify your email · Code sent to [email]"
- OTP input (same attributes as State 2A).
- "Verify Code →" primary button → calls `verifyEmailOtp`.
- "Resend Code" outline button → calls `requestEmailOtp` again.
- "← Go back" ghost link → returns to State 2B-ask.
- Inline error message on failed verify (stays in State 2B-verify).

**Final — Continue**
- Summary result box (green for returning, blue for new member).
- Single "Continue to Dashboard →" or "Continue to Registration →"
  button — navigates via `window.top.location.href` from the click
  handler (user-gesture requirement, see §2.4).

**General rules:**
- Each state has its own message div — errors never bleed across states.
- Failed OTP attempts loop in-place; the email and state are never reset
  on a bad code.
- If `sessionStorage` already contains a valid `member` object on page
  load, skip to dashboard immediately.
- `appBaseUrl` is injected server-side as `__SCRIPT_URL__` by `doGet`.

### 8.3 Dashboard View (`page_dashboard.html`)

Displays:

- Member name, `MemberID`, `FamilyID` (if any), `Type`.
- Computed status badge (see §4.5 resolution logic):
    - 🟡 Yellow "Payment Pending · [PaymentIntent]" — if open `WebApp-Events` row exists.
    - 🟢 Green "Active · [Individual|Family]" — if `status=active` and no pending events.
    - 🔴 Red "Expired · [Individual|Family]" — if `status=expired`.
    - ⚪ Grey "Not Active" — if `status=not active`.
    - 🟠 Orange upgrade prompt — if `status=active`, `type=Individual`, no pending upgrade event.
- Expiration date (color-coded: red if expired, orange if within `Reminder_Days_Before` days).
- `JoinYear`.
- Action buttons contextual by status:
    - Always: "Update Profile", "Submit Payment Proof".
    - If expired or not active: "Renew Membership".
    - If active Individual: "Renew Membership", "Upgrade to Family".
    - If active Family: "Renew Membership".
    - If admin: "Admin Panel".


### 8.4 Profile View (`page_profile.html`)

Editable fields: `First Name`, `Last Name`, `PhoneNumber`, `WeChatID`, `District`, `JoinYear`, **`Type`** (Individual / Family).

- Email is read-only.
- Changing `Type` to `Family` triggers FamilyID assignment on save.
- After save: redirect to dashboard.


### 8.5 Renewal View (`page_renewal.html`)

Membership type options shown based on current `Type`:


| Current `Type` | Options shown |
| :-- | :-- |
| `Individual` | Individual Renewal (\$30) · Family Upgrade (\$20) |
| `Family` | Family Renewal (\$50) |
| `not active` / new | Individual Renewal (\$30) · Family Renewal (\$50) |

- Prices read from Config (`Individual_Price`, `Family_Price`, `Family_Upgrade_Price`).
- Payment method selector from `Payment_Methods` config.
- Instructions for each payment method (handles, QR codes from Config).
- "Continue to Submit Proof →" button leads to `page_payment.html` with pre-filled `paymentIntent` and `amount`.


### 8.6 Payment Proof View (`page_paymentproof.html`)

Fields:

- `PaymentIntent` (pre-filled from URL params, read-only if pre-filled).
- `Amount` (pre-filled, editable for exceptions).
- `Payment Date`.
- `Payer Name`.
- `Last 4 Digits` (optional).
- `Notes` (optional).
- `Screenshot` file upload (optional, stored in Drive).

On submit: calls `submitPaymentProof(jsonRequest)`. Member sees confirmation.

### 8.7 Admin View (`page_admin.html`)

Gated: checks `Admin_Emails` config on load. Non-admins see "Not authorized."

Tabs:

- **Pending Renewals**: lists `WebApp-Events` with `Status=Pending/Matched`. Shows `PaymentIntent`, amount, member details, matched payment. Approve / Reject with notes.
- **Unmatched Payments**: shows `Fetch-Gmail` rows with `Processed=FALSE`. Manual linking.
- **Payment Proofs**: lists payment proof submissions. Run OCR button.
- **Config**: editable key/value pairs. All changes logged.

---

## 9. Testing

### 9.1 Tooling

Jest + ts-jest + TypeScript.

### 9.2 Unit Tests

- `config.test.ts` — reading/writing Config, `Family_Upgrade_Price` default.
- `sheets.test.ts` — mapping rows to `Member`, `WebAppEvent` (with `PaymentIntent`), `PaymentRecord`.
- `renewal.test.ts`:
    - Individual Renewal: expiration extended, `Type=Individual`, `Status=active`.
    - Family Renewal: expiration extended for all family members, `Type=Family`.
    - Family Upgrade: `Type=Family`, FamilyID assigned, expiration unchanged.
    - Family Upgrade rejected if member is not `active`.
- `auth.test.ts` — OTP creation, expiry, verification, cleanup.
  **New `lookupEmail` cases:**
  - Returns `{ found: false }` for an email not in Membership Master.
  - Returns `{ found: true, firstName, memberID }` for a known email;
    asserts that `status`, `expiration`, and `paymentDate` are
    **absent** from the response (sensitive field guard).
  - Returns `INVALID_EMAIL` error for a malformed email string
    (no `@`, empty string).
  - Logs `EMAIL_LOOKUP` action on every call.
  - Logs `EMAIL_LOOKUP_NOT_FOUND` action specifically when not found.
- `members.test.ts` — profile creation, profile update with `Type` change + FamilyID auto-assignment.


### 9.3 Integration Tests (Mocked Sheets)

- **Full Individual Renewal**: WebApp-Events submission → reconcile with Fetch-Gmail → `approveRenewal` → assert `Status=active`, `Type=Individual`, `Expiration` extended, `Payment-History` row written.
- **Full Family Renewal**: same flow → assert all family members updated.
- **Family Upgrade**: active Individual submits \$20 → approve → assert `Type=Family`, `FamilyID` assigned, `Expiration` unchanged.
- **Family Upgrade Guard**: inactive member submits \$20 → approve → assert rejection with error note.

---

## 10. CLASP Setup \& Implementation Plan

### 10.1 CLASP Setup

1. Create Apps Script project bound to the Google Sheet.
2. Install CLASP: `npm install -g @google/clasp && clasp login`.
3. `clasp create --type webapp --title "MMRunners Membership" --rootDir dist`.
4. Configure `tsconfig.json`: `outDir: "dist"`, `strict: true`, `types: ["google-apps-script"]`.
5. Build and deploy: `npm run build && clasp push && clasp deploy`.
6. Update `Config.AppBaseUrl` with deployment URL.

### 10.2 Implementation Steps

1. **Scaffold**: `src/`, `frontend/`, `tests/`, `tsconfig.json`, `package.json`, `jest.config.js`, `.clasp.json`.
2. **Types \& Config**: update `types.ts` (`Member.status` expanded, `WebAppEvent.paymentIntent` added), `config.ts`, `sheets.ts`.
3. **Auth module**: Email OTP only in `auth.ts`. Remove/disable Google OAuth path.
4. **Members module**: `members.ts` — use `payload.email` only; add `Type` field to `updateMemberProfile`; auto-assign `FamilyID` on type change.
5. **Renewal module**: `renewal.ts` — `submitRenewalRequest` uses `PaymentIntent`; `approveRenewal` implements three-branch logic (§7.1).
6. **Admin module**: `admin.ts` — gate all endpoints by `Admin_Emails`; expose `PaymentIntent` in pending events list.
7. **Frontend**: update `page_renewal.html` (contextual options by type), `page_dashboard.html` (status resolution logic §4.5), `page_profile.html` (add `Type` field).
8. **Logger**: `auditLog` helper in `logger.ts`; add `UPGRADE_APPROVED` action code.
9. **Tests**: unit + integration per §9.
```

***

This is the complete updated `PRDv2.md`. Key changes from rev 2:[^1]

- **Auth**: OTP-only (Google OAuth removed as primary path per current codebase)
- **Section 4**: Full membership status × type model with all 10 cases, status definitions, and `PaymentIntent` types
- **Section 5**: `WebApp-Events` and `Payment-History` use `PaymentIntent` instead of `MembershipType`; `Config` gets `Family_Upgrade_Price`; `Member.status` expanded to 3 values
- **Section 6**: `members.ts` note on never using `Session.getActiveUser()` post-login; session identity model documented
- **Section 7**: Three-branch `approveRenewal` logic with the Family Upgrade guard
- **Section 8**: Contextual renewal options by member type; dashboard status resolution order; admin gating noted
- **Section 9**: New test cases for all three `PaymentIntent` branches and the upgrade guard


<div align="center">⁂</div>
```

