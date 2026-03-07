# Codebase Snapshot

Root: `/Users/cathylin/github/web-apps/membership`


---
## File: `.gitignore`
---

```
node_modules/
dist/
dist-test/
*.js.map

```


---
## File: `GEMINI.md`
---

```markdown

```


---
## File: `PRDv4.md`
---

```markdown
# Misty Mountain Runners Membership Web App — Product Requirements Document

_Last updated: 2026-03-06 (rev 4)_

---

## Changelog — rev 4 vs rev 3

- **Status model**: `expired` + `not active` consolidated into `inactive`; new value `pending_upgrade` added.
- **Dashboard**: page_renewal removed from user flow. All renewal/upgrade actions handled directly from dashboard via dynamic buttons. Third dashboard section removed.
- **Button logic**: full dynamic button spec added (§8.3). Buttons gated by status, type, expiration window, and pending payment proof state.
- **EventType taxonomy**: `WebApp-Events.EventType` values updated to align with button actions (`dues_payment`, `family_switch`, `family_upgrade`, `membership_application`, `admin_request`).
- **PaymentIntent values**: renamed to `Individual Membership`, `Family Membership`, `Family Upgrade` (replaces `Individual Renewal`, `Family Renewal`).
- **Pending Upgrade sub-states**: two sub-states defined (proof submitted vs. not submitted).
- **Cancel Upgrade**: new action; reverts all family members to Individual, removes FamilyID, recalculates status instantly.
- **New table**: `Membership-Master-Log` — full-row audit log before any Main table update.
- **New page**: `page_family.html` — family member management (blank for now, added to routing).
- **FamilyID lifecycle**: assigned on Switch/Upgrade action; recycled on Cancel Upgrade.
- **Expiration rules**: Upgrade to Family does NOT extend expiration. Switch to Family and Pay Dues extend by +1 year. Upgrade to Family only available when expiration > 3 months; otherwise user pays full Family dues.
- **Pending review expiry**: payment proof pending review expires after 1 week; member notified to resubmit.

---

## 1. Product Overview & Goals

### 1.1 Objective

Build a membership web application for Misty Mountain Runners that:

- Manages member authentication via email OTP (primary) for all members.
- Displays and updates member profiles and family groupings.
- Handles membership dues and Individual→Family upgrades paid externally (Zelle, Venmo, PayPal).
- Matches bank/payment emails (from Gmail) to member submissions.
- Maintains clean Payment History for reporting and audit.

The app runs on **Google Apps Script (GAS)** with Google Sheets as the data store, managed via **CLASP** and GitHub.

### 1.2 Scope — Phase 1 (MVP)

In scope:
- Authentication: Email OTP for all members (Gmail and non-Gmail).
- Member self-service: view membership status/expiration, edit profile, submit payment proof, manage family members.
- Membership payments: Individual Membership, Family Membership, and Family Upgrade — all paid externally via Zelle/Venmo/PayPal; member submits proof, admin approves.
- All renewal/upgrade actions initiated from dashboard (no separate renewal page in user flow).
- Data integration: Membership Master as source of truth; Fetch-Gmail payment data for reconciliation.
- Audit logging: full-row copy to Log table before any Main table update; activity log for debugging.

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
  - New sheets: `WebApp-Events`, `Payment-History`, `Auth-OTP`, `Config`, `WebApp-ActivityLog`, `Membership-Master-Log`.
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
- **Log before write**: every function that writes to Membership Master must call `logMainTableRow(memberID)` before modifying any value. No exceptions.

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

- **Member**: club runner or family member. Can log in, view/update profile, submit membership payments, view status, manage family members.
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
- Set `Status = "inactive"`, `Type = "Individual"` by default.

#### 3.3.2 FamilyID Generation and Lifecycle (B001–B999)

**Assignment**: FamilyID is assigned at the moment a member clicks "Switch to Family" or "Upgrade to Family" on the dashboard — not at payment approval time.

- Scan all existing `FamilyID` values, parse numeric part after `B`.
- Find first unused integer from 1–999, format as 3 digits (e.g., `B036`).
- Store the new `FamilyID` on that member's row immediately.

**Recycling**: FamilyID is hidden from users. Every member has a permanent unique `MemberID`. When a Cancel Upgrade action removes a FamilyID from all members in that family, that FamilyID becomes available for reuse.

#### 3.3.3 Profile Retrieval

After authentication:
1. Query Membership Master by email.
2. If found, load: `MemberID`, `Status`, `Expiration`, `Email`, `First Name`, `Last Name`, `Type`, `FamilyID`, `Gender`, `WeChatID`, `District`, `Membership Fee Paid`, `Payment Date`, `Payment Transaction`, `Created`, `JoinYear`, `PhoneNumber`, `LastLoginDate`, `ProfileLastUpdated`.
3. Return family members sharing the same `FamilyID` if applicable.
4. If not found: create new row with new `MemberID`, `Status="inactive"`, `Type="Individual"`, `JoinYear=current year` (editable). Prompt to complete profile.

#### 3.3.4 Profile Editing

Members can update: `FirstName`, `LastName`, `PhoneNumber`, `WeChatID`, `District`, `JoinYear`.

- `Type` is no longer directly editable on the profile page. Type changes happen exclusively via dashboard action buttons (Switch to Family, Upgrade to Family, Cancel Upgrade).
- Backend updates the matching row and sets `ProfileLastUpdated`.
- **Log before write**: `logMainTableRow(memberID)` must be called before any profile update is written.

#### 3.3.5 Family Semantics

- `Type="Family"` with a non-blank `FamilyID` means membership applies to all members sharing that `FamilyID`.
- All family members share the same `Expiration` date.
- When a Family dues payment is approved, `Expiration` is extended by +1 year for all rows with the same `FamilyID`.
- A Family Upgrade approval changes `Type` to `"Family"` and assigns a `FamilyID` without changing `Expiration` (upgrade covers the remaining active period only).
- New family members added while status is `pending_upgrade` receive `Expiration = yesterday` (one day in the past), making them `inactive`. If the upgrade is later cancelled, they revert to Individual with that same expired date.

---

## 4. Membership Status & Type Model

### 4.1 Two Independent Dimensions

Every member has exactly two dimensions tracked on their Membership Master row:

| Dimension | Column | Possible Values |
|---|---|---|
| **Membership Type** | `Type` | `Individual` · `Family` |
| **Membership Status** | `Status` | `active` · `inactive` · `pending_upgrade` |

### 4.2 Status Definitions

| Status | Meaning | Written By |
|---|---|---|
| `inactive` | No confirmed active membership. Covers: never paid, expired, or lapsed. | New member creation; nightly expiry-check job |
| `active` | Has a confirmed, non-expired membership. | `approveRenewal` / `approveDuesPayment` after payment confirmation |
| `pending_upgrade` | Member was Individual, clicked Switch/Upgrade to Family, FamilyID assigned, but payment not yet approved. | `initiateUpgrade` action on dashboard |

**Rule**: `Status` on Membership Master is only written by `approveDuesPayment` (→ `active`), the scheduled expiry-check job (→ `inactive`), `initiateUpgrade` (→ `pending_upgrade`), and `cancelUpgrade` (→ `active` or `inactive` based on expiration). It is never set to `pending` (that is an event-level concept in `WebApp-Events`).

### 4.3 Payment Intent Types

`WebApp-Events` uses a `PaymentIntent` column to precisely describe what the payment covers:

| `PaymentIntent` | Meaning | Expected Amount | Expiration Effect on Approval |
|---|---|---|---|
| `Individual Membership` | Paying individual membership dues | `IndividualPrice` ($30) | `Expiration = max(today, currentExpiration) + 1 year` for this member |
| `Family Membership` | Full family membership dues (Switch or Renewal) | `FamilyPrice` ($50) | `Expiration = max(today, currentExpiration) + 1 year` for all family members |
| `Family Upgrade` | Delta payment to upgrade Individual→Family mid-cycle | `FamilyUpgradePrice` ($20) | No change to `Expiration` |

### 4.4 Expiration Windows and Button Availability

| Condition | Available payment actions |
|---|---|
| Expires > 3 months | Upgrade to Family only (PaymentIntent = `Family Upgrade`) |
| 42 days ≤ expires ≤ 3 months | Both Switch to Family AND Upgrade to Family (user's choice) |
| Expires < 42 days OR Status = `inactive` | Pay Dues + Switch to Family only |

**Upgrade to Family** (PaymentIntent = `Family Upgrade`): does not extend expiration. Only available when expiration > 3 months.

**Switch to Family** (PaymentIntent = `Family Membership`): extends expiration +1 year. Available when expires ≤ 3 months or status = `inactive`.

### 4.5 Pending Upgrade Sub-States

When `Status = pending_upgrade`, the dashboard distinguishes two sub-states by checking `WebApp-Events`:

| Sub-state | Condition | Dashboard message | Available actions |
|---|---|---|---|
| **Awaiting Review** | `WebApp-Events` has a row with `EventType IN (family_switch, family_upgrade)` AND `M_Status = Pending` for this member | "Your upgrade payment is under review. We'll notify you of the result." | Cancel Upgrade only |
| **Proof Required** | `Status = pending_upgrade` but no matching pending event in `WebApp-Events` | "Please submit payment proof to complete your Family upgrade." | Submit proof link + Cancel Upgrade |

**Pending review expiry**: if admin has not reviewed the proof within 1 week, the `WebApp-Events` row expires and `M_Status` is updated to `Expired`. Member is notified (email) and must resubmit proof. Status returns to sub-state Proof Required.

### 4.6 Cancel Upgrade

When a member cancels a pending upgrade:

1. For all rows in Membership Master with the same `FamilyID`:
   - Set `Type = "Individual"`.
   - Set `FamilyID = ""` (blank).
   - Recalculate `Status`: if `Expiration >= today` → `active`, else → `inactive`. This recalculation happens **immediately** (not via nightly job).
2. If a payment proof was submitted and is pending review (`WebApp-Events` row with `M_Status = Pending`): update that event's `M_Status = Rejected`, set `Notes = "Cancelled by member"`.
3. Log `CANCEL_UPGRADE` action in `WebApp-ActivityLog`.
4. **Log before write**: `logMainTableRow` must be called for each affected member row before any change.

### 4.7 EventType / PaymentIntent Filter Table

This table defines how the dashboard interprets pending events in `WebApp-Events`:

| EventType | PaymentIntent | Suppresses Pay Dues / Switch / Upgrade buttons | Shows View Pending Requests button |
|---|---|---|---|
| `dues_payment` | `Individual Membership` | ✅ | ✅ |
| `dues_payment` | `Family Membership` | ✅ | ✅ |
| `family_switch` | `Family Membership` | ✅ | ✅ |
| `family_upgrade` | `Family Upgrade` | ✅ | ✅ |
| `membership_application` | — | ❌ | ✅ |
| `admin_request` | — | ❌ | ✅ |

**Simplified rule**: View Pending Requests button shows whenever any `WebApp-Events` row for this member has `M_Status = Pending`. Payment-type events (`dues_payment`, `family_switch`, `family_upgrade`) additionally suppress the payment action buttons.

---

## 5. Data Model — Google Sheets

### 5.1 Membership Master (Existing)

Sheet: `Membership-Master-Main-3`

Existing columns: `MemberID` (Axxxx), `Status`, `Created`, `Expiration`, `Email`, `First Name`, `Last Name`, `Type` (Individual / Family), `FamilyID` (Bxxx), `Gender`, `WeChatID`, `District`, `WebApp`, `Payment CheckInfo`, `Last Updated`, `Membership Fee Paid`, `Payment Date`, `Payment Transaction`.

New columns (append at end):
- `JoinYear` (string YYYY).
- `PhoneNumber` (string).
- `LastLoginDate` (datetime).
- `ProfileLastUpdated` (datetime).
- `Notes` (string — admin/system notes).

**Status values** (updated): `active` · `inactive` · `pending_upgrade`.

- `active`: confirmed non-expired membership.
- `inactive`: never paid, expired, or lapsed (consolidates old `expired` + `not active`).
- `pending_upgrade`: FamilyID assigned, awaiting payment approval to become active Family member.

### 5.2 WebApp-Events

Sheet: `WebApp-Events`

Purpose: log of all payment submissions and member action events from the web app.

Columns:
- `EventID` — unique id (`EV-[timestamp]-[random]`).
- `EventType` — see §4.7: `dues_payment`, `family_switch`, `family_upgrade`, `membership_application`, `admin_request`.
- `Timestamp` — submission time.
- `ExpiresAt` — for payment proof review: `Timestamp + 7 days`. After this date without admin action, event is expired and member is notified to resubmit.
- `MemberID` — submitter's MemberID.
- `Email` — submitter email.
- `PaymentIntent` — `"Individual Membership"`, `"Family Membership"`, or `"Family Upgrade"`.
- `Amount` — numeric.
- `PaymentMethod` — `"Zelle"`, `"Venmo"`, or `"PayPal"`.
- `PayerName` — string.
- `MemoField` — string.
- `Last4Digits` — string (optional).
- `FamilyMemberEmails` — comma-separated (optional).
- `M_Status` — `"Pending"` · `"Matched"` · `"Approved"` · `"Rejected"` · `"Expired"` · `"Error"`. (Column M in sheet.)
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
- `PaymentIntent` — `"Individual Membership"` · `"Family Membership"` · `"Family Upgrade"`.
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
| `FamilyPrice` | `50` | Price for family membership dues |
| `FamilyUpgradePrice` | `20` | Delta price to upgrade Individual → Family mid-cycle |
| `PaymentMethods` | `Zelle,Venmo,PayPal` | Comma-separated accepted payment methods |
| `ReminderDaysBefore` | `42` | Days before expiry to begin showing renewal buttons |
| `UpgradeMinMonths` | `3` | Minimum months remaining on expiration to allow Family Upgrade (difference only) |
| `MembershipRenewalYears` | `1` | Years added per dues payment |
| `PaymentProofReviewDays` | `7` | Days before an unreviewed payment proof event expires |
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
`EMAIL_LOOKUP`, `EMAIL_LOOKUP_NOT_FOUND`,
`OTP_REQUESTED`, `OTP_VERIFY_SUCCESS`, `OTP_VERIFY_FAIL`,
`DUES_SUBMIT`, `UPGRADE_INITIATE`, `CANCEL_UPGRADE`,
`RECONCILE_MATCH_FOUND`, `DUES_APPROVED`, `UPGRADE_APPROVED`,
`PROOF_EXPIRED`, `ERROR`.

### 5.7 Fetch-Gmail (Existing)

Sheet: `Fetch-Gmail-data-in-Google-Spreadsheet-Active-4`

Existing columns: `TimeStamp`, `Sender`, `Amount`, `Memo`, `TransactionDate`, `TransactionNumber`, `MessageId`, `Subject`, `Original Memo`, `Notes`, `Processed`, `Source` (Zelle/Venmo/PayPal).

New column:
- `WebAppEventID` — links each matched payment to `WebApp-Events.EventID`.

### 5.8 Membership-Master-Log (New)

Sheet: `Membership-Master-Log`

**Purpose**: Full-row audit trail of Membership Master. Before any value in a Membership Master row is updated (profile edit, status change, type change, expiration update, etc.), the entire current row is copied here. This allows the admin to revert the Main table to any prior state by inspecting the log.

**Rule**: Every backend function that writes to `Membership-Master-Main-3` **must** call `logMainTableRow(memberID)` as its first operation, before any write. No exceptions.

Columns:
- `LogID` — unique id (`LOG-[timestamp]-[random]`).
- `LoggingTime` — datetime the row was copied into this log (i.e., just before the Main table update).
- _(All columns from `Membership-Master-Main-3` copied verbatim, in original column order)_: `MemberID`, `Status`, `Created`, `Expiration`, `Email`, `First Name`, `Last Name`, `Type`, `FamilyID`, `Gender`, `WeChatID`, `District`, `WebApp`, `Payment CheckInfo`, `Last Updated`, `Membership Fee Paid`, `Payment Date`, `Payment Transaction`, `JoinYear`, `PhoneNumber`, `LastLoginDate`, `ProfileLastUpdated`, `Notes`.

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
- **`types.ts`** — all shared interfaces: `Member`, `WebAppEvent`, `PaymentRecord`, `OtpRecord`, `ConfigMap`, `ActivityLogEntry`, `ApiRequest<T>`, `ApiResponseSuccess<T>`, `ApiResponseError`. `Member.status` type: `'active' | 'inactive' | 'pending_upgrade'`. `WebAppEvent.paymentIntent` type: `'Individual Membership' | 'Family Membership' | 'Family Upgrade'`. `WebAppEvent.eventType` type: `'dues_payment' | 'family_switch' | 'family_upgrade' | 'membership_application' | 'admin_request'`.
- **`sheets.ts`** — helpers for reading/writing rows, mapping rows ↔ typed objects. Includes `logMainTableRow(memberID)` which copies the current Main table row to `Membership-Master-Log` before any write.
- **`auth.ts`** — `lookupEmail`, `requestEmailOtp`, `verifyEmailOtp`. See §3.2.
- **`members.ts`** — `getOrCreateMemberProfile`, `updateMemberProfile`, `createNewMember`. Uses `payload.email` exclusively. Profile update does **not** expose `Type` field (Type changes go through `upgrade.ts`).
- **`upgrade.ts`** — New module handling all Type-change flows:
  - `initiateSwitch(jsonRequest)`: Individual → Family (full dues). Assigns FamilyID, sets `Status = pending_upgrade`. Creates `WebApp-Events` row with `EventType = family_switch`, `PaymentIntent = Family Membership`.
  - `initiateUpgrade(jsonRequest)`: Individual → Family (difference). Validates expiration > `UpgradeMinMonths`. Assigns FamilyID, sets `Status = pending_upgrade`. Creates `WebApp-Events` row with `EventType = family_upgrade`, `PaymentIntent = Family Upgrade`.
  - `cancelUpgrade(jsonRequest)`: Reverts all family members to Individual. Removes FamilyID. Recalculates Status instantly. Rejects any pending proof event. Logs `CANCEL_UPGRADE`.
- **`dues.ts`** — `submitDuesPayment(jsonRequest)`, `reconcileWebAppWithGmail(jsonRequest?)`, `approveDuesPayment(jsonRequest)`, `rejectDuesPayment(jsonRequest)`. Approval logic branches on `PaymentIntent` (see §7.1).
- **`family.ts`** — `getFamilyMembers(jsonRequest)`, `addFamilyMember(jsonRequest)`, `removeFamilyMember(jsonRequest)`. Accessible when `Type = Family`. Does not change expiration dates. New members added during `pending_upgrade` receive `Expiration = yesterday`.
- **`admin.ts`** — `getPendingEvents`, `getUnmatchedPayments`, `getConfig`, `updateConfigEntry`, `getPaymentProofs`. All gated by `AdminEmails` config check.
- **`ui.ts`** — `doGet(e)`: routes `?page=` to HTML template; injects `__SCRIPT_URL__` and `__URL_PARAMS__`.
- **`logger.ts`** — `auditLog(action, details)` appends to `WebApp-ActivityLog`.

---

## 7. Dues Payment & Reconciliation Algorithms

### 7.1 `approveDuesPayment` — Three-Branch Logic

When an admin approves a `WebApp-Events` row, the logic branches on `PaymentIntent`. **Always call `logMainTableRow` for each affected member before any write.**

#### Branch A: `Individual Membership`

1. Load member row by `MemberID`.
2. Call `logMainTableRow(memberID)`.
3. Compute `newExpiration = max(today, currentExpiration) + MembershipRenewalYears`.
4. Set `member.Type = "Individual"`, `member.Status = "active"`, `member.Expiration = newExpiration`.
5. Update `Membership Fee Paid`, `Payment Date`, `Payment Transaction`, `Last Updated`.
6. Insert `Payment-History` row with `PaymentIntent = "Individual Membership"`.
7. Log `DUES_APPROVED`.

#### Branch B: `Family Membership` (Switch or Renewal)

1. Load member row by `MemberID`.
2. For all members sharing the same `FamilyID` (or just this member if no FamilyID yet): call `logMainTableRow` for each.
3. If `member.FamilyID` is blank → generate new `FamilyID` (§3.3.2).
4. Compute `newExpiration = max(today, currentExpiration) + MembershipRenewalYears`.
5. Set `Type = "Family"`, `Status = "active"`, `Expiration = newExpiration` for all family members.
6. Insert `Payment-History` row with `PaymentIntent = "Family Membership"`.
7. Log `DUES_APPROVED`.

#### Branch C: `Family Upgrade`

1. Load member row by `MemberID`.
2. **Validate**: `member.Status` must be `"pending_upgrade"` and expiration at time of initiation was > `UpgradeMinMonths`. If not → reject with note.
3. For all members sharing the same `FamilyID`: call `logMainTableRow` for each.
4. Set `Type = "Family"`, `Status = "active"` for all family members. **Do NOT change `Expiration`.**
5. Insert `Payment-History` row with `PaymentIntent = "Family Upgrade"`.
6. Log `UPGRADE_APPROVED`.

### 7.2 Reconciliation with Fetch-Gmail

1. Load `WebApp-Events` where `EventType IN (dues_payment, family_switch, family_upgrade)` and `M_Status = "Pending"` or `"Matched"`.
2. Load `Fetch-Gmail` rows where `Processed` is blank or `FALSE`.
3. For each pending event:
   - If `Last4Digits` provided: exact match on `TransactionNumber` + `Amount`.
   - Else fuzzy match: `Amount` match, `Source` matches `PaymentMethod`, date within ±3 days, `PayerName ≈ Sender` (case-insensitive), `Memo` or `Original Memo` contains `MemberID` or member name.
4. On match:
   - `WebApp-Events`: `M_Status = "Matched"`, set `MatchedMessageId`, `MatchedTransactionNumber`.
   - `Fetch-Gmail`: `Processed = TRUE`, `WebAppEventID = EventID`.
   - Log `RECONCILE_MATCH_FOUND`.
5. Admin calls `approveDuesPayment` → runs §7.1 branch logic → `M_Status = "Approved"`.
6. No match: keep `Pending` or set `Error`. Expose in admin UI for manual linking.

### 7.3 Pending Review Expiry (Scheduled Job)

A scheduled job checks `WebApp-Events` for rows where `ExpiresAt < now` and `M_Status = "Pending"`:
1. Set `M_Status = "Expired"`.
2. Send notification email to the member: "Your payment proof for [PaymentIntent] has not been reviewed within 7 days. Please log in and resubmit your proof."
3. Log `PROOF_EXPIRED`.
4. Member's `Status` in Main table remains `pending_upgrade` (Proof Required sub-state).

---

## 8. Frontend — Multi-Template Views

### 8.1 Routing

`doGet(e)` reads `e.parameter.page` and serves:

| `?page=` | Template | Notes |
| :-- | :-- | :-- |
| _(none)_ / `login` | `page_login.html` | |
| `dashboard` | `page_dashboard.html` | Primary action hub |
| `profile` | `page_profile.html` | |
| `payment_proof` | `page_payment_proof.html` | Pre-filled from URL params |
| `payment_history` | `page_payment_history.html` | |
| `family` | `page_family.html` | Family member management (§8.6) |
| `newmember` | `page_newmember.html` | |
| `admin` | `page_admin.html` | |

> **Note**: `page_renewal.html` is removed from the member-facing flow. Renewal and upgrade actions are handled entirely via dashboard buttons. The payment proof submission page (`page_payment_proof.html`) receives `PaymentIntent` and `Amount` as URL params pre-filled by the dashboard button action.

### 8.2 Login View (`page_login.html`)

_(Unchanged from rev 3 — see §3.2 for state machine.)_

### 8.3 Dashboard View (`page_dashboard.html`)

Displays member name, `MemberID`, `Type`, status badge, expiration date, `JoinYear`.

**Status badge resolution** (evaluated in this order):

1. Check `WebApp-Events` for any row with `M_Status = Pending` for this member.
   - If found AND `EventType IN (dues_payment, family_switch, family_upgrade)` AND `Main.Status = pending_upgrade`, pending sub-state = Awaiting Review.
   - If found AND `EventType IN (dues_payment, family_switch, family_upgrade)` AND `Main.Status ≠ pending_upgrade`, badge = 🟡 "Payment Pending · [PaymentIntent]".
   - If found AND `EventType IN (membership_application, admin_request)`, include View Pending Requests regardless of other state.
2. If `Main.Status = pending_upgrade`, badge = 🟠 "Upgrade Pending".
3. If `Main.Status = active` AND expiration is within `ReminderDaysBefore` days: badge = 🟢 "Active · [Type] · Renews soon".
4. If `Main.Status = active`: badge = 🟢 "Active · [Type]".
5. If `Main.Status = inactive`: badge = 🔴 "Inactive · [Type]".

**Section 1 — Dynamic Action Buttons** (shown based on state):

Catch-all gate: if any payment-type event has `M_Status = Pending` in `WebApp-Events`, suppress Pay Dues, Switch to Family, and Upgrade to Family. Show View Pending Requests instead.

| Condition | Button(s) shown |
|---|---|
| Any `M_Status = Pending` in `WebApp-Events` (any EventType) | **View Pending Requests** |
| `Status = pending_upgrade` AND Awaiting Review sub-state | **Cancel Upgrade** only (payment buttons suppressed) |
| `Status = pending_upgrade` AND Proof Required sub-state | **Submit Payment Proof** (links to payment_proof with pre-filled intent) + **Cancel Upgrade** |
| `Status = inactive` OR (`Status = active` AND expires < 42 days) AND `Type = Individual` | **Pay Dues** (PaymentIntent = Individual Membership) + **Switch to Family** (PaymentIntent = Family Membership) |
| `Status = inactive` OR (`Status = active` AND expires < 42 days) AND `Type = Family` | **Pay Dues** (PaymentIntent = Family Membership) |
| `Status = active` AND expires between 42 days and 3 months AND `Type = Individual` | **Switch to Family** (PaymentIntent = Family Membership, +1 yr) + **Upgrade to Family** (PaymentIntent = Family Upgrade, no expiry change) |
| `Status = active` AND expires > 3 months AND `Type = Individual` | **Upgrade to Family** (PaymentIntent = Family Upgrade) |
| `Status = active` AND `Type = Family` AND expires < 42 days | **Pay Dues** (PaymentIntent = Family Membership) |
| `Type = Family` | **Manage Family** (links to page_family) |

**Section 2 — Account Links** (always shown):

- Update Profile (links to page_profile)
- View Payment History (links to page_payment_history)
- Admin Panel (only if member email is in `AdminEmails` config)

> **Note**: Section 3 (previously "Other") is removed.

### 8.4 Profile View (`page_profile.html`)

Editable fields: `First Name`, `Last Name`, `PhoneNumber`, `WeChatID`, `District`, `JoinYear`.

- Email is read-only.
- `Type` is **not** editable here. Type changes happen only via dashboard buttons.
- After save: redirect to dashboard.

### 8.5 Payment Proof View (`page_payment_proof.html`)

Pre-filled from URL params: `PaymentIntent`, `Amount`.

Fields:
- `PaymentIntent` (read-only, pre-filled).
- `Amount` (pre-filled, editable for exceptions).
- `Payment Date`.
- `Payer Name`.
- `Last 4 Digits` (optional).
- `Notes` (optional).
- `Screenshot` file upload (optional, stored in Drive).

On submit: calls `submitPaymentProof(jsonRequest)`. Creates `WebApp-Events` row with `ExpiresAt = now + PaymentProofReviewDays`. Member sees confirmation and is told to await review.

### 8.6 Family View (`page_family.html`)

_Blank placeholder for now. To be implemented in a future sprint._

Requirements (for implementation reference):
- Show all members sharing the same `FamilyID`.
- Add new family member (by email or name + email).
- Remove family member.
- Accessible when `Type = Family` (any status including `pending_upgrade`).
- Expiration dates are read-only on this page.
- New members added while `Status = pending_upgrade` receive `Expiration = yesterday`.

### 8.7 Admin View (`page_admin.html`)

Gated: checks `AdminEmails` config on load.

Tabs:
- **Pending Payments**: lists `WebApp-Events` with `M_Status = Pending/Matched`. Shows `EventType`, `PaymentIntent`, amount, member details, matched payment. Approve / Reject with notes.
- **Unmatched Payments**: shows `Fetch-Gmail` rows with `Processed = FALSE`. Manual linking.
- **Payment Proofs**: lists payment proof submissions. Run OCR button.
- **Config**: editable key/value pairs. All changes logged.

---

## 9. Testing

### 9.1 Tooling

Jest + ts-jest + TypeScript.

### 9.2 Unit Tests

- `config.test.ts` — reading/writing Config, all price/timing keys.
- `sheets.test.ts` — mapping rows to `Member` (status = `inactive | active | pending_upgrade`), `WebAppEvent` (with `EventType` + `PaymentIntent`), `PaymentRecord`. `logMainTableRow` writes correct columns to Log sheet.
- `dues.test.ts`:
  - Individual Membership: expiration extended, `Type = Individual`, `Status = active`.
  - Family Membership: expiration extended for all family members, `Type = Family`.
  - Family Upgrade: `Type = Family`, FamilyID pre-assigned, expiration unchanged.
  - Family Upgrade rejected if `Status ≠ pending_upgrade`.
- `upgrade.test.ts`:
  - `initiateSwitch`: assigns FamilyID, sets `Status = pending_upgrade`, creates `WebApp-Events` row.
  - `initiateUpgrade`: validates expiration > `UpgradeMinMonths`; rejects if ≤.
  - `cancelUpgrade`: all family members set to Individual, FamilyID cleared, status recalculated instantly, pending proof event rejected.
  - New family member during `pending_upgrade` receives `Expiration = yesterday`.
- `auth.test.ts` — OTP creation, expiry, verification, cleanup. `lookupEmail` sensitive field guard.
- `members.test.ts` — profile creation, profile update (Type field not exposed).

### 9.3 Integration Tests (Mocked Sheets)

- **Full Individual dues flow**: submit → reconcile → approve → assert `Status = active`, `Type = Individual`, expiration extended, Log row written before update.
- **Full Family dues flow**: same → assert all family members updated, Log rows written for each.
- **Family Upgrade flow**: initiate → submit proof → approve → assert `Type = Family`, expiration unchanged, Log rows written.
- **Cancel Upgrade (no proof)**: initiate → cancel → assert all reverted to Individual, FamilyID cleared, status recalculated.
- **Cancel Upgrade (proof pending)**: initiate → submit proof → cancel → assert proof event Rejected, all reverted.
- **Proof expiry**: pending event past `ExpiresAt` → scheduled job sets `M_Status = Expired`, member notified, Main table status unchanged (still `pending_upgrade`).
- **Log table coverage**: every approval/update path asserts that a `Membership-Master-Log` row was written before the Main table row changed.

---

## 10. CLASP Setup & Implementation Plan

### 10.1 CLASP Setup

1. Create Apps Script project bound to the Google Sheet.
2. Install CLASP: `npm install -g @google/clasp && clasp login`.
3. `clasp create --type webapp --title "MMRunners Membership" --rootDir dist`.
4. Configure `tsconfig.json`: `outDir: "dist"`, `strict: true`, `types: ["google-apps-script"]`.
5. Build and deploy: `npm run build && clasp push && clasp deploy`.
6. Update `Config.AppBaseUrl` with deployment URL.

**Notes: run `clasp login` before build and deploy.**

### 10.2 Implementation Steps

1. **Scaffold**: `src/`, `frontend/`, `tests/`, `tsconfig.json`, `package.json`, `jest.config.js`, `.clasp.json`.
2. **Types & Config**: update `types.ts` (`Member.status` to 3 values, `WebAppEvent.paymentIntent` + `eventType` updated), `config.ts`, `sheets.ts`. Add `logMainTableRow` to `sheets.ts`.
3. **Create `Membership-Master-Log` sheet** with all Main table columns + `LogID` + `LoggingTime`.
4. **Auth module**: Email OTP only in `auth.ts`.
5. **Members module**: `members.ts` — profile update excludes `Type` field.
6. **Upgrade module**: new `upgrade.ts` — `initiateSwitch`, `initiateUpgrade`, `cancelUpgrade`.
7. **Dues module**: `dues.ts` — `submitDuesPayment`, `approveDuesPayment` (three-branch), `rejectDuesPayment`, reconciliation.
8. **Family module**: `family.ts` — `getFamilyMembers`, `addFamilyMember`, `removeFamilyMember`.
9. **Admin module**: `admin.ts` — update to use new EventType/PaymentIntent values.
10. **Frontend**: `page_dashboard.html` (full button logic per §8.3), `page_profile.html` (remove Type field), `page_payment_proof.html` (pre-filled from URL params), `page_family.html` (blank placeholder). Remove `page_renewal.html` from routing.
11. **Logger**: add `CANCEL_UPGRADE`, `UPGRADE_INITIATE`, `PROOF_EXPIRED`, `DUES_SUBMIT` action codes.
12. **Scheduled jobs**: OTP cleanup, expiry-check (inactive update), proof expiry check (§7.3).
13. **Tests**: unit + integration per §9.

### 10.3 TODO — Upcoming

- [ ] `page_family.html` full implementation (family member add/remove UI).
- [ ] Admin notification when a payment proof is submitted.
- [ ] Proof expiry scheduled job implementation.
- [ ] Nightly expiry-check job to set `Status = inactive` when `Expiration < today`.

```


---
## File: `TODO.md`
---

```markdown
- [ ] in login phase, if we don't see any OTP code available and not expired for this email address, we automatically send them a new code and tell them to check their email.

- [ ] error in page=payment_history: Uncaught ReferenceError: SESSIONID is not defined
    at userCodeAppPanel?createOAuthDialog=true:133:74

- [ ] remove renewal page. 

add PaymentMethod in Submit Payment Proof page.

dashboard actions depending on the membership type and membership expires and webapp-events history.

1. if any status=Pending, button=View Pending Requests.
2. if membership expires < 42 days, button=Pay Dues, PaymentIntent depends on Membership Type. 
3. if membership expires < 42 days and Type = Individual, button= Switch to Family, send PaymentIntent = Family Membership
4. if membership expires >= 42 days and Type = Individual, button=Upgrade to Family, send PaymentIntent = Family Upgrade 



- [ ] Timestamp of all rows in WebApp-Events table is updated to the current time. It should be the event original time. 

- [ ] Membership Type if shown Individual, display a button right next to it to "Upgrade to Family". Clicking the button will mark this user's attempt to change to Family membership. 
    1. If the current membership is good for more than 2 months, we route to page=payment, type=upgrade to family, amount=20. 
    2. if the current membership is about to expire or has expired, we route to page=payment, type=family renewal, amount=50

looks like our member's state machine is more complicated than we thought. we have to consider both the current membership type and the expiration date to determine what payment options we should show to users.

show the payment options for family membership. If the user successfully pays for the upgrade, we update their membership type to family in the profile page.

- [ ] Renew Membership page shows incorrect options for individual members whose membership about to expire. Let's remove the renewal page all together. Since we renew for the new year, we show Renew Individual and Change to Family. 
    - for family members whose membership about to expire, we show Renew Family and Change to Individual.
    - for expired members or new members, we show Pay Individual and Pay Family options. 
    - for individual members whose membership expires more than 6 weeks later, we show Extend Individual and Change to Family options.
    for individual members whose membership expires more than 6 weeks later, we show Extend Individual and Change to Family options.

how do we determine what status a member is in? 
1. Individual membership expires more than 6 weeks later. 
2. Individual membership expiring soon. 

- [ ] after clicking "Save Changes" in profile, the button display "Saving... and greyed out". when save operation is done, the top of page shows "Profile updated successfully! Redirecting…". It doesn't redirect to dashboard. the current design is hard to see the success message or error message because it doesn't automatically scroll to the top of page. therefore 3 issues after clicking "Save Changes":
    1. if the update is successful, users might not see the success message and think nothing happened.
    2. if the update fails, users might not see the error message and think their changes are saved successfully.
    3. redirect to dashboard after successful update, so users can see the updated membership type and relevant payment options immediately.

- [ ] dashboard's Upgrade to Family Membership section, we actually ask users to change their membership type in the profile page. not about paying for the upgrade immediately.
- [ ] we have to remember an active member's type with confirmed payment. because a member can upgrade to family.
- [ ] Update Profile doesn't have a membership type selection.

## features

- [ ] remove the last section "Upgrade to Family Membership" more compact dashboard. "Is your family information correct?" if the user is confirmed family member or has requested family membership. in dashboard we display a family member table and a button "Edit Family Profile ->" which will take users to the profile page where they can edit family member information.



- [ ] add a membership type column in the payment history sheet. and use it in the reconciliation process to improve the matching accuracy.

```


---
## File: `appsscript.json`
---

```json
{
  "timeZone": "America/New_York",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_ACCESSING",
    "access": "ANYONE"
  },
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/script.send_mail",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/script.locale",
    "https://www.googleapis.com/auth/script.scriptapp",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive"
  ]
}

```


---
## File: `frontend/membership.code-workspace`
---

```
{
	"folders": [
		{
			"path": ".."
		},
		{
			"path": "../.."
		}
	],
	"settings": {}
}
```


