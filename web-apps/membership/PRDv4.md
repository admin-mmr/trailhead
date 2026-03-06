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