---
## File: `frontend/page_admin.html`
---

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Misty Mountain Runners — Admin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f0f5; min-height: 100vh; }
    .topbar { background: #5c35a8; color: #fff; padding: 14px 24px; display: flex; justify-content: space-between; align-items: center; }
    .topbar h1 { font-size: 18px; font-weight: 700; }
    .topbar a { color: #fff; text-decoration: none; font-size: 14px; opacity: 0.85; }
    .container { max-width: 900px; margin: 24px auto; padding: 0 16px; }
    .tabs { display: flex; gap: 4px; margin-bottom: 20px; border-bottom: 2px solid #e0e0e0; }
    .tab { padding: 10px 20px; border: none; background: none; cursor: pointer; font-size: 14px; font-weight: 600; color: #777; border-bottom: 3px solid transparent; margin-bottom: -2px; }
    .tab.active { color: #5c35a8; border-bottom-color: #5c35a8; }
    .panel { display: none; }
    .panel.active { display: block; }
    .card { background: #fff; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.07); padding: 24px; margin-bottom: 16px; }
    .card h3 { font-size: 15px; font-weight: 700; color: #333; margin-bottom: 4px; }
    .meta { font-size: 12px; color: #888; margin-bottom: 14px; }
    .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 20px; margin-bottom: 16px; }
    .detail-item label { font-size: 11px; color: #999; text-transform: uppercase; letter-spacing: 0.4px; display: block; }
    .detail-item span { font-size: 14px; color: #333; font-weight: 500; }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
    .badge-pending  { background: #fff3e0; color: #e65100; }
    .badge-matched  { background: #e3f2fd; color: #1565c0; }
    .badge-approved { background: #e8f5e9; color: #2d7d46; }
    .badge-rejected { background: #fdecea; color: #c62828; }
    .btn { padding: 8px 16px; border-radius: 6px; border: none; font-size: 13px; font-weight: 600; cursor: pointer; }
    .btn-approve { background: #2d7d46; color: #fff; }
    .btn-approve:hover { background: #235f36; }
    .btn-reject { background: #fdecea; color: #c62828; border: 1px solid #f5c6cb; }
    .btn-reject:hover { background: #f5c6cb; }
    .btn-reconcile { background: #5c35a8; color: #fff; padding: 10px 20px; border-radius: 8px; }
    .btn-reconcile:hover { background: #4a2b8a; }
    .action-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .notes-input { width: 100%; padding: 8px 10px; border: 1px solid #ccc; border-radius: 6px; font-size: 13px; margin-bottom: 8px; }
    .config-table { width: 100%; border-collapse: collapse; }
    .config-table th { text-align: left; font-size: 12px; color: #888; text-transform: uppercase; padding: 8px 10px; border-bottom: 2px solid #f0f0f0; }
    .config-table td { padding: 10px 10px; border-bottom: 1px solid #f5f5f5; font-size: 14px; vertical-align: middle; }
    .config-table input { border: 1px solid #e0e0e0; border-radius: 6px; padding: 6px 10px; font-size: 14px; width: 100%; }
    .config-table input:focus { border-color: #5c35a8; outline: none; }
    .btn-save-config { background: #5c35a8; color: #fff; font-size: 12px; padding: 5px 12px; }
    .empty-state { text-align: center; padding: 40px; color: #aaa; font-size: 15px; }
    .refresh-btn { background: none; border: 1px solid #ccc; border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer; color: #666; }
    .refresh-btn:hover { background: #f5f5f5; }
    #globalMsg { font-size: 14px; padding: 10px 12px; border-radius: 8px; margin-bottom: 12px; display: none; }
    #globalMsg.success { background: #e8f5e9; color: #2d7d46; display: block; }
    #globalMsg.error   { background: #fdecea; color: #c62828; display: block; }
  </style>
</head>
<body>
<div class="topbar">
  <h1>🛡️ Admin Panel — Misty Mountain Runners</h1>
  <a href="?page=dashboard">← Dashboard</a>
</div>

<div class="container">
  <div id="globalMsg"></div>

  <div class="tabs">
    <button class="tab active" onclick="showTab('pending')">Pending Renewals</button>
    <button class="tab" onclick="showTab('unmatched')">Unmatched Payments</button>
    <button class="tab" onclick="showTab('payment-proofs')">Payment Proofs</button>
    <button class="tab" onclick="showTab('config')">Config</button>
  </div>

  <!-- Pending Renewals -->
  <div class="panel active" id="panel-pending">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <div>
        <button class="btn-reconcile btn" onclick="reconcile()">⚡ Auto-Reconcile</button>
        <button class="refresh-btn" style="margin-left:8px;" onclick="loadPending()">↻ Refresh</button>
      </div>
    </div>
    <div id="pending-list"><div class="empty-state">Loading…</div></div>
  </div>

  <!-- Unmatched Payments -->
  <div class="panel" id="panel-unmatched">
    <button class="refresh-btn" style="margin-bottom:16px;" onclick="loadUnmatched()">↻ Refresh</button>
    <div id="unmatched-list"><div class="empty-state">Loading…</div></div>
  </div>

  <!-- Payment Proofs -->
  <div class="panel" id="panel-payment-proofs">
    <button class="refresh-btn" style="margin-bottom:16px;" onclick="loadPaymentProofs()">↻ Refresh</button>
    <div id="payment-proofs-list"><div class="empty-state">Loading…</div></div>
  </div>

  <!-- Config -->
  <div class="panel" id="panel-config">
    <div class="card">
      <table class="config-table">
        <thead>
          <tr><th>Key</th><th>Value</th><th>Description</th><th></th></tr>
        </thead>
        <tbody id="config-body"><tr><td colspan="4" class="empty-state">Loading…</td></tr></tbody>
      </table>
    </div>
  </div>
</div>

<script>
  console.log('[MMR][admin] page script started, location:', window.location.href);
  var appBaseUrl = '__SCRIPT_URL__';
  console.log('[MMR][admin] appBaseUrl:', appBaseUrl);

  var adminEmail = null;
  var eventsCache = {};      // already used in approve(); keep as-is
  var pendingEventsList = []; // NEW: flat list for manual match

  // Navigate all relative ?page= links through window.top with absolute URL
  document.addEventListener('click', function(e) {
    var a = e.target.closest('a[href]');
    if (a) {
      var h = a.getAttribute('href');
      if (h && h.charAt(0) === '?') {
        e.preventDefault();
        console.log('[MMR][admin] nav click to:', h);
        window.top.location.href = appBaseUrl + h;
      }
    }
  });

  const SESSION_ID = Math.random().toString(36).slice(2);
  let configData = {};

  function callApi(fn, payload) {
    console.log('[MMR][admin] callApi:', fn, JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      const req = { requestId: Math.random().toString(36).slice(2), payload };
      google.script.run
        .withSuccessHandler(r => {
          const res = JSON.parse(r);
          console.log('[MMR][admin]', fn, 'success:', JSON.stringify(res.payload || res));
          if (res.ok) resolve(res.payload);
          else reject(new Error(res.errorMessage));
        })
        .withFailureHandler(err => {
          console.error('[MMR][admin]', fn, 'failure:', err);
          reject(err);
        })
        [fn](JSON.stringify(req));
    });
  }

  function showGlobalMsg(text, type) {
    const el = document.getElementById('globalMsg');
    el.textContent = text;
    el.className = type;
    console.log('[MMR][admin] globalMsg:', type, text);
    setTimeout(function() { el.className = ''; el.style.display = 'none'; }, 4000);
  }

  function showTab(name) {
    console.log('[MMR][admin] showTab:', name);
    document.querySelectorAll('.tab').forEach(function(t, i) {
      var names = ['pending', 'unmatched', 'payment-proofs', 'config'];
      t.classList.toggle('active', names[i] === name);
    });
    document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('active'); });
    document.getElementById('panel-' + name).classList.add('active');
  }

  function statusBadge(status) {
    var cls = { Pending: 'badge-pending', Matched: 'badge-matched', Approved: 'badge-approved', Rejected: 'badge-rejected' }[status] || '';
    return '<span class="badge ' + cls + '">' + status + '</span>';
  }

  function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function loadPaymentProofs() {
    console.log('[MMR][admin] loadPaymentProofs, adminEmail:', adminEmail);
    var el = document.getElementById('payment-proofs-list');
    el.innerHTML = '<div class="empty-state">Loading…</div>';
    callApi('getPaymentProofs', { adminEmail: adminEmail })
      .then(function(data) {
        var proofs = data.proofs || [];
        console.log('[MMR][admin] getPaymentProofs returned', proofs.length, 'proofs');
        if (!proofs.length) { el.innerHTML = '<div class="empty-state">No payment proofs found.</div>'; return; }
        el.innerHTML = proofs.map(function(p) {
          var ocrButton = `<button class="btn btn-secondary" onclick="runOcr('${esc(p.eventId)}')">Run OCR</button>`;
          return '<div class="card" id="pp-' + esc(p.eventId) + '">' +
            '<h3>' + esc(p.payerName || 'Unknown') + ' &mdash; ' + esc(p.eventName) + ' $' + esc(p.amount) + '</h3>' +
            '<div class="meta">' + esc(p.eventId) + ' &bull; ' + new Date(p.timestamp).toLocaleString() + ' &bull; ' + statusBadge(p.status) + '</div>' +
            '<div class="detail-grid">' +
            '<div class="detail-item"><label>Member ID</label><span>' + esc(p.memberId) + '</span></div>' +
            '<div class="detail-item"><label>Email</label><span>' + esc(p.email) + '</span></div>' +
            '<div class="detail-item"><label>Screenshot File ID</label><span>' + esc(p.screenshotFileId) + '</span></div>' +
            '<div class="detail-item"><label>GDrive File Path</label><span>' + (p.gdriveFilePath ? `<a href="${p.gdriveFilePath}" target="_blank">Open</a>` : 'N/A') + '</span></div>' +
            '<div class="detail-item"><label>OCR Text</label><pre>' + esc(p.ocrText) + '</pre></div>' +
            '<div class="detail-item"><label>OCR Timestamp</label><span>' + esc(p.ocrTimestamp) + '</span></div>' +
            '</div>' + ocrButton + '</div>';
        }).join('');
      })
      .catch(function(err) {
        console.error('[MMR][admin] getPaymentProofs error:', err && err.message);
        el.innerHTML = '<div class="empty-state">Error: ' + esc(err && err.message) + '</div>';
      });
  }

  function runOcr(eventId) {
    console.log('[MMR][admin] runOcr eventId:', eventId);
    showGlobalMsg('Running OCR for ' + eventId + '...', 'success');
    callApi('runOcrForPaymentProof', { adminEmail: adminEmail, eventId: eventId })
      .then(function() {
        showGlobalMsg('OCR completed for ' + eventId, 'success');
        loadPaymentProofs();
      })
      .catch(function(err) {
        showGlobalMsg('OCR failed for ' + eventId + ': ' + (err && err.message), 'error');
      });
  }

  function loadPending() {
    console.log('[MMR][admin] loadPending, adminEmail:', adminEmail);
    var el = document.getElementById('pending-list');
    el.innerHTML = '<div class="empty-state">Loading…</div>';
    callApi('getPendingEvents', { adminEmail: adminEmail })
      .then(function(data) {
        var events = data.events || [];
        console.log('[MMR][admin] getPendingEvents returned', events.length, 'events');

        // Rebuild caches for manual match dropdown
        eventsCache = {};
        pendingEventsList = [];
        events.forEach(function(ev) {
          eventsCache[ev.eventID] = ev;
          if (ev.status === 'Pending' || ev.status === 'Matched') {
            pendingEventsList.push(ev);
          }
        });

        if (!events.length) {
          el.innerHTML = '<div class="empty-state">No pending renewals. 🎉</div>';
          return;
        }

        el.innerHTML = events.map(function(ev) {
          var actionsHtml = '';
          if (ev.status !== 'Approved' && ev.status !== 'Rejected') {
            actionsHtml =
              '<input class="notes-input" id="notes-' + esc(ev.eventID) + '" placeholder="Notes (optional)" />' +
              '<div class="action-row">' +
              '<button class="btn btn-approve" onclick="approve(\'' + esc(ev.eventID) + '\')">✓ Approve</button>' +
              '<button class="btn btn-reject" onclick="reject(\'' + esc(ev.eventID) + '\')">✗ Reject</button>' +
              '</div>';
          } else {
            actionsHtml =
              '<div style="font-size:13px;color:#888;">Processed by ' + esc(ev.adminApprover) + ' on ' + esc(ev.approvalDate) + '</div>';
          }

          return (
            '<div class="card" id="ev-' + esc(ev.eventID) + '">' +
              '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
                '<div>' +
                  '<h3>' + esc(ev.payerName || 'Unknown') + ' &mdash; ' + esc(ev.paymentIntent) + ' $' + esc(ev.amount) + '</h3>' +
                  '<div class="meta">' +
                    esc(ev.eventID) + ' &bull; ' +
                    new Date(ev.timestamp).toLocaleString() + ' &bull; ' +
                    statusBadge(ev.status) +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="detail-grid">' +
                '<div class="detail-item"><label>Member ID</label><span>' + esc(ev.memberID) + '</span></div>' +
                '<div class="detail-item"><label>Email</label><span>' + esc(ev.email) + '</span></div>' +
                '<div class="detail-item"><label>Payment Method</label><span>' + esc(ev.paymentMethod) + '</span></div>' +
                '<div class="detail-item"><label>Last 4 Digits</label><span>' + esc(ev.last4Digits || '—') + '</span></div>' +
                '<div class="detail-item"><label>Memo</label><span>' + esc(ev.memoField) + '</span></div>' +
                '<div class="detail-item"><label>Matched Transaction</label><span>' + esc(ev.matchedTransactionNumber || '—') + '</span></div>' +
              '</div>' +
              actionsHtml +
            '</div>'
          );
        }).join('');
      })
      .catch(function(err) {
        console.error('[MMR][admin] getPendingEvents error:', err && err.message);
        el.innerHTML = '<div class="empty-state">Error: ' + esc(err && err.message) + '</div>';
      });
  }

  function loadUnmatched() {
    console.log('[MMR][admin] loadUnmatched, adminEmail:', adminEmail);
    var el = document.getElementById('unmatched-list');
    el.innerHTML = '<div class="empty-state">Loading…</div>';
    callApi('getUnmatchedPayments', { adminEmail: adminEmail })
      .then(function(data) {
        var payments = data.payments || [];
        console.log('[MMR][admin] getUnmatchedPayments returned', payments.length, 'payments');
        if (!payments.length) { el.innerHTML = '<div class="empty-state">No unmatched payments.</div>'; return; }
        el.innerHTML = payments.map(function(p) {
          return '<div class="card">' +
            '<h3>' + esc(p.sender) + ' &mdash; $' + esc(p.amount) + ' via ' + esc(p.source) + '</h3>' +
            '<div class="meta">' + esc(p.transactionDate || p.timestamp) + '</div>' +
            '<div class="detail-grid">' +
            '<div class="detail-item"><label>Memo</label><span>' + esc(p.memo) + '</span></div>' +
            '<div class="detail-item"><label>Original Memo</label><span>' + esc(p.originalMemo || '—') + '</span></div>' +
            '<div class="detail-item"><label>Transaction #</label><span>' + esc(p.transactionNumber || '—') + '</span></div>' +
            '<div class="detail-item"><label>Message ID</label><span>' + esc(p.messageId || '—') + '</span></div>' +
            '</div></div>';
        }).join('');
      })
      .catch(function(err) {
        console.error('[MMR][admin] getUnmatchedPayments error:', err && err.message);
        el.innerHTML = '<div class="empty-state">Error: ' + esc(err && err.message) + '</div>';
      });
  }

  function loadConfig() {
    console.log('[MMR][admin] loadConfig, adminEmail:', adminEmail);
    callApi('getConfig', { adminEmail: adminEmail, caller: 'admin-page-init' })
      .then(function(data) {
        configData = data.config || {};
        console.log('[MMR][admin] getConfig returned', Object.keys(configData).length, 'keys');
        var body = document.getElementById('config-body');
        body.innerHTML = Object.keys(configData).map(function(key) {
          var value = configData[key];
          return '<tr>' +
            '<td><strong>' + esc(key) + '</strong></td>' +
            '<td><input type="text" id="cfg-' + esc(key) + '" value="' + esc(value) + '" /></td>' +
            '<td style="color:#999;font-size:13px;"></td>' +
            '<td><button class="btn btn-save-config" onclick="saveConfig(\'' + esc(key) + '\')">Save</button></td>' +
            '</tr>';
        }).join('');
      })
      .catch(function(err) {
        console.error('[MMR][admin] getConfig error:', err && err.message);
        document.getElementById('config-body').innerHTML = '<tr><td colspan="4">Error: ' + esc(err && err.message) + '</td></tr>';
      });
  }

  function approve(eventID) {
    // Warn admin if this is a Family Upgrade for an inactive member
    const ev = eventsCache[eventID];  // keep a local cache when loadPending() runs
    if (ev?.paymentIntent === 'Family Upgrade' && ev?.memberStatus !== 'active') {
      showGlobalMsg('⚠️ Warning: Member is not active. Family Upgrade requires active Individual membership.', 'error');
      return;
    }
    
    var notesEl = document.getElementById('notes-' + eventID);
    var notes = notesEl ? notesEl.value : '';
    console.log('[MMR][admin] approve eventID:', eventID, '| notes:', notes);
    callApi('approveRenewal', { eventID: eventID, adminEmail: adminEmail, notes: notes })
      .then(function() { showGlobalMsg('Renewal approved!', 'success'); loadPending(); })
      .catch(function(err) { showGlobalMsg('Error: ' + (err && err.message), 'error'); });
  }

  function reject(eventID) {
    var notesEl = document.getElementById('notes-' + eventID);
    var notes = notesEl ? notesEl.value : '';
    if (!notes) return showGlobalMsg('Please add a note explaining the rejection.', 'error');
    console.log('[MMR][admin] reject eventID:', eventID, '| notes:', notes);
    callApi('rejectRenewal', { eventID: eventID, adminEmail: adminEmail, notes: notes })
      .then(function() { showGlobalMsg('Renewal rejected.', 'success'); loadPending(); })
      .catch(function(err) { showGlobalMsg('Error: ' + (err && err.message), 'error'); });
  }

  function reconcile() {
    console.log('[MMR][admin] reconcile triggered');
    showGlobalMsg('Running reconciliation…', 'success');
    callApi('reconcileWebAppWithGmail', {})
      .then(function(data) {
        console.log('[MMR][admin] reconcile done, matchCount:', data.matchCount);
        showGlobalMsg('Done! ' + data.matchCount + ' payment(s) matched.', 'success');
        loadPending();
      })
      .catch(function(err) { showGlobalMsg('Error: ' + (err && err.message), 'error'); });
  }

  function saveConfig(key) {
    var inputEl = document.getElementById('cfg-' + key);
    var value = inputEl ? inputEl.value : '';
    console.log('[MMR][admin] saveConfig key:', key, '| value:', value);
    callApi('updateConfigEntry', { adminEmail: adminEmail, key: key, value: value })
      .then(function() { showGlobalMsg('Saved: ' + key, 'success'); })
      .catch(function(err) { showGlobalMsg('Error: ' + (err && err.message), 'error'); });
  }

  // ---- Init ----
  const cached = sessionStorage.getItem('member');
  if (cached) {
    try { adminEmail = JSON.parse(cached).email || ''; } catch (_) {}
  }
  console.log('[MMR][admin] adminEmail from sessionStorage:', adminEmail);

  function showUnauthorized(reason) {
    document.querySelector('.container').innerHTML =
      '<div class="card" style="text-align:center;padding:40px;">' +
      '<p style="font-size:20px;margin-bottom:12px;">🔒</p>' +
      '<p style="font-weight:700;margin-bottom:8px;">Access Denied</p>' +
      '<p style="color:#888;margin-bottom:20px;">' + esc(reason) + '</p>' +
      '<a href="' + appBaseUrl + '?page=dashboard" style="color:#5c35a8;">← Back to Dashboard</a>' +
      '</div>';
  }

  if (!adminEmail) {
    showUnauthorized('No session found. Please sign in.');
  } else {
    // Verify admin status server-side before loading any panels.
    // getConfig() returns FORBIDDEN if the email is not in AdminEmails config.
    console.log('[MMR][admin] verifying admin status for:', adminEmail);
    callApi('getConfig', { adminEmail: adminEmail, caller: 'admin-page-auth-check' })
      .then(function(data) {
        console.log('[MMR][admin] admin verified, loading panels');
        // Seed configData from the auth check so Config tab doesn't need a second call
        configData = data.config || {};
        loadPending();
        loadUnmatched();
        loadPaymentProofs();
        loadConfig();
      })
      .catch(function(err) {
        console.warn('[MMR][admin] admin check failed:', err && err.message);
        showUnauthorized('You do not have admin access.');
      });
  }
</script>
</body>
</html>

```


---
## File: `frontend/page_dashboard.html`
---

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Misty Mountain Runners — Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; min-height: 100vh; }
    .topbar { background: #2d7d46; color: #fff; padding: 14px 24px; display: flex; justify-content: space-between; align-items: center; }
    .topbar h1 { font-size: 18px; font-weight: 700; }
    .topbar a { color: #fff; text-decoration: none; font-size: 14px; opacity: 0.85; }
    .topbar a:hover { opacity: 1; }
    .container { max-width: 600px; margin: 32px auto; padding: 0 16px; }
    .card { background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); padding: 28px; margin-bottom: 20px; }
    .card h2 { font-size: 16px; font-weight: 700; color: #333; margin-bottom: 18px; }
    .welcome { font-size: 22px; font-weight: 700; color: #1a1a1a; margin-bottom: 4px; }
    .member-id { font-size: 13px; color: #888; margin-bottom: 20px; }
    .status-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 600; margin-bottom: 16px; }
    .status-active    { background: #e8f5e9; color: #2d7d46; }
    .status-inactive  { background: #fdecea; color: #c62828; }
    .status-expiring  { background: #fff8e1; color: #f57c00; }
    .status-pending   { background: #fff3e0; color: #e65100; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .info-item label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.4px; display: block; margin-bottom: 2px; }
    .info-item span { font-size: 15px; color: #1a1a1a; font-weight: 500; }
    .expiry-date { font-size: 18px; font-weight: 700; }
    .expiry-date.expired  { color: #c62828; }
    .expiry-date.expiring { color: #f57c00; }
    .expiry-date.active   { color: #2d7d46; }
    /* Action buttons */
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 22px; }
    .btn { padding: 11px 20px; border-radius: 8px; border: none; font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-block; }
    .btn-primary   { background: #2d7d46; color: #fff; }
    .btn-primary:hover { background: #235f36; }
    .btn-secondary { background: #fff; color: #2d7d46; border: 1.5px solid #2d7d46; }
    .btn-secondary:hover { background: #f0f8f2; }
    .btn-admin     { background: #5c35a8; color: #fff; }
    .btn-admin:hover { background: #4a2b8a; }
    .btn-ghost     { background: #fff; color: #555; border: 1.5px solid #ccc; }
    .btn-ghost:hover { background: #f5f5f5; border-color: #aaa; color: #333; }
    .btn-danger    { background: #fff; color: #c62828; border: 1.5px solid #c62828; }
    .btn-danger:hover { background: #fdecea; }
    .btn-pending   { background: #fff; color: #e65100; border: 1.5px solid #ffcc80; }
    .btn-pending:hover { background: #fff8e1; }
    /* Status/info messages within action area */
    .action-msg { width: 100%; padding: 12px 14px; border-radius: 8px; font-size: 13px; line-height: 1.5; margin-bottom: 4px; }
    .action-msg-warning { background: #fff3e0; border: 1px solid #ffb74d; color: #e65100; }
    .action-msg-info    { background: #e3f2fd; border: 1px solid #90caf9; color: #1565c0; }
    .action-msg-success { background: #e8f5e9; border: 1px solid #a5d6a7; color: #2d7d46; }
    /* Profile card */
    .profile-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; margin-bottom: 16px; }
    .profile-row label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.4px; display: block; margin-bottom: 2px; }
    .profile-row span { font-size: 14px; color: #1a1a1a; }
    .profile-row span.empty { color: #bbb; font-style: italic; }
    .profile-warning { background: #fff3e0; border: 1px solid #ffb74d; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #e65100; margin-bottom: 14px; }
    #loading { text-align: center; padding: 60px; color: #888; }
    #content { display: none; }
  </style>
</head>
<body>

<div class="topbar">
  <h1>🏃 Misty Mountain Runners</h1>
  <div style="display:flex;gap:20px;align-items:center;">
    <a href="?page=profile">Profile</a>
    <a href="?page=login" id="signOutLink">Sign Out</a>
  </div>
</div>

<div class="container">
  <div id="loading">Loading your profile…</div>
  <div id="content">

    <!-- Status card -->
    <div class="card">
      <div class="welcome" id="welcomeName"></div>
      <div class="member-id" id="memberMeta"></div>
      <span class="status-badge" id="statusBadge"></span>
      <div class="info-grid">
        <div class="info-item">
          <label>Membership Expires</label>
          <span class="expiry-date" id="expiryDate">—</span>
        </div>
        <div class="info-item">
          <label>Join Year</label>
          <span id="joinYear">—</span>
        </div>
        <div class="info-item">
          <label>Membership Type</label>
          <span id="memberType">—</span>
        </div>
        <div class="info-item">
          <label>District</label>
          <span id="district">—</span>
        </div>
      </div>

      <!-- Dynamic action buttons — populated by renderActionButtons() -->
      <div class="actions" id="actionButtons">
        <span style="color:#aaa;font-size:13px;">Loading actions…</span>
      </div>
    </div>

    <!-- Profile confirmation card (Section 2) -->
    <div class="card" id="profileCard">
      <h2>Is your information correct?</h2>
      <div id="profileWarning" class="profile-warning" style="display:none;">
        Some fields are empty — please update your profile.
      </div>
      <div class="profile-grid" id="profileGrid"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;">
        <a href="?page=profile" class="btn btn-secondary">Update Profile</a>
        <a href="#" id="paymentHistoryBtn" class="btn btn-ghost">Payment History</a>
        <a href="?page=admin" class="btn btn-admin" id="adminBtn" style="display:none;">Admin Panel</a>
      </div>
    </div>

  </div>
</div>

<script>
  var appBaseUrl = '__SCRIPT_URL__';
  var currentMember = null;
  var cachedEvents  = [];
  var configCache   = {};

  const SESSION_ID = Math.random().toString(36).slice(2);

  // Navigate relative ?page= links through window.top using absolute URL
  document.addEventListener('click', function(e) {
    var a = e.target.closest('a[href]');
    if (a) {
      var h = a.getAttribute('href');
      if (h && h.charAt(0) === '?') {
        e.preventDefault();
        window.top.location.href = appBaseUrl + h;
      }
    }
  });

  document.getElementById('signOutLink').addEventListener('click', function() {
    sessionStorage.removeItem('member');
  });

  // ---- API helper ----
  function callApi(fn, payload) {
    return new Promise(function(resolve, reject) {
      var req = { requestId: Math.random().toString(36).slice(2), payload: payload };
      google.script.run
        .withSuccessHandler(function(r) {
          var res = JSON.parse(r);
          if (res.ok) resolve(res.payload);
          else reject(new Error(res.errorMessage));
        })
        .withFailureHandler(function(err) { reject(err); })
        [fn](JSON.stringify(req));
    });
  }

  // ---- Date helpers ----
  function getDaysUntilExpiry(expirationStr) {
    if (!expirationStr) return -9999;
    var exp = new Date(expirationStr);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.floor((exp - today) / (1000 * 60 * 60 * 24));
  }

  function fmtDate(str) {
    if (!str) return 'Not set';
    return new Date(str).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ---- Status badge ----
  function renderStatusBadge(member, hasPendingPayment) {
    var badgeEl  = document.getElementById('statusBadge');
    var expiryEl = document.getElementById('expiryDate');
    var days = getDaysUntilExpiry(member.expiration);

    if (member.status === 'pending_upgrade') {
      badgeEl.textContent  = '⏳ Upgrade Pending';
      badgeEl.className    = 'status-badge status-pending';
      expiryEl.className   = 'expiry-date expiring';
    } else if (hasPendingPayment) {
      badgeEl.textContent  = '⏳ Payment Pending';
      badgeEl.className    = 'status-badge status-pending';
      expiryEl.className   = 'expiry-date expiring';
    } else if (member.status === 'active') {
      if (days <= 7) {
        badgeEl.textContent = '🔴 Expiring Very Soon';
        badgeEl.className   = 'status-badge status-inactive';
        expiryEl.className  = 'expiry-date expired';
      } else if (days <= 42) {
        badgeEl.textContent = '🟡 Active — Renew Soon';
        badgeEl.className   = 'status-badge status-expiring';
        expiryEl.className  = 'expiry-date expiring';
      } else {
        badgeEl.textContent = '🟢 Active';
        badgeEl.className   = 'status-badge status-active';
        expiryEl.className  = 'expiry-date active';
      }
    } else {
      // inactive
      badgeEl.textContent = '🔴 Inactive';
      badgeEl.className   = 'status-badge status-inactive';
      expiryEl.className  = 'expiry-date expired';
    }

    expiryEl.textContent = fmtDate(member.expiration);
  }

  // ---- Action buttons ----
  // Renders the dynamic button set based on PRDv4 §8.3 logic.
  function renderActionButtons(member, events) {
    var container = document.getElementById('actionButtons');
    container.innerHTML = '';

    var PAYMENT_TYPES = ['dues_payment', 'family_switch', 'family_upgrade'];
    var pendingPaymentEvents = (events || []).filter(function(e) {
      return PAYMENT_TYPES.indexOf(e.eventType) !== -1 && e.status === 'Pending';
    });
    var hasPendingPayment = pendingPaymentEvents.length > 0;
    var hasAnyPending = (events || []).some(function(e) {
      return e.status === 'Pending' || e.status === 'Matched';
    });

    var days        = getDaysUntilExpiry(member.expiration);
    var REMIND_DAYS = parseInt(configCache['ReminderDaysBefore'] || '42', 10);
    var MIN_MONTHS  = parseInt(configCache['UpgradeMinMonths']   || '3', 10);
    var indivPrice  = parseFloat(configCache['IndividualPrice']  || '30');
    var familyPrice = parseFloat(configCache['FamilyPrice']      || '50');
    var upgradePrice= parseFloat(configCache['FamilyUpgradePrice']|| '20');
    var THREE_MONTHS_DAYS = MIN_MONTHS * 30;

    // ── View Pending Requests — always show when any pending event ──────────
    if (hasAnyPending) {
      addBtn(container, '⏳ View Pending Requests',
        '?page=payment_history&memberId=' + member.memberID, 'btn-pending');
    }

    // ── Pending Upgrade state ─────────────────────────────────────────────
    if (member.status === 'pending_upgrade') {
      if (hasPendingPayment) {
        // Sub-state 1: proof submitted, awaiting review
        addMsg(container, '⏳ Your upgrade payment is under review. We\'ll notify you of the result.', 'action-msg-info');
      } else {
        // Sub-state 2: no proof submitted yet
        addMsg(container, '⚠️ Please submit payment proof to complete your Family upgrade.', 'action-msg-warning');
        addBtn(container, 'Submit Payment Proof',
          '?page=payment_proof&memberId=' + member.memberID, 'btn-primary');
      }
      addActionBtn(container, 'Cancel Upgrade', 'btn-danger', function() {
        doCancelUpgrade(member);
      });
      if (member.type === 'Family') {
        addBtn(container, 'Manage Family', '?page=family&memberId=' + member.memberID, 'btn-secondary');
      }
      return; // No further payment buttons when pending_upgrade
    }

    // ── Payment buttons (suppressed if pending payment exists) ───────────
    if (!hasPendingPayment) {
      var isInactiveOrExpiring = member.status === 'inactive' || days < REMIND_DAYS;

      if (member.type === 'Individual') {
        if (isInactiveOrExpiring) {
          // Pay Dues + Switch to Family
          addBtn(container,
            'Pay Dues — $' + indivPrice,
            '?page=payment&intent=' + encodeURIComponent('Individual Membership') + '&amount=' + indivPrice,
            'btn-primary');
          addActionBtn(container,
            'Switch to Family — $' + familyPrice,
            'btn-secondary',
            function() { doInitiateSwitch(member, familyPrice); });
        } else if (days >= REMIND_DAYS && days <= THREE_MONTHS_DAYS) {
          // Both Switch and Upgrade (user's choice)
          addActionBtn(container,
            'Switch to Family — $' + familyPrice,
            'btn-secondary',
            function() { doInitiateSwitch(member, familyPrice); });
          addActionBtn(container,
            'Upgrade to Family — $' + upgradePrice + ' (no expiry change)',
            'btn-secondary',
            function() { doInitiateUpgrade(member, upgradePrice); });
        } else {
          // Upgrade to Family only (> 3 months remaining)
          addActionBtn(container,
            'Upgrade to Family — $' + upgradePrice,
            'btn-secondary',
            function() { doInitiateUpgrade(member, upgradePrice); });
        }
      } else if (member.type === 'Family') {
        if (isInactiveOrExpiring) {
          addBtn(container,
            'Pay Dues — $' + familyPrice,
            '?page=payment&intent=' + encodeURIComponent('Family Membership') + '&amount=' + familyPrice,
            'btn-primary');
        }
        addBtn(container, 'Manage Family',
          '?page=family&memberId=' + member.memberID, 'btn-secondary');
      }
    }
  }

  // ---- Button/message builder helpers ----
  function addBtn(container, label, href, cls) {
    var a = document.createElement('a');
    a.href      = href;
    a.className = 'btn ' + cls;
    a.textContent = label;
    container.appendChild(a);
  }

  function addActionBtn(container, label, cls, handler) {
    var btn = document.createElement('button');
    btn.className   = 'btn ' + cls;
    btn.textContent = label;
    btn.addEventListener('click', handler);
    container.appendChild(btn);
  }

  function addMsg(container, text, cls) {
    var div = document.createElement('div');
    div.className   = 'action-msg ' + cls;
    div.textContent = text;
    container.appendChild(div);
  }

  // ---- Initiate Switch to Family ----
  function doInitiateSwitch(member, amount) {
    if (!confirm(
      'Switch to Family membership?\n\n' +
      'Your membership type will change to Family and marked as pending until $' + amount + ' is paid.\n\n' +
      'Continue?'
    )) return;

    var btn = event.currentTarget;
    btn.disabled    = true;
    btn.textContent = 'Processing…';

    callApi('initiateSwitch', { memberID: member.memberID, email: member.email, sessionID: SESSION_ID })
      .then(function(data) {
        // Update local cache so the "Continue" button navigates with correct state
        var updated = Object.assign({}, member, {
          status: 'pending_upgrade', type: 'Family', familyID: data.familyID,
        });
        sessionStorage.setItem('member', JSON.stringify(updated));
        currentMember = updated;

        // GAS iframe requires navigation from a user gesture — show Continue button
        var container = document.getElementById('actionButtons');
        container.innerHTML = '';
        addMsg(container,
          '✅ Switched to Family. Please pay $' + amount + ' to activate your membership.',
          'action-msg-success');
        var cont = document.createElement('button');
        cont.className   = 'btn btn-primary';
        cont.textContent = 'Continue to Payment →';
        cont.addEventListener('click', function() {
          window.top.location.href = appBaseUrl +
            '?page=payment&intent=' + encodeURIComponent('Family Membership') + '&amount=' + amount;
        });
        container.appendChild(cont);
        // Refresh badge
        renderStatusBadge(updated, false);
      })
      .catch(function(err) {
        btn.disabled    = false;
        btn.textContent = 'Switch to Family — $' + amount;
        alert('Error: ' + (err && err.message || 'Unknown error. Please try again.'));
      });
  }

  // ---- Initiate Upgrade to Family ----
  function doInitiateUpgrade(member, amount) {
    if (!confirm(
      'Upgrade to Family membership?\n\n' +
      'You will pay $' + amount + ' (delta). Your expiration date will NOT change.\n\n' +
      'Continue?'
    )) return;

    var btn = event.currentTarget;
    btn.disabled    = true;
    btn.textContent = 'Processing…';

    callApi('initiateUpgrade', { memberID: member.memberID, email: member.email, sessionID: SESSION_ID })
      .then(function(data) {
        var updated = Object.assign({}, member, {
          status: 'pending_upgrade', type: 'Family', familyID: data.familyID,
        });
        sessionStorage.setItem('member', JSON.stringify(updated));
        currentMember = updated;

        var container = document.getElementById('actionButtons');
        container.innerHTML = '';
        addMsg(container,
          '✅ Upgrade initiated. Please pay $' + amount + ' upgrade fee. Your expiration date is unchanged.',
          'action-msg-success');
        var cont = document.createElement('button');
        cont.className   = 'btn btn-primary';
        cont.textContent = 'Continue to Payment →';
        cont.addEventListener('click', function() {
          window.top.location.href = appBaseUrl +
            '?page=payment&intent=' + encodeURIComponent('Family Upgrade') + '&amount=' + amount;
        });
        container.appendChild(cont);
        renderStatusBadge(updated, false);
      })
      .catch(function(err) {
        btn.disabled    = false;
        btn.textContent = 'Upgrade to Family — $' + amount;
        alert('Error: ' + (err && err.message || 'Unknown error. Please try again.'));
      });
  }

  // ---- Cancel Upgrade ----
  function doCancelUpgrade(member) {
    if (!confirm(
      'Cancel Family upgrade?\n\n' +
      'All family members will revert to Individual membership. ' +
      'Any pending payment proof will be rejected.\n\n' +
      'Continue?'
    )) return;

    callApi('cancelUpgrade', { memberID: member.memberID, email: member.email, sessionID: SESSION_ID })
      .then(function() {
        var container = document.getElementById('actionButtons');
        container.innerHTML = '';
        addMsg(container,
          '✅ Upgrade cancelled. All members reverted to Individual.',
          'action-msg-success');
        var cont = document.createElement('button');
        cont.className   = 'btn btn-secondary';
        cont.textContent = 'Reload Dashboard →';
        cont.addEventListener('click', function() {
          window.top.location.href = appBaseUrl + '?page=dashboard';
        });
        container.appendChild(cont);
      })
      .catch(function(err) {
        alert('Error: ' + (err && err.message || 'Unknown error. Please try again.'));
      });
  }

  // ---- Profile card ----
  function renderProfileCard(member) {
    var fields = [
      { label: 'First Name', value: member.firstName },
      { label: 'Last Name',  value: member.lastName },
      { label: 'Email',      value: member.email },
      { label: 'Phone',      value: member.phoneNumber },
      { label: 'WeChat ID',  value: member.wechatID },
      { label: 'District',   value: member.district },
    ];
    var anyEmpty = !member.firstName || !member.lastName || !member.phoneNumber;
    document.getElementById('profileWarning').style.display = anyEmpty ? 'block' : 'none';

    var grid = document.getElementById('profileGrid');
    grid.innerHTML = '';
    fields.forEach(function(f) {
      var div = document.createElement('div');
      div.className = 'profile-row';
      var lbl = document.createElement('label');
      lbl.textContent = f.label;
      var val = document.createElement('span');
      if (f.value) {
        val.textContent = f.value;
      } else {
        val.textContent = 'Not set';
        val.className = 'empty';
      }
      div.appendChild(lbl);
      div.appendChild(val);
      grid.appendChild(div);
    });
  }

  // ---- Main render ----
  function renderMember(member, events) {
    currentMember = member;
    cachedEvents  = events || [];

    document.getElementById('welcomeName').textContent =
      'Welcome, ' + (member.firstName || member.email) + '!';
    document.getElementById('memberMeta').textContent =
      member.memberID + (member.familyID ? ' · Family ' + member.familyID : '');

    var PAYMENT_TYPES   = ['dues_payment', 'family_switch', 'family_upgrade'];
    var hasPendingPayment = (events || []).some(function(e) {
      return PAYMENT_TYPES.indexOf(e.eventType) !== -1 && e.status === 'Pending';
    });

    renderStatusBadge(member, hasPendingPayment);

    document.getElementById('joinYear').textContent   = member.joinYear  || '—';
    document.getElementById('memberType').textContent = member.type      || '—';
    document.getElementById('district').textContent   = member.district  || '—';

    document.getElementById('paymentHistoryBtn').href =
      '?page=payment_history&memberId=' + member.memberID;

    renderProfileCard(member);
    renderActionButtons(member, events);

    // Admin button (non-blocking)
    callApi('getConfig', { adminEmail: member.email, caller: 'dashboard-admin-check' })
      .then(function() {
        document.getElementById('adminBtn').style.display = 'inline-block';
      })
      .catch(function() { /* not admin */ });

    document.getElementById('loading').style.display = 'none';
    document.getElementById('content').style.display = 'block';
  }

  // ---- Load config + member ----
  // We load config first (prices, thresholds) then member + events in parallel.
  var configPromise = callApi('getPublicConfig', {})
    .then(function(data) { configCache = data || {}; })
    .catch(function() { /* use defaults */ });

  var eventsPromise = null;
  var memberPromise = null;

  var cached = sessionStorage.getItem('member');
  if (cached) {
    try {
      var m = JSON.parse(cached);
      // Render immediately from cache with empty events (events load separately)
      configPromise.then(function() {
        renderMember(m, []);
      });
    } catch (e) {
      console.error('[MMR][dashboard] failed to parse cached member:', e);
    }
  }

  var memberEmail = '';
  if (cached) { try { memberEmail = JSON.parse(cached).email || ''; } catch (_) {} }

  // Load fresh member data + events in parallel
  Promise.all([
    configPromise,
    callApi('getOrCreateMemberProfile', { email: memberEmail, sessionID: SESSION_ID }),
    callApi('getMemberPaymentHistory',   { email: memberEmail, sessionID: SESSION_ID }),
  ]).then(function(results) {
    var profileData = results[1];
    var historyData = results[2];

    // Guard against server returning wrong memberID (GAS admin account fallback)
    if (cached && profileData.member.memberID !== currentMember?.memberID) {
      console.warn('[MMR][dashboard] server memberID mismatch — keeping cached session');
      // Still update events with correct data
      renderMember(currentMember, historyData.events || []);
      return;
    }

    sessionStorage.setItem('member', JSON.stringify(profileData.member));
    renderMember(profileData.member, historyData.events || []);
  }).catch(function(err) {
    console.error('[MMR][dashboard] load error:', err && err.message);
    if (!cached) {
      var loadingEl = document.getElementById('loading');
      loadingEl.style.display = 'block';
      loadingEl.innerHTML = 'Session expired. <a href="?page=login" style="color:#2d7d46">Sign in again</a>';
    }
  });

</script>
</body>
</html>

```


---
## File: `frontend/page_family.html`
---

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Misty Mountain Runners — Family Members</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; min-height: 100vh; }
    .topbar { background: #2d7d46; color: #fff; padding: 14px 24px; display: flex; justify-content: space-between; align-items: center; }
    .topbar h1 { font-size: 18px; font-weight: 700; }
    .topbar a { color: #fff; text-decoration: none; font-size: 14px; opacity: 0.85; }
    .container { max-width: 600px; margin: 32px auto; padding: 0 16px; }
    .card { background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); padding: 28px; margin-bottom: 20px; }
    .placeholder { text-align: center; padding: 48px 24px; color: #888; }
    .placeholder h2 { font-size: 20px; font-weight: 700; color: #333; margin-bottom: 12px; }
    .placeholder p { font-size: 14px; line-height: 1.6; }
    .btn { padding: 11px 20px; border-radius: 8px; border: none; font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-block; margin-top: 20px; }
    .btn-secondary { background: #fff; color: #2d7d46; border: 1.5px solid #2d7d46; }
  </style>
</head>
<body>

<div class="topbar">
  <h1>🏃 Misty Mountain Runners</h1>
  <a href="?page=dashboard">← Dashboard</a>
</div>

<div class="container">
  <div class="card">
    <div class="placeholder">
      <h2>Family Members</h2>
      <p>Family member management is coming soon.<br>
         You'll be able to add and remove family members from this page.</p>
      <a href="?page=dashboard" class="btn btn-secondary">← Back to Dashboard</a>
    </div>
  </div>
</div>

<script>
  var appBaseUrl = '__SCRIPT_URL__';
  document.addEventListener('click', function(e) {
    var a = e.target.closest('a[href]');
    if (a) {
      var h = a.getAttribute('href');
      if (h && h.charAt(0) === '?') {
        e.preventDefault();
        window.top.location.href = appBaseUrl + h;
      }
    }
  });
</script>
</body>
</html>

```


---
## File: `frontend/page_login.html`
---

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Misty Mountain Runners — Login</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f5f5f5; min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
    }
    .card {
      background: #fff; border-radius: 16px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.10);
      padding: 40px 32px; width: 100%; max-width: 400px;
    }
    .logo { text-align: center; font-size: 40px; margin-bottom: 8px; }
    .app-title { text-align: center; font-size: 22px; font-weight: 700; color: #1a1a1a; margin-bottom: 4px; }
    .subtitle { text-align: center; font-size: 14px; color: #777; margin-bottom: 28px; }

    /* Messages */
    .msg { font-size: 14px; padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; display: none; }
    .msg.success { background: #e8f5e9; color: #2d7d46; display: block; }
    .msg.error   { background: #fdecea; color: #c62828; display: block; }
    .msg.info    { background: #e3f2fd; color: #1565c0; display: block; }

    /* Inputs */
    input[type="email"], input[type="text"] {
      width: 100%; padding: 13px 14px;
      border: 1.5px solid #ddd; border-radius: 10px;
      font-size: 15px; margin-bottom: 12px;
      transition: border-color 0.2s;
    }
    input:focus { border-color: #2d7d46; outline: none; }

    /* Buttons */
    .btn {
      width: 100%; padding: 13px;
      border-radius: 10px; border: none;
      font-size: 15px; font-weight: 600;
      cursor: pointer; transition: background 0.2s;
      margin-bottom: 10px;
    }
    .btn:disabled { opacity: 0.55; cursor: not-allowed; }
    .btn-primary   { background: #2d7d46; color: #fff; }
    .btn-primary:hover:not(:disabled) { background: #235f36; }
    .btn-google    { background: #fff; color: #333; border: 1.5px solid #ddd; }
    .btn-google:hover:not(:disabled) { background: #f5f5f5; }
    .btn-outline   { background: #fff; color: #2d7d46; border: 1.5px solid #2d7d46; }
    .btn-outline:hover:not(:disabled) { background: #f0f8f2; }
    .btn-ghost {
      background: none; border: none; color: #888;
      font-size: 13px; cursor: pointer; padding: 4px 0;
      text-decoration: underline; width: auto; margin-bottom: 0;
    }
    .btn-ghost:hover { color: #444; }

    .divider { display: flex; align-items: center; gap: 10px; margin: 18px 0; color: #bbb; font-size: 13px; }
    .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: #eee; }

    /* Result boxes */
    .result-box {
      border-radius: 10px; padding: 18px 16px; margin-bottom: 20px; text-align: center;
    }
    .result-box.returning { background: #e8f5e9; border: 1px solid #a5d6a7; }
    .result-box.new-member { background: #e3f2fd; border: 1px solid #90caf9; }
    .result-box .result-icon { font-size: 28px; margin-bottom: 6px; }
    .result-box h3 { font-size: 17px; font-weight: 700; color: #1a1a1a; margin-bottom: 4px; }
    .result-box p  { font-size: 13px; color: #555; line-height: 1.5; }

    /* OTP sub-section */
    .otp-section { margin-top: 20px; border-top: 1px solid #f0f0f0; padding-top: 20px; }
    .otp-section label { font-size: 13px; color: #555; display: block; margin-bottom: 6px; }

    /* Spinner */
    .spinner {
      display: inline-block; width: 16px; height: 16px;
      border: 2px solid rgba(255,255,255,0.4);
      border-top-color: #fff; border-radius: 50%;
      animation: spin 0.7s linear infinite; margin-right: 6px; vertical-align: middle;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    #dbg { font-size: 11px; color: #bbb; margin-top: 12px; text-align: center; }

    /* not show Google loginn for now since it requires extra setup and isn't the primary path in the current codebase */
    #googleBtn, #googleSpinner, .divider { display: none; }

  </style>
</head>
<body>
<div class="card">
  <div class="logo">🏃</div>
  <div class="app-title">Misty Mountain Runners</div>

  <!-- ═══════════════════════════════════════════
       STATE 1: Email entry + Google sign-in
  ════════════════════════════════════════════ -->
  <div id="state-email">
    <p class="subtitle">Sign in or register</p>
    <div id="msg-email" class="msg"></div>

    <button class="btn btn-google" id="googleBtn" onclick="loginWithGoogle()" style="display:none;">
      <img src="https://www.google.com/favicon.ico"
           style="width:16px;height:16px;vertical-align:middle;margin-right:8px;" />
      Sign in with Google
    </button>
    <span id="googleSpinner" style="display:none;"><span class="spinner"></span></span>

    <div class="divider"  style="display:none;">or sign in with email</div>

    <input type="email" id="emailInput"
           placeholder="your@email.com"
           onkeydown="if(event.key==='Enter') checkEmail()" />
    <button class="btn btn-primary" id="checkEmailBtn" onclick="checkEmail()">
      Continue →
    </button>
  </div>

  <!-- ═══════════════════════════════════════════
       STATE 2A: Returning member found
  ════════════════════════════════════════════ -->
  <div id="state-returning" style="display:none">
    <div class="result-box returning">
      <div class="result-icon">👋</div>
      <h3>Welcome back, <span id="returning-name"></span>!</h3>
      <p>Member ID: <strong id="returning-memberid"></strong></p>
    </div>

    <div id="msg-returning" class="msg"></div>

    <div class="otp-section">
      <label>Enter your one-time login code, or request a new one.</label>
      <input type="text" id="otpInput-returning"
             placeholder="6-digit code" maxlength="6"
             inputmode="numeric" autocomplete="one-time-code"
             onkeydown="if(event.key==='Enter') verifyOtp('returning')" />
      <button class="btn btn-primary" id="verifyBtn-returning"
              onclick="verifyOtp('returning')">
        Verify Code →
      </button>
      <button class="btn btn-outline" id="sendBtn-returning"
              onclick="sendOtp('returning')">
        Send Me a New Code
      </button>
      <button class="btn-ghost" onclick="goBack()">← Try a different email</button>
    </div>
  </div>

  <!-- ═══════════════════════════════════════════
       STATE 2B: Email not found — ask intent
  ════════════════════════════════════════════ -->
  <div id="state-new-ask" style="display:none">
    <div class="result-box new-member">
      <div class="result-icon">✉️</div>
      <h3>No account found</h3>
      <p>We don't have a record for<br/><strong id="new-ask-email"></strong></p>
    </div>

    <div id="msg-new-ask" class="msg"></div>
    <p style="font-size:14px;color:#444;margin-bottom:16px;text-align:center;">
      Are you a new member?
    </p>

    <button class="btn btn-primary" id="newMemberYesBtn"
            onclick="startNewMemberOtp()">
      Yes — Register Me →
    </button>
    <button class="btn-ghost" style="display:block;text-align:center;width:100%;margin-top:4px;"
            onclick="goBack()">
      ← No, go back and change email
    </button>
  </div>

  <!-- ═══════════════════════════════════════════
       STATE 2B-verify: New member OTP entry
  ════════════════════════════════════════════ -->
  <div id="state-new-verify" style="display:none">
    <div class="result-box new-member">
      <div class="result-icon">✉️</div>
      <h3>Verify your email</h3>
      <p>Code sent to<br/><strong id="new-verify-email"></strong></p>
    </div>

    <div id="msg-new-verify" class="msg"></div>

    <div class="otp-section">
      <label>Enter the 6-digit code from your inbox.</label>
      <input type="text" id="otpInput-new"
             placeholder="6-digit code" maxlength="6"
             inputmode="numeric" autocomplete="one-time-code"
             onkeydown="if(event.key==='Enter') verifyOtp('new')" />
      <button class="btn btn-primary" id="verifyBtn-new"
              onclick="verifyOtp('new')">
        Verify Code →
      </button>
      <button class="btn btn-outline" id="sendBtn-new"
              onclick="sendOtp('new')">
        Resend Code
      </button>
      <button class="btn-ghost" onclick="goBack()">← Go back</button>
    </div>
  </div>

  <!-- ═══════════════════════════════════════════
       FINAL: Continue button (after OTP verified)
  ════════════════════════════════════════════ -->
  <div id="state-continue" style="display:none">
    <div id="continue-msg" style="margin-bottom:20px;"></div>
    <button class="btn btn-primary" id="continueBtn" onclick="onContinueClick()">
      Continue →
    </button>
  </div>

  <div id="dbg"></div>
</div>

<script>
  console.log('[MMR][login] page loaded, location:', window.location.href);
  var appBaseUrl = '__SCRIPT_URL__';
  var SESSION_ID = Math.random().toString(36).slice(2);
  var pendingPage = 'dashboard';
  var currentEmail = '';

  // ── Utilities ──────────────────────────────────────────────

  function callApi(fn, payload) {
    console.log('[MMR][login] callApi:', fn, JSON.stringify(payload));
    return new Promise(function(resolve, reject) {
      var req = { requestId: Math.random().toString(36).slice(2), payload: payload };
      google.script.run
        .withSuccessHandler(function(r) {
          var res = JSON.parse(r);
          console.log('[MMR][login]', fn, 'response:', JSON.stringify(res.payload || res));
          if (res.ok) resolve(res.payload);
          else reject(new Error(res.errorMessage));
        })
        .withFailureHandler(function(err) {
          console.error('[MMR][login]', fn, 'failure:', err);
          reject(err);
        })
        [fn](JSON.stringify(req));
    });
  }

  function showMsg(id, text, type) {
    var el = document.getElementById('msg-' + id);
    if (!el) return;
    el.textContent = text;
    el.className = 'msg ' + type;
  }
  function clearMsg(id) {
    var el = document.getElementById('msg-' + id);
    if (el) el.className = 'msg';
  }

  function showState(name) {
    var states = ['email', 'returning', 'new-ask', 'new-verify', 'continue'];
    states.forEach(function(s) {
      var el = document.getElementById('state-' + s);
      if (el) el.style.display = (s === name) ? 'block' : 'none';
    });
    document.getElementById('dbg').textContent = 'State: ' + name;
  }

  function goBack() {
    currentEmail = '';
    document.getElementById('emailInput').value = '';
    document.getElementById('otpInput-returning').value = '';
    document.getElementById('otpInput-new').value = '';
    document.getElementById('checkEmailBtn').disabled = false;
    clearMsg('email');
    showState('email');
    document.getElementById('emailInput').focus();
  }

  // ── Google OAuth ───────────────────────────────────────────

  function loginWithGoogle() {
    document.getElementById('googleBtn').disabled = true;
    document.getElementById('googleSpinner').style.display = 'inline';
    callApi('handleGoogleLogin', { email: '', sessionID: SESSION_ID })
      .then(function(data) {
        document.getElementById('googleSpinner').style.display = 'none';
        if (data.isNewMember) {
          sessionStorage.setItem('pending_email', data.email);
          showContinue(
            '<div class="result-box new-member"><div class="result-icon">✅</div>' +
            '<h3>Email verified</h3><p>New member registration for<br/><strong>' +
            esc(data.email) + '</strong></p></div>',
            'newmember'
          );
        } else {
          sessionStorage.setItem('member', JSON.stringify(data.member));
          showContinue(
            '<div class="result-box returning"><div class="result-icon">✅</div>' +
            '<h3>Welcome back, ' + esc(data.member.firstName || data.member.email) + '!</h3>' +
            '<p>Signed in with Google</p></div>',
            'dashboard'
          );
        }
      })
      .catch(function(err) {
        document.getElementById('googleSpinner').style.display = 'none';
        document.getElementById('googleBtn').disabled = false;
        showMsg('email', err.message || 'Google sign-in failed. Try email login.', 'error');
      });
  }

  // ── STATE 1 → STATE 2: Check email in database ─────────────

  function checkEmail() {
    var email = document.getElementById('emailInput').value.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return showMsg('email', 'Please enter a valid email address.', 'error');
    }
    currentEmail = email;
    clearMsg('email');
    var btn = document.getElementById('checkEmailBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Checking…';

    callApi('lookupEmail', { email: email, sessionID: SESSION_ID })
      .then(function(data) {
        btn.disabled = false;
        btn.textContent = 'Continue →';
        if (data.found) {
          // Returning member
          document.getElementById('returning-name').textContent =
            data.firstName || email;
          document.getElementById('returning-memberid').textContent =
            data.memberID || '';
          clearMsg('returning');
          showState('returning');
          document.getElementById('otpInput-returning').focus();
        } else {
          // Not found — ask if new member
          document.getElementById('new-ask-email').textContent = email;
          clearMsg('new-ask');
          showState('new-ask');
        }
      })
      .catch(function(err) {
        btn.disabled = false;
        btn.textContent = 'Continue →';
        showMsg('email', err.message || 'Could not check email. Please try again.', 'error');
      });
  }

  // ── OTP Send ────────────────────────────────────────────────

  function sendOtp(context) {
    // context: 'returning' | 'new'
    var btnId = 'sendBtn-' + context;
    var msgId = context === 'returning' ? 'returning' : 'new-verify';
    var btn = document.getElementById(btnId);
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Sending…';
    clearMsg(msgId);

    callApi('requestEmailOtp', { email: currentEmail, sessionID: SESSION_ID })
      .then(function() {
        btn.disabled = false;
        btn.textContent = context === 'returning' ? 'Send Me a New Code' : 'Resend Code';
        showMsg(msgId, '✓ Code sent to ' + currentEmail + '. Check your inbox.', 'success');
        var inputId = context === 'returning' ? 'otpInput-returning' : 'otpInput-new';
        document.getElementById(inputId).focus();
      })
      .catch(function(err) {
        btn.disabled = false;
        btn.textContent = context === 'returning' ? 'Send Me a New Code' : 'Resend Code';
        showMsg(msgId, err.message || 'Failed to send code. Please try again.', 'error');
      });
  }

  // ── New member: "Yes, register me" → send OTP then show verify ──

  function startNewMemberOtp() {
    var btn = document.getElementById('newMemberYesBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Sending code…';
    clearMsg('new-ask');

    callApi('requestEmailOtp', { email: currentEmail, sessionID: SESSION_ID })
      .then(function() {
        btn.disabled = false;
        btn.textContent = 'Yes — Register Me →';
        document.getElementById('new-verify-email').textContent = currentEmail;
        clearMsg('new-verify');
        showState('new-verify');
        document.getElementById('otpInput-new').focus();
      })
      .catch(function(err) {
        btn.disabled = false;
        btn.textContent = 'Yes — Register Me →';
        showMsg('new-ask', err.message || 'Failed to send code. Please try again.', 'error');
      });
  }

  // ── OTP Verify ──────────────────────────────────────────────

  function verifyOtp(context) {
    // context: 'returning' | 'new'
    var inputId = context === 'returning' ? 'otpInput-returning' : 'otpInput-new';
    var btnId   = context === 'returning' ? 'verifyBtn-returning' : 'verifyBtn-new';
    var msgId   = context === 'returning' ? 'returning' : 'new-verify';
    var otpCode = document.getElementById(inputId).value.trim();

    if (!otpCode || otpCode.length < 6) {
      return showMsg(msgId, 'Please enter the 6-digit code.', 'error');
    }

    var btn = document.getElementById(btnId);
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Verifying…';
    clearMsg(msgId);

    callApi('verifyEmailOtp', { email: currentEmail, otpCode: otpCode, sessionID: SESSION_ID })
      .then(function(data) {
        btn.disabled = false;
        btn.textContent = 'Verify Code →';

        if (data.otpNotFound) {
          // Stay on the same screen, but show the message from the server
          showMsg(msgId, data.message, 'info');
          return;
        }

        if (data.isNewMember) {
          sessionStorage.setItem('pending_email', data.email);
          showContinue(
            '<div class="result-box new-member"><div class="result-icon">✅</div>' +
            '<h3>Email verified!</h3>' +
            '<p>Let\'s set up your account for<br/><strong>' + esc(data.email) + '</strong></p></div>',
            'newmember'
          );
        } else {
          sessionStorage.setItem('member', JSON.stringify(data.member));
          showContinue(
            '<div class="result-box returning"><div class="result-icon">✅</div>' +
            '<h3>Welcome back, ' + esc(data.member.firstName || data.member.email) + '!</h3>' +
            '<p>Member ID: <strong>' + esc(data.member.memberID) + '</strong></p></div>',
            'dashboard'
          );
        }
      })
      .catch(function(err) {
        btn.disabled = false;
        btn.textContent = 'Verify Code →';
        showMsg(msgId, err.message || 'Invalid or expired code. Please try again.', 'error');
      });
  }

  // ── Final continue state ────────────────────────────────────

  function showContinue(msgHtml, page) {
    pendingPage = page;
    document.getElementById('continue-msg').innerHTML = msgHtml;
    var label = page === 'dashboard'  ? 'Continue to Dashboard →'
              : page === 'newmember'  ? 'Continue to Registration →'
              : 'Continue →';
    document.getElementById('continueBtn').textContent = label;
    showState('continue');
  }

  function onContinueClick() {
    var btn = document.getElementById('continueBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Loading…';
    var url = appBaseUrl + '?page=' + pendingPage;
    console.log('[MMR][login] navigating to:', url);
    window.top.location.href = url;
  }

  // ── HTML escape ─────────────────────────────────────────────
  function esc(str) {
    return String(str || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Init: redirect if already logged in ─────────────────────
  var cached = sessionStorage.getItem('member');
  if (cached) {
    var btn = document.getElementById('continueBtn');
    btn.style.display = 'block';
    btn.onclick = function() {
      window.top.location.href = appBaseUrl + '?page=dashboard';
    };
  }
</script>
</body>
</html>

```


---
## File: `frontend/page_newmember.html`
---

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Misty Mountain Runners — New Member Registration</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #fff; border-radius: 12px; box-shadow: 0 2px 16px rgba(0,0,0,0.10); padding: 40px 36px; width: 100%; max-width: 460px; }
    .logo { text-align: center; margin-bottom: 8px; font-size: 32px; }
    h1 { text-align: center; font-size: 20px; color: #1a1a1a; margin-bottom: 4px; }
    .notice { background: #fff8e1; border: 1px solid #ffe082; border-radius: 8px; padding: 12px 16px; font-size: 14px; color: #5d4037; margin: 20px 0; }
    .notice .email-highlight { font-weight: 700; color: #1a1a1a; }
    .field { margin-bottom: 16px; }
    label { display: block; font-size: 13px; font-weight: 600; color: #555; margin-bottom: 6px; }
    .required { color: #c62828; }
    input[type=text], input[type=tel] { width: 100%; padding: 10px 12px; border: 1px solid #ccc; border-radius: 8px; font-size: 15px; }
    input[readonly] { background: #f5f5f5; color: #888; cursor: default; }
    input:focus { outline: none; border-color: #2d7d46; box-shadow: 0 0 0 2px rgba(45,125,70,0.15); }
    .btn { display: block; width: 100%; padding: 12px; border-radius: 8px; border: none; font-size: 15px; font-weight: 600; cursor: pointer; text-align: center; }
    .btn-primary { background: #2d7d46; color: #fff; margin-top: 8px; }
    .btn-primary:hover { background: #235f36; }
    .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-link { background: none; border: none; color: #2d7d46; cursor: pointer; font-size: 13px; margin-top: 12px; text-decoration: underline; }
    .msg { font-size: 14px; padding: 10px 12px; border-radius: 8px; margin-bottom: 16px; display: none; }
    .msg.error { background: #fdecea; color: #c62828; display: block; }
    .success-view { display: none; text-align: center; padding: 20px 0; }
    .success-icon { font-size: 52px; margin-bottom: 16px; }
    .member-id-badge { display: inline-block; background: #e8f5e9; color: #1b5e20; font-size: 28px; font-weight: 800; letter-spacing: 2px; padding: 12px 28px; border-radius: 10px; margin: 12px 0 20px; border: 2px solid #a5d6a7; }
    .success-view p { color: #555; font-size: 15px; line-height: 1.6; margin-bottom: 20px; }
  </style>
</head>
<body>

<div class="card">
  <div class="logo">🏃</div>
  <h1>Misty Mountain Runners</h1>

  <!-- Registration form -->
  <div id="formView">
    <div class="notice">
      We don't recognize <span class="email-highlight" id="emailDisplay">this email</span>. If this is your correct email and you're signing up, please complete the form below.
    </div>

    <div id="msg" class="msg"></div>

    <div class="field">
      <label>Email (verified)</label>
      <input type="text" id="emailField" readonly />
    </div>
    <div class="field">
      <label>First Name <span class="required">*</span></label>
      <input type="text" id="firstName" placeholder="Your first name" />
    </div>
    <div class="field">
      <label>Last Name <span class="required">*</span></label>
      <input type="text" id="lastName" placeholder="Your last name" />
    </div>
    <div class="field">
      <label>Phone Number</label>
      <input type="tel" id="phoneNumber" placeholder="e.g. 917-555-1234" />
    </div>
    <div class="field">
      <label>District</label>
      <input type="text" id="district" placeholder="e.g. Queens, Brooklyn" />
    </div>

    <button class="btn btn-primary" id="submitBtn" onclick="submitRegistration()">Register →</button>
    <button class="btn-link" onclick="goToLogin()">← Not your email? Sign in again</button>
  </div>

  <!-- Success view -->
  <div id="successView" class="success-view">
    <div class="success-icon">🎉</div>
    <h2 style="font-size:20px;color:#1a1a1a;margin-bottom:8px;">Welcome to Misty Mountain Runners!</h2>
    <p>Your registration is complete. Your member ID is:</p>
    <div class="member-id-badge" id="memberIdBadge">—</div>
    <p>Next, set up your membership by submitting your annual fee.</p>
    <button class="btn btn-primary" id="toRenewalBtn" onclick="onGoToRenewal()">Set Up Membership →</button>
  </div>
</div>

<script>
  console.log('[MMR][newmember] page script started, location:', window.location.href);
  var appBaseUrl = '__SCRIPT_URL__';
  const SESSION_ID = Math.random().toString(36).slice(2);
  console.log('[MMR][newmember] appBaseUrl:', appBaseUrl);

  document.addEventListener('click', function(e) {
    var a = e.target.closest('a[href]');
    if (a) { var h = a.getAttribute('href'); if (h && h.charAt(0) === '?') { e.preventDefault(); window.top.location.href = appBaseUrl + h; } }
  });

  function callApi(fn, payload) {
    console.log('[MMR][newmember] callApi:', fn, JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      const req = { requestId: Math.random().toString(36).slice(2), payload };
      google.script.run
        .withSuccessHandler(r => {
          const res = JSON.parse(r);
          console.log('[MMR][newmember]', fn, 'success:', JSON.stringify(res.payload || res));
          if (res.ok) resolve(res.payload);
          else reject(new Error(res.errorMessage));
        })
        .withFailureHandler(err => {
          console.error('[MMR][newmember]', fn, 'failure:', err);
          reject(err);
        })
        [fn](JSON.stringify(req));
    });
  }

  function showMsg(text) {
    const el = document.getElementById('msg');
    el.textContent = text;
    el.className = 'msg error';
  }

  function goToLogin() {
    console.log('[MMR][newmember] navigating to login');
    window.top.location.href = appBaseUrl + '?page=login';
  }

  function onGoToRenewal() {
    console.log('[MMR][newmember] navigating to renewal');
    window.top.location.href = appBaseUrl + '?page=renewal';
  }

  function submitRegistration() {
    const email = document.getElementById('emailField').value.trim();
    const firstName = document.getElementById('firstName').value.trim();
    const lastName = document.getElementById('lastName').value.trim();
    const phoneNumber = document.getElementById('phoneNumber').value.trim();
    const district = document.getElementById('district').value.trim();

    if (!firstName) return showMsg('First name is required.');
    if (!lastName) return showMsg('Last name is required.');

    console.log('[MMR][newmember] submitting registration for:', email, firstName, lastName);
    const btn = document.getElementById('submitBtn');
    btn.disabled = true;
    btn.textContent = 'Registering…';

    callApi('createNewMember', { email, firstName, lastName, phoneNumber, district, sessionID: SESSION_ID })
      .then(data => {
        console.log('[MMR][newmember] member created:', data.member && data.member.memberID);
        sessionStorage.setItem('member', JSON.stringify(data.member));
        document.getElementById('memberIdBadge').textContent = data.member.memberID;
        document.getElementById('formView').style.display = 'none';
        document.getElementById('successView').style.display = 'block';
      })
      .catch(err => {
        console.error('[MMR][newmember] registration error:', err.message);
        showMsg(err.message || 'Registration failed. Please try again.');
        btn.disabled = false;
        btn.textContent = 'Register →';
      });
  }

  // Populate email from sessionStorage
  const pendingEmail = sessionStorage.getItem('pending_email') || '';
  console.log('[MMR][newmember] pending_email from sessionStorage:', pendingEmail);
  if (!pendingEmail) {
    // No pending email — redirect to login
    console.log('[MMR][newmember] no pending_email, redirecting to login');
    window.top.location.href = appBaseUrl + '?page=login';
  } else {
    document.getElementById('emailDisplay').textContent = pendingEmail;
    document.getElementById('emailField').value = pendingEmail;
  }
</script>
</body>
</html>

```


---
## File: `frontend/page_payment.html`
---

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Misty Mountain Runners — Payment</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; min-height: 100vh; }
    .topbar { background: #2d7d46; color: #fff; padding: 14px 24px; display: flex; justify-content: space-between; align-items: center; }
    .topbar h1 { font-size: 18px; font-weight: 700; }
    .topbar a { color: #fff; text-decoration: none; font-size: 14px; opacity: 0.85; }
    .container { max-width: 560px; margin: 32px auto; padding: 0 16px; }
    .card { background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); padding: 28px; margin-bottom: 20px; }
    h2 { font-size: 18px; font-weight: 700; color: #1a1a1a; margin-bottom: 16px; }
    .payment-summary { background: #f0f8f2; border-radius: 10px; padding: 16px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
    .payment-summary .desc { font-size: 15px; color: #333; font-weight: 500; }
    .payment-summary .amount { font-size: 24px; font-weight: 800; color: #2d7d46; }
    .instructions-box { margin-bottom: 20px; }
    .instructions-box h3 { font-size: 15px; font-weight: 700; color: #2d7d46; margin-bottom: 10px; }
    .payment-methods { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; }
    .method { border: 1px solid #e0e0e0; border-radius: 10px; padding: 16px; }
    .method h4 { font-size: 16px; font-weight: 600; margin-bottom: 12px; }
    .method .handle { font-size: 14px; color: #555; margin-bottom: 8px; }
    .method .handle strong { color: #1a1a1a; }
    .qr-code { max-width: 150px; margin-top: 10px; }
    .memo-tip { margin-top: 20px; background: #fff3e0; border-left: 3px solid #f57c00; padding: 10px 14px; border-radius: 4px; font-size: 13px; color: #444; }
    .btn { padding: 12px 24px; border-radius: 8px; border: none; font-size: 15px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-block; }
    .btn-primary { background: #2d7d46; color: #fff; width: 100%; text-align: center; }
    .btn-primary:hover { background: #235f36; }
    .msg { font-size: 14px; padding: 10px 12px; border-radius: 8px; margin-bottom: 16px; display: none; }
    .msg.error { background: #fdecea; color: #c62828; display: block; }
  </style>
</head>
<body>
<div class="topbar">
  <h1>🏃 Misty Mountain Runners</h1>
  <a href="?page=dashboard">← Dashboard</a>
</div>

<div class="container">
  <div id="msg" class="msg"></div>

  <div class="card">
    <h2>Send Your Payment</h2>
    <div class="payment-summary">
      <div>
        <div class="desc" id="paymentType">Membership Renewal</div>
      </div>
      <div class="amount" id="paymentAmount">$0</div>
    </div>

    <div class="instructions-box">
      <h3>Payment Instructions</h3>
      <div class="payment-methods">
        <div class="method">
          <h4>Zelle</h4>
          <div class="handle">Handle: <strong id="zelleHandle"></strong></div>
          <img id="zelleQrCode" alt="Zelle QR Code" class="qr-code" />
        </div>
        <div class="method">
          <h4>Venmo</h4>
          <div class="handle">Handle: <strong id="venmoHandle"></strong></div>
          <img id="venmoQrCode" alt="Venmo QR Code" class="qr-code" />
        </div>
        <div class="method">
          <h4>PayPal</h4>
          <div class="handle">Handle: <strong id="paypalHandle"></strong></div>
        </div>
      </div>
      <div class="memo-tip">
        <strong>Important:</strong> Please include your Member ID <strong id="memoMemberID"></strong> in the payment memo/note to help us match your payment.
      </div>
    </div>
    <a href="#" id="continueBtn" class="btn btn-primary">Continue to Submit Proof →</a>
  </div>
</div>

<script>
  console.log('[MMR][payment] page script started');
  console.log('[MMR][payment] window.location.href =', window.location.href);
  console.log('[MMR][payment] window.location.search =', window.location.search);
  console.log('[MMR][payment] window.parent.location (may be blocked) =', (() => { try { return window.parent.location.href; } catch(e) { return 'cross-origin blocked'; } })());
  var appBaseUrl = '__SCRIPT_URL__';
  const SERVER_PARAMS = __URL_PARAMS__;  // ← ADD THIS (no quotes - it's raw JSON)
  const SESSION_ID = Math.random().toString(36).slice(2);

  document.addEventListener('click', function(e) {
    var a = e.target.closest('a[href]');
    if (a) {
      var h = a.getAttribute('href');
      if (h && h.charAt(0) === '?') {
        e.preventDefault();
        window.top.location.href = appBaseUrl + h;
      }
    }
  });

  let member = null;
  let config = {};
  let paymentType = 'Payment';
  let paymentAmount = 0;

  function getUrlParams() {
    console.log('[MMR][payment] SERVER_PARAMS =', SERVER_PARAMS);
    
    // Use server-injected params (most reliable - no cross-origin issues)
    if (SERVER_PARAMS && SERVER_PARAMS['type']) {
      paymentType = SERVER_PARAMS['type'] || 'Membership Payment';
      paymentAmount = parseFloat(SERVER_PARAMS['amount']) || 0;
      console.log('[MMR][payment] params from server injection: type=', paymentType, 'amount=', paymentAmount);
      return;
    }

    // Fallback: window.location.search (works in some GAS setups)
    const params = new URLSearchParams(window.location.search);
    paymentType = params.get('type') || 'Membership Payment';
    paymentAmount = parseFloat(params.get('amount')) || 0;
    console.log('[MMR][payment] params from URL fallback: type=', paymentType, 'amount=', paymentAmount);
  }

  function callApi(fn, payload) {
    console.log('[MMR][payment] callApi:', fn, JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      const req = { requestId: Math.random().toString(36).slice(2), payload };
      google.script.run
        .withSuccessHandler(r => {
          const res = JSON.parse(r);
          if (res.ok) resolve(res.payload);
          else reject(new Error(res.errorMessage));
        })
        .withFailureHandler(err => reject(err))
        [fn](JSON.stringify(req));
    });
  }

  function showMsg(text) {
    const el = document.getElementById('msg');
    el.textContent = text;
    el.className = 'msg error';
    el.scrollIntoView({ behavior: 'smooth' });
  }

  function renderPage() {
    console.log('[MMR][payment] renderPage called, paymentType=', paymentType, 'paymentAmount=', paymentAmount);
    console.log('[MMR][payment] config keys =', Object.keys(config || {}));
    console.log('[MMR][payment] ZelleHandle =', config && config['ZelleHandle']);
    console.log('[MMR][payment] VenmoHandle =', config && config['VenmoHandle']);
    console.log('[MMR][payment] PayPalHandle =', config && config['PayPalHandle']);
    
    document.getElementById('paymentType').textContent = paymentType;
    document.getElementById('paymentAmount').textContent = '$' + paymentAmount;
    document.getElementById('zelleHandle').textContent = config['ZelleHandle'] || 'Not configured';
    document.getElementById('venmoHandle').textContent = config['VenmoHandle'] || 'Not configured';
    document.getElementById('paypalHandle').textContent = config['PayPalHandle'] || 'Not configured';

    // After the handle lines, add:
    const zelleFileId = config['ZelleQRCodeFileId'];
    const venmoFileId = config['VenmoQRCodeFileId'];

    console.log('[MMR][payment] ZelleQRCodeFileId =', zelleFileId);
    console.log('[MMR][payment] VenmoQRCodeFileId =', venmoFileId);

    // In renderPage(), replace the img src assignments with iframes:
    if (zelleFileId) {
      const zelleUrl = appBaseUrl + '?page=image&id=' + zelleFileId;
      const zelleContainer = document.getElementById('zelleQrCode');
      zelleContainer.outerHTML = `<iframe src="${zelleUrl}" style="width:160px;height:160px;border:none;" title="Zelle QR Code"></iframe>`;
      console.log('[MMR][payment] zelleQrCode iframe src =', zelleUrl);
    }
    if (venmoFileId) {
      const venmoUrl = appBaseUrl + '?page=image&id=' + venmoFileId;
      const venmoContainer = document.getElementById('venmoQrCode');
      venmoContainer.outerHTML = `<iframe src="${venmoUrl}" style="width:160px;height:160px;border:none;" title="Venmo QR Code"></iframe>`;
    }

    if (member) {
      document.getElementById('memoMemberID').textContent = member.memberID;
    }
    const continueBtn = document.getElementById('continueBtn');
    continueBtn.href = `?page=payment_proof&memberId=${member ? member.memberID : ''}&eventName=${encodeURIComponent(paymentType)}&amount=${paymentAmount}`;
  }

  // Init
  (async function() {
    try {
      getUrlParams();
      const cached = sessionStorage.getItem('member');
      if (cached) {
        member = JSON.parse(cached);
      }
      
      // ✅ FASTER - parallel
      const [profileData, configData] = await Promise.all([
        callApi('getOrCreateMemberProfile', { email: member?.email, sessionID: SESSION_ID }),
        callApi('getPublicConfig', {})
      ]);
      member = profileData.member;
      sessionStorage.setItem('member', JSON.stringify(member));
      config = configData.config;
      renderPage();

    } catch (err) {
      showMsg('Error loading page: ' + err.message);
      console.error('[MMR][payment] init error:', err);
    }
  })();
</script>
</body>
</html>

```


---
## File: `frontend/page_payment_history.html`
---

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Payment History — Misty Mountain Runners</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f5f5f5; min-height: 100vh; padding: 24px 16px;
    }
    .card {
      background: #fff; border-radius: 16px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.08);
      padding: 28px 24px; max-width: 640px; margin: 0 auto;
    }
    .back-link {
      display: inline-flex; align-items: center; gap: 6px;
      color: #2d7d46; font-size: 14px; font-weight: 500;
      cursor: pointer; border: none; background: none;
      padding: 0; margin-bottom: 20px; text-decoration: none;
    }
    .back-link:hover { text-decoration: underline; }
    h2 { font-size: 20px; font-weight: 700; color: #1a1a1a; margin-bottom: 4px; }
    .member-id { font-size: 13px; color: #888; margin-bottom: 24px; }

    /* Section headers */
    .section-title {
      font-size: 13px; font-weight: 700; color: #555;
      text-transform: uppercase; letter-spacing: 0.5px;
      margin: 24px 0 12px;
    }

    /* Event / payment rows */
    .row-card {
      border: 1px solid #eee; border-radius: 10px;
      padding: 14px 16px; margin-bottom: 10px;
    }
    .row-card:last-child { margin-bottom: 0; }
    .row-top {
      display: flex; justify-content: space-between;
      align-items: flex-start; gap: 8px;
    }
    .row-intent {
      font-size: 14px; font-weight: 600; color: #1a1a1a;
    }
    .row-amount {
      font-size: 14px; font-weight: 700; color: #2d7d46;
      white-space: nowrap;
    }
    .row-meta {
      font-size: 12px; color: #888; margin-top: 5px;
      display: flex; flex-wrap: wrap; gap: 8px;
    }
    .row-meta span::before { content: '· '; }
    .row-meta span:first-child::before { content: ''; }

    /* Status badges */
    .badge {
      display: inline-block; font-size: 11px; font-weight: 600;
      padding: 2px 8px; border-radius: 20px; white-space: nowrap;
    }
    .badge-approved  { background: #e8f5e9; color: #2d7d46; }
    .badge-pending   { background: #fff8e1; color: #f57c00; }
    .badge-matched   { background: #e3f2fd; color: #1565c0; }
    .badge-rejected  { background: #fdecea; color: #c62828; }
    .badge-error     { background: #fdecea; color: #c62828; }

    /* Period bar for confirmed payments */
    .period-bar {
      margin-top: 8px; font-size: 12px; color: #555;
      background: #f0f8f2; border-radius: 6px;
      padding: 6px 10px;
    }

    /* Pending explanation box */
    .pending-explainer {
      background: #fff8e1; border: 1px solid #ffe082;
      border-radius: 10px; padding: 14px 16px; margin-bottom: 16px;
      font-size: 13px; color: #5d4037; line-height: 1.6;
    }
    .pending-explainer strong { color: #e65100; }

    .empty { text-align: center; color: #aaa; font-size: 14px; padding: 32px 0; }

    /* Spinner */
    .spinner {
      display: inline-block; width: 20px; height: 20px;
      border: 3px solid #ddd; border-top-color: #2d7d46;
      border-radius: 50%; animation: spin 0.7s linear infinite;
      margin: 40px auto; display: block;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
<div class="card">
  <button class="back-link" onclick="goToDashboard()">← Dashboard</button>

  <h2>🧾 Payment History</h2>
  <div class="member-id" id="member-id-display"></div>

  <div id="loading"><div class="spinner"></div></div>
  <div id="content" style="display:none"></div>
</div>

<script>
  var appBaseUrl = '__SCRIPT_URL__';
  var SESSION_ID = Math.random().toString(36).slice(2);

  function goToDashboard() {
    window.top.location.href = appBaseUrl + '?page=dashboard';
  }

  function callApi(fn, payload) {
    return new Promise(function(resolve, reject) {
      var req = { requestId: Math.random().toString(36).slice(2), payload: payload };
      google.script.run
        .withSuccessHandler(function(r) {
          var res = JSON.parse(r);
          if (res.ok) resolve(res.payload);
          else reject(new Error(res.errorMessage));
        })
        .withFailureHandler(function(err) { reject(err); })
        [fn](JSON.stringify(req));
    });
  }

  function badgeCls(status) {
    return 'badge badge-' + (status || 'pending').toLowerCase();
  }

  function fmt(dateStr) {
    if (!dateStr) return '—';
    var d = new Date(dateStr);
    return isNaN(d) ? dateStr : d.toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  }

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                          .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function renderEvents(events) {
    // Pending/Matched events — shown at top with explanation
    var pending = events.filter(function(e) {
      return e.status === 'Pending' || e.status === 'Matched';
    });
    var past = events.filter(function(e) {
      return e.status === 'Approved' || e.status === 'Rejected' || e.status === 'Error';
    });
    return { pending: pending, past: past };
  }

  function buildPendingHTML(pending) {
    if (!pending.length) return '';
    var html = '<div class="section-title">⏳ Awaiting Admin Approval</div>';
    html += '<div class="pending-explainer">';
    html += '<strong>Why is my membership status unchanged?</strong><br/>';
    html += 'Your payment submission is received and under review. ';
    html += 'Once an admin verifies the payment, your status will be updated automatically. ';
    html += 'This usually takes 1–3 business days.';
    html += '</div>';
    pending.forEach(function(e) {
      html += '<div class="row-card">';
      html += '<div class="row-top">';
      html += '<span class="row-intent">' + esc(e.paymentIntent) + '</span>';
      html += '<span>' +
        '<span class="' + badgeCls(e.status) + '">' + esc(e.status) + '</span>' +
        '</span>';
      html += '</div>';
      html += '<div class="row-meta">';
      html += '<span>$' + esc(e.amount) + '</span>';
      html += '<span>' + esc(e.paymentMethod) + '</span>';
      html += '<span>Submitted ' + fmt(e.timestamp) + '</span>';
      if (e.status === 'Matched') {
        html += '<span>✓ Payment located in bank records</span>';
      }
      html += '</div>';
      if (e.notes) {
        html += '<div class="row-meta" style="margin-top:4px;color:#c0392b;">' +
          '<span>' + esc(e.notes) + '</span></div>';
      }
      html += '</div>';
    });
    return html;
  }

    // --- NEW: build proofs section ---
  function buildProofsHTML(proofs, currentMemberID) {
    if (!proofs || !proofs.length) return '';
    var html = '<div class="section-title">Payment Proof Submissions</div>';
    proofs.forEach(function(p) {
      var isOwn = p.memberID === currentMemberID;
      var memberLabel = isOwn ? 'You' : 'Family member ' + esc(p.memberID);

      var screenshotLink = p.screenshotFileId
        ? ' &bull; <a href="https://drive.google.com/file/d/' + esc(p.screenshotFileId) + '/view" target="_blank">View Screenshot</a>'
        : '';

      // Deep-link into admin approval queue
      var isPending = p.status === 'Pending Review' || p.status === 'Pending';
      var approvalLink = isPending
        ? ' &bull; <a href="' + appBaseUrl + '?page=admin" target="_top" '
          + 'onclick="sessionStorage.setItem(\'adminFocusProof\',\'' + esc(p.eventID) + '\');return true;"'
          + '>View in Admin Queue</a>'
        : '';

      html += '<div class="row-card">';
      html += '<div class="row-top">';
      html += '<span class="row-intent">' + esc(p.eventName) + '</span>';
      html += '<span class="row-amount">$' + esc(p.amount) + '</span>';
      html += '</div>';
      html += '<div class="row-meta">';
      html += '<span>' + memberLabel + '</span>';
      html += '<span>' + fmt(p.paymentDate) + '</span>';
      html += '<span>' + esc(p.payerName) + '</span>';
      html += '<span><span class="' + badgeCls(p.status) + '">' + esc(p.status) + '</span></span>';
      html += screenshotLink + approvalLink;
      html += '</div>';
      if (p.notes) {
        html += '<div class="row-meta" style="margin-top:4px;color:#555">'
              + '<span>Note: ' + esc(p.notes) + '</span></div>';
      }
      html += '</div>';
    });
    return html;
  }

  // --- UPDATED data loader ---
  var member = null;
  try { member = JSON.parse(sessionStorage.getItem('member')); } catch(e) {}
  if (!member || !member.email) {
    window.top.location.href = appBaseUrl + '?page=login';
  } else {
    document.getElementById('member-id-display').textContent = 'Member ID: ' + member.memberID;
    callApi('getMemberPaymentHistory', { email: member.email, sessionID: SESSION_ID })
      .then(function(data) {
        document.getElementById('loading').style.display = 'none';
        var content = document.getElementById('content');
        content.style.display = 'block';
        var split = renderEvents(data.events);
        var html = '';
        html += buildPendingHTML(split.pending);          // pending WebApp-Events
        html += buildProofsHTML(data.proofs, data.memberID); // NEW: proof submissions
        html += buildConfirmedHTML(data.payments);         // confirmed Payment-History
        html += buildRejectedHTML(split.past);             // rejected/error events
        content.innerHTML = html || '<div class="empty">No payment activity found.</div>';
      })
      .catch(function(err) {
        document.getElementById('loading').style.display = 'none';
        var content = document.getElementById('content');
        content.style.display = 'block';
        content.innerHTML = '<div class="empty" style="color:#c62828">Failed to load: ' + esc(err.message) + '</div>';
      });
  }


  function buildConfirmedHTML(payments) {
    if (!payments.length) return '<div class="empty">No confirmed payments yet.</div>';
    var html = '<div class="section-title">✅ Confirmed Payments</div>';
    payments.forEach(function(p) {
      html += '<div class="row-card">';
      html += '<div class="row-top">';
      html += '<span class="row-intent">' + esc(p.paymentIntent) + '</span>';
      html += '<span class="row-amount">$' + esc(p.amount) + '</span>';
      html += '</div>';
      html += '<div class="row-meta">';
      html += '<span>' + esc(p.paymentMethod) + '</span>';
      html += '<span>' + fmt(p.paymentDate) + '</span>';
      html += '<span>' + esc(p.payerName) + '</span>';
      if (p.source) html += '<span>' + esc(p.source) + '</span>';
      html += '</div>';
      if (p.periodStart && p.periodEnd) {
        html += '<div class="period-bar">📅 Coverage: ' +
          fmt(p.periodStart) + ' → ' + fmt(p.periodEnd) + '</div>';
      }
      html += '</div>';
    });
    return html;
  }

  function buildRejectedHTML(past) {
    var rejected = past.filter(function(e) {
      return e.status === 'Rejected' || e.status === 'Error';
    });
    if (!rejected.length) return '';
    var html = '<div class="section-title">❌ Rejected / Error</div>';
    rejected.forEach(function(e) {
      html += '<div class="row-card">';
      html += '<div class="row-top">';
      html += '<span class="row-intent">' + esc(e.paymentIntent) + '</span>';
      html += '<span class="' + badgeCls(e.status) + '">' + esc(e.status) + '</span>';
      html += '</div>';
      html += '<div class="row-meta">';
      html += '<span>$' + esc(e.amount) + '</span>';
      html += '<span>' + fmt(e.timestamp) + '</span>';
      html += '</div>';
      if (e.notes) {
        html += '<div class="row-meta" style="margin-top:4px;color:#c62828;">' +
          '<span>Note: ' + esc(e.notes) + '</span></div>';
      }
      html += '</div>';
    });
    return html;
  }

  // ── Load data ────────────────────────────────────────────────
  var member = null;
  try { member = JSON.parse(sessionStorage.getItem('member') || 'null'); } catch(_) {}

  if (!member || !member.email) {
    window.top.location.href = appBaseUrl + '?page=login';
  } else {
    document.getElementById('member-id-display').textContent =
      'Member ID: ' + (member.memberID || '—');

    callApi('getMemberPaymentHistory', {
      email: member.email,
      sessionID: SESSION_ID
    })
    .then(function(data) {
      document.getElementById('loading').style.display = 'none';
      var content = document.getElementById('content');
      content.style.display = 'block';

      var split = renderEvents(data.events || []);
      var html = '';

      // 1. Pending submissions (with explainer)
      html += buildPendingHTML(split.pending);

      // 2. Confirmed payments
      html += buildConfirmedHTML(data.payments || []);

      // 3. Rejected / errors
      html += buildRejectedHTML(split.past);

      content.innerHTML = html || '<div class="empty">No payment activity found.</div>';
    })
    .catch(function(err) {
      document.getElementById('loading').style.display = 'none';
      var content = document.getElementById('content');
      content.style.display = 'block';
      content.innerHTML = '<div class="empty" style="color:#c62828;">Failed to load: ' +
        esc(err.message) + '</div>';
    });
  }
</script>
</body>
</html>

```


---
## File: `frontend/page_payment_proof.html`
---

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Misty Mountain Runners — Submit Payment Proof</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; min-height: 100vh; }
    .topbar { background: #2d7d46; color: #fff; padding: 14px 24px; display: flex; justify-content: space-between; align-items: center; }
    .topbar h1 { font-size: 18px; font-weight: 700; }
    .topbar a { color: #fff; text-decoration: none; font-size: 14px; opacity: 0.85; }
    .container { max-width: 560px; margin: 32px auto; padding: 0 16px; }
    .card { background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); padding: 28px; margin-bottom: 20px; }
    h2 { font-size: 18px; font-weight: 700; color: #1a1a1a; margin-bottom: 24px; }
    .field { margin-bottom: 18px; }
    label { display: block; font-size: 13px; font-weight: 600; color: #555; margin-bottom: 6px; }
    input, select, textarea { width: 100%; padding: 10px 12px; border: 1px solid #ccc; border-radius: 8px; font-size: 15px; background: #fff; }
    textarea { min-height: 80px; }
    .btn { padding: 12px 24px; border-radius: 8px; border: none; font-size: 15px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-block; }
    .btn-primary { background: #2d7d46; color: #fff; width: 100%; text-align: center; }
    .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
    .msg { font-size: 14px; padding: 10px 12px; border-radius: 8px; margin-bottom: 16px; display: none; }
    .msg.success { background: #e8f5e9; color: #2d7d46; display: block; }
    .msg.error { background: #fdecea; color: #c62828; display: block; }
  </style>
</head>
<body>
<div class="topbar">
  <h1>🏃 Misty Mountain Runners</h1>
  <!-- ✅ CORRECT — absolute URL, window.top, from direct onclick -->
  <button onclick="window.top.location.href = appBaseUrl + '?page=dashboard'">
    ← Dashboard
  </button>
</div>

<div class="container">
  <div class="card" id="formCard">
    <h2>Submit Payment Proof</h2>
    <div id="msg" class="msg"></div>

    <div class="field">
      <label>Payment For</label>
      <select id="eventName"></select>
    </div>
    <div class="field">
      <label>Amount</label>
      <input type="number" id="amount" placeholder="e.g. 30" />
    </div>
    <div class="field">
      <label>Payment Date</label>
      <input type="date" id="paymentDate" />
    </div>
    <div class="field">
      <label>Payer Name</label>
      <input type="text" id="payerName" placeholder="Name on the account used for payment" />
    </div>
    <div class="field">
      <label>Last 4 Digits of Confirmation/Transaction #</label>
      <input type="text" id="last4Digits" placeholder="e.g. 5678" maxlength="4" />
    </div>
    <div class="field">
      <label>Notes</label>
      <textarea id="notes" placeholder="Anything else we should know?"></textarea>
    </div>
    <div class="field">
      <label>Confirmation Screenshot (optional)</label>
      <input type="file" id="screenshot" accept="image/*" />
    </div>

    <button class="btn btn-primary" id="submitBtn" onclick="submitProof()">Submit</button>
  </div>
</div>

<script>
console.log('[MMR][paymentproof] page script started');
var appBaseUrl = '__SCRIPT_URL__';
const SERVER_PARAMS = __URL_PARAMS__;   // injected by doGet - no quotes!
const SESSION_ID = Math.random().toString(36).slice(2);
let member = null;

console.log('[MMR][paymentproof] SERVER_PARAMS =', SERVER_PARAMS);

function callApi(fn, payload) {
  console.log('[MMR][paymentproof] callApi:', fn);
  return new Promise((resolve, reject) => {
    const req = { requestId: Math.random().toString(36).slice(2), payload };
    google.script.run
      .withSuccessHandler(r => {
        const res = JSON.parse(r);
        if (res.ok) resolve(res.payload);
        else reject(new Error(res.errorMessage));
      })
      .withFailureHandler(err => reject(err))
      [fn](JSON.stringify(req));
  });
}

function showMsg(text, type) {
  const el = document.getElementById('msg');
  el.textContent = text;
  el.className = 'msg ' + type;
  el.scrollIntoView({ behavior: 'smooth' });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.toString().split(',')[1]);
    reader.onerror = error => reject(error);
  });
}

// Pre-fill fields from SERVER_PARAMS immediately — no API call needed
function prefillFromParams() {
  const eventName = SERVER_PARAMS['eventName'];
  const amount    = SERVER_PARAMS['amount'];
  const memberId  = SERVER_PARAMS['memberId'];

  console.log('[MMR][paymentproof] prefill: eventName=', eventName, 'amount=', amount, 'memberId=', memberId);

  if (amount) {
    const amountInput = document.getElementById('amount');
    amountInput.value = amount;
    amountInput.readOnly = true;
    console.log('[MMR][paymentproof] amount pre-filled =', amount);
  }

  if (memberId) {
    // Store for submit use even before profile API returns
    if (!member) member = { memberID: memberId, email: '' };
    console.log('[MMR][paymentproof] memberId pre-filled =', memberId);
  }

  // eventName dropdown: add option if not already present after events load
  return eventName;  // returned so we can use after events load
}

async function submitProof() {
  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Submitting...';
  try {
    const fileInput = document.getElementById('screenshot');
    let screenshotBase64 = null;
    if (fileInput.files.length > 0) {
      screenshotBase64 = await fileToBase64(fileInput.files[0]);
    }
    const payload = {
      memberID:    member?.memberID,
      email:       member?.email,
      eventName:   document.getElementById('eventName').value,
      amount:      document.getElementById('amount').value,
      paymentDate: document.getElementById('paymentDate').value,
      payerName:   document.getElementById('payerName').value.trim(),
      last4Digits: document.getElementById('last4Digits').value.trim(),
      notes:       document.getElementById('notes').value.trim(),
      screenshot:  screenshotBase64,
      sessionID:   SESSION_ID,
    };
    console.log('[MMR][paymentproof] submitting proof for memberID=', payload.memberID);
    await callApi('submitPaymentProof', payload);
    document.getElementById('formCard').innerHTML = `
      <div class="msg success" style="text-align:center">
        <h2>Success!</h2>
        <p>Your payment proof has been submitted for review.</p>
        <a href="${appBaseUrl}?page=dashboard" class="btn btn-primary" style="margin-top:16px">Back to Dashboard</a>
      </div>`;
  } catch(err) {
    showMsg(err.message + ' — An error occurred.', 'error');
    btn.disabled = false;
    btn.textContent = 'Submit';
  }
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Pre-fill amount/memberId immediately from SERVER_PARAMS (instant, no API call)
  const pendingEventName = prefillFromParams();

  // 2. Pre-fill today's date immediately
  document.getElementById('paymentDate').valueAsDate = new Date();

  // 3. Load session member + events list in parallel
  try {
    const cached = sessionStorage.getItem('member');
    if (cached) member = JSON.parse(cached);

    console.log('[MMR][paymentproof] loading events and profile in parallel');

    const [eventsResult] = await Promise.all([
      callApi('getPaymentConfirmationEvents', {}),
      // ...
    ]);
    console.log('[MMR][paymentproof] eventsResult raw =', JSON.stringify(eventsResult));
    const events = Array.isArray(eventsResult) ? eventsResult 
                  : Array.isArray(eventsResult?.events) ? eventsResult.events 
                  : [];
    console.log('[MMR][paymentproof] events array length =', events.length);


    // 4. Populate events dropdown
    const select = document.getElementById('eventName');
    select.innerHTML = events.map(e =>
      `<option value="${e.name}">${e.name} — ${e.description}</option>`
    ).join('');
    console.log('[MMR][paymentproof] events loaded, count =', events.length);

    // 5. Set the pre-selected event from URL params
    if (pendingEventName) {
      // Add option if not in list (e.g. custom event name)
      if (![...select.options].some(o => o.value === pendingEventName)) {
        const opt = document.createElement('option');
        opt.value = pendingEventName;
        opt.textContent = pendingEventName;
        select.appendChild(opt);
      }
      select.value = pendingEventName;
      select.disabled = true;
      console.log('[MMR][paymentproof] eventName pre-selected =', pendingEventName);
    }

  } catch(err) {
    showMsg('Failed to load page data. Please refresh.', 'error');
    console.error('[MMR][paymentproof] init error:', err);
  }
});
</script>
</body>
</html>

```


---
## File: `frontend/page_profile.html`
---

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Misty Mountain Runners — Profile</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; min-height: 100vh; }
    .topbar { background: #2d7d46; color: #fff; padding: 14px 24px; display: flex; justify-content: space-between; align-items: center; }
    .topbar h1 { font-size: 18px; font-weight: 700; }
    .topbar a { color: #fff; text-decoration: none; font-size: 14px; opacity: 0.85; }
    .topbar a:hover { opacity: 1; }
    .container { max-width: 520px; margin: 32px auto; padding: 0 16px; }
    .card { background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); padding: 28px; }
    h2 { font-size: 18px; font-weight: 700; color: #1a1a1a; margin-bottom: 24px; }
    .field { margin-bottom: 18px; }
    label { display: block; font-size: 13px; font-weight: 600; color: #555; margin-bottom: 6px; }
    input { width: 100%; padding: 10px 12px; border: 1px solid #ccc; border-radius: 8px; font-size: 15px; }
    input:focus { outline: none; border-color: #2d7d46; box-shadow: 0 0 0 2px rgba(45,125,70,0.15); }
    input[readonly] { background: #f9f9f9; color: #888; cursor: default; }
    .hint { font-size: 12px; color: #999; margin-top: 4px; }
    .actions { display: flex; gap: 12px; margin-top: 24px; }
    .btn { padding: 11px 24px; border-radius: 8px; border: none; font-size: 15px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-block; }
    .btn-primary { background: #2d7d46; color: #fff; }
    .btn-primary:hover { background: #235f36; }
    .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-secondary { background: #fff; color: #555; border: 1.5px solid #ccc; }
    .btn-secondary:hover { background: #f5f5f5; }
    .msg { font-size: 14px; padding: 10px 12px; border-radius: 8px; margin-bottom: 16px; display: none; }
    .msg.success { background: #e8f5e9; color: #2d7d46; display: block; }
    .msg.error   { background: #fdecea; color: #c62828; display: block; }
    #errorView { display: none; text-align: center; padding: 40px 0; }
    #errorView p { color: #c62828; font-size: 15px; margin-bottom: 16px; }
    #formView { display: block; }
  </style>
</head>
<body>
<div class="topbar">
  <h1>🏃 Misty Mountain Runners</h1>
  <a href="?page=dashboard">← Dashboard</a>
</div>

<div class="container">
  <div class="card">

    <!-- Error state (shown if profile fails to load and no session cache) -->
    <div id="errorView">
      <p id="errorMsg">Could not load your profile.</p>
      <a href="?page=login" class="btn btn-primary">Sign in again</a>
    </div>

    <!-- Profile form -->
    <div id="formView">
      <h2>Update Profile</h2>
      <div id="msg" class="msg"></div>

      <div class="field">
        <label>Email</label>
        <input type="email" id="email" readonly />
      </div>
      <div class="field">
        <label>Member ID</label>
        <input type="text" id="memberID" readonly />
      </div>
      <div class="field">
        <label>First Name</label>
        <input type="text" id="firstName" placeholder="First name" />
      </div>
      <div class="field">
        <label>Last Name</label>
        <input type="text" id="lastName" placeholder="Last name" />
      </div>
      <div class="field">
        <label>Phone Number</label>
        <input type="tel" id="phoneNumber" placeholder="e.g. 917-555-1234" />
      </div>
      <div class="field">
        <label>WeChat ID</label>
        <input type="text" id="wechatID" placeholder="WeChat username (optional)" />
      </div>
      <div class="field">
        <label>District</label>
        <input type="text" id="district" placeholder="e.g. Queens, Brooklyn" />
      </div>
      <div class="field">
        <label>Join Year</label>
        <input type="number" id="joinYear" placeholder="e.g. 2019" min="2000" max="2099" />
        <div class="hint">Year you first joined the club. You may edit this.</div>
      </div>

      <div class="actions">
        <button class="btn btn-primary" id="saveBtn" onclick="saveProfile()">Save Changes</button>
        <a href="?page=dashboard" class="btn btn-secondary">Cancel</a>
      </div>
    </div>

  </div>
</div>

<script>
  console.log('[MMR][profile] page script started, location:', window.location.href);
  var appBaseUrl = '__SCRIPT_URL__';
  console.log('[MMR][profile] appBaseUrl:', appBaseUrl);

  // Navigate all relative ?page= links through window.top with absolute URL
  document.addEventListener('click', function(e) {
    var a = e.target.closest('a[href]');
    if (a) {
      var h = a.getAttribute('href');
      if (h && h.charAt(0) === '?') {
        e.preventDefault();
        console.log('[MMR][profile] nav click to:', h);
        window.top.location.href = appBaseUrl + h;
      }
    }
  });

  const SESSION_ID = Math.random().toString(36).slice(2);
  let currentMemberID = null;

  function callApi(fn, payload) {
    console.log('[MMR][profile] callApi:', fn, JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      const req = { requestId: Math.random().toString(36).slice(2), payload };
      google.script.run
        .withSuccessHandler(r => {
          const res = JSON.parse(r);
          console.log('[MMR][profile]', fn, 'success:', JSON.stringify(res.payload || res));
          if (res.ok) resolve(res.payload);
          else reject(new Error(res.errorMessage));
        })
        .withFailureHandler(err => {
          console.error('[MMR][profile]', fn, 'failure:', err);
          reject(err);
        })
        [fn](JSON.stringify(req));
    });
  }

  function showMsg(text, type) {
    const el = document.getElementById('msg');
    el.textContent = text;
    el.className = 'msg ' + type;
  }

  function showError(msg) {
    console.error('[MMR][profile] showError:', msg);
    document.getElementById('errorMsg').textContent = msg || 'Could not load your profile.';
    document.getElementById('formView').style.display = 'none';
    document.getElementById('errorView').style.display = 'block';
  }

  function loadProfile(member) {
    console.log('[MMR][profile] loadProfile memberID:', member.memberID);
    currentMemberID = member.memberID;
    document.getElementById('email').value       = member.email       || '';
    document.getElementById('memberID').value    = member.memberID    || '';
    document.getElementById('firstName').value   = member.firstName   || '';
    document.getElementById('lastName').value    = member.lastName    || '';
    document.getElementById('phoneNumber').value = member.phoneNumber || '';
    document.getElementById('wechatID').value    = member.wechatID    || '';
    document.getElementById('district').value    = member.district    || '';
    document.getElementById('joinYear').value    = member.joinYear    || '';
  }

  function saveProfile() {
    if (!currentMemberID) return showMsg('Profile not loaded. Please refresh.', 'error');
    const btn = document.getElementById('saveBtn');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    const updates = {
      memberID:    currentMemberID,
      firstName:   document.getElementById('firstName').value.trim(),
      lastName:    document.getElementById('lastName').value.trim(),
      phoneNumber: document.getElementById('phoneNumber').value.trim(),
      wechatID:    document.getElementById('wechatID').value.trim(),
      district:    document.getElementById('district').value.trim(),
      joinYear:    document.getElementById('joinYear').value.trim(),
    };
    console.log('[MMR][profile] saveProfile for memberID:', currentMemberID);

    callApi('updateMemberProfile', updates)
      .then(data => {
        console.log('[MMR][profile] updateMemberProfile success');
        if (data.member) {
          sessionStorage.setItem('member', JSON.stringify(data.member));
          loadProfile(data.member);
        }
        showMsg('Profile updated successfully! Redirecting…', 'success');
        setTimeout(() => {
          window.top.location.href = appBaseUrl + '?page=dashboard';
        }, 1000);
      })
      .catch(err => {
        console.error('[MMR][profile] updateMemberProfile error:', err && err.message);
        showMsg(err.message || 'Failed to save. Please try again.', 'error');
        btn.disabled = false;
        btn.textContent = 'Save Changes';
      });
  }

  // ---- Load from session or server ----
  const cached = sessionStorage.getItem('member');
  if (cached) {
    try {
      const m = JSON.parse(cached);
      console.log('[MMR][profile] loaded member from sessionStorage:', m.memberID);
      loadProfile(m);
    } catch (e) {
      console.error('[MMR][profile] failed to parse cached member:', e);
    }
  }

  var memberEmail = '';
  if (cached) {
    try { memberEmail = JSON.parse(cached).email || ''; } catch (_) {}
  }
  console.log('[MMR][profile] calling getOrCreateMemberProfile with email:', memberEmail);

  callApi('getOrCreateMemberProfile', { email: memberEmail, sessionID: SESSION_ID })
    .then(function(data) {
      console.log('[MMR][profile] getOrCreateMemberProfile success, memberID:', data.member && data.member.memberID);
      sessionStorage.setItem('member', JSON.stringify(data.member));
      loadProfile(data.member);
    })
    .catch(function(err) {
      console.error('[MMR][profile] getOrCreateMemberProfile failed:', err && err.message);
      if (!cached) {
        // No cached data at all — show error card, don't navigate
        showError('Session expired or profile not found. Please sign in again.');
      }
      // If we had cached member already rendered, don't blank the page
    });
</script>
</body>
</html>

```


---
## File: `jest.config.js`
---

```javascript
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.test.json',
    },
  },
  testMatch: ['**/tests/**/*.test.ts'],
  setupFilesAfterEnv: ['./tests/setup.ts'],
};

```


---
## File: `package.json`
---

```json
{
  "name": "mmrunners-membership",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "tsc",
    "build:copy": "rm -f dist/*.html && tsc && cp frontend/*.html dist/ && cp appsscript.json dist/",
    "push": "clasp push",
    "deploy": "clasp deploy",
    "build:push": "npm run build:copy && npm run push",
    "test": "jest",
    "test:watch": "jest --watch",
    "otp:cleanup": "clasp run cleanupExpiredOtps"
  },
  "devDependencies": {
    "@google/clasp": "^2.4.2",
    "@types/google-apps-script": "^1.0.100",
    "@types/jest": "^29.5.12",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.4",
    "typescript": "^5.4.0"
  }
}

```


---
## File: `src/admin.ts`
---

```typescript
// ============================================================
// Admin functions: view pending events, unmatched payments, config CRUD
// Depends on: config.ts, sheets.ts, logger.ts
// Exposed GAS functions: getPendingEvents, getUnmatchedPayments,
//                        getConfig, updateConfigEntry
// ============================================================

function getPendingEvents(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{ adminEmail: string }>;
  try {
    if (!isAdmin(req.payload.adminEmail)) {
      return jsonError(req.requestId, 'FORBIDDEN', 'Not authorized.');
    }
    const events = getPendingWebAppEvents();
    return jsonOk(req.requestId, { events });
  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

function getUnmatchedPayments(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{ adminEmail: string }>;
  try {
    if (!isAdmin(req.payload.adminEmail)) {
      return jsonError(req.requestId, 'FORBIDDEN', 'Not authorized.');
    }
    const payments = getUnmatchedGmailPayments();
    return jsonOk(req.requestId, { payments });
  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

function getPaymentProofs(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{ adminEmail: string }>;
  try {
    if (!isAdmin(req.payload.adminEmail)) {
      return jsonError(req.requestId, 'FORBIDDEN', 'Not authorized.');
    }
    // Payment proofs are now stored directly in WebApp-Events.
    // Return all events that have a screenshotFileId attached.
    const sheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
    const data = sheet.getDataRange().getValues().slice(1); // skip header
    const proofs = data
      .filter(row => row[WE_COL.SCREENSHOT_FILE_ID])
      .map(row => ({
        eventId:         String(row[WE_COL.EVENT_ID]),
        timestamp:       String(row[WE_COL.TIMESTAMP]),
        memberId:        String(row[WE_COL.MEMBER_ID]),
        email:           String(row[WE_COL.EMAIL]),
        eventName:       String(row[WE_COL.PAYMENT_INTENT]),
        amount:          Number(row[WE_COL.AMOUNT]) || 0,
        paymentDate:     String(row[WE_COL.PAYMENT_DATE]      || ''),
        payerName:       String(row[WE_COL.PAYER_NAME]),
        last4Digits:     String(row[WE_COL.LAST_4_DIGITS]),
        notes:           String(row[WE_COL.NOTES]),
        screenshotFileId: String(row[WE_COL.SCREENSHOT_FILE_ID]),
        status:          String(row[WE_COL.STATUS]),
        gdriveFilePath:  String(row[WE_COL.GDRIVE_FILE_PATH]  || ''),
        ocrText:         String(row[WE_COL.OCR_TEXT]          || ''),
        ocrTimestamp:    String(row[WE_COL.OCR_TIMESTAMP]     || ''),
      }));
    return jsonOk(req.requestId, { proofs });
  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

function getConfig(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{ adminEmail: string; caller?: string }>;
  try {
    console.log('[mmr][getConfig] called by:', req.payload.caller || 'unknown', '| adminEmail:', req.payload.adminEmail);
    if (!isAdmin(req.payload.adminEmail)) {
      console.log('[mmr][getConfig] FORBIDDEN for:', req.payload.adminEmail);
      return jsonError(req.requestId, 'FORBIDDEN', 'Not authorized.');
    }
    const config = getConfigMap();
    console.log('[mmr][getConfig] returning', Object.keys(config).length, 'config keys');
    return jsonOk(req.requestId, { config });
  } catch (e: any) {
    console.error('[mmr][getConfig] error:', String(e));
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

function updateConfigEntry(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{ adminEmail: string; key: string; value: string }>;
  const { payload } = req;
  try {
    if (!isAdmin(payload.adminEmail)) {
      return jsonError(req.requestId, 'FORBIDDEN', 'Not authorized.');
    }
    setConfigValue(payload.key, payload.value);
    auditLog('CONFIG_UPDATE', {
      email: payload.adminEmail,
      state: { key: payload.key, value: payload.value },
    });
    return jsonOk(req.requestId, { message: 'Config updated.' });
  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
} 

function getPublicConfig(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{}>;
  try {
    console.log('mmr:getPublicConfig called, requestId =', req.requestId);
    const allConfig = getConfigMap();
    console.log('mmr:getPublicConfig allConfig keys =', Object.keys(allConfig).join(', '));

    const publicConfig: Record<string, string> = {};
    const publicKeys = ['ZelleHandle','VenmoHandle','PayPalHandle',
                        'ZelleQRCodeFileId','VenmoQRCodeFileId',
                        'IndividualPrice','FamilyPrice','FamilyUpgradePrice'];
    for (const key of publicKeys) {
      console.log(`mmr:getPublicConfig key="${key}" value="${allConfig[key] ?? '(missing)'}" `);
      if (allConfig[key]) publicConfig[key] = allConfig[key];
    }

    console.log('mmr:getPublicConfig returning keys =', Object.keys(publicConfig).join(', '));
    return jsonOk(req.requestId, { config: publicConfig });
  } catch (e: any) {
    console.error('mmr:getPublicConfig ERROR =', String(e));
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

function isAdmin(email: string): boolean {
  const adminEmails = getConfigValue('AdminEmails')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  return adminEmails.includes(email.trim().toLowerCase());
}

// Manually link an unmatched Gmail payment to a WebApp-Events row
function manualMatch(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{
    adminEmail: string;
    eventID: string;
    messageId: string;
  }>;
  const payload = req.payload;

  try {
    if (!isAdmin(payload.adminEmail)) {
      return jsonError(req.requestId, 'FORBIDDEN', 'Not authorized.');
    }

    const eventID = (payload.eventID || '').trim();
    const messageId = (payload.messageId || '').trim();
    if (!eventID || !messageId) {
      return jsonError(req.requestId, 'BAD_REQUEST', 'eventID and messageId are required.');
    }

    const eventsSheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
    const gmailSheet  = getSheet(SHEET_NAMES.FETCH_GMAIL);
    if (!eventsSheet || !gmailSheet) {
      return jsonError(req.requestId, 'SHEET_MISSING', 'Required sheets not found.');
    }

    const eventsValues = eventsSheet.getDataRange().getValues();
    const gmailValues  = gmailSheet.getDataRange().getValues();

    let eventRowIndex = -1;
    let gmailRowIndex = -1;

    // Find WebApp-Events row by EventID
    for (let i = 1; i < eventsValues.length; i++) {
      const row = eventsValues[i];
      if (String(row[WE_COL.EVENT_ID]).trim() === eventID) {
        eventRowIndex = i;
        break;
      }
    }

    if (eventRowIndex === -1) {
      return jsonError(req.requestId, 'NOT_FOUND', 'Event not found.');
    }

    // Find Fetch-Gmail row by MessageId
    for (let i = 1; i < gmailValues.length; i++) {
      const row = gmailValues[i];
      if (String(row[FG_COL.MESSAGE_ID]).trim() === messageId) {
        gmailRowIndex = i;
        break;
      }
    }

    if (gmailRowIndex === -1) {
      return jsonError(req.requestId, 'NOT_FOUND', 'Gmail payment not found.');
    }

    const eventRow = eventsValues[eventRowIndex];
    const gmailRow = gmailValues[gmailRowIndex];

    const transactionNumber = String(gmailRow[FG_COL.TRANSACTION_NUMBER] || '');
    const amount            = Number(gmailRow[FG_COL.AMOUNT]) || 0;

    // Update WebApp-Events row: Status -> Matched, set matched fields
    eventRow[WE_COL.STATUS]                 = 'Matched';
    eventRow[WE_COL.MATCHED_MESSAGE_ID]       = messageId;
    eventRow[WE_COL.MATCHED_TRANSACTION_NUMBER] = transactionNumber;
    // Optionally record note that this was a manual match
    const oldNotes = String(eventRow[WE_COL.NOTES] || '');
    const noteLine = `Manual match by ${payload.adminEmail} on ${new Date().toISOString()} amount=${amount}`;
    eventRow[WE_COL.NOTES] = oldNotes ? (oldNotes + ' | ' + noteLine) : noteLine;

    eventsSheet.getRange(eventRowIndex + 1, 1, 1, eventRow.length).setValues([eventRow]);

    // Update Fetch-Gmail row: mark processed and link EventID
    gmailRow[FG_COL.PROCESSED]    = true;
    gmailRow[FG_COL.WEBAPP_EVENT_ID] = eventID;
    gmailSheet.getRange(gmailRowIndex + 1, 1, 1, gmailRow.length).setValues([gmailRow]);

    auditLog('MANUALMATCH', {
      email: payload.adminEmail,
      eventID,
      state: { messageId, transactionNumber, amount },
    });

    // Return minimal summary for frontend refresh
    const updatedEvent: WebAppEvent = {
      eventID:        String(eventRow[WE_COL.EVENT_ID]),
      eventType:      String(eventRow[WE_COL.EVENT_TYPE])  as WebAppEvent['eventType'],
      timestamp:      String(eventRow[WE_COL.TIMESTAMP]),
      expiresAt:      String(eventRow[WE_COL.EXPIRES_AT] || ''),
      memberID:       String(eventRow[WE_COL.MEMBER_ID]),
      email:          String(eventRow[WE_COL.EMAIL]),
      paymentIntent:  String(eventRow[WE_COL.PAYMENT_INTENT]) as WebAppEvent['paymentIntent'],
      amount:         Number(eventRow[WE_COL.AMOUNT]) || 0,
      paymentMethod:  String(eventRow[WE_COL.PAYMENT_METHOD]) as WebAppEvent['paymentMethod'],
      payerName:      String(eventRow[WE_COL.PAYER_NAME]),
      memoField:      String(eventRow[WE_COL.MEMO_FIELD]),
      last4Digits:    String(eventRow[WE_COL.LAST_4_DIGITS]),
      familyMemberEmails: String(eventRow[WE_COL.FAMILY_MEMBER_EMAILS]),
      status:        String(eventRow[WE_COL.STATUS]) as WebAppEvent['status'],  
      matchedMessageId:       String(eventRow[WE_COL.MATCHED_MESSAGE_ID]),
      matchedTransactionNumber: String(eventRow[WE_COL.MATCHED_TRANSACTION_NUMBER]),
      adminApprover: String(eventRow[WE_COL.ADMIN_APPROVER] || ''),
      approvalDate:  String(eventRow[WE_COL.APPROVAL_DATE] || ''),
      notes:         String(eventRow[WE_COL.NOTES] || ''),
    };

    return jsonOk(req.requestId, { event: updatedEvent });
  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

function debugAdminCheck() {
  const raw = getConfigValue('AdminEmails');
  console.log('Raw AdminEmails value:', JSON.stringify(raw));
  const list = raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  console.log('Parsed list:', list);
  console.log('Includes admin@mmrunners.org:', list.includes('admin@mmrunners.org'));
}


(globalThis as any).getPendingEvents     = getPendingEvents;
(globalThis as any).getUnmatchedPayments = getUnmatchedPayments;
(globalThis as any).getConfig            = getConfig;
(globalThis as any).updateConfigEntry    = updateConfigEntry;
(globalThis as any).getPaymentProofs     = getPaymentProofs;
(globalThis as any).getPublicConfig      = getPublicConfig;
(globalThis as any).manualMatch          = manualMatch;


```


---
## File: `src/auth.ts`
---

```typescript
// ============================================================
// Authentication: Google OAuth + Email OTP
// Depends on: config.ts, sheets.ts, logger.ts, members.ts
// Exposed GAS functions: handleGoogleLogin, requestEmailOtp, verifyEmailOtp
// ============================================================


function handleGoogleLogin(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<LoginPayload>;
  const { payload } = req;
  try {
    const email = Session.getActiveUser().getEmail();
    console.log('[mmr][handleGoogleLogin] session email:', email);
    if (!email) {
      return jsonError(req.requestId, 'AUTH_FAILED', 'Could not retrieve your Google account. Please make sure you are signed in.');
    }
    auditLog('LOGIN_START', { sessionID: payload.sessionID, email });

    const existing = findMemberByEmail(email);
    if (!existing) {
      console.log('[mmr][handleGoogleLogin] new member detected:', email);
      auditLog('NEW_MEMBER_DETECTED', { email, sessionID: payload.sessionID });
      return jsonOk(req.requestId, { isNewMember: true, email });
    }

    console.log('[mmr][handleGoogleLogin] returning member:', existing.member.memberID);
    updateMemberRow(existing.rowIndex, { LAST_LOGIN_DATE: new Date().toISOString() });
    auditLog('LOGIN_SUCCESS', { sessionID: payload.sessionID, email, memberID: existing.member.memberID });
    return jsonOk(req.requestId, { member: existing.member, isNewMember: false });
  } catch (e: any) {
    console.error('[mmr][handleGoogleLogin] error:', String(e));
    auditLog('ERROR', { sessionID: payload.sessionID, email: payload.email, errorMessage: String(e) });
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

// New: lightweight pre-OTP lookup — returns firstName + memberID if found, no auth required.
// Does NOT expose sensitive fields (status, expiration, payment data).
function lookupEmail(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{ email: string; sessionID: string }>;
  const { payload } = req;
  try {
    const email = payload.email.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return jsonError(req.requestId, 'INVALID_EMAIL', 'Invalid email address.');
    }
    console.log('[mmr][lookupEmail] looking up:', email);
    auditLog('EMAIL_LOOKUP', { sessionID: payload.sessionID, email });

    const existing = findMemberByEmail(email);
    if (!existing) {
      console.log('[mmr][lookupEmail] not found:', email);
      return jsonOk(req.requestId, { found: false });
    }

    const { member } = existing;
    console.log('[mmr][lookupEmail] found memberID:', member.memberID);
    // Return only non-sensitive fields sufficient for the welcome message
    return jsonOk(req.requestId, {
      found: true,
      firstName: member.firstName || '',
      memberID: member.memberID,
    });
  } catch (e: any) {
    console.error('[mmr][lookupEmail] error:', String(e));
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

function requestEmailOtp(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<OtpRequestPayload>;
  const { payload } = req;
  try {
    const email = payload.email.trim().toLowerCase();
    console.log('[mmr][requestEmailOtp] OTP requested for:', email);
    if (!email || !email.includes('@')) {
      return jsonError(req.requestId, 'INVALID_EMAIL', 'Invalid email address.');
    }
    
    // Check for existing valid OTP
    const existingOtp = findValidOtpByEmail(email);
    if (existingOtp) {
      console.log('[mmr][requestEmailOtp] Found existing valid OTP for:', email);
      // Resend the existing OTP
      sendCode(email, existingOtp.otp.otpCode);
    } else {
      // Generate and send a new OTP
      const otpCode = generateOtpCode();
      const otpValidHours = parseInt(getConfigValue('OTPValidHours'), 10) || 24;
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + otpValidHours * 60 * 60 * 1000);

      appendOtpRecord({
        email,
        otpCode,
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        used: false,
        ipAddress: '',
      });
      
      sendCode(email, otpCode);
    }

    console.log('[mmr][requestEmailOtp] OTP sent to:', email);
    auditLog('OTP_REQUESTED', { sessionID: payload.sessionID, email });
    return jsonOk(req.requestId, { message: 'Code sent. Please check your email.' });
  } catch (e: any) {
    console.error('[mmr][requestEmailOtp] error:', String(e));
    auditLog('ERROR', { sessionID: payload.sessionID, email: payload.email, errorMessage: String(e) });
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

function sendCode(email: string, otpCode: string): void {
  const otpValidHours = parseInt(getConfigValue('OTPValidHours'), 10) || 24;
  MailApp.sendEmail({
    to: email,
    subject: 'Your Misty Mountain Runners Login Code',
    body: `Your login code is: ${otpCode}\n\nThis code expires in ${otpValidHours} hours.\n\nIf you did not request this code, please ignore this email.`,
  });
}

function handleOtpNotFound(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<OtpVerifyPayload>;
  const { payload } = req;
  try {
    const email = payload.email.trim().toLowerCase();
    console.log('[mmr][handleOtpNotFound] OTP not found, generating a new one for:', email);
    auditLog('OTP_NOT_FOUND', { sessionID: payload.sessionID, email });
    
    // To avoid duplicating code, we can call requestEmailOtp internally.
    // However, requestEmailOtp sends an email and returns a JSON string.
    // We want to send the email but return a specific JSON response for this case.
    
    const otpCode = generateOtpCode();
    const otpValidHours = parseInt(getConfigValue('OTPValidHours'), 10) || 24;
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + otpValidHours * 60 * 60 * 1000);

    appendOtpRecord({
      email,
      otpCode,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      used: false,
      ipAddress: '', // IP address is not available in this context
    });

    MailApp.sendEmail({
      to: email,
      subject: 'Your New Misty Mountain Runners Login Code',
      body: `We received a login attempt, but the code was invalid. Here is a new login code for you: ${otpCode}\n\nThis code expires in ${otpValidHours} hours.\n\nIf you did not request this code, please ignore this email.`,
    });
    
    return jsonOk(req.requestId, {
      otpNotFound: true,
      message: 'Invalid or expired code. A new code has been sent to your email address. Please check your inbox.',
    });
  } catch (e: any) {
    console.error('[mmr][handleOtpNotFound] error:', String(e));
    auditLog('ERROR', { sessionID: payload.sessionID, email: payload.email, errorMessage: String(e) });
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

function verifyEmailOtp(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<OtpVerifyPayload>;
  const { payload } = req;
  try {
    const email = payload.email.trim().toLowerCase();
    console.log('[mmr][verifyEmailOtp] verifying OTP for:', email, '| code length:', payload.otpCode.length);
    const match = findValidOtp(email, payload.otpCode.trim());
    if (!match) {
      console.log('[mmr][verifyEmailOtp] OTP invalid or expired for:', email);
      auditLog('OTP_VERIFY_FAIL', { sessionID: payload.sessionID, email });
      return handleOtpNotFound(jsonRequest);
    }
    markOtpUsed(match.rowIndex);

    const existing = findMemberByEmail(email);
    if (!existing) {
      console.log('[mmr][verifyEmailOtp] new member detected:', email);
      auditLog('NEW_MEMBER_DETECTED', { email, sessionID: payload.sessionID });
      return jsonOk(req.requestId, { isNewMember: true, email });
    }

    console.log('[mmr][verifyEmailOtp] returning member:', existing.member.memberID);
    updateMemberRow(existing.rowIndex, { LAST_LOGIN_DATE: new Date().toISOString() });
    auditLog('OTP_VERIFY_SUCCESS', { sessionID: payload.sessionID, email, memberID: existing.member.memberID });
    return jsonOk(req.requestId, { member: existing.member, isNewMember: false });
  } catch (e: any) {
    console.error('[mmr][verifyEmailOtp] error:', String(e));
    auditLog('ERROR', { sessionID: payload.sessionID, email: payload.email, errorMessage: String(e) });
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

(globalThis as any).lookupEmail      = lookupEmail;
(globalThis as any).requestEmailOtp  = requestEmailOtp;
(globalThis as any).verifyEmailOtp   = verifyEmailOtp;
(globalThis as any).handleGoogleLogin = handleGoogleLogin;
```


---
## File: `src/config.ts`
---

```typescript
// ============================================================
// Spreadsheet configuration
// MEMBERSHIP_SPREADSHEET_ID: the workbook containing Membership-Master-Main-3
//   and all new sheets (WebApp-Events, Payment-History, Auth-OTP, Config,
//   WebApp-ActivityLog, Membership-Master-Log).
// GMAIL_SPREADSHEET_ID: the separate workbook containing the Fetch-Gmail sheet.
// Update both IDs before deploying.
// ============================================================

const MEMBERSHIP_SPREADSHEET_ID = '11SFvgApmDtEv4jz5bTYI9_zEhCFMQAXC4b2z_4s3ljk';
const GMAIL_SPREADSHEET_ID = '1rVOvhXzSxCRpWdAw3jYq5tWrYdCYtXmfqblTHP_wPqA';

// Sheet names
const SHEET_NAMES = {
  MEMBERSHIP_MASTER: 'Main',
  MEMBERSHIP_LOG:    'Membership-Master-Log',   // Full-row audit log (copy before every write)
  WEBAPP_EVENTS:     'WebApp-Events',
  PAYMENT_HISTORY:   'Payment-History',
  AUTH_OTP:          'Auth-OTP',
  CONFIG:            'Config',
  ACTIVITY_LOG:      'WebApp-ActivityLog',
  FETCH_GMAIL:       'Active',
  PAYMENT_EVENTS:    'Payment Confirmation Events',
};

// Sheets that live in the Fetch-Gmail spreadsheet (all others are in the membership spreadsheet)
const GMAIL_SHEETS = new Set([SHEET_NAMES.FETCH_GMAIL]);

// Membership Master column indices (0-based)
const MM_COL = {
  MEMBER_ID: 0,
  STATUS: 1,
  CREATED: 2,
  EXPIRATION: 3,
  EMAIL: 4,
  FIRST_NAME: 5,
  LAST_NAME: 6,
  TYPE: 7,
  FAMILY_ID: 8,
  GENDER: 9,
  WECHAT_ID: 10,
  DISTRICT: 11,
  WEBAPP: 12,
  PAYMENT_CHECK: 13,
  INFO: 14,
  LAST_UPDATED: 15,
  MEMBERSHIP_FEE_PAID: 16,
  PAYMENT_DATE: 17,
  PAYMENT_TRANSACTION: 18,
  // New columns appended after existing ones
  JOIN_YEAR: 19,
  PHONE_NUMBER: 20,
  LAST_LOGIN_DATE: 21,
  NOTES: 22,
};

// Membership-Master-Log column indices (0-based)
// LogID and LoggingTime are prepended; all MM_COL values follow at offset +2
const ML_COL = {
  LOG_ID: 0,
  LOGGING_TIME: 1,
  // Main table columns start at index 2 (MM_COL offset by +2)
};
const ML_MM_OFFSET = 2; // MM columns start at this index in the log table

// WebApp-Events column indices (0-based)
const WE_COL = {
  EVENT_ID: 0,
  EVENT_TYPE: 1,
  TIMESTAMP: 2,
  EXPIRES_AT: 3,           // New: Timestamp + PaymentProofReviewDays
  MEMBER_ID: 4,
  EMAIL: 5,
  PAYMENT_INTENT: 6,
  AMOUNT: 7,
  PAYMENT_METHOD: 8,
  PAYER_NAME: 9,
  MEMO_FIELD: 10,
  LAST_4_DIGITS: 11,
  FAMILY_MEMBER_EMAILS: 12,
  STATUS: 13,
  MATCHED_MESSAGE_ID: 14,
  MATCHED_TRANSACTION_NUMBER: 15,
  ADMIN_APPROVER: 16,
  APPROVAL_DATE: 17,
  NOTES: 18,
  // Payment-proof fields
  PAYMENT_DATE: 19,
  SCREENSHOT_FILE_ID: 20,
  GDRIVE_FILE_PATH: 21,
  OCR_TEXT: 22,
  OCR_TIMESTAMP: 23,
};

// Payment-History column indices (0-based)
const PH_COL = {
  PAYMENT_ID: 0,
  EVENT_ID: 1,
  MEMBER_ID: 2,
  PAYMENT_DATE: 3,
  AMOUNT: 4,
  MEMBERSHIP_TYPE: 5,
  PAYMENT_METHOD: 6,
  PAYER_NAME: 7,
  MEMO_FIELD: 8,
  LAST_4_DIGITS: 9,
  TRANSACTION_REFERENCE: 10,
  PERIOD_START: 11,
  PERIOD_END: 12,
  PROCESSED_BY: 13,
  PROCESSED_DATE: 14,
  SOURCE: 15,
  NOTES: 16,
};

// Auth-OTP column indices (0-based)
const OTP_COL = {
  EMAIL: 0,
  OTP_CODE: 1,
  CREATED_AT: 2,
  EXPIRES_AT: 3,
  USED: 4,
  IP_ADDRESS: 5,
};

// WebApp-ActivityLog column indices (0-based)
const LOG_COL = {
  LOG_ID: 0,
  TIMESTAMP: 1,
  SESSION_ID: 2,
  MEMBER_ID: 3,
  EMAIL: 4,
  EVENT_ID: 5,
  ACTION: 6,
  STATE: 7,
  ERROR_CODE: 8,
  ERROR_MESSAGE: 9,
};

// Fetch Gmail column indices (0-based)
const FG_COL = {
  TIMESTAMP: 0,
  SENDER: 1,
  AMOUNT: 2,
  MEMO: 3,
  TRANSACTION_DATE: 4,
  TRANSACTION_NUMBER: 5,
  MESSAGE_ID: 6,
  SUBJECT: 7,
  ORIGINAL_MEMO: 8,
  NOTES: 9,
  PROCESSED: 10,
  SOURCE: 11,
  WEBAPP_EVENT_ID: 12,
};

// Config sheet column indices (0-based)
const CFG_COL = {
  KEY: 0,
  VALUE: 1,
  DESCRIPTION: 2,
};

// Payment Confirmation Events column indices (0-based)
const PCE_COL = {
  EVENT_NAME: 0,
  DESCRIPTION: 1,
  CONFIRMATION_METHOD: 2,
};


// ============================================================
// Sheet headers for auto-creation (new sheets only)
// Existing sheets (Membership Master, Fetch-Gmail) must already exist.
// ============================================================

const SHEET_HEADERS: Record<string, string[]> = {
  [SHEET_NAMES.MEMBERSHIP_LOG]: [
    'LogID', 'LoggingTime',
    // All Main table columns follow (mirrors MM_COL order)
    'MemberID', 'Status', 'Created', 'Expiration', 'Email',
    'FirstName', 'LastName', 'Type', 'FamilyID', 'Gender',
    'WeChatID', 'District', 'WebApp', 'PaymentCheck', 'Info',
    'LastUpdated', 'MembershipFeePaid', 'PaymentDate', 'PaymentTransaction',
    'JoinYear', 'PhoneNumber', 'LastLoginDate', 'Notes',
  ],
  [SHEET_NAMES.WEBAPP_EVENTS]: [
    'EventID', 'EventType', 'Timestamp', 'ExpiresAt', 'MemberID', 'Email',
    'PaymentIntent', 'Amount', 'PaymentMethod', 'PayerName', 'MemoField',
    'Last4Digits', 'FamilyMemberEmails', 'Status',
    'MatchedMessageId', 'MatchedTransactionNumber',
    'AdminApprover', 'ApprovalDate', 'Notes',
    'PaymentDate', 'ScreenshotFileId', 'GDriveFilePath', 'OCRText', 'OCRTimestamp',
  ],
  [SHEET_NAMES.PAYMENT_HISTORY]: [
    'PaymentID', 'EventID', 'MemberID', 'PaymentDate', 'Amount',
    'PaymentIntent', 'PaymentMethod', 'PayerName', 'MemoField',
    'Last4Digits', 'TransactionReference', 'PeriodStart', 'PeriodEnd',
    'ProcessedBy', 'ProcessedDate', 'Source', 'Notes',
  ],
  [SHEET_NAMES.AUTH_OTP]: [
    'Email', 'OTPCode', 'CreatedAt', 'ExpiresAt', 'Used', 'IPAddress',
  ],
  [SHEET_NAMES.CONFIG]: [
    'Key', 'Value', 'Description',
  ],
  [SHEET_NAMES.ACTIVITY_LOG]: [
    'LogID', 'Timestamp', 'SessionID', 'MemberID', 'Email',
    'EventID', 'Action', 'State', 'ErrorCode', 'ErrorMessage',
  ],
  [SHEET_NAMES.PAYMENT_EVENTS]: [
    'Event Name', 'Description', 'Confirmation Method',
  ],
};

// Default Config values seeded on first creation
const DEFAULT_CONFIG_ROWS: string[][] = [
  ['IndividualPrice',          '30',                      'Price for individual membership dues'],
  ['FamilyPrice',              '50',                      'Price for family membership dues'],
  ['FamilyUpgradePrice',       '20',                      'Delta price to upgrade Individual → Family mid-cycle'],
  ['PaymentMethods',           'Zelle,Venmo,PayPal',      'Comma-separated accepted payment methods'],
  ['ZelleHandle',              'zelle@example.com',       'Zelle payment handle'],
  ['VenmoHandle',              '@venmo-user',             'Venmo payment handle'],
  ['PayPalHandle',             'paypal@example.com',      'PayPal payment handle'],
  ['ReminderDaysBefore',       '42',                      'Days before expiry to show renewal buttons on dashboard'],
  ['UpgradeMinMonths',         '3',                       'Minimum months remaining to allow Family Upgrade (delta payment)'],
  ['PaymentProofReviewDays',   '7',                       'Days before an unreviewed payment proof event auto-expires'],
  ['MembershipRenewalYears',   '1',                       'Years added per dues payment'],
  ['OTPValidHours',            '24',                      'Hours before OTP expires'],
  ['OTPCleanupDays',           '7',                       'Days before used/expired OTPs are deleted'],
  ['AdminEmails',              'admin@mmrunners.org',     'Comma-separated admin email addresses'],
  ['AppBaseUrl',               '',                        'Deployed web app URL (set after first deploy)'],
  ['PaymentProofFolderId',     '1I-FR4iTC8649XBzFSplyG2XARNBHwflz', 'Google Drive folder ID for payment proofs'],
  ['ZelleQRCodeFileId',        '',                        'Google Drive file ID for Zelle QR code image'],
  ['VenmoQRCodeFileId',        '',                        'Google Drive file ID for Venmo QR code image'],
];

// Default Payment Events values seeded on first creation
const DEFAULT_PAYMENT_EVENTS_ROWS: string[][] = [
  ['Individual Membership', 'Confirm your payment for individual membership dues', 'Match with payment history'],
  ['Family Membership',     'Confirm your payment for family membership dues',     'Match with payment history'],
  ['Family Upgrade',        'Confirm your payment for upgrading to family membership (delta)', 'Match with payment history'],
  ['Other Payment',         'Confirm your other payments related to membership',   'Manual review'],
];


// ============================================================
// Spreadsheet + Config helpers
// ============================================================

function getSheet(name: string): GoogleAppsScript.Spreadsheet.Sheet {
  const id = GMAIL_SHEETS.has(name) ? GMAIL_SPREADSHEET_ID : MEMBERSHIP_SPREADSHEET_ID;
  const ss = SpreadsheetApp.openById(id);
  let sheet = ss.getSheetByName(name);

  if (!sheet) {
    const headers = SHEET_HEADERS[name];
    if (!headers) {
      // Existing sheet (Membership Master or Fetch-Gmail) — must exist already
      throw new Error(`Sheet not found: "${name}" in spreadsheet ${id}`);
    }
    // Auto-create with correct headers
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    // Freeze header row
    sheet.setFrozenRows(1);
    // Seed default values
    if (name === SHEET_NAMES.CONFIG) {
      DEFAULT_CONFIG_ROWS.forEach(row => sheet!.appendRow(row));
    } else if (name === SHEET_NAMES.PAYMENT_EVENTS) {
      DEFAULT_PAYMENT_EVENTS_ROWS.forEach(row => sheet!.appendRow(row));
    }
  }

  return sheet;
}

function getConfigMap(): ConfigMap {
  const sheet = getSheet(SHEET_NAMES.CONFIG);
  const rows = sheet.getDataRange().getValues();
  const map: ConfigMap = {};
  for (let i = 1; i < rows.length; i++) {
    const key = String(rows[i][CFG_COL.KEY]).trim();
    const value = String(rows[i][CFG_COL.VALUE]).trim();
    if (key) map[key] = value;
  }
  return map;
}

function getConfigValue(key: string): string {
  return getConfigMap()[key] ?? '';
}

function setConfigValue(key: string, value: string): void {
  const sheet = getSheet(SHEET_NAMES.CONFIG);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][CFG_COL.KEY]).trim() === key) {
      sheet.getRange(i + 1, CFG_COL.VALUE + 1).setValue(value);
      return;
    }
  }
  // Key not found — append new row
  sheet.appendRow([key, value, '']);
}

// ── globalThis exports for test environment ──────────────────
// In GAS all functions are globally scoped. In Node.js/Jest each
// require() runs in its own module scope, so helpers needed by
// other modules must be reachable via globalThis.
(globalThis as any).getSheet           = getSheet;
(globalThis as any).getConfigMap       = getConfigMap;
(globalThis as any).getConfigValue     = getConfigValue;
(globalThis as any).setConfigValue     = setConfigValue;

// Export config constants so cross-module calls can resolve them in the test environment
(globalThis as any).SHEET_NAMES    = SHEET_NAMES;
(globalThis as any).GMAIL_SHEETS   = GMAIL_SHEETS;
(globalThis as any).MM_COL         = MM_COL;
(globalThis as any).ML_COL         = ML_COL;
(globalThis as any).ML_MM_OFFSET   = ML_MM_OFFSET;
(globalThis as any).WE_COL         = WE_COL;
(globalThis as any).PH_COL         = PH_COL;
(globalThis as any).OTP_COL        = OTP_COL;
(globalThis as any).LOG_COL        = LOG_COL;
(globalThis as any).FG_COL         = FG_COL;
(globalThis as any).CFG_COL        = CFG_COL;
(globalThis as any).PCE_COL        = PCE_COL;
(globalThis as any).MEMBERSHIP_SPREADSHEET_ID = MEMBERSHIP_SPREADSHEET_ID;
(globalThis as any).GMAIL_SPREADSHEET_ID      = GMAIL_SPREADSHEET_ID;

```


---
## File: `src/family.ts`
---

```typescript
// ============================================================
// Family member management
// Depends on: config.ts, sheets.ts, logger.ts
// Exposed GAS functions: getFamilyMembers, addFamilyMember, removeFamilyMember
// ============================================================

// Returns all members sharing the acting member's FamilyID.
function getFamilyMembers(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{ memberID: string; sessionID: string }>;
  const { payload } = req;
  try {
    const result = findMemberByID(payload.memberID);
    if (!result) return jsonError(req.requestId, 'NOT_FOUND', 'Member not found.');

    const { member } = result;
    if (member.type !== 'Family') {
      return jsonError(req.requestId, 'INVALID_STATE',
        'Only Family-type members can manage family members.');
    }
    if (!member.familyID) {
      return jsonOk(req.requestId, { members: [] });
    }

    const members = getMembersByFamilyID(member.familyID);
    return jsonOk(req.requestId, { members, familyID: member.familyID });
  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

// Add a member to the acting member's family group.
// The target member must already exist in Membership Master.
// If Status = pending_upgrade, the new member gets Expiration = yesterday (inactive).
function addFamilyMember(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<FamilyMemberPayload>;
  const { payload } = req;
  try {
    const actor = findMemberByID(payload.memberID);
    if (!actor) return jsonError(req.requestId, 'NOT_FOUND', 'Acting member not found.');

    if (actor.member.type !== 'Family') {
      return jsonError(req.requestId, 'INVALID_STATE',
        'Only Family-type members can add family members.');
    }
    if (!actor.member.familyID) {
      return jsonError(req.requestId, 'INVALID_STATE', 'Acting member has no FamilyID.');
    }

    const target = findMemberByEmail(payload.targetEmail);
    if (!target) {
      return jsonError(req.requestId, 'NOT_FOUND',
        `No member found with email: ${payload.targetEmail}`);
    }
    if (target.member.familyID && target.member.familyID !== actor.member.familyID) {
      return jsonError(req.requestId, 'CONFLICT',
        'This member is already part of a different family group.');
    }
    if (target.member.memberID === payload.memberID) {
      return jsonError(req.requestId, 'INVALID_STATE', 'Cannot add yourself as a family member.');
    }

    // Log before write
    logMainTableRow(target.member.memberID);

    const now = new Date().toISOString();

    // If acting member is in pending_upgrade, new member gets yesterday's date (inactive)
    const isPendingUpgrade = actor.member.status === 'pending_upgrade';
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const updates: Record<string, any> = {
      TYPE:        'Family',
      FAMILY_ID:   actor.member.familyID,
      LAST_UPDATED: now,
    };
    if (isPendingUpgrade) {
      updates['EXPIRATION'] = yesterdayStr;
      updates['STATUS']     = 'pending_upgrade';
    }

    updateMemberRow(target.rowIndex, updates);

    auditLog('FAMILY_MEMBER_ADDED', {
      memberID:  payload.memberID,
      sessionID: payload.sessionID,
      state:     { targetMemberID: target.member.memberID, familyID: actor.member.familyID },
    });

    const updated = findMemberByID(target.member.memberID);
    return jsonOk(req.requestId, {
      member: updated?.member,
      message: `${target.member.firstName || target.member.email} added to family.`,
    });
  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

// Remove a member from the acting member's family group.
// The removed member reverts to Individual; their status is recalculated from expiration.
function removeFamilyMember(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<FamilyMemberPayload>;
  const { payload } = req;
  try {
    const actor = findMemberByID(payload.memberID);
    if (!actor) return jsonError(req.requestId, 'NOT_FOUND', 'Acting member not found.');

    if (actor.member.type !== 'Family') {
      return jsonError(req.requestId, 'INVALID_STATE',
        'Only Family-type members can remove family members.');
    }

    const target = findMemberByEmail(payload.targetEmail);
    if (!target) {
      return jsonError(req.requestId, 'NOT_FOUND',
        `No member found with email: ${payload.targetEmail}`);
    }
    if (target.member.memberID === payload.memberID) {
      return jsonError(req.requestId, 'INVALID_STATE',
        'Cannot remove yourself. Use Cancel Upgrade or contact admin.');
    }
    if (target.member.familyID !== actor.member.familyID) {
      return jsonError(req.requestId, 'CONFLICT',
        'This member is not in your family group.');
    }

    // Log before write
    logMainTableRow(target.member.memberID);

    const now = new Date().toISOString();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const expDate = target.member.expiration ? new Date(target.member.expiration) : null;
    const revertedStatus =
      expDate && !isNaN(expDate.getTime()) && expDate >= today ? 'active' : 'inactive';

    updateMemberRow(target.rowIndex, {
      TYPE:        'Individual',
      FAMILY_ID:   '',
      STATUS:      revertedStatus,
      LAST_UPDATED: now,
    });

    auditLog('FAMILY_MEMBER_REMOVED', {
      memberID:  payload.memberID,
      sessionID: payload.sessionID,
      state:     { targetMemberID: target.member.memberID },
    });

    return jsonOk(req.requestId, {
      message: `${target.member.firstName || target.member.email} removed from family and reverted to Individual.`,
    });
  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

(globalThis as any).getFamilyMembers   = getFamilyMembers;
(globalThis as any).addFamilyMember    = addFamilyMember;
(globalThis as any).removeFamilyMember = removeFamilyMember;

```


---
## File: `src/image.ts`
---

```typescript
// ============================================================
// Image serving
// ============================================================

// Image serving
function serveImage(fileId: string): GoogleAppsScript.HTML.HtmlOutput {
  try {
    console.log('mmr:serveImage fileId =', fileId);
    if (!fileId) {
      return HtmlService.createHtmlOutput('<p>Missing file ID</p>');
    }
    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();
    const mimeType = blob.getContentType();
    const bytes = blob.getBytes();
    const base64 = Utilities.base64Encode(bytes);

    console.log('mmr:serveImage mimeType =', mimeType, 'size =', bytes.length);

    // Serve as inline base64 image page — browsers accept this from GAS doGet
    const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;">
      <img src="data:${mimeType};base64,${base64}" style="max-width:100%;display:block;" />
    </body></html>`;

    return HtmlService.createHtmlOutput(html)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (e: any) {
    console.error('mmr:serveImage ERROR fileId =', fileId, 'error =', String(e));
    return HtmlService.createHtmlOutput(`<p>Image not found: ${String(e)}</p>`);
  }
}

```


---
## File: `src/logger.ts`
---

```typescript
// ============================================================
// Audit log helper
// Depends on: config.ts, sheets.ts
// ============================================================

function auditLog(
  action: string,
  details: {
    sessionID?: string;
    memberID?: string;
    email?: string;
    eventID?: string;
    state?: object;
    errorCode?: string;
    errorMessage?: string;
  }
): void {
  try {
    console.log('[mmr][audit]', action, JSON.stringify(details));
    const sheet = getSheet(SHEET_NAMES.ACTIVITY_LOG);
    sheet.appendRow([
      generateLogID(),
      new Date().toISOString(),
      details.sessionID ?? '',
      details.memberID ?? '',
      details.email ?? '',
      details.eventID ?? '',
      action,
      details.state ? JSON.stringify(details.state) : '',
      details.errorCode ?? '',
      details.errorMessage ? details.errorMessage.substring(0, 500) : '',
    ]);
  } catch (e) {
    // Logging must never crash the main flow
    console.error('auditLog failed:', e);
  }
}

// ── globalThis exports for test environment ──────────────────
(globalThis as any).auditLog    = auditLog;

```


---
## File: `src/members.ts`
---

```typescript
// ============================================================
// Member profile management
// Depends on: config.ts, sheets.ts, logger.ts
// Exposed GAS functions: getOrCreateMemberProfile, updateMemberProfile, createNewMember
// ============================================================

// ✅ AFTER — trust the payload email only
function getOrCreateMemberProfile(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{ email?: string; sessionID?: string }>;
  const payload = req.payload;
  try {
    // Auth already validated at login (handleGoogleLogin / verifyEmailOtp).
    // Trust the payload email directly — do NOT use Session.getActiveUser()
    // here, as GAS may resolve to the script owner's account instead of
    // the actual user when called from a loaded page.
    const resolvedEmail = (payload.email || '').trim().toLowerCase();
    console.log('[mmr] getOrCreateMemberProfile payload email:', payload.email,
      'resolved:', resolvedEmail);

    if (!resolvedEmail) {
      return jsonError(req.requestId, 'AUTH_REQUIRED', 'No email available. Please sign in again.');
    }

    const result = findMemberByEmail(resolvedEmail);
    if (!result) {
      console.log('[mmr] getOrCreateMemberProfile member not found for', resolvedEmail);
      return jsonError(req.requestId, 'NOT_FOUND', 'Member not found. Please sign in again.');
    }

    console.log('[mmr] getOrCreateMemberProfile found member', result.member.memberID);
    let familyMembers: Member[] = [];
    if (result.member.familyID) {
      familyMembers = findMembersByFamilyID(result.member.familyID).map(r => r.member);
    }
    console.log('[mmr] getOrCreateMemberProfile family members:', familyMembers.length);
    return jsonOk(req.requestId, { member: result.member, familyMembers });
  } catch (e: any) {
    console.error('[mmr] getOrCreateMemberProfile error', String(e));
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

function updateMemberProfile(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<UpdateProfilePayload>;
  const { payload } = req;
  try {
    console.log('[mmr][updateMemberProfile] memberID:', payload.memberID);
    const result = findMemberByID(payload.memberID);
    if (!result) return jsonError(req.requestId, 'NOT_FOUND', 'Member not found.');

    const now = new Date().toISOString();
    const updates: Record<string, any> = {
      LAST_UPDATED: now,
    };
    if (payload.firstName   !== undefined) updates['FIRST_NAME']   = payload.firstName.trim();
    if (payload.lastName    !== undefined) updates['LAST_NAME']    = payload.lastName.trim();
    if (payload.phoneNumber !== undefined) updates['PHONE_NUMBER'] = payload.phoneNumber.trim();
    if (payload.wechatID    !== undefined) updates['WECHAT_ID']    = payload.wechatID.trim();
    if (payload.district    !== undefined) updates['DISTRICT']     = payload.district.trim();
    if (payload.joinYear    !== undefined) updates['JOIN_YEAR']    = payload.joinYear.trim();
    // NOTE: Type is intentionally excluded. Membership type changes
    // (Individual ↔ Family) are handled exclusively via upgrade.ts.

    console.log('[mmr][updateMemberProfile] updating fields:', Object.keys(updates));
    logMainTableRow(payload.memberID);
    updateMemberRow(result.rowIndex, updates);
    auditLog('PROFILE_UPDATE', { memberID: payload.memberID, state: payload });

    const updated = findMemberByID(payload.memberID);
    console.log('[mmr][updateMemberProfile] update complete for:', payload.memberID);
    return jsonOk(req.requestId, { member: updated?.member });
  } catch (e: any) {
    console.error('[mmr][updateMemberProfile] error:', String(e));
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

// Called by the new-member registration page after form submission.
function createNewMember(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{
    email: string;
    firstName: string;
    lastName: string;
    phoneNumber?: string;
    district?: string;
    sessionID?: string;
  }>;
  const { payload } = req;
  try {
    const email = payload.email.trim().toLowerCase();
    console.log('[mmr][createNewMember] called for email:', email);

    // Guard: don't create a duplicate
    const existing = findMemberByEmail(email);
    if (existing) {
      console.log('[mmr][createNewMember] member already exists:', existing.member.memberID);
      return jsonOk(req.requestId, { member: existing.member, alreadyExisted: true });
    }

    const memberID = generateMemberID();
    const now = new Date().toISOString();
    const currentYear = String(new Date().getFullYear());

    const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
    const newRow: any[] = new Array(23).fill('');
    newRow[MM_COL.MEMBER_ID] = memberID;
    newRow[MM_COL.STATUS] = 'inactive';
    newRow[MM_COL.CREATED] = now;
    newRow[MM_COL.EMAIL] = email;
    newRow[MM_COL.FIRST_NAME] = payload.firstName.trim();
    newRow[MM_COL.LAST_NAME] = (payload.lastName || '').trim();
    newRow[MM_COL.TYPE] = 'Individual';
    newRow[MM_COL.PHONE_NUMBER] = (payload.phoneNumber || '').trim();
    newRow[MM_COL.DISTRICT] = (payload.district || '').trim();
    newRow[MM_COL.JOIN_YEAR] = currentYear;
    newRow[MM_COL.LAST_UPDATED] = now;
    newRow[MM_COL.LAST_LOGIN_DATE] = now;
    sheet.appendRow(newRow);

    console.log('[mmr][createNewMember] created member ID:', memberID, 'for:', email);
    auditLog('MEMBER_CREATED', { memberID, email, sessionID: payload.sessionID });

    const created = findMemberByEmail(email);
    if (!created) throw new Error('Failed to retrieve newly created member record.');
    return jsonOk(req.requestId, { member: created.member });
  } catch (e: any) {
    console.error('[mmr][createNewMember] error:', String(e));
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

function getMemberPaymentHistory(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{ email: string; sessionID: string }>;
  const payload = req.payload;
  try {
    const email = payload.email.trim().toLowerCase();

    // 1. Resolve member
    const found = findMemberByEmail(email);
    if (!found) return jsonError(req.requestId, 'MEMBER_NOT_FOUND', 'Member not found.');
    const member = found.member;
    const memberID = member.memberID;

    // 2. Expand to family scope: self + anyone sharing the same FamilyID
    let allMemberIDs: string[] = [memberID];
    if (member.familyID) {
      const familyMembers = getMembersByFamilyID(member.familyID);
      const familyIDs = familyMembers
        .map(m => m.memberID)
        .filter(id => id !== memberID);
      allMemberIDs = [memberID, ...familyIDs];
    }

    // 3. Gather data across entire family scope
    const payments = allMemberIDs.flatMap(id => getPaymentHistoryByMemberID(id));
    const events   = allMemberIDs.flatMap(id => getWebAppEventsByMemberID(id));

    auditLog('PAYMENTHISTORY_VIEW', { sessionID: payload.sessionID, memberID });

    // Return memberID so frontend knows who "self" is (to label family entries)
    return jsonOk(req.requestId, { memberID, payments, events });
  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

(globalThis as any).getOrCreateMemberProfile  = getOrCreateMemberProfile;
(globalThis as any).updateMemberProfile       = updateMemberProfile;
(globalThis as any).getMemberPaymentHistory   = getMemberPaymentHistory;
(globalThis as any).createNewMember            = createNewMember;            // ← 
```


---
## File: `src/ocr.ts`
---

```typescript
// ============================================================
// OCR processing for payment proofs stored in WebApp-Events
// Depends on: config.ts, sheets.ts, admin.ts
// Exposed GAS functions: runOcrForPaymentProof
// ============================================================

// Enable Advanced Drive Service (Resources → Advanced Google services → Drive API)
function ocrImageToText_(imageFileId: string): string {
  const file = Drive.Files.copy(
    {
      name: 'OCR temp',
      mimeType: 'application/vnd.google-apps.document'
    },
    imageFileId,
    {ocr: true}
  );

  if (!file.id) {
    throw new Error('Failed to create temporary file for OCR.');
  }

  const doc = DocumentApp.openById(file.id);
  const text = doc.getBody().getText();
  Drive.Files.remove(file.id); // Clean up the temporary file
  return text;
}

function runOcrForPaymentProof(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{ adminEmail: string; eventId: string }>;
  const { payload } = req;
  try {
    if (!isAdmin(payload.adminEmail)) {
      return jsonError(req.requestId, 'FORBIDDEN', 'Not authorized.');
    }

    const found = findWebAppEvent(payload.eventId);
    if (!found) {
      return jsonError(req.requestId, 'NOT_FOUND', 'WebApp event not found.');
    }

    const fileId = found.event.screenshotFileId || '';
    if (!fileId) {
      return jsonError(req.requestId, 'BAD_REQUEST', 'No screenshot file ID found for this event.');
    }

    const ocrText = ocrImageToText_(fileId);
    const filePath = DriveApp.getFileById(fileId).getUrl();
    const timestamp = new Date().toISOString();

    updateWebAppEventRow(found.rowIndex, {
      GDRIVE_FILE_PATH: filePath,
      OCR_TEXT:         ocrText,
      OCR_TIMESTAMP:    timestamp,
    });

    return jsonOk(req.requestId, { message: 'OCR process completed successfully.' });

  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

```


---
## File: `src/otp.ts`
---

```typescript

function findValidOtp(email: string, otpCode: string): OtpMatch | null {
  const sheet = getSheet('OTP');
  const otps = sheet.getDataRange().getValues();
  const now = new Date();

  // Iterate backwards to find the most recent OTP
  for (let i = otps.length - 1; i > 0; i--) {
    const row = otps[i];
    const record: Otp = {
      email: row[0],
      otpCode: String(row[1]),
      createdAt: row[2],
      expiresAt: row[3],
      used: row[4],
      ipAddress: row[5],
    };

    if (
      record.email.toLowerCase() === email.toLowerCase() &&
      record.otpCode === otpCode &&
      !record.used &&
      new Date(record.expiresAt) > now
    ) {
      return {
        rowIndex: i + 1,
        otp: record,
      };
    }
  }
  return null;
}

function findValidOtpByEmail(email: string): OtpMatch | null {
  const sheet = getSheet('OTP');
  const otps = sheet.getDataRange().getValues();
  const now = new Date();

  // Iterate backwards to find the most recent OTP
  for (let i = otps.length - 1; i > 0; i--) {
    const row = otps[i];
    const record: Otp = {
      email: row[0],
      otpCode: String(row[1]),
      createdAt: row[2],
      expiresAt: row[3],
      used: row[4],
      ipAddress: row[5],
    };

    if (
      record.email.toLowerCase() === email.toLowerCase() &&
      !record.used &&
      new Date(record.expiresAt) > now
    ) {
      return {
        rowIndex: i + 1,
        otp: record,
      };
    }
  }
  return null;
}

function appendOtpRecord(otp: Otp): void {
  const sheet = getSheet('OTP');
  sheet.appendRow([
    otp.email,
    otp.otpCode,
    otp.createdAt,
    otp.expiresAt,
    otp.used,
    otp.ipAddress,
  ]);
}

function markOtpUsed(rowIndex: number): void {
  const sheet = getSheet('OTP');
  sheet.getRange(rowIndex, 5).setValue(true);
}

```


---
## File: `src/payment_proof.ts`
---

```typescript
// ============================================================
// Payment Proof Submission
// Depends on: config.ts, sheets.ts, logger.ts
// Exposed GAS functions: getPaymentConfirmationEvents, submitPaymentProof
// ============================================================

function getPaymentConfirmationEvents(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{}>;
  try {
    const sheet = getSheet(SHEET_NAMES.PAYMENT_EVENTS);
    const rows = sheet.getDataRange().getValues().slice(1); // skip header
    const events = rows.map(row => ({
      name: row[PCE_COL.EVENT_NAME],
      description: row[PCE_COL.DESCRIPTION],
      confirmationMethod: row[PCE_COL.CONFIRMATION_METHOD],
    }));
    return jsonOk(req.requestId, { events });
  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

function submitPaymentProof(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<any>;
  const { payload } = req;
  try {
    console.log('[mmr][submitPaymentProof] memberID:', payload.memberID);

    // 1. Upload screenshot to Drive
    const folderId = getConfigValue('PaymentProofFolderId');
    if (!folderId) {
      throw new Error('Payment proof folder ID is not configured.');
    }
    const folder = DriveApp.getFolderById(folderId);

    let fileId = '';
    if (payload.screenshot) {
      const decoded = Utilities.base64Decode(payload.screenshot);
      const blob = Utilities.newBlob(decoded, 'image/png', `${payload.memberID}-proof-${Date.now()}.png`);
      const file = folder.createFile(blob);
      fileId = file.getId();
    }

    // 2. Find the most recent Pending or Matched WebApp-Event for this member
    const memberEvents = getWebAppEventsByMemberID(payload.memberID);
    const pendingEvent = memberEvents
      .filter(ev => ev.status === 'Pending' || ev.status === 'Matched')
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

    if (pendingEvent) {
      // 3a. Attach proof fields to the existing event
      const found = findWebAppEvent(pendingEvent.eventID);
      if (found) {
        updateWebAppEventRow(found.rowIndex, {
          PAYMENT_DATE:       payload.paymentDate || '',
          SCREENSHOT_FILE_ID: fileId,
          NOTES:              payload.notes || found.event.notes,
        });
        console.log('[mmr][submitPaymentProof] updated existing event:', pendingEvent.eventID);
      }
    } else {
      // 3b. No pending event found — create a standalone proof event
      const newEventID = appendWebAppEvent({
        eventType:                'PaymentProof',
        timestamp:                new Date().toISOString(),
        expiresAt:                '',
        memberID:                 payload.memberID,
        email:                    payload.email,
        paymentIntent:            (payload.eventName || '') as PaymentIntent,
        amount:                   payload.amount || 0,
        paymentMethod:            '',
        payerName:                payload.payerName || '',
        memoField:                '',
        last4Digits:              payload.last4Digits || '',
        familyMemberEmails:       '',
        status:                   'Pending',
        matchedMessageId:         '',
        matchedTransactionNumber: '',
        adminApprover:            '',
        approvalDate:             '',
        notes:                    payload.notes || '',
        paymentDate:              payload.paymentDate || '',
        screenshotFileId:         fileId,
        gdriveFilePath:           '',
        ocrText:                  '',
        ocrTimestamp:             '',
      });
      console.log('[mmr][submitPaymentProof] created standalone event:', newEventID);
    }

    return jsonOk(req.requestId, { message: 'Proof submitted successfully.' });
  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

```


---
## File: `src/renewal.ts`
---

```typescript
// ============================================================
// Membership dues: submit, reconcile, approve, reject
// Depends on: config.ts, sheets.ts, logger.ts
// Exposed GAS functions: submitDuesPayment, reconcileWebAppWithGmail,
//                        approveDuesPayment, rejectDuesPayment
// NOTE: Old names (submitRenewalRequest, approveRenewal, rejectRenewal) are
//       kept as aliases for backward compatibility with existing callers.
// ============================================================

function submitDuesPayment(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<DuesSubmitPayload>;
  const { payload } = req;
  try {
    console.log('[mmr][submitDuesPayment] memberID:', payload.memberId,
      '| intent:', payload.paymentIntent, '| amount:', payload.amount);

    const config = getConfigMap();
    const reviewDays = parseInt(config['PaymentProofReviewDays'] || '7', 10);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + reviewDays * 24 * 60 * 60 * 1000).toISOString();

    auditLog('DUES_SUBMIT', {
      memberID: payload.memberId,
      email: payload.email,
      sessionID: payload.sessionID,
    });

    const eventID = appendWebAppEvent({
      eventType:                'dues_payment',
      timestamp:                now,
      expiresAt,
      memberID:                 payload.memberId,
      email:                    payload.email,
      paymentIntent:            payload.paymentIntent,
      amount:                   payload.amount,
      paymentMethod:            payload.paymentMethod,
      payerName:                payload.payerName,
      memoField:                payload.memoField,
      last4Digits:              payload.last4Digits              ?? '',
      familyMemberEmails:       payload.familyMemberEmails       ?? '',
      status:                   'Pending',
      matchedMessageId:         '',
      matchedTransactionNumber: '',
      adminApprover:            '',
      approvalDate:             '',
      notes:                    '',
    });

    auditLog('DUES_SUBMIT', {
      eventID,
      memberID: payload.memberId,
      email: payload.email,
    });

    return jsonOk(req.requestId, {
      eventID,
      message: 'Payment submitted. We will verify and approve within 1–2 business days.',
    });
  } catch (e: any) {
    auditLog('ERROR', { memberID: payload.memberId, email: payload.email, errorMessage: String(e) });
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

// Backward-compat alias
function submitRenewalRequest(jsonRequest: string): string {
  return submitDuesPayment(jsonRequest);
}


function reconcileWebAppWithGmail(_jsonRequest?: string): string {
  try {
    console.log('[mmr][reconcileWebAppWithGmail] starting reconciliation');
    const pendingEvents = getPendingWebAppEvents().filter(e => e.status === 'Pending');
    const gmailPayments = getUnmatchedGmailPayments();
    let matchCount = 0;

    for (const event of pendingEvents) {
      const found = findWebAppEvent(event.eventID);
      if (!found) continue;

      const gmailMatch = findGmailMatch(event, gmailPayments);
      if (gmailMatch) {
        updateWebAppEventRow(found.rowIndex, {
          STATUS:                     'Matched',
          MATCHED_MESSAGE_ID:         gmailMatch.messageId,
          MATCHED_TRANSACTION_NUMBER: gmailMatch.transactionNumber,
        });
        markGmailPaymentProcessed(gmailMatch.rowIndex, event.eventID);
        auditLog('RECONCILE_MATCH_FOUND', { eventID: event.eventID, memberID: event.memberID });
        matchCount++;
      }
    }

    console.log('[mmr][reconcileWebAppWithGmail] done, matches:', matchCount);
    return jsonOk('reconcile', { matchCount });
  } catch (e: any) {
    console.error('[mmr][reconcileWebAppWithGmail] error:', String(e));
    return jsonError('reconcile', 'INTERNAL_ERROR', String(e));
  }
}

function findGmailMatch(event: WebAppEvent, gmailRows: FetchGmailRow[]): FetchGmailRow | null {
  const eventDate = new Date(event.timestamp);
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  for (const row of gmailRows) {
    if (row.processed) continue;
    if (row.amount !== event.amount) continue;

    const rowDate = new Date(row.transactionDate || row.timestamp);
    if (isNaN(rowDate.getTime())) continue;
    if (Math.abs(eventDate.getTime() - rowDate.getTime()) > SEVEN_DAYS_MS) continue;

    const trimmed4 = (event.last4Digits || '').trim();
    const last4Match =
      trimmed4.length === 4 && (row.transactionNumber || '').endsWith(trimmed4);

    const memoText = ((row.memo || '') + ' ' + (row.originalMemo || '')).toLowerCase();
    const memberIdMatch = memoText.includes(event.memberID.toLowerCase());

    const payerLower  = (event.payerName || '').toLowerCase().trim();
    const senderLower = (row.sender      || '').toLowerCase().trim();
    const payerNameMatch =
      payerLower.length > 0 && senderLower.length > 0 &&
      (senderLower.includes(payerLower) || payerLower.includes(senderLower));

    if (last4Match || memberIdMatch || payerNameMatch) return row;
  }
  return null;
}


function approveDuesPayment(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<ApproveDuesPayload>;
  const payload = req.payload;
  try {
    const found = findWebAppEvent(payload.eventID);
    if (!found) return jsonError(req.requestId, 'NOT_FOUND', 'Event not found.');

    const event = found.event;
    const renewalYears = parseInt(getConfigValue('MembershipRenewalYears'), 10) || 1;
    const today = new Date();
    const intent = event.paymentIntent as PaymentIntent;
    const now = new Date().toISOString();

    // ── Branch C: Family Upgrade (delta payment, no expiration change) ───────
    if (intent === 'Family Upgrade') {
      const primary = findMemberByID(event.memberID);
      if (!primary) return jsonError(req.requestId, 'NOT_FOUND', 'Member not found.');

      // Must be in pending_upgrade state (set by initiateUpgrade)
      if (primary.member.status !== 'pending_upgrade') {
        return jsonError(req.requestId, 'INVALID_STATE',
          'Family Upgrade approval requires the member to be in pending_upgrade state.');
      }

      const familyID = primary.member.familyID;
      const membersToUpdate = familyID
        ? findMembersByFamilyID(familyID)
        : [primary];

      // Log before write for each family member
      for (const { member: fm } of membersToUpdate) {
        logMainTableRow(fm.memberID);
      }

      // Set Type = Family, Status = active for all. Expiration unchanged.
      for (const { rowIndex } of membersToUpdate) {
        updateMemberRow(rowIndex, {
          TYPE:         'Family',
          STATUS:       'active',
          LAST_UPDATED: now,
        });
      }

      const periodStart = primary.member.expiration
        ? new Date(primary.member.expiration).toISOString().split('T')[0]
        : today.toISOString().split('T')[0];
      const periodEnd = periodStart;

      appendPaymentRecord({
        ...baseRecord(event, payload), paymentIntent: intent,
        periodStart, periodEnd,
      });
      updateWebAppEventRow(found.rowIndex, {
        STATUS:         'Approved',
        ADMIN_APPROVER: payload.adminEmail,
        APPROVAL_DATE:  now,
        NOTES:          payload.notes ?? '',
      });
      auditLog('UPGRADE_APPROVED', { eventID: event.eventID, memberID: event.memberID });
      return jsonOk(req.requestId, { message: 'Family upgrade approved.', periodEnd });
    }

    // ── Branch B: Family Membership (Switch or Renewal) ───────────────────────
    // ── Branch A: Individual Membership ─────────────────────────────────────
    let membersToUpdate: Array<{ rowIndex: number; member: Member }> = [];

    if (intent === 'Family Membership') {
      const primary = findMemberByID(event.memberID);
      if (!primary) return jsonError(req.requestId, 'NOT_FOUND', 'Member not found.');

      // Assign FamilyID if blank (safety net — should already be set by initiateSwitch)
      if (!primary.member.familyID) {
        const newFamilyID = generateFamilyID();
        logMainTableRow(primary.member.memberID);
        updateMemberRow(primary.rowIndex, { FAMILY_ID: newFamilyID });
        primary.member.familyID = newFamilyID;
      }

      membersToUpdate = findMembersByFamilyID(primary.member.familyID);
      if (membersToUpdate.length === 0) membersToUpdate = [primary];
    } else {
      // Individual Membership
      const m = findMemberByID(event.memberID);
      if (!m) return jsonError(req.requestId, 'NOT_FOUND', 'Member not found.');
      membersToUpdate = [m];
    }

    // Compute newExpiration = max(today + N years, currentExpiration + N years)
    let newExpiration = new Date(today);
    newExpiration.setFullYear(newExpiration.getFullYear() + renewalYears);
    for (const { member } of membersToUpdate) {
      if (member.expiration) {
        const current = new Date(member.expiration);
        if (!isNaN(current.getTime()) && current > today) {
          const extended = new Date(current);
          extended.setFullYear(extended.getFullYear() + renewalYears);
          if (extended > newExpiration) newExpiration = extended;
        }
      }
    }

    const periodStart = today.toISOString().split('T')[0];
    const periodEnd   = newExpiration.toISOString().split('T')[0];
    const memberType  = intent === 'Family Membership' ? 'Family' : 'Individual';

    // Log before write for each member
    for (const { member: fm } of membersToUpdate) {
      logMainTableRow(fm.memberID);
    }

    for (const { rowIndex } of membersToUpdate) {
      updateMemberRow(rowIndex, {
        EXPIRATION:          periodEnd,
        TYPE:                memberType,
        STATUS:              'active',
        MEMBERSHIP_FEE_PAID: event.amount,
        PAYMENT_DATE:        now,
        PAYMENT_TRANSACTION: event.matchedTransactionNumber || event.last4Digits,
        LAST_UPDATED:        now,
      });
    }

    appendPaymentRecord({
      ...baseRecord(event, payload), paymentIntent: intent,
      periodStart, periodEnd,
    });
    updateWebAppEventRow(found.rowIndex, {
      STATUS:         'Approved',
      ADMIN_APPROVER: payload.adminEmail,
      APPROVAL_DATE:  now,
      NOTES:          payload.notes ?? '',
    });
    auditLog('DUES_APPROVED', {
      eventID: event.eventID, memberID: event.memberID, email: event.email,
    });

    return jsonOk(req.requestId, { message: 'Dues approved.', periodEnd });

  } catch (e: any) {
    auditLog('ERROR', { eventID: payload.eventID, errorMessage: String(e) });
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

// Backward-compat alias
function approveRenewal(jsonRequest: string): string {
  return approveDuesPayment(jsonRequest);
}

function baseRecord(event: WebAppEvent, payload: ApproveDuesPayload) {
  return {
    eventID:              event.eventID,
    memberID:             event.memberID,
    paymentDate:          new Date().toISOString().split('T')[0],
    amount:               event.amount,
    paymentMethod:        event.paymentMethod,
    payerName:            event.payerName,
    memoField:            event.memoField,
    last4Digits:          event.last4Digits,
    transactionReference: event.matchedTransactionNumber,
    processedBy:          payload.adminEmail,
    processedDate:        new Date().toISOString(),
    source:               'WebApp',
    notes:                payload.notes ?? '',
  };
}


function rejectDuesPayment(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<RejectDuesPayload>;
  const { payload } = req;
  try {
    console.log('[mmr][rejectDuesPayment] eventID:', payload.eventID, '| admin:', payload.adminEmail);
    const found = findWebAppEvent(payload.eventID);
    if (!found) return jsonError(req.requestId, 'NOT_FOUND', 'Event not found.');

    const now = new Date().toISOString();
    updateWebAppEventRow(found.rowIndex, {
      STATUS:         'Rejected',
      ADMIN_APPROVER: payload.adminEmail,
      APPROVAL_DATE:  now,
      NOTES:          payload.notes,
    });

    auditLog('RENEWAL_REJECTED', { eventID: payload.eventID, memberID: found.event.memberID });
    return jsonOk(req.requestId, { message: 'Payment rejected.' });
  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

// Backward-compat alias
function rejectRenewal(jsonRequest: string): string {
  return rejectDuesPayment(jsonRequest);
}

(globalThis as any).submitDuesPayment        = submitDuesPayment;
(globalThis as any).submitRenewalRequest     = submitRenewalRequest;
(globalThis as any).reconcileWebAppWithGmail = reconcileWebAppWithGmail;
(globalThis as any).approveDuesPayment       = approveDuesPayment;
(globalThis as any).approveRenewal           = approveRenewal;
(globalThis as any).rejectDuesPayment        = rejectDuesPayment;
(globalThis as any).rejectRenewal            = rejectRenewal;

```


---
## File: `src/sheets.ts`
---

```typescript
// ============================================================
// Low-level sheet read/write helpers
// Depends on: config.ts, types.ts
// ============================================================

// ---- ID generators ----

function generateEventID(): string {
  return `EV-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function generatePaymentID(): string {
  return `PY-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function generateLogID(): string {
  return `LG-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function generateMasterLogID(): string {
  return `ML-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

// ---- Membership Master ----

// Returns 'active' or 'inactive' based on expiration date.
// 'pending_upgrade' is STORED in the Status column and read directly by rowToMember — not derived.
function deriveStatus(expirationStr: string): 'active' | 'inactive' {
  if (!expirationStr || expirationStr.trim() === '') return 'inactive';
  const exp = new Date(expirationStr);
  if (isNaN(exp.getTime())) return 'inactive';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return exp >= today ? 'active' : 'inactive';
}

function rowToMember(row: any[]): Member {
  const expiration = String(row[MM_COL.EXPIRATION] ?? '');
  const storedStatus = String(row[MM_COL.STATUS] ?? '').trim().toLowerCase();

  // 'pending_upgrade' is stored explicitly. For all other values (including legacy
  // 'expired', 'not active'), derive active/inactive from the expiration date.
  const status: Member['status'] =
    storedStatus === 'pending_upgrade'
      ? 'pending_upgrade'
      : deriveStatus(expiration);

  return {
    memberID: String(row[MM_COL.MEMBER_ID] ?? ''),
    status,
    created: String(row[MM_COL.CREATED] ?? ''),
    expiration,
    email: String(row[MM_COL.EMAIL] ?? ''),
    firstName: String(row[MM_COL.FIRST_NAME] ?? ''),
    lastName: String(row[MM_COL.LAST_NAME] ?? ''),
    type: String(row[MM_COL.TYPE] ?? 'Individual') as Member['type'],
    familyID: String(row[MM_COL.FAMILY_ID] ?? ''),
    gender: String(row[MM_COL.GENDER] ?? ''),
    wechatID: String(row[MM_COL.WECHAT_ID] ?? ''),
    district: String(row[MM_COL.DISTRICT] ?? ''),
    webApp: String(row[MM_COL.WEBAPP] ?? ''),
    paymentCheck: String(row[MM_COL.PAYMENT_CHECK] ?? ''),
    info: String(row[MM_COL.INFO] ?? ''),
    lastUpdated: String(row[MM_COL.LAST_UPDATED] ?? ''),
    membershipFeePaid: String(row[MM_COL.MEMBERSHIP_FEE_PAID] ?? ''),
    paymentDate: String(row[MM_COL.PAYMENT_DATE] ?? ''),
    paymentTransaction: String(row[MM_COL.PAYMENT_TRANSACTION] ?? ''),
    joinYear: String(row[MM_COL.JOIN_YEAR] ?? ''),
    phoneNumber: String(row[MM_COL.PHONE_NUMBER] ?? ''),
    lastLoginDate: String(row[MM_COL.LAST_LOGIN_DATE] ?? ''),
    notes: String(row[MM_COL.NOTES] ?? ''),
  };
}

// ---- Membership-Master-Log (audit trail) ----

/**
 * Copy the current Main table row for memberID into the Log table BEFORE any write.
 * Rule: every function that updates Membership Master must call this first.
 */
function logMainTableRow(memberID: string): void {
  try {
    const mainSheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
    const data = mainSheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][MM_COL.MEMBER_ID]) === memberID) {
        const logSheet = getSheet(SHEET_NAMES.MEMBERSHIP_LOG);
        const logRow = [
          generateMasterLogID(),
          new Date().toISOString(),
          ...data[i],            // All Main table columns verbatim
        ];
        logSheet.appendRow(logRow);
        return;
      }
    }
    // If member not found, log a warning but don't throw — write must proceed
    console.warn(`[logMainTableRow] memberID not found: ${memberID}`);
  } catch (e) {
    // Logging must never crash the main flow
    console.error('[logMainTableRow] failed:', e);
  }
}

function findMemberByEmail(email: string): { member: Member; rowIndex: number } | null {
  const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][MM_COL.EMAIL]).toLowerCase() === email.toLowerCase()) {
      return { member: rowToMember(data[i]), rowIndex: i + 1 };
    }
  }
  return null;
}

function findMemberByID(memberID: string): { member: Member; rowIndex: number } | null {
  const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][MM_COL.MEMBER_ID]) === memberID) {
      return { member: rowToMember(data[i]), rowIndex: i + 1 };
    }
  }
  return null;
}

function findMembersByFamilyID(familyID: string): Array<{ member: Member; rowIndex: number }> {
  const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
  const data = sheet.getDataRange().getValues();
  const results: Array<{ member: Member; rowIndex: number }> = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][MM_COL.FAMILY_ID]) === familyID) {
      results.push({ member: rowToMember(data[i]), rowIndex: i + 1 });
    }
  }
  return results;
}

function generateMemberID(): string {
  const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
  const data = sheet.getDataRange().getValues();
  const used = new Set<number>();
  for (let i = 1; i < data.length; i++) {
    const m = String(data[i][MM_COL.MEMBER_ID]).match(/^A(\d{4})$/);
    if (m) used.add(parseInt(m[1], 10));
  }
  for (let n = 1; n <= 9999; n++) {
    if (!used.has(n)) return 'A' + String(n).padStart(4, '0');
  }
  throw new Error('No available member IDs (A0001–A9999 all in use).');
}

function generateFamilyID(): string {
  const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
  const data = sheet.getDataRange().getValues();
  const used = new Set<number>();
  for (let i = 1; i < data.length; i++) {
    const m = String(data[i][MM_COL.FAMILY_ID]).match(/^B(\d{3})$/);
    if (m) used.add(parseInt(m[1], 10));
  }
  for (let n = 1; n <= 999; n++) {
    if (!used.has(n)) return 'B' + String(n).padStart(3, '0');
  }
  throw new Error('No available family IDs B001–B999 all in use.');
}

// Returns all members sharing a FamilyID
function getMembersByFamilyID(familyID: string): Member[] {
  const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  return rows.slice(1)
    .filter(row => String(row[MM_COL.FAMILY_ID]).trim() === familyID.trim())
    .map(row => rowToMember(row));
}


function updateMemberRow(rowIndex: number, updates: Record<string, any>): void {
  const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
  for (const [colKey, value] of Object.entries(updates)) {
    const colIndex = (MM_COL as Record<string, number>)[colKey];
    if (colIndex !== undefined) {
      sheet.getRange(rowIndex, colIndex + 1).setValue(value);
    }
  }
}

// ---- WebApp-Events ----

function rowToWebAppEvent(row: any[]): WebAppEvent {
  return {
    eventID:                  String(row[WE_COL.EVENT_ID]                  ?? ''),
    eventType:                String(row[WE_COL.EVENT_TYPE]                ?? '') as WebAppEvent['eventType'],
    timestamp:                String(row[WE_COL.TIMESTAMP]                 ?? ''),
    expiresAt:                String(row[WE_COL.EXPIRES_AT]                ?? ''),
    memberID:                 String(row[WE_COL.MEMBER_ID]                 ?? ''),
    email:                    String(row[WE_COL.EMAIL]                     ?? ''),
    paymentIntent:            String(row[WE_COL.PAYMENT_INTENT]            ?? '') as WebAppEvent['paymentIntent'],
    amount:                   Number(row[WE_COL.AMOUNT]                    ?? 0),
    paymentMethod:            String(row[WE_COL.PAYMENT_METHOD]            ?? ''),
    payerName:                String(row[WE_COL.PAYER_NAME]                ?? ''),
    memoField:                String(row[WE_COL.MEMO_FIELD]                ?? ''),
    last4Digits:              String(row[WE_COL.LAST_4_DIGITS]             ?? ''),
    familyMemberEmails:       String(row[WE_COL.FAMILY_MEMBER_EMAILS]      ?? ''),
    status:                   String(row[WE_COL.STATUS]                    ?? '') as WebAppEvent['status'],
    matchedMessageId:         String(row[WE_COL.MATCHED_MESSAGE_ID]        ?? ''),
    matchedTransactionNumber: String(row[WE_COL.MATCHED_TRANSACTION_NUMBER]?? ''),
    adminApprover:            String(row[WE_COL.ADMIN_APPROVER]            ?? ''),
    approvalDate:             String(row[WE_COL.APPROVAL_DATE]             ?? ''),
    notes:                    String(row[WE_COL.NOTES]                     ?? ''),
    paymentDate:              String(row[WE_COL.PAYMENT_DATE]              ?? ''),
    screenshotFileId:         String(row[WE_COL.SCREENSHOT_FILE_ID]        ?? ''),
    gdriveFilePath:           String(row[WE_COL.GDRIVE_FILE_PATH]          ?? ''),
    ocrText:                  String(row[WE_COL.OCR_TEXT]                  ?? ''),
    ocrTimestamp:             String(row[WE_COL.OCR_TIMESTAMP]             ?? ''),
  };
}

function appendWebAppEvent(event: Omit<WebAppEvent, 'eventID'>): string {
  const sheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
  const eventID = generateEventID();
  sheet.appendRow([
    eventID,
    event.eventType,
    event.timestamp,
    event.expiresAt,
    event.memberID,
    event.email,
    event.paymentIntent,
    event.amount,
    event.paymentMethod,
    event.payerName,
    event.memoField,
    event.last4Digits,
    event.familyMemberEmails,
    event.status,
    '', '', '', '', '',             // MatchedMessageId … Notes
    event.paymentDate      ?? '',
    event.screenshotFileId ?? '',
    event.gdriveFilePath   ?? '',
    event.ocrText          ?? '',
    event.ocrTimestamp     ?? '',
  ]);
  return eventID;
}

function findWebAppEvent(eventID: string): { event: WebAppEvent; rowIndex: number } | null {
  const sheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][WE_COL.EVENT_ID]) === eventID) {
      return { event: rowToWebAppEvent(data[i]), rowIndex: i + 1 };
    }
  }
  return null;
}

function getPendingWebAppEvents(): WebAppEvent[] {
  const sheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
  const data = sheet.getDataRange().getValues();
  const events: WebAppEvent[] = [];
  for (let i = 1; i < data.length; i++) {
    const status = String(data[i][WE_COL.STATUS]);
    if (status === 'Pending' || status === 'Matched') {
      events.push(rowToWebAppEvent(data[i]));
    }
  }
  return events;
}

// Returns all pending payment-type events for a specific member.
// Used by the dashboard to determine catch-all gate state.
function getPendingPaymentEventsForMember(memberID: string): WebAppEvent[] {
  const PAYMENT_TYPES: Set<string> = new Set([
    'dues_payment', 'family_switch', 'family_upgrade',
  ]);
  const sheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
  const data = sheet.getDataRange().getValues();
  const events: WebAppEvent[] = [];
  for (let i = 1; i < data.length; i++) {
    if (
      String(data[i][WE_COL.MEMBER_ID]) === memberID &&
      String(data[i][WE_COL.STATUS]) === 'Pending' &&
      PAYMENT_TYPES.has(String(data[i][WE_COL.EVENT_TYPE]))
    ) {
      events.push(rowToWebAppEvent(data[i]));
    }
  }
  return events;
}

function updateWebAppEventRow(rowIndex: number, updates: Record<string, any>): void {
  const sheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
  for (const [colKey, value] of Object.entries(updates)) {
    const colIndex = (WE_COL as Record<string, number>)[colKey];
    if (colIndex !== undefined) {
      sheet.getRange(rowIndex, colIndex + 1).setValue(value);
    }
  }
}

// ---- Payment-History ----

function appendPaymentRecord(record: Omit<PaymentRecord, 'paymentID'>): string {
  const sheet = getSheet(SHEET_NAMES.PAYMENT_HISTORY);
  const paymentID = generatePaymentID();
  sheet.appendRow([
    paymentID,
    record.eventID,
    record.memberID,
    record.paymentDate,
    record.amount,
    record.paymentIntent,
    record.paymentMethod,
    record.payerName,
    record.memoField,
    record.last4Digits,
    record.transactionReference,
    record.periodStart,
    record.periodEnd,
    record.processedBy,
    record.processedDate,
    record.source,
    record.notes,
  ]);
  return paymentID;
}

// ---- Fetch Gmail ----

function getUnmatchedGmailPayments(): FetchGmailRow[] {
  const sheet = getSheet(SHEET_NAMES.FETCH_GMAIL);
  const data = sheet.getDataRange().getValues();
  const results: FetchGmailRow[] = [];
  for (let i = 1; i < data.length; i++) {
    const processed = data[i][FG_COL.PROCESSED];
    if (!processed || String(processed).toUpperCase() === 'FALSE') {
      results.push(rowToFetchGmailRow(data[i], i + 1));
    }
  }
  return results;
}

function rowToFetchGmailRow(row: any[], rowIndex: number): FetchGmailRow {
  return {
    timestamp: String(row[FG_COL.TIMESTAMP] ?? ''),
    sender: String(row[FG_COL.SENDER] ?? ''),
    amount: Number(row[FG_COL.AMOUNT] ?? 0),
    memo: String(row[FG_COL.MEMO] ?? ''),
    transactionDate: String(row[FG_COL.TRANSACTION_DATE] ?? ''),
    transactionNumber: String(row[FG_COL.TRANSACTION_NUMBER] ?? ''),
    messageId: String(row[FG_COL.MESSAGE_ID] ?? ''),
    subject: String(row[FG_COL.SUBJECT] ?? ''),
    originalMemo: String(row[FG_COL.ORIGINAL_MEMO] ?? ''),
    notes: String(row[FG_COL.NOTES] ?? ''),
    processed: Boolean(row[FG_COL.PROCESSED]),
    source: String(row[FG_COL.SOURCE] ?? ''),
    webAppEventID: String(row[FG_COL.WEBAPP_EVENT_ID] ?? ''),
    rowIndex,
  };
}

function markGmailPaymentProcessed(rowIndex: number, eventID: string): void {
  const sheet = getSheet(SHEET_NAMES.FETCH_GMAIL);
  sheet.getRange(rowIndex, FG_COL.PROCESSED + 1).setValue(true);
  sheet.getRange(rowIndex, FG_COL.WEBAPP_EVENT_ID + 1).setValue(eventID);
}


function getPaymentHistoryByMemberID(memberID: string): PaymentHistoryItem[] {
  const sheet = getSheet(SHEET_NAMES.PAYMENT_HISTORY);
  if (!sheet) return [];

  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  const col = (name: string) => headers.indexOf(name);

  return rows.slice(1)
    .filter(row => row[col('MemberID')] === memberID)
    .map(row => ({
      paymentID:     String(row[col('PaymentID')]     || ''),
      eventID:       String(row[col('EventID')]       || ''),
      paymentDate:   String(row[col('PaymentDate')]   || ''),
      amount:        Number(row[col('Amount')]        || 0),
      paymentIntent: String(row[col('PaymentIntent')] || '') as PaymentHistoryItem['paymentIntent'],
      paymentMethod: String(row[col('PaymentMethod')] || ''),
      payerName:     String(row[col('PayerName')]     || ''),
      periodStart:   String(row[col('PeriodStart')]   || ''),
      periodEnd:     String(row[col('PeriodEnd')]     || ''),
      source:        String(row[col('Source')]        || ''),
      notes:         String(row[col('Notes')]         || ''),
    }));
}

function getWebAppEventsByMemberID(memberID: string): WebAppEventSummary[] {
  const sheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
  if (!sheet) return [];

  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  const col = (name: string) => headers.indexOf(name);

  return rows.slice(1)
    .filter(row => row[col('MemberID')] === memberID)
    .map(row => ({
      eventID:          String(row[col('EventID')]          || ''),
      eventType:        String(row[col('EventType')]        || ''),
      timestamp:        String(row[col('Timestamp')]        || ''),
      paymentIntent:    String(row[col('PaymentIntent')]    || ''),
      amount:           Number(row[col('Amount')]           || 0),
      paymentMethod:    String(row[col('PaymentMethod')]    || ''),
      status:           String(row[col('Status')]           || '') as WebAppEventSummary['status'],
      notes:            String(row[col('Notes')]            || ''),
      paymentDate:      String(row[col('PaymentDate')]      || ''),
      screenshotFileId: String(row[col('ScreenshotFileId')] || ''),
      gdriveFilePath:   String(row[col('GDriveFilePath')]   || ''),
      ocrText:          String(row[col('OCRText')]          || ''),
      ocrTimestamp:     String(row[col('OCRTimestamp')]     || ''),
    }));
}

// ── globalThis exports for test environment ──────────────────
(globalThis as any).deriveStatus                   = deriveStatus;
(globalThis as any).rowToMember                    = rowToMember;
(globalThis as any).logMainTableRow                = logMainTableRow;
(globalThis as any).findMemberByEmail              = findMemberByEmail;
(globalThis as any).findMemberByID                 = findMemberByID;
(globalThis as any).findMembersByFamilyID          = findMembersByFamilyID;
(globalThis as any).getMembersByFamilyID           = getMembersByFamilyID;
(globalThis as any).generateMemberID               = generateMemberID;
(globalThis as any).generateFamilyID               = generateFamilyID;
(globalThis as any).generateMasterLogID            = generateMasterLogID;
(globalThis as any).updateMemberRow                = updateMemberRow;
(globalThis as any).appendWebAppEvent              = appendWebAppEvent;
(globalThis as any).findWebAppEvent                = findWebAppEvent;
(globalThis as any).getPendingWebAppEvents         = getPendingWebAppEvents;
(globalThis as any).getPendingPaymentEventsForMember = getPendingPaymentEventsForMember;
(globalThis as any).updateWebAppEventRow           = updateWebAppEventRow;
(globalThis as any).appendPaymentRecord            = appendPaymentRecord;
(globalThis as any).getUnmatchedGmailPayments      = getUnmatchedGmailPayments;
(globalThis as any).markGmailPaymentProcessed      = markGmailPaymentProcessed;
(globalThis as any).getPaymentHistoryByMemberID    = getPaymentHistoryByMemberID;
(globalThis as any).getWebAppEventsByMemberID      = getWebAppEventsByMemberID;
(globalThis as any).generateEventID             = generateEventID;
(globalThis as any).generatePaymentID           = generatePaymentID;
(globalThis as any).generateLogID               = generateLogID;

```


---
## File: `src/types.ts`
---

```typescript
// ============================================================
// Core domain types
// ============================================================

interface Member {
  memberID: string;          // Axxxx
  status: 'active' | 'inactive' | 'pending_upgrade';
  created: string;
  expiration: string;
  email: string;
  firstName: string;
  lastName: string;
  type: 'Individual' | 'Family';
  familyID: string;          // Bxxx or blank
  gender: string;
  wechatID: string;
  district: string;
  webApp: string;
  paymentCheck: string;
  info: string;
  lastUpdated: string;
  membershipFeePaid: string;
  paymentDate: string;
  paymentTransaction: string;
  // New columns
  joinYear: string;
  phoneNumber: string;
  lastLoginDate: string;
  notes: string;
}

// PaymentIntent describes the financial transaction type
type PaymentIntent = 'Individual Membership' | 'Family Membership' | 'Family Upgrade';

// EventType aligns with the action that triggered the event
type EventType =
  | 'dues_payment'          // Regular dues submission (Individual or Family)
  | 'family_switch'         // Individual switching to Family (full dues, triggered by initiateSwitch)
  | 'family_upgrade'        // Individual upgrading to Family mid-cycle (delta, triggered by initiateUpgrade)
  | 'membership_application'// New member application
  | 'admin_request';        // Admin-initiated event

interface WebAppEvent {
  eventID: string;
  eventType: EventType | string;
  timestamp: string;
  expiresAt: string;         // Timestamp + PaymentProofReviewDays; after this, event auto-expires
  memberID: string;
  email: string;
  paymentIntent: PaymentIntent;
  amount: number;
  paymentMethod: string;
  payerName: string;
  memoField: string;
  last4Digits: string;
  familyMemberEmails: string;
  status: 'Pending' | 'Matched' | 'Approved' | 'Rejected' | 'Expired' | 'Error';
  matchedMessageId: string;
  matchedTransactionNumber: string;
  adminApprover: string;
  approvalDate: string;
  notes: string;
  // Payment-proof fields (populated when user attaches a proof to this event)
  paymentDate?: string;
  screenshotFileId?: string;
  gdriveFilePath?: string;
  ocrText?: string;
  ocrTimestamp?: string;
}

interface PaymentHistoryItem {
  paymentID: string;
  eventID: string;
  paymentDate: string;
  amount: number;
  paymentIntent: PaymentIntent;
  paymentMethod: string;
  payerName: string;
  periodStart: string;
  periodEnd: string;
  source: string;
  notes: string;
}

// Payload for submitting dues (Pay Dues flow — no pre-existing event)
interface DuesSubmitPayload {
  memberId: string;
  email: string;
  paymentIntent: PaymentIntent;
  amount: number;
  paymentMethod: string;
  payerName: string;
  memoField: string;
  last4Digits?: string;
  familyMemberEmails?: string;
  sessionID: string;
}

// Keep old name as alias for backward compat with any callers
type RenewalSubmitPayload = DuesSubmitPayload;

interface PaymentRecord {
  paymentID: string;
  eventID: string;
  memberID: string;
  paymentDate: string;
  amount: number;
  paymentIntent: string;
  paymentMethod: string;
  payerName: string;
  memoField: string;
  last4Digits: string;
  transactionReference: string;
  periodStart: string;
  periodEnd: string;
  processedBy: string;
  processedDate: string;
  source: string;
  notes: string;
}

interface Otp {
  email: string;
  otpCode: string;
  createdAt: string;
  expiresAt: string;
  used: boolean;
  ipAddress: string;
}

interface OtpMatch {
  rowIndex: number;
  otp: Otp;
}

interface ActivityLogEntry {
  logID: string;
  timestamp: string;
  sessionID: string;
  memberID: string;
  email: string;
  eventID: string;
  action: string;
  state: string;
  errorCode: string;
  errorMessage: string;
}

interface ConfigMap {
  [key: string]: string;
}

interface FetchGmailRow {
  timestamp: string;
  sender: string;
  amount: number;
  memo: string;
  transactionDate: string;
  transactionNumber: string;
  messageId: string;
  subject: string;
  originalMemo: string;
  notes: string;
  processed: boolean;
  source: string;
  webAppEventID: string;
  rowIndex: number;
}

// ============================================================
// API envelope types
// ============================================================

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

// ============================================================
// Payload types
// ============================================================

interface LoginPayload {
  email: string;
  sessionID: string;
}

interface LookupEmailPayload {
  email: string;
  sessionID: string;
}

interface LookupEmailResponse {
  found: boolean;
  firstName?: string;
  memberID?: string;
}

interface OtpRequestPayload {
  email: string;
  sessionID: string;
}

interface OtpVerifyPayload {
  email: string;
  otpCode: string;
  sessionID: string;
}

interface UpdateProfilePayload {
  memberID: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  wechatID?: string;
  district?: string;
  joinYear?: string;
  // NOTE: Type is intentionally excluded — type changes go through upgrade.ts only
}

interface ApproveDuesPayload {
  eventID: string;
  adminEmail: string;
  notes?: string;
}

// Keep old name as alias
type ApproveRenewalPayload = ApproveDuesPayload;

interface RejectDuesPayload {
  eventID: string;
  adminEmail: string;
  notes: string;
}

// Keep old name as alias
type RejectRenewalPayload = RejectDuesPayload;

// Payload for initiating Switch to Family (full dues)
interface InitiateSwitchPayload {
  memberID: string;
  email: string;
  sessionID: string;
}

// Payload for initiating Upgrade to Family (delta payment, mid-cycle)
interface InitiateUpgradePayload {
  memberID: string;
  email: string;
  sessionID: string;
}

// Payload for cancelling a pending upgrade
interface CancelUpgradePayload {
  memberID: string;
  email: string;
  sessionID: string;
}

// Payload for family member management
interface FamilyMemberPayload {
  memberID: string;       // Acting member (must be Family type)
  targetEmail: string;    // Email of member to add/remove
  sessionID: string;
}

interface WebAppEventSummary {
  eventID:             string;
  eventType:           string;
  timestamp:           string;
  paymentIntent:       string;
  amount:              number;
  paymentMethod:       string;
  status:              'Pending' | 'Matched' | 'Approved' | 'Rejected' | 'Expired' | 'Error';
  notes:               string;
  // Payment-proof fields
  paymentDate:         string;
  screenshotFileId:    string;
  gdriveFilePath:      string;
  ocrText:             string;
  ocrTimestamp:        string;
}

```


---
## File: `src/ui.ts`
---

```typescript
// ============================================================
// GAS web app entry point and JSON response helpers
// Depends on: (none — must be loaded first by GAS alphabetically)
// ============================================================

function doGet(e: GoogleAppsScript.Events.DoGet): GoogleAppsScript.HTML.HtmlOutput {
  try {
    console.log('mmr:doGet called, parameters =', JSON.stringify(e.parameter));
    const page = (e && e.parameter && e.parameter['page']) || 'login';
    console.log('mmr:doGet serving page =', page);

    if (page === 'image') {
      const fileId = e.parameter['id'];
      return serveImage(fileId);
    }

    try {
      // 'renewal' removed — renewal/upgrade actions handled via dashboard buttons.
      // 'family' added — family member management page.
      const allowedPages = [
        'login', 'dashboard', 'profile', 'family',
        'admin', 'newmember', 'payment_proof', 'payment', 'image', 'payment_history',
      ];
      const safePage = allowedPages.includes(page) ? page : 'login';
      const fileName = `page_${safePage}`;
      console.log(`doGet: serving "${fileName}", page param="${page}"`);

      let scriptUrl = '';
      try { scriptUrl = ScriptApp.getService().getUrl(); } catch (_) {}

      const urlParamsJson = JSON.stringify(e.parameter || {});

      const raw = HtmlService.createHtmlOutputFromFile(fileName).getContent();
      const content = raw
        .replace('__SCRIPT_URL__', scriptUrl)
        .replace('__URL_PARAMS__', urlParamsJson);

      const output = HtmlService.createHtmlOutput(content)
        .setTitle('Misty Mountain Runners — Membership')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
      return output;

    } catch (er: any) {
      console.error('mmr:doGet ERROR for page =', page, 'error =', String(er));
      return HtmlService.createHtmlOutput(
        `<h2 style="color:red;font-family:sans-serif;">Server Error in doGet for ${page}</h2><pre>${String(er)}</pre>`
      );
    }

  } catch (err: any) {
    console.error('doGet error:', String(err));
    return HtmlService.createHtmlOutput(
      `<h2 style="color:red;font-family:sans-serif;">Server Error in doGet</h2><pre>${String(err)}</pre>`
    );
  }
}


// ---- JSON response helpers (used by all backend modules) ----

function jsonOk<T>(requestId: string, payload: T): string {
  const response: ApiResponseSuccess<T> = { ok: true, requestId, payload };
  return JSON.stringify(response);
}

function jsonError(requestId: string, errorCode: string, errorMessage: string): string {
  const response: ApiResponseError = { ok: false, requestId, errorCode, errorMessage };
  return JSON.stringify(response);
}

(globalThis as any).doGet = doGet;

// ── globalThis exports for test environment ──────────────────
(globalThis as any).jsonOk    = jsonOk;
(globalThis as any).jsonError = jsonError;

```


---
## File: `src/upgrade.ts`
---

```typescript
// ============================================================
// Family upgrade flows: Switch to Family, Upgrade to Family, Cancel Upgrade
// Depends on: config.ts, sheets.ts, logger.ts
// Exposed GAS functions: initiateSwitch, initiateUpgrade, cancelUpgrade
// ============================================================

// ---- initiateSwitch ----
// Individual → Family (full Family dues, expiration extended on approval).
// Available when: Status = inactive OR expires < ReminderDaysBefore days.
// Action: assign FamilyID, set Status = pending_upgrade, create WebApp-Events row.

function initiateSwitch(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<InitiateSwitchPayload>;
  const { payload } = req;
  try {
    console.log('[mmr][initiateSwitch] memberID:', payload.memberID);

    const result = findMemberByID(payload.memberID);
    if (!result) return jsonError(req.requestId, 'NOT_FOUND', 'Member not found.');

    const { member, rowIndex } = result;

    if (member.status === 'pending_upgrade') {
      return jsonError(req.requestId, 'INVALID_STATE',
        'A family upgrade is already in progress. Complete or cancel it first.');
    }
    if (member.type === 'Family' && member.status === 'active') {
      return jsonError(req.requestId, 'INVALID_STATE',
        'Already an active Family member.');
    }

    // Log before write
    logMainTableRow(payload.memberID);

    // Assign FamilyID if not already set
    let familyID = member.familyID;
    if (!familyID) {
      familyID = generateFamilyID();
    }

    const config = getConfigMap();
    const amount = parseFloat(config['FamilyPrice'] || '50');
    const reviewDays = parseInt(config['PaymentProofReviewDays'] || '7', 10);

    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + reviewDays * 24 * 60 * 60 * 1000).toISOString();

    // Update Main table: Type = Family, Status = pending_upgrade, assign FamilyID
    updateMemberRow(rowIndex, {
      TYPE:      'Family',
      STATUS:    'pending_upgrade',
      FAMILY_ID: familyID,
      LAST_UPDATED: now,
    });

    // Create WebApp-Events row to track this switch request
    const eventID = appendWebAppEvent({
      eventType:                'family_switch',
      timestamp:                now,
      expiresAt,
      memberID:                 payload.memberID,
      email:                    payload.email,
      paymentIntent:            'Family Membership',
      amount,
      paymentMethod:            '',
      payerName:                '',
      memoField:                '',
      last4Digits:              '',
      familyMemberEmails:       '',
      status:                   'Pending',
      matchedMessageId:         '',
      matchedTransactionNumber: '',
      adminApprover:            '',
      approvalDate:             '',
      notes:                    '',
    });

    auditLog('UPGRADE_INITIATE', {
      eventID,
      memberID: payload.memberID,
      email: payload.email,
      sessionID: payload.sessionID,
      state: { action: 'family_switch', familyID },
    });

    return jsonOk(req.requestId, {
      eventID,
      familyID,
      paymentIntent: 'Family Membership',
      amount,
      message: 'Switched to Family. Please pay the Family dues to activate your membership.',
    });
  } catch (e: any) {
    auditLog('ERROR', { memberID: payload.memberID, errorMessage: String(e) });
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

// ---- initiateUpgrade ----
// Individual → Family (delta payment only, expiration unchanged).
// Available when: Status = active AND expiration > UpgradeMinMonths months from today.

function initiateUpgrade(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<InitiateUpgradePayload>;
  const { payload } = req;
  try {
    console.log('[mmr][initiateUpgrade] memberID:', payload.memberID);

    const result = findMemberByID(payload.memberID);
    if (!result) return jsonError(req.requestId, 'NOT_FOUND', 'Member not found.');

    const { member, rowIndex } = result;

    if (member.status === 'pending_upgrade') {
      return jsonError(req.requestId, 'INVALID_STATE',
        'A family upgrade is already in progress. Complete or cancel it first.');
    }
    if (member.status !== 'active') {
      return jsonError(req.requestId, 'INVALID_STATE',
        'Family Upgrade requires an active membership. Use Switch to Family instead.');
    }
    if (member.type !== 'Individual') {
      return jsonError(req.requestId, 'INVALID_STATE',
        'Already on a Family plan.');
    }

    // Validate expiration > UpgradeMinMonths
    const config = getConfigMap();
    const upgradeMinMonths = parseInt(config['UpgradeMinMonths'] || '3', 10);
    const today = new Date();
    const minExpiration = new Date(today);
    minExpiration.setMonth(minExpiration.getMonth() + upgradeMinMonths);

    const expDate = new Date(member.expiration);
    if (isNaN(expDate.getTime()) || expDate <= minExpiration) {
      return jsonError(req.requestId, 'INVALID_STATE',
        `Upgrade to Family requires more than ${upgradeMinMonths} months remaining on your membership. ` +
        `Use Switch to Family (full dues) instead.`);
    }

    // Log before write
    logMainTableRow(payload.memberID);

    // Assign FamilyID if not already set
    let familyID = member.familyID;
    if (!familyID) {
      familyID = generateFamilyID();
    }

    const amount = parseFloat(config['FamilyUpgradePrice'] || '20');
    const reviewDays = parseInt(config['PaymentProofReviewDays'] || '7', 10);

    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + reviewDays * 24 * 60 * 60 * 1000).toISOString();

    // Update Main table: Type = Family, Status = pending_upgrade, assign FamilyID
    updateMemberRow(rowIndex, {
      TYPE:      'Family',
      STATUS:    'pending_upgrade',
      FAMILY_ID: familyID,
      LAST_UPDATED: now,
    });

    // Create WebApp-Events row to track this upgrade request
    const eventID = appendWebAppEvent({
      eventType:                'family_upgrade',
      timestamp:                now,
      expiresAt,
      memberID:                 payload.memberID,
      email:                    payload.email,
      paymentIntent:            'Family Upgrade',
      amount,
      paymentMethod:            '',
      payerName:                '',
      memoField:                '',
      last4Digits:              '',
      familyMemberEmails:       '',
      status:                   'Pending',
      matchedMessageId:         '',
      matchedTransactionNumber: '',
      adminApprover:            '',
      approvalDate:             '',
      notes:                    '',
    });

    auditLog('UPGRADE_INITIATE', {
      eventID,
      memberID: payload.memberID,
      email: payload.email,
      sessionID: payload.sessionID,
      state: { action: 'family_upgrade', familyID },
    });

    return jsonOk(req.requestId, {
      eventID,
      familyID,
      paymentIntent: 'Family Upgrade',
      amount,
      message: 'Upgrade initiated. Please pay the upgrade fee to activate Family membership. Your expiration date is unchanged.',
    });
  } catch (e: any) {
    auditLog('ERROR', { memberID: payload.memberID, errorMessage: String(e) });
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

// ---- cancelUpgrade ----
// Revert all family members back to Individual. Remove FamilyID from all.
// Recalculate Status immediately based on each member's expiration date.
// Reject any pending proof event if found.

function cancelUpgrade(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<CancelUpgradePayload>;
  const { payload } = req;
  try {
    console.log('[mmr][cancelUpgrade] memberID:', payload.memberID);

    const result = findMemberByID(payload.memberID);
    if (!result) return jsonError(req.requestId, 'NOT_FOUND', 'Member not found.');

    const { member } = result;

    if (member.status !== 'pending_upgrade') {
      return jsonError(req.requestId, 'INVALID_STATE',
        'No pending upgrade to cancel.');
    }

    // Find all members sharing the same FamilyID
    let membersToRevert: Array<{ member: Member; rowIndex: number }> = [];
    if (member.familyID) {
      membersToRevert = findMembersByFamilyID(member.familyID);
    }
    if (membersToRevert.length === 0) {
      membersToRevert = [result];
    }

    const now = new Date().toISOString();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Log and revert each family member
    for (const { member: fm, rowIndex } of membersToRevert) {
      logMainTableRow(fm.memberID);

      // Immediately recalculate status from expiration
      const expDate = fm.expiration ? new Date(fm.expiration) : null;
      const revertedStatus =
        expDate && !isNaN(expDate.getTime()) && expDate >= today ? 'active' : 'inactive';

      updateMemberRow(rowIndex, {
        TYPE:        'Individual',
        STATUS:      revertedStatus,
        FAMILY_ID:   '',
        LAST_UPDATED: now,
      });
    }

    // Reject any pending family_switch / family_upgrade event for this member
    const pendingEvents = getPendingWebAppEvents();
    for (const ev of pendingEvents) {
      if (
        ev.memberID === payload.memberID &&
        (ev.eventType === 'family_switch' || ev.eventType === 'family_upgrade')
      ) {
        const found = findWebAppEvent(ev.eventID);
        if (found) {
          updateWebAppEventRow(found.rowIndex, {
            STATUS:        'Rejected',
            ADMIN_APPROVER: 'system',
            APPROVAL_DATE:  now,
            NOTES:          'Cancelled by member',
          });
        }
      }
    }

    auditLog('CANCEL_UPGRADE', {
      memberID: payload.memberID,
      email: payload.email,
      sessionID: payload.sessionID,
      state: { revertedCount: membersToRevert.length },
    });

    return jsonOk(req.requestId, {
      message: 'Upgrade cancelled. All family members reverted to Individual.',
      revertedCount: membersToRevert.length,
    });
  } catch (e: any) {
    auditLog('ERROR', { memberID: payload.memberID, errorMessage: String(e) });
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

(globalThis as any).initiateSwitch   = initiateSwitch;
(globalThis as any).initiateUpgrade  = initiateUpgrade;
(globalThis as any).cancelUpgrade    = cancelUpgrade;

```


---
## File: `tests/family.test.ts`
---

```typescript
// ============================================================
// family.ts — unit tests
// Covers: getFamilyMembers, addFamilyMember, removeFamilyMember
// ============================================================

require('../src/types');
require('../src/ui');
require('../src/config');
require('../src/sheets');
require('../src/logger');
require('../src/family');

declare function getFamilyMembers(jsonRequest: string): string;
declare function addFamilyMember(jsonRequest: string): string;
declare function removeFamilyMember(jsonRequest: string): string;
declare function __seedSheet(name: string, rows: any[][]): void;
declare function __getSheet(name: string): any[][];
declare function findMemberByID(id: string): any;
declare function getMembersByFamilyID(id: string): any[];
declare function logMainTableRow(memberID: string): void;
declare function updateMemberRow(idx: number, updates: any): void;
declare function findMemberByEmail(email: string): any;
declare function auditLog(action: string, data?: any): void;

// ── Shared helpers ──────────────────────────────────────────

const MAIN   = 'Main';
const LOG_SHEET = 'Membership-Master-Log';
const CONFIG = 'Config';

function seedConfig(): void {
  __seedSheet(CONFIG, [
    ['Key', 'Value', 'Description'],
    ['MembershipRenewalYears', '1', ''],
  ]);
}

function seedEmptyLog(): void {
  __seedSheet(LOG_SHEET, [new Array(25).fill('')]);
}

/** 23-column Main row with sensible defaults. */
function makeMainRow(overrides: Record<number, any> = {}): any[] {
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  const row: any[] = new Array(23).fill('');
  row[0] = 'A0001';
  row[1] = 'active';
  row[3] = future.toISOString();
  row[4] = 'alice@example.com';
  row[5] = 'Alice';
  row[7] = 'Individual';
  Object.entries(overrides).forEach(([k, v]) => { row[Number(k)] = v; });
  return row;
}

function req(payload: object): string {
  return JSON.stringify({ requestId: 'test-req', payload });
}

// ── getFamilyMembers ────────────────────────────────────────

describe('getFamilyMembers', () => {
  beforeEach(() => seedConfig());

  it('returns error when acting member not found', () => {
    __seedSheet(MAIN, [new Array(23).fill('')]);
    const res = JSON.parse(getFamilyMembers(req({ memberID: 'A9999', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('NOT_FOUND');
  });

  it('returns error when acting member is Individual type', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow({ 7: 'Individual' })]);
    const res = JSON.parse(getFamilyMembers(req({ memberID: 'A0001', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
  });

  it('returns empty members array when Family member has no FamilyID', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow({ 7: 'Family', 8: '' })]);
    const res = JSON.parse(getFamilyMembers(req({ memberID: 'A0001', sessionID: 's1' })));
    expect(res.ok).toBe(true);
    expect(res.payload.members).toEqual([]);
  });

  it('returns all members sharing the same FamilyID', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);

    const actor  = makeMainRow({ 0: 'A0001', 7: 'Family', 8: 'B001' });
    const member2 = makeMainRow({ 0: 'A0002', 7: 'Family', 8: 'B001', 4: 'bob@example.com' });
    const member3 = makeMainRow({ 0: 'A0003', 7: 'Family', 8: 'B001', 4: 'carol@example.com' });
    const other   = makeMainRow({ 0: 'A0004', 7: 'Individual', 8: '' });

    __seedSheet(MAIN, [new Array(23).fill(''), actor, member2, member3, other]);

    const res = JSON.parse(getFamilyMembers(req({ memberID: 'A0001', sessionID: 's1' })));
    expect(res.ok).toBe(true);
    const ids = res.payload.members.map((m: any) => m.memberID);
    expect(ids).toContain('A0001');
    expect(ids).toContain('A0002');
    expect(ids).toContain('A0003');
    expect(ids).not.toContain('A0004');
    expect(res.payload.familyID).toBe('B001');
  });
});

// ── addFamilyMember ─────────────────────────────────────────

describe('addFamilyMember', () => {
  beforeEach(() => {
    seedConfig();
    seedEmptyLog();
  });

  it('returns error when acting member not found', () => {
    __seedSheet(MAIN, [new Array(23).fill('')]);
    const res = JSON.parse(addFamilyMember(req({ memberID: 'A9999', targetEmail: 'bob@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('NOT_FOUND');
  });

  it('returns error when acting member is not Family type', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow({ 7: 'Individual' })]);
    const res = JSON.parse(addFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
  });

  it('returns error when acting member has no FamilyID', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow({ 7: 'Family', 8: '' })]);
    const res = JSON.parse(addFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
  });

  it('returns NOT_FOUND when target email does not exist', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow({ 7: 'Family', 8: 'B001' })]);
    const res = JSON.parse(addFamilyMember(req({ memberID: 'A0001', targetEmail: 'nobody@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('NOT_FOUND');
  });

  it('returns CONFLICT when target already belongs to a different family', () => {
    const actor  = makeMainRow({ 0: 'A0001', 7: 'Family', 8: 'B001' });
    const target = makeMainRow({ 0: 'A0002', 7: 'Family', 8: 'B999', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), actor, target]);

    const res = JSON.parse(addFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('CONFLICT');
  });

  it('returns INVALID_STATE when trying to add yourself', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow({ 7: 'Family', 8: 'B001' })]);
    const res = JSON.parse(addFamilyMember(req({ memberID: 'A0001', targetEmail: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
  });

  it('sets target TYPE = Family and FAMILY_ID when actor is active', () => {
    const actor  = makeMainRow({ 0: 'A0001', 7: 'Family', 8: 'B001' });
    const target = makeMainRow({ 0: 'A0002', 7: 'Individual', 8: '', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), actor, target]);

    const res = JSON.parse(addFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(true);

    const mainRows = __getSheet(MAIN);
    const targetRow = mainRows[2];
    expect(targetRow[7]).toBe('Family');  // TYPE
    expect(targetRow[8]).toBe('B001');    // FAMILY_ID
  });

  it('sets target EXPIRATION = yesterday and STATUS = pending_upgrade when actor is pending_upgrade', () => {
    const actor  = makeMainRow({ 0: 'A0001', 1: 'pending_upgrade', 7: 'Family', 8: 'B001' });
    const target = makeMainRow({ 0: 'A0002', 7: 'Individual', 8: '', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), actor, target]);

    addFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' }));

    const mainRows = __getSheet(MAIN);
    const targetRow = mainRows[2];

    // EXPIRATION should be yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().split('T')[0];
    expect(targetRow[3]).toBe(yStr); // EXPIRATION

    expect(targetRow[1]).toBe('pending_upgrade'); // STATUS
    expect(targetRow[7]).toBe('Family');           // TYPE
    expect(targetRow[8]).toBe('B001');             // FAMILY_ID
  });

  it('does NOT set yesterday expiration when actor status is active', () => {
    const actor  = makeMainRow({ 0: 'A0001', 1: 'active', 7: 'Family', 8: 'B001' });
    const future = new Date();
    future.setFullYear(future.getFullYear() + 2);
    const target = makeMainRow({ 0: 'A0002', 7: 'Individual', 8: '', 4: 'bob@example.com', 3: future.toISOString() });
    __seedSheet(MAIN, [new Array(23).fill(''), actor, target]);

    addFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' }));

    const mainRows = __getSheet(MAIN);
    // Target expiration should NOT be yesterday
    const targetExp = new Date(mainRows[2][3]);
    expect(targetExp.getTime()).toBeGreaterThan(Date.now());
  });

  it('writes a log row before updating the target member', () => {
    const actor  = makeMainRow({ 0: 'A0001', 7: 'Family', 8: 'B001' });
    const target = makeMainRow({ 0: 'A0002', 7: 'Individual', 8: '', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), actor, target]);

    addFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' }));

    const logRows = __getSheet(LOG_SHEET);
    expect(logRows.length).toBe(2); // header + 1 log row
    expect(logRows[1][0]).toMatch(/^ML-/);
    expect(logRows[1][2]).toBe('A0002'); // logged the TARGET's memberID
  });

  it('allows re-adding a member already in the same family (idempotent)', () => {
    const actor   = makeMainRow({ 0: 'A0001', 7: 'Family', 8: 'B001' });
    const inFamily = makeMainRow({ 0: 'A0002', 7: 'Family', 8: 'B001', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), actor, inFamily]);

    const res = JSON.parse(addFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(true);
  });
});

// ── removeFamilyMember ──────────────────────────────────────

describe('removeFamilyMember', () => {
  beforeEach(() => {
    seedConfig();
    seedEmptyLog();
  });

  it('returns error when acting member not found', () => {
    __seedSheet(MAIN, [new Array(23).fill('')]);
    const res = JSON.parse(removeFamilyMember(req({ memberID: 'A9999', targetEmail: 'bob@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('NOT_FOUND');
  });

  it('returns error when acting member is not Family type', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow({ 7: 'Individual' })]);
    const res = JSON.parse(removeFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
  });

  it('returns NOT_FOUND when target email does not exist', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow({ 7: 'Family', 8: 'B001' })]);
    const res = JSON.parse(removeFamilyMember(req({ memberID: 'A0001', targetEmail: 'nobody@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('NOT_FOUND');
  });

  it('returns INVALID_STATE when trying to remove yourself', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow({ 7: 'Family', 8: 'B001' })]);
    const res = JSON.parse(removeFamilyMember(req({ memberID: 'A0001', targetEmail: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
  });

  it('returns CONFLICT when target is not in the same family', () => {
    const actor  = makeMainRow({ 0: 'A0001', 7: 'Family', 8: 'B001' });
    const target = makeMainRow({ 0: 'A0002', 7: 'Family', 8: 'B999', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), actor, target]);

    const res = JSON.parse(removeFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('CONFLICT');
  });

  it('reverts target to Individual and clears FamilyID', () => {
    const actor  = makeMainRow({ 0: 'A0001', 7: 'Family', 8: 'B001' });
    const target = makeMainRow({ 0: 'A0002', 7: 'Family', 8: 'B001', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), actor, target]);

    const res = JSON.parse(removeFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(true);

    const mainRows = __getSheet(MAIN);
    const targetRow = mainRows[2];
    expect(targetRow[7]).toBe('Individual'); // TYPE
    expect(targetRow[8]).toBe('');           // FAMILY_ID cleared
  });

  it('recalculates removed member status as active when expiration is future', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);

    const actor  = makeMainRow({ 0: 'A0001', 7: 'Family', 8: 'B001' });
    const target = makeMainRow({ 0: 'A0002', 7: 'Family', 8: 'B001', 4: 'bob@example.com', 3: future.toISOString() });
    __seedSheet(MAIN, [new Array(23).fill(''), actor, target]);

    removeFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' }));

    const mainRows = __getSheet(MAIN);
    expect(mainRows[2][1]).toBe('active');
  });

  it('recalculates removed member status as inactive when expiration is past', () => {
    const past = new Date();
    past.setFullYear(past.getFullYear() - 1);

    const actor  = makeMainRow({ 0: 'A0001', 7: 'Family', 8: 'B001' });
    const target = makeMainRow({ 0: 'A0002', 7: 'Family', 8: 'B001', 4: 'bob@example.com', 3: past.toISOString() });
    __seedSheet(MAIN, [new Array(23).fill(''), actor, target]);

    removeFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' }));

    const mainRows = __getSheet(MAIN);
    expect(mainRows[2][1]).toBe('inactive');
  });

  it('writes a log row before updating the target member', () => {
    const actor  = makeMainRow({ 0: 'A0001', 7: 'Family', 8: 'B001' });
    const target = makeMainRow({ 0: 'A0002', 7: 'Family', 8: 'B001', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), actor, target]);

    removeFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' }));

    const logRows = __getSheet(LOG_SHEET);
    expect(logRows.length).toBe(2); // header + 1 log row
    expect(logRows[1][2]).toBe('A0002'); // logged the TARGET's memberID
  });

  it('does not modify the acting member row', () => {
    const actor  = makeMainRow({ 0: 'A0001', 7: 'Family', 8: 'B001' });
    const target = makeMainRow({ 0: 'A0002', 7: 'Family', 8: 'B001', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), actor, target]);

    removeFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' }));

    const mainRows = __getSheet(MAIN);
    // Actor row unchanged
    expect(mainRows[1][7]).toBe('Family');
    expect(mainRows[1][8]).toBe('B001');
  });
});

export {};

```


---
## File: `tests/renewal.test.ts`
---

```typescript
// ============================================================
// renewal.ts — unit tests
// Covers: submitDuesPayment, approveDuesPayment (branches A/B/C),
//         rejectDuesPayment, backward-compat aliases
// ============================================================

require('../src/types');
require('../src/ui');
require('../src/config');
require('../src/sheets');
require('../src/logger');
require('../src/renewal');

declare function submitDuesPayment(jsonRequest: string): string;
declare function submitRenewalRequest(jsonRequest: string): string;
declare function approveDuesPayment(jsonRequest: string): string;
declare function approveRenewal(jsonRequest: string): string;
declare function rejectDuesPayment(jsonRequest: string): string;
declare function rejectRenewal(jsonRequest: string): string;
declare function __seedSheet(name: string, rows: any[][]): void;
declare function __getSheet(name: string): any[][];
declare function findMemberByID(id: string): any;
declare function findMembersByFamilyID(id: string): any[];
declare function findWebAppEvent(id: string): any;
declare function logMainTableRow(memberID: string): void;
declare function appendPaymentRecord(record: any): string;
declare function appendWebAppEvent(ev: any): string;
declare function updateWebAppEventRow(idx: number, updates: any): void;
declare function updateMemberRow(idx: number, updates: any): void;
declare function getConfigValue(key: string): string;
declare function generateFamilyID(): string;
declare function auditLog(action: string, data?: any): void;

// ── Shared helpers ──────────────────────────────────────────

const MAIN    = 'Main';
const EVENTS  = 'WebApp-Events';
const LOG_SHEET = 'Membership-Master-Log';
const CONFIG  = 'Config';
const HISTORY = 'Payment-History';

function seedConfig(): void {
  __seedSheet(CONFIG, [
    ['Key', 'Value', 'Description'],
    ['PaymentProofReviewDays', '7',  ''],
    ['MembershipRenewalYears', '1',  ''],
    ['IndividualPrice',        '30', ''],
    ['FamilyPrice',            '50', ''],
  ]);
}

function seedEmptyHistory(): void {
  __seedSheet(HISTORY, [new Array(17).fill('')]);
}

function seedEmptyLog(): void {
  __seedSheet(LOG_SHEET, [new Array(25).fill('')]);
}

/** 23-column Main row. */
function makeMainRow(overrides: Record<number, any> = {}): any[] {
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  const row: any[] = new Array(23).fill('');
  row[0] = 'A0001';
  row[1] = 'active';
  row[3] = future.toISOString();
  row[4] = 'alice@example.com';
  row[5] = 'Alice';
  row[7] = 'Individual';
  Object.entries(overrides).forEach(([k, v]) => { row[Number(k)] = v; });
  return row;
}

/** 24-column WebApp-Events row. */
function makeEventRow(overrides: Record<number, any> = {}): any[] {
  const row: any[] = new Array(24).fill('');
  row[0]  = 'EV001';                        // EVENT_ID
  row[1]  = 'dues_payment';                  // EVENT_TYPE
  row[2]  = new Date().toISOString();        // TIMESTAMP
  row[3]  = new Date(Date.now() + 7 * 86400000).toISOString(); // EXPIRES_AT
  row[4]  = 'A0001';                         // MEMBER_ID
  row[5]  = 'alice@example.com';             // EMAIL
  row[6]  = 'Individual Membership';         // PAYMENT_INTENT
  row[7]  = 30;                              // AMOUNT
  row[13] = 'Matched';                       // STATUS
  Object.entries(overrides).forEach(([k, v]) => { row[Number(k)] = v; });
  return row;
}

/** Minimal ApiRequest JSON. */
function req(payload: object): string {
  return JSON.stringify({ requestId: 'test-req', payload });
}

// ── submitDuesPayment ───────────────────────────────────────

describe('submitDuesPayment', () => {
  beforeEach(() => {
    seedConfig();
    __seedSheet(EVENTS, [new Array(24).fill('')]);
  });

  it('creates a dues_payment event with Pending status', () => {
    const res = JSON.parse(submitDuesPayment(req({
      memberId:      'A0001',
      email:         'alice@example.com',
      sessionID:     's1',
      paymentIntent: 'Individual Membership',
      amount:        30,
      paymentMethod: 'Zelle',
      payerName:     'Alice',
      memoField:     'A0001',
    })));

    expect(res.ok).toBe(true);
    expect(res.payload.eventID).toBeTruthy();

    const evRows = __getSheet(EVENTS);
    expect(evRows.length).toBe(2);
    expect(evRows[1][1]).toBe('dues_payment');          // EVENT_TYPE
    expect(evRows[1][6]).toBe('Individual Membership'); // PAYMENT_INTENT
    expect(evRows[1][13]).toBe('Pending');               // STATUS
  });

  it('stores expiresAt as a future timestamp', () => {
    submitDuesPayment(req({
      memberId: 'A0001', email: 'alice@example.com', sessionID: 's1',
      paymentIntent: 'Individual Membership', amount: 30,
      paymentMethod: 'Venmo', payerName: 'Alice', memoField: '',
    }));
    const evRows = __getSheet(EVENTS);
    const expiresAt = new Date(evRows[1][3]);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('backward-compat alias submitRenewalRequest delegates to submitDuesPayment', () => {
    const res = JSON.parse(submitRenewalRequest(req({
      memberId: 'A0001', email: 'alice@example.com', sessionID: 's1',
      paymentIntent: 'Individual Membership', amount: 30,
      paymentMethod: 'Zelle', payerName: 'Alice', memoField: '',
    })));
    expect(res.ok).toBe(true);
    const evRows = __getSheet(EVENTS);
    expect(evRows[1][1]).toBe('dues_payment');
  });
});

// ── approveDuesPayment — Branch A: Individual Membership ────

describe('approveDuesPayment — Branch A (Individual Membership)', () => {
  beforeEach(() => {
    seedConfig();
    seedEmptyHistory();
    seedEmptyLog();
  });

  it('extends expiration by 1 year and sets status = active', () => {
    const past = new Date();
    past.setFullYear(past.getFullYear() - 1);
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow({ 1: 'inactive', 3: past.toISOString() })]);
    __seedSheet(EVENTS, [new Array(24).fill(''), makeEventRow()]);

    const res = JSON.parse(approveDuesPayment(req({
      eventID: 'EV001', adminEmail: 'admin@mmrunners.org', notes: '',
    })));
    expect(res.ok).toBe(true);
    expect(res.payload.periodEnd).toBeTruthy();

    const mainRows = __getSheet(MAIN);
    expect(mainRows[1][1]).toBe('active');     // STATUS
    expect(mainRows[1][7]).toBe('Individual'); // TYPE unchanged

    // Expiration should be in the future
    const newExp = new Date(mainRows[1][3]);
    expect(newExp.getTime()).toBeGreaterThan(Date.now());
  });

  it('extends from current expiration (not today) when still active', () => {
    const future6mo = new Date();
    future6mo.setMonth(future6mo.getMonth() + 6);
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow({ 3: future6mo.toISOString() })]);
    __seedSheet(EVENTS, [new Array(24).fill(''), makeEventRow()]);

    const res = JSON.parse(approveDuesPayment(req({
      eventID: 'EV001', adminEmail: 'admin@mmrunners.org', notes: '',
    })));
    expect(res.ok).toBe(true);

    const mainRows = __getSheet(MAIN);
    const newExp = new Date(mainRows[1][3]);
    // Should be approx 1 year from the existing 6-month expiration (~18 months from now)
    const expected = new Date(future6mo);
    expected.setFullYear(expected.getFullYear() + 1);
    // Allow ±2 days tolerance
    expect(Math.abs(newExp.getTime() - expected.getTime())).toBeLessThan(2 * 86400000);
  });

  it('marks the WebApp-Events row as Approved', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow()]);
    __seedSheet(EVENTS, [new Array(24).fill(''), makeEventRow()]);

    approveDuesPayment(req({ eventID: 'EV001', adminEmail: 'admin@mmrunners.org', notes: 'ok' }));
    const evRows = __getSheet(EVENTS);
    expect(evRows[1][13]).toBe('Approved');            // STATUS
    expect(evRows[1][16]).toBe('admin@mmrunners.org'); // ADMIN_APPROVER
  });

  it('appends a record to Payment-History', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow()]);
    __seedSheet(EVENTS, [new Array(24).fill(''), makeEventRow()]);

    approveDuesPayment(req({ eventID: 'EV001', adminEmail: 'admin@mmrunners.org', notes: '' }));
    const histRows = __getSheet(HISTORY);
    expect(histRows.length).toBe(2); // header + 1 payment record
  });

  it('writes a log row before updating Main', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow()]);
    __seedSheet(EVENTS, [new Array(24).fill(''), makeEventRow()]);

    approveDuesPayment(req({ eventID: 'EV001', adminEmail: 'admin@mmrunners.org', notes: '' }));
    const logRows = __getSheet(LOG_SHEET);
    expect(logRows.length).toBe(2); // header + 1 log row
    expect(logRows[1][0]).toMatch(/^ML-/);
  });

  it('returns NOT_FOUND when event does not exist', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow()]);
    __seedSheet(EVENTS, [new Array(24).fill('')]);
    const res = JSON.parse(approveDuesPayment(req({ eventID: 'NOEVENT', adminEmail: 'admin@mmrunners.org' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('NOT_FOUND');
  });

  it('backward-compat alias approveRenewal delegates to approveDuesPayment', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow()]);
    __seedSheet(EVENTS, [new Array(24).fill(''), makeEventRow()]);
    const res = JSON.parse(approveRenewal(req({ eventID: 'EV001', adminEmail: 'admin@mmrunners.org' })));
    expect(res.ok).toBe(true);
  });
});

// ── approveDuesPayment — Branch B: Family Membership ────────

describe('approveDuesPayment — Branch B (Family Membership)', () => {
  beforeEach(() => {
    seedConfig();
    seedEmptyHistory();
    seedEmptyLog();
  });

  it('extends expiration and sets active for all family members', () => {
    const past = new Date();
    past.setFullYear(past.getFullYear() - 1);

    const member1 = makeMainRow({ 0: 'A0001', 1: 'pending_upgrade', 3: past.toISOString(), 7: 'Family', 8: 'B001' });
    const member2 = makeMainRow({ 0: 'A0002', 1: 'inactive',        3: past.toISOString(), 7: 'Family', 8: 'B001', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), member1, member2]);

    const evRow = makeEventRow({ 4: 'A0001', 6: 'Family Membership', 7: 50 });
    __seedSheet(EVENTS, [new Array(24).fill(''), evRow]);

    const res = JSON.parse(approveDuesPayment(req({ eventID: 'EV001', adminEmail: 'admin@mmrunners.org', notes: '' })));
    expect(res.ok).toBe(true);

    const mainRows = __getSheet(MAIN);
    // Both members updated
    expect(mainRows[1][1]).toBe('active');
    expect(mainRows[2][1]).toBe('active');
    expect(mainRows[1][7]).toBe('Family');
    expect(mainRows[2][7]).toBe('Family');

    // Both expirations are in the future
    expect(new Date(mainRows[1][3]).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(mainRows[2][3]).getTime()).toBeGreaterThan(Date.now());
  });

  it('writes a log row for each family member', () => {
    const member1 = makeMainRow({ 0: 'A0001', 7: 'Family', 8: 'B001' });
    const member2 = makeMainRow({ 0: 'A0002', 7: 'Family', 8: 'B001', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), member1, member2]);

    const evRow = makeEventRow({ 6: 'Family Membership', 7: 50 });
    __seedSheet(EVENTS, [new Array(24).fill(''), evRow]);

    approveDuesPayment(req({ eventID: 'EV001', adminEmail: 'admin@mmrunners.org', notes: '' }));
    const logRows = __getSheet(LOG_SHEET);
    // One log row per family member
    expect(logRows.length).toBe(3); // header + 2 log rows
  });
});

// ── approveDuesPayment — Branch C: Family Upgrade ───────────

describe('approveDuesPayment — Branch C (Family Upgrade)', () => {
  beforeEach(() => {
    seedConfig();
    seedEmptyHistory();
    seedEmptyLog();
  });

  it('returns INVALID_STATE when member is not in pending_upgrade', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow({ 7: 'Family', 8: 'B001' })]);
    const evRow = makeEventRow({ 6: 'Family Upgrade', 7: 20 });
    __seedSheet(EVENTS, [new Array(24).fill(''), evRow]);

    const res = JSON.parse(approveDuesPayment(req({ eventID: 'EV001', adminEmail: 'admin@mmrunners.org' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
  });

  it('sets active and Family type WITHOUT changing expiration', () => {
    const futureDate = new Date();
    futureDate.setMonth(futureDate.getMonth() + 8); // 8 months out
    const expStr = futureDate.toISOString().split('T')[0];

    __seedSheet(MAIN, [new Array(23).fill(''),
      makeMainRow({ 1: 'pending_upgrade', 3: expStr, 7: 'Family', 8: 'B001' }),
    ]);
    const evRow = makeEventRow({ 6: 'Family Upgrade', 7: 20 });
    __seedSheet(EVENTS, [new Array(24).fill(''), evRow]);

    const res = JSON.parse(approveDuesPayment(req({ eventID: 'EV001', adminEmail: 'admin@mmrunners.org', notes: '' })));
    expect(res.ok).toBe(true);

    const mainRows = __getSheet(MAIN);
    expect(mainRows[1][1]).toBe('active');
    expect(mainRows[1][7]).toBe('Family');
    // Expiration must not have changed — compare date portion only
    expect(mainRows[1][3]).toBe(expStr);
  });

  it('sets all family members to active when upgrading', () => {
    const expStr = new Date(Date.now() + 8 * 30 * 86400000).toISOString().split('T')[0];

    const member1 = makeMainRow({ 0: 'A0001', 1: 'pending_upgrade', 3: expStr, 7: 'Family', 8: 'B001' });
    const member2 = makeMainRow({ 0: 'A0002', 1: 'pending_upgrade', 3: expStr, 7: 'Family', 8: 'B001', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), member1, member2]);

    const evRow = makeEventRow({ 6: 'Family Upgrade', 7: 20 });
    __seedSheet(EVENTS, [new Array(24).fill(''), evRow]);

    approveDuesPayment(req({ eventID: 'EV001', adminEmail: 'admin@mmrunners.org', notes: '' }));

    const mainRows = __getSheet(MAIN);
    expect(mainRows[1][1]).toBe('active');
    expect(mainRows[2][1]).toBe('active');
    // Expirations unchanged
    expect(mainRows[1][3]).toBe(expStr);
    expect(mainRows[2][3]).toBe(expStr);
  });

  it('writes log rows for each member before updating', () => {
    const expStr = new Date(Date.now() + 8 * 30 * 86400000).toISOString().split('T')[0];
    const member1 = makeMainRow({ 0: 'A0001', 1: 'pending_upgrade', 3: expStr, 7: 'Family', 8: 'B001' });
    const member2 = makeMainRow({ 0: 'A0002', 1: 'pending_upgrade', 3: expStr, 7: 'Family', 8: 'B001', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), member1, member2]);

    const evRow = makeEventRow({ 6: 'Family Upgrade', 7: 20 });
    __seedSheet(EVENTS, [new Array(24).fill(''), evRow]);

    approveDuesPayment(req({ eventID: 'EV001', adminEmail: 'admin@mmrunners.org', notes: '' }));
    const logRows = __getSheet(LOG_SHEET);
    expect(logRows.length).toBe(3); // header + 2 log rows
  });
});

// ── rejectDuesPayment ───────────────────────────────────────

describe('rejectDuesPayment', () => {
  beforeEach(() => {
    seedConfig();
    seedEmptyLog();
  });

  it('sets WebApp-Events STATUS = Rejected', () => {
    __seedSheet(EVENTS, [new Array(24).fill(''), makeEventRow()]);
    const res = JSON.parse(rejectDuesPayment(req({
      eventID: 'EV001', adminEmail: 'admin@mmrunners.org', notes: 'Amount mismatch',
    })));
    expect(res.ok).toBe(true);

    const evRows = __getSheet(EVENTS);
    expect(evRows[1][13]).toBe('Rejected');
    expect(evRows[1][16]).toBe('admin@mmrunners.org');
    expect(evRows[1][18]).toBe('Amount mismatch');
  });

  it('returns NOT_FOUND when event does not exist', () => {
    __seedSheet(EVENTS, [new Array(24).fill('')]);
    const res = JSON.parse(rejectDuesPayment(req({ eventID: 'NOSUCH', adminEmail: 'admin@mmrunners.org', notes: '' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('NOT_FOUND');
  });

  it('backward-compat alias rejectRenewal delegates to rejectDuesPayment', () => {
    __seedSheet(EVENTS, [new Array(24).fill(''), makeEventRow()]);
    const res = JSON.parse(rejectRenewal(req({ eventID: 'EV001', adminEmail: 'admin@mmrunners.org', notes: '' })));
    expect(res.ok).toBe(true);
    const evRows = __getSheet(EVENTS);
    expect(evRows[1][13]).toBe('Rejected');
  });

  it('does not modify the Main table on rejection', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow()]);
    __seedSheet(EVENTS, [new Array(24).fill(''), makeEventRow()]);

    rejectDuesPayment(req({ eventID: 'EV001', adminEmail: 'admin@mmrunners.org', notes: '' }));

    const mainRows = __getSheet(MAIN);
    // Member unchanged: still active, expiration intact
    expect(mainRows[1][1]).toBe('active');
    expect(mainRows[1][7]).toBe('Individual');
  });
});

export {};

```


---
## File: `tests/setup.ts`
---

```typescript
// ============================================================
// Jest global setup: mock all Google Apps Script APIs
// ============================================================

// In-memory sheet store
const sheetData: Record<string, any[][]> = {};

function makeSheet(name: string) {
  if (!sheetData[name]) sheetData[name] = [[]];
  return {
    getName: () => name,
    getDataRange: () => ({
      getValues: () => sheetData[name].map(r => [...r]),
    }),
    appendRow: (row: any[]) => {
      sheetData[name].push([...row]);
    },
    getRange: (row: number, col: number) => ({
      setValue: (v: any) => {
        while (sheetData[name].length < row) sheetData[name].push([]);
        while (sheetData[name][row - 1].length < col) sheetData[name][row - 1].push('');
        sheetData[name][row - 1][col - 1] = v;
      },
      getValue: () => sheetData[name][row - 1]?.[col - 1] ?? '',
    }),
    deleteRow: (row: number) => {
      sheetData[name].splice(row - 1, 1);
    },
  };
}

// Reset all sheet data between tests
beforeEach(() => {
  Object.keys(sheetData).forEach(k => delete sheetData[k]);
});

// GAS globals — openById works for both spreadsheet IDs; sheets are keyed by name only
(global as any).SpreadsheetApp = {
  openById: (_id: string) => ({
    getSheetByName: (name: string) => makeSheet(name),
  }),
};

(global as any).MailApp = {
  sendEmail: jest.fn(),
};

(global as any).Session = {
  getActiveUser: () => ({ getEmail: () => 'admin@mmrunners.org' }),
};

(global as any).HtmlService = {
  createHtmlOutputFromFile: (file: string) => ({
    setTitle: () => ({}),
    setXFrameOptionsMode: () => ({}),
  }),
  XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
};

(global as any).Logger = {
  log: jest.fn(),
};

(global as any).ScriptApp = {
  getService: () => ({ getUrl: () => 'https://script.google.com/test' }),
};

// HtmlService.createHtmlOutput needed by ui.ts
(global as any).HtmlService = {
  createHtmlOutputFromFile: (_file: string) => ({
    getContent: () => '<html>__SCRIPT_URL____URL_PARAMS__</html>',
    setTitle: () => ({}),
    setXFrameOptionsMode: () => ({}),
  }),
  createHtmlOutput: (_content: string) => ({
    setTitle: (_t: string) => ({ setXFrameOptionsMode: () => ({}) }),
  }),
  XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
};

// Expose test helper to seed sheets
(global as any).__seedSheet = (name: string, rows: any[][]) => {
  sheetData[name] = rows.map(r => [...r]);
};

(global as any).__getSheet = (name: string) => sheetData[name] || [];

```


---
## File: `tests/sheets.test.ts`
---

```typescript
// ============================================================
// sheets.ts — unit tests
// Covers: deriveStatus, rowToMember, logMainTableRow,
//         generateMemberID, generateFamilyID, findMemberByEmail,
//         findMemberByID, findMembersByFamilyID, updateMemberRow
// ============================================================

require('../src/types');
require('../src/ui');
require('../src/config');
require('../src/sheets');

declare function deriveStatus(expiration: string): string;
declare function rowToMember(row: any[]): any;
declare function logMainTableRow(memberID: string): void;
declare function findMemberByEmail(email: string): any;
declare function findMemberByID(id: string): any;
declare function generateMemberID(): string;
declare function generateFamilyID(): string;
declare function __seedSheet(name: string, rows: any[][]): void;
declare function __getSheet(name: string): any[][];

// --------------- deriveStatus ---------------

describe('deriveStatus', () => {
  it('returns inactive for blank expiration', () => {
    expect(deriveStatus('')).toBe('inactive');
  });

  it('returns inactive for invalid date', () => {
    expect(deriveStatus('not-a-date')).toBe('inactive');
  });

  it('returns active for future expiration', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    expect(deriveStatus(future.toISOString())).toBe('active');
  });

  it('returns inactive for past expiration', () => {
    const past = new Date();
    past.setFullYear(past.getFullYear() - 1);
    expect(deriveStatus(past.toISOString())).toBe('inactive');
  });

  it('returns active for today (same day)', () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    expect(deriveStatus(today.toISOString())).toBe('active');
  });

  // Legacy values 'expired' and 'not active' must NOT be returned
  it('never returns legacy status strings', () => {
    const result = deriveStatus(new Date().toISOString());
    expect(['active', 'inactive']).toContain(result);
  });
});

// --------------- rowToMember ---------------

describe('rowToMember', () => {
  function makeRow(overrides: Record<number, any> = {}): any[] {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const row: any[] = new Array(23).fill('');
    row[0]  = 'A0001';   // MEMBER_ID
    row[1]  = 'active';  // STATUS
    row[3]  = future.toISOString(); // EXPIRATION
    row[4]  = 'test@example.com';
    row[5]  = 'Jane';
    row[6]  = 'Doe';
    row[7]  = 'Individual';
    Object.entries(overrides).forEach(([k, v]) => { row[Number(k)] = v; });
    return row;
  }

  it('derives active from future expiration (stored status ignored for active/inactive)', () => {
    const m = rowToMember(makeRow({ 1: 'active' }));
    expect(m.status).toBe('active');
    expect(m.memberID).toBe('A0001');
  });

  it('derives inactive when expiration is in the past regardless of stored status', () => {
    const past = new Date();
    past.setFullYear(past.getFullYear() - 1);
    const m = rowToMember(makeRow({ 1: 'active', 3: past.toISOString() }));
    expect(m.status).toBe('inactive');
  });

  it('returns pending_upgrade when stored status = pending_upgrade', () => {
    const m = rowToMember(makeRow({ 1: 'pending_upgrade' }));
    expect(m.status).toBe('pending_upgrade');
  });

  it('handles legacy "not active" stored status as inactive', () => {
    const past = new Date();
    past.setFullYear(past.getFullYear() - 1);
    const m = rowToMember(makeRow({ 1: 'not active', 3: past.toISOString() }));
    expect(m.status).toBe('inactive');
  });

  it('handles legacy "expired" stored status as inactive', () => {
    const past = new Date();
    past.setFullYear(past.getFullYear() - 1);
    const m = rowToMember(makeRow({ 1: 'expired', 3: past.toISOString() }));
    expect(m.status).toBe('inactive');
  });

  it('maps all fields correctly', () => {
    const m = rowToMember(makeRow({ 5: 'Alice', 6: 'Smith', 7: 'Family', 8: 'B001' }));
    expect(m.firstName).toBe('Alice');
    expect(m.lastName).toBe('Smith');
    expect(m.type).toBe('Family');
    expect(m.familyID).toBe('B001');
  });
});

// --------------- logMainTableRow ---------------

describe('logMainTableRow', () => {
  const MAIN  = 'Main';
  const LOG   = 'Membership-Master-Log';

  beforeEach(() => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    // Header row + one member row
    __seedSheet(MAIN, [
      ['MemberID','Status','Created','Expiration','Email','FirstName','LastName',
       'Type','FamilyID','Gender','WeChatID','District','WebApp','PaymentCheck','Info',
       'LastUpdated','MembershipFeePaid','PaymentDate','PaymentTransaction',
       'JoinYear','PhoneNumber','LastLoginDate','Notes'],
      ['A0001', 'active', '', future.toISOString(), 'a@example.com',
       'Ann', 'Lee', 'Individual', '', '', '', '', '', '', '',
       '', '', '', '', '2022', '', '', ''],
    ]);
    __seedSheet(LOG, [
      ['LogID','LoggingTime',
       'MemberID','Status','Created','Expiration','Email','FirstName','LastName',
       'Type','FamilyID','Gender','WeChatID','District','WebApp','PaymentCheck','Info',
       'LastUpdated','MembershipFeePaid','PaymentDate','PaymentTransaction',
       'JoinYear','PhoneNumber','LastLoginDate','Notes'],
    ]);
  });

  it('appends a log row before a write', () => {
    logMainTableRow('A0001');
    const logRows = __getSheet(LOG);
    expect(logRows.length).toBe(2); // header + 1 log row
    const logRow = logRows[1];
    expect(logRow[0]).toMatch(/^ML-/);           // LogID
    expect(typeof logRow[1]).toBe('string');      // LoggingTime
    expect(logRow[2]).toBe('A0001');              // MemberID (offset +2)
  });

  it('does not throw when member not found', () => {
    expect(() => logMainTableRow('NOTEXIST')).not.toThrow();
    const logRows = __getSheet(LOG);
    expect(logRows.length).toBe(1); // only header, no row added
  });
});

// --------------- findMemberByEmail / findMemberByID ---------------

describe('findMemberByEmail', () => {
  beforeEach(() => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    __seedSheet('Main', [
      new Array(23).fill(''), // header row (simplified)
      (() => {
        const r = new Array(23).fill('');
        r[0] = 'A0001'; r[4] = 'user@example.com'; r[3] = future.toISOString(); return r;
      })(),
    ]);
  });

  it('finds member by email (case-insensitive)', () => {
    const result = findMemberByEmail('USER@EXAMPLE.COM');
    expect(result).not.toBeNull();
    expect(result!.member.memberID).toBe('A0001');
  });

  it('returns null when email not found', () => {
    expect(findMemberByEmail('nobody@example.com')).toBeNull();
  });
});

describe('findMemberByID', () => {
  beforeEach(() => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    __seedSheet('Main', [
      new Array(23).fill(''),
      (() => {
        const r = new Array(23).fill('');
        r[0] = 'A0042'; r[4] = 'x@x.com'; r[3] = future.toISOString(); return r;
      })(),
    ]);
  });

  it('finds member by ID', () => {
    const result = findMemberByID('A0042');
    expect(result).not.toBeNull();
    expect(result!.member.email).toBe('x@x.com');
  });

  it('returns null when ID not found', () => {
    expect(findMemberByID('A9999')).toBeNull();
  });
});

// --------------- generateMemberID / generateFamilyID ---------------

describe('generateMemberID', () => {
  it('returns A0001 for an empty sheet', () => {
    __seedSheet('Main', [new Array(23).fill('')]);
    expect(generateMemberID()).toBe('A0001');
  });

  it('skips used IDs and returns first available', () => {
    const used = new Array(23).fill('');
    used[0] = 'A0001';
    __seedSheet('Main', [new Array(23).fill(''), used]);
    expect(generateMemberID()).toBe('A0002');
  });
});

describe('generateFamilyID', () => {
  it('returns B001 for an empty sheet', () => {
    __seedSheet('Main', [new Array(23).fill('')]);
    expect(generateFamilyID()).toBe('B001');
  });

  it('skips used FamilyIDs', () => {
    const used = new Array(23).fill('');
    used[8] = 'B001';
    __seedSheet('Main', [new Array(23).fill(''), used]);
    expect(generateFamilyID()).toBe('B002');
  });
});

export {};

```


---
## File: `tests/upgrade.test.ts`
---

```typescript
// ============================================================
// upgrade.ts — unit tests
// Covers: initiateSwitch, initiateUpgrade, cancelUpgrade
// ============================================================

require('../src/types');
require('../src/ui');
require('../src/config');
require('../src/sheets');
require('../src/logger');
require('../src/upgrade');

declare function initiateSwitch(jsonRequest: string): string;
declare function initiateUpgrade(jsonRequest: string): string;
declare function cancelUpgrade(jsonRequest: string): string;
declare function __seedSheet(name: string, rows: any[][]): void;
declare function __getSheet(name: string): any[][];
declare function findMemberByID(id: string): any;
declare function findMembersByFamilyID(id: string): any[];
declare function logMainTableRow(memberID: string): void;
declare function generateFamilyID(): string;
declare function appendWebAppEvent(ev: any): string;
declare function getPendingWebAppEvents(): any[];
declare function findWebAppEvent(id: string): any;
declare function updateWebAppEventRow(idx: number, updates: any): void;
declare function updateMemberRow(idx: number, updates: any): void;
declare function getConfigMap(): any;
declare function auditLog(action: string, data?: any): void;

// ── Shared helpers ──────────────────────────────────────────

const MAIN    = 'Main';
const EVENTS  = 'WebApp-Events';
const LOG_SHEET = 'Membership-Master-Log';
const CONFIG  = 'Config';

/** Build a 23-column Main row with sensible defaults. */
function makeMainRow(overrides: Record<number, any> = {}): any[] {
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  const row: any[] = new Array(23).fill('');
  row[0] = 'A0001';            // MM_COL.MEMBER_ID
  row[1] = 'active';           // MM_COL.STATUS
  row[3] = future.toISOString(); // MM_COL.EXPIRATION
  row[4] = 'alice@example.com'; // MM_COL.EMAIL
  row[5] = 'Alice';            // MM_COL.FIRST_NAME
  row[7] = 'Individual';       // MM_COL.TYPE
  Object.entries(overrides).forEach(([k, v]) => { row[Number(k)] = v; });
  return row;
}

/** Seed a minimal Config sheet with required keys. */
function seedConfig(extra: string[][] = []): void {
  __seedSheet(CONFIG, [
    ['Key', 'Value', 'Description'],
    ['FamilyPrice',          '50', ''],
    ['FamilyUpgradePrice',   '20', ''],
    ['PaymentProofReviewDays', '7', ''],
    ['UpgradeMinMonths',     '3',  ''],
    ['MembershipRenewalYears', '1', ''],
    ...extra,
  ]);
}

/** Seed header + one member row in Main. */
function seedMain(memberRow: any[]): void {
  __seedSheet(MAIN, [new Array(23).fill(''), memberRow]);
}

/** Seed empty Events sheet (header only). */
function seedEmptyEvents(): void {
  __seedSheet(EVENTS, [new Array(24).fill('')]);
}

/** Seed empty Log sheet (header only). */
function seedEmptyLog(): void {
  __seedSheet(LOG_SHEET, [new Array(25).fill('')]);
}

/** Build a minimal ApiRequest JSON string. */
function req(payload: object): string {
  return JSON.stringify({ requestId: 'test-req', payload });
}

// ── initiateSwitch ──────────────────────────────────────────

describe('initiateSwitch', () => {
  beforeEach(() => {
    seedConfig();
    seedEmptyEvents();
    seedEmptyLog();
  });

  it('returns error when member not found', () => {
    seedMain(makeMainRow({ 0: 'A0002' }));
    const res = JSON.parse(initiateSwitch(req({ memberID: 'A9999', email: 'x@x.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('NOT_FOUND');
  });

  it('returns error when status is already pending_upgrade', () => {
    seedMain(makeMainRow({ 1: 'pending_upgrade' }));
    const res = JSON.parse(initiateSwitch(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
  });

  it('returns error when member is already active Family', () => {
    seedMain(makeMainRow({ 1: 'active', 7: 'Family', 8: 'B001' }));
    const res = JSON.parse(initiateSwitch(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
  });

  it('succeeds for inactive Individual member — sets pending_upgrade and creates event', () => {
    const past = new Date();
    past.setFullYear(past.getFullYear() - 1);
    seedMain(makeMainRow({ 1: 'inactive', 3: past.toISOString() }));

    const res = JSON.parse(initiateSwitch(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(true);
    expect(res.payload.paymentIntent).toBe('Family Membership');
    expect(res.payload.amount).toBe(50);
    expect(res.payload.familyID).toMatch(/^B\d{3}/);
    expect(res.payload.eventID).toBeTruthy();
  });

  it('succeeds for active Individual member (expiring soon)', () => {
    seedMain(makeMainRow({ 1: 'active', 7: 'Individual' }));
    const res = JSON.parse(initiateSwitch(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(true);
    expect(res.payload.paymentIntent).toBe('Family Membership');
  });

  it('sets STATUS = pending_upgrade and TYPE = Family in Main sheet', () => {
    seedMain(makeMainRow());
    initiateSwitch(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' }));
    const mainRows = __getSheet(MAIN);
    const memberRow = mainRows[1];
    expect(memberRow[1]).toBe('pending_upgrade'); // STATUS
    expect(memberRow[7]).toBe('Family');          // TYPE
    expect(memberRow[8]).toMatch(/^B\d{3}/);      // FAMILY_ID assigned
  });

  it('appends a family_switch event to WebApp-Events with Pending status', () => {
    seedMain(makeMainRow());
    initiateSwitch(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' }));
    const evRows = __getSheet(EVENTS);
    expect(evRows.length).toBe(2); // header + 1 event
    const evRow = evRows[1];
    expect(evRow[1]).toBe('family_switch');       // WE_COL.EVENT_TYPE
    expect(evRow[6]).toBe('Family Membership');   // WE_COL.PAYMENT_INTENT
    expect(evRow[13]).toBe('Pending');            // WE_COL.STATUS
  });

  it('writes a log row to Membership-Master-Log before the main table update', () => {
    seedMain(makeMainRow());
    initiateSwitch(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' }));
    const logRows = __getSheet(LOG_SHEET);
    expect(logRows.length).toBe(2); // header + 1 log row
    expect(logRows[1][0]).toMatch(/^ML-/); // LogID
    expect(logRows[1][2]).toBe('A0001');   // MemberID at ML_MM_OFFSET
  });

  it('reuses existing familyID if member already has one', () => {
    seedMain(makeMainRow({ 8: 'B999' }));
    const res = JSON.parse(initiateSwitch(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' })));
    expect(res.payload.familyID).toBe('B999');
  });
});

// ── initiateUpgrade ─────────────────────────────────────────

describe('initiateUpgrade', () => {
  beforeEach(() => {
    seedConfig();
    seedEmptyEvents();
    seedEmptyLog();
  });

  it('returns error when member not found', () => {
    seedMain(makeMainRow());
    const res = JSON.parse(initiateUpgrade(req({ memberID: 'ZZZZ', email: 'x@x.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('NOT_FOUND');
  });

  it('returns error when status is pending_upgrade', () => {
    seedMain(makeMainRow({ 1: 'pending_upgrade' }));
    const res = JSON.parse(initiateUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
  });

  it('returns error when status is inactive (not active)', () => {
    const past = new Date();
    past.setFullYear(past.getFullYear() - 1);
    seedMain(makeMainRow({ 3: past.toISOString() }));
    const res = JSON.parse(initiateUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
  });

  it('returns error when member is already Family type', () => {
    seedMain(makeMainRow({ 7: 'Family', 8: 'B001' }));
    const res = JSON.parse(initiateUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
  });

  it('returns error when expiration is less than UpgradeMinMonths away', () => {
    // Expires in 2 months — below the 3-month threshold
    const twoMonths = new Date();
    twoMonths.setMonth(twoMonths.getMonth() + 2);
    seedMain(makeMainRow({ 3: twoMonths.toISOString() }));
    const res = JSON.parse(initiateUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
    expect(res.errorMessage).toMatch(/3 months/i);
  });

  it('succeeds when active Individual with expiration > 3 months', () => {
    // Expires in 6 months — well above threshold
    const sixMonths = new Date();
    sixMonths.setMonth(sixMonths.getMonth() + 6);
    seedMain(makeMainRow({ 3: sixMonths.toISOString() }));

    const res = JSON.parse(initiateUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(true);
    expect(res.payload.paymentIntent).toBe('Family Upgrade');
    expect(res.payload.amount).toBe(20);
    expect(res.payload.familyID).toMatch(/^B\d{3}/);
  });

  it('sets pending_upgrade and Family type in Main sheet', () => {
    const sixMonths = new Date();
    sixMonths.setMonth(sixMonths.getMonth() + 6);
    seedMain(makeMainRow({ 3: sixMonths.toISOString() }));

    initiateUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' }));
    const mainRows = __getSheet(MAIN);
    expect(mainRows[1][1]).toBe('pending_upgrade'); // STATUS
    expect(mainRows[1][7]).toBe('Family');           // TYPE
  });

  it('appends a family_upgrade event with Family Upgrade intent', () => {
    const sixMonths = new Date();
    sixMonths.setMonth(sixMonths.getMonth() + 6);
    seedMain(makeMainRow({ 3: sixMonths.toISOString() }));

    initiateUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' }));
    const evRows = __getSheet(EVENTS);
    expect(evRows.length).toBe(2);
    expect(evRows[1][1]).toBe('family_upgrade');  // WE_COL.EVENT_TYPE
    expect(evRows[1][6]).toBe('Family Upgrade');  // WE_COL.PAYMENT_INTENT
    expect(evRows[1][13]).toBe('Pending');         // WE_COL.STATUS
  });

  it('writes a log row before updating Main', () => {
    const sixMonths = new Date();
    sixMonths.setMonth(sixMonths.getMonth() + 6);
    seedMain(makeMainRow({ 3: sixMonths.toISOString() }));

    initiateUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' }));
    const logRows = __getSheet(LOG_SHEET);
    expect(logRows.length).toBe(2);
    expect(logRows[1][0]).toMatch(/^ML-/);
  });
});

// ── cancelUpgrade ───────────────────────────────────────────

describe('cancelUpgrade', () => {
  beforeEach(() => {
    seedConfig();
    seedEmptyLog();
  });

  it('returns error when member not found', () => {
    seedMain(makeMainRow());
    __seedSheet(EVENTS, [new Array(24).fill('')]);
    const res = JSON.parse(cancelUpgrade(req({ memberID: 'ZZZZ', email: 'x@x.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('NOT_FOUND');
  });

  it('returns error when status is not pending_upgrade', () => {
    seedMain(makeMainRow({ 1: 'active' }));
    __seedSheet(EVENTS, [new Array(24).fill('')]);
    const res = JSON.parse(cancelUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
  });

  it('reverts the single member back to Individual with recalculated status (active)', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    seedMain(makeMainRow({ 1: 'pending_upgrade', 3: future.toISOString(), 7: 'Family', 8: 'B001' }));
    __seedSheet(EVENTS, [new Array(24).fill('')]);

    const res = JSON.parse(cancelUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(true);
    expect(res.payload.revertedCount).toBeGreaterThanOrEqual(1);

    const mainRows = __getSheet(MAIN);
    expect(mainRows[1][7]).toBe('Individual'); // TYPE reverted
    expect(mainRows[1][8]).toBe('');           // FAMILY_ID cleared
    expect(mainRows[1][1]).toBe('active');     // STATUS recalculated
  });

  it('recalculates status as inactive when expiration is past', () => {
    const past = new Date();
    past.setFullYear(past.getFullYear() - 1);
    seedMain(makeMainRow({ 1: 'pending_upgrade', 3: past.toISOString(), 7: 'Family', 8: 'B001' }));
    __seedSheet(EVENTS, [new Array(24).fill('')]);

    cancelUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' }));
    const mainRows = __getSheet(MAIN);
    expect(mainRows[1][1]).toBe('inactive');
  });

  it('reverts all family members sharing the same FamilyID', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);

    const member1 = makeMainRow({ 0: 'A0001', 1: 'pending_upgrade', 3: future.toISOString(), 7: 'Family', 8: 'B001' });
    const member2 = makeMainRow({ 0: 'A0002', 1: 'pending_upgrade', 3: future.toISOString(), 7: 'Family', 8: 'B001', 4: 'bob@example.com' });

    __seedSheet(MAIN, [new Array(23).fill(''), member1, member2]);
    __seedSheet(EVENTS, [new Array(24).fill('')]);

    const res = JSON.parse(cancelUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(true);
    expect(res.payload.revertedCount).toBe(2);

    const mainRows = __getSheet(MAIN);
    // Both members reverted
    expect(mainRows[1][7]).toBe('Individual');
    expect(mainRows[2][7]).toBe('Individual');
    expect(mainRows[1][8]).toBe('');
    expect(mainRows[2][8]).toBe('');
  });

  it('rejects pending family_switch / family_upgrade events for the member', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    seedMain(makeMainRow({ 1: 'pending_upgrade', 3: future.toISOString(), 7: 'Family', 8: 'B001' }));

    // Seed a pending family_switch event for A0001
    const evRow = new Array(24).fill('');
    evRow[0]  = 'EV001';          // WE_COL.EVENT_ID
    evRow[1]  = 'family_switch';  // WE_COL.EVENT_TYPE
    evRow[2]  = new Date().toISOString(); // WE_COL.TIMESTAMP
    evRow[4]  = 'A0001';          // WE_COL.MEMBER_ID
    evRow[13] = 'Pending';        // WE_COL.STATUS
    __seedSheet(EVENTS, [new Array(24).fill(''), evRow]);

    cancelUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' }));

    const evRows = __getSheet(EVENTS);
    // The event row should now be Rejected
    expect(evRows[1][13]).toBe('Rejected');
    expect(evRows[1][16]).toBe('system'); // ADMIN_APPROVER
  });

  it('writes a log row for each reverted member', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const member1 = makeMainRow({ 0: 'A0001', 1: 'pending_upgrade', 3: future.toISOString(), 7: 'Family', 8: 'B001' });
    const member2 = makeMainRow({ 0: 'A0002', 1: 'pending_upgrade', 3: future.toISOString(), 7: 'Family', 8: 'B001', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), member1, member2]);
    __seedSheet(EVENTS, [new Array(24).fill('')]);

    cancelUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' }));
    const logRows = __getSheet(LOG_SHEET);
    // header + 2 log rows (one per member)
    expect(logRows.length).toBe(3);
  });
});

export {};

```


---
## File: `tsconfig.json`
---

```json
{
  "compilerOptions": {
    "target": "ES2019",
    "lib": ["ES2019"],
    "module": "none",
    "strict": true,
    "noImplicitAny": true,
    "outDir": "dist",
    "types": ["google-apps-script"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}

```


---
## File: `tsconfig.test.json`
---

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "commonjs",
    "types": ["jest", "node", "google-apps-script"],
    "outDir": "dist-test"
  },
  "include": ["src/**/*.ts", "tests/setup.ts", "tests/*.test.ts"],
  "exclude": ["node_modules", "dist", "tests/*.skip.ts"]
}

```


