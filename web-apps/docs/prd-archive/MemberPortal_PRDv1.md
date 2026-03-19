# Misty Mountain Runners Membership Web App – Product Requirements Document (PRD)

_Last updated: 2026-03-02_

---

## 1. Product Overview & Goals

### 1.1 Objective

Build a scalable membership web application for Misty Mountain Runners that:

- Manages member authentication with a mix of Google OAuth and email One-Time Password (OTP). 
- Lets members view and update profiles and family groupings stored in the Membership Master sheet. 
- Handles membership renewals and new signups paid externally (Zelle, Venmo, PayPal) and reconciles those with Gmail-derived payment data. 
- Maintains clean **Payment History** and **Membership History** to support reporting, audit, and analytics. 

The app runs on **Google Apps Script (GAS)** with Google Sheets as the main data store and will be managed via **CLASP** and GitHub for version control and collaboration. 

### 1.2 Scope – Phase 1 (MVP)

Phase 1 focuses on:

- Authentication:
  - Google OAuth for gmail.com users (about 65% of members). 
  - Email OTP login for all non-Gmail addresses. 
- Member self-service:
  - View current membership status (`active`/`not active`) and expiration from Membership Master.
  - Edit profile: WeChat ID, phone, district, and JoinYear.
- Membership payments:
  - External payment via Zelle, Venmo, PayPal (no in-app payment processing).
  - Member submits payment details (payer name, memo, last 4 digits, optional screenshot).
  - Admins approve payments and renew memberships.
- Data integration:
  - Reuse the existing `Membership-Master-Main-3` sheet as source of truth for members. 
  - Use the Fetch-Gmail sheet that already logs Zelle/Venmo/PayPal messages for payment matching. 
- Logging:
  - Generic WebApp events sheet for all structured submissions.
  - Detailed activity log for troubleshooting.

Out of scope for MVP (but considered in design):

- NYRR leaderboard/ranking, training plans, discount codes, event registration beyond membership.

---

## 2. Tech Stack & Architecture

### 2.1 Tech Stack

- **Backend**: Google Apps Script (GAS), deployed as a web app bound to the membership spreadsheet. 
- **Frontend**: HTML/CSS and TypeScript compiled to JavaScript, served via `HtmlService`.
- **Data Store**:
  - `Membership-Master-Main-3` as primary member database. 
  - New sheets: `WebApp-Events`, `Payment-History`, `Membership-History`, `Auth-OTP`, `Config`, `WebApp-ActivityLog`.
  - Existing Fetch-Gmail sheet for Zelle/Venmo/PayPal.
- **Version Control & Deployment**:
  - GitHub repo managed with CLASP (`rootDir` = `dist`).
  - TypeScript project compiled to `dist/` before `clasp push`.

### 2.2 Architectural Principles

- **API-style backend**:
  - All front-end → back-end calls use JSON strings.
  - Every exposed Apps Script function has the signature `fn(jsonRequest: string): string`.
- **Layering**:
  - `types`, `config`, `sheets` (data access), `auth`, `members`, `renewal`, `admin`, `ui`.
- **Future mobile support**:
  - Business logic implemented as functions callable via `doPost`/`doGet` style APIs later.
- **Configurability**:
  - Prices, payment methods, OTP rules, and admin emails live in `Config` (no hard-coded constants). 

---

## 3. User Roles & Core Flows

### 3.1 Roles

- **Member**:
  - Logs in, views/upgrades membership, updates profile, submits renewal requests.
- **Admin**:
  - Approves membership payments, manages config, monitors events and activity.
- **System**:
  - Background scripts to match payments, update membership/ payment history, and send notifications.

### 3.2 Authentication Flows

#### 3.2.1 Google OAuth Login

Target: `@gmail.com` addresses that already exist in Membership Master or are new members. 

Flow:

1. User clicks “Sign in with Google”.
2. GAS retrieves the authenticated Google email.
3. If domain is `gmail.com`, treat as Google-authenticated member.
4. Lookup this email in Membership Master:
   - If found, load member profile and proceed to dashboard.
   - If not found, create a new **inactive** member (see MemberID rules in 3.3.1) and prompt for profile completion. 

#### 3.2.2 Email OTP Login

Target: non-Gmail addresses (Yahoo, Hotmail, QQ, corporate, etc.). 

1. User enters email and chooses “Login by Email Code (OTP)”.
2. System:
   - Generates a 6-digit OTP.
   - Reads `OTP_Valid_Hours` from `Config` (default 24). 
   - Writes an `Auth-OTP` row with `Email`, `OTPCode`, `CreatedAt`, `ExpiresAt`, `Used = FALSE`.
3. System emails the OTP via `MailApp.sendEmail`.
4. User enters the OTP code in the app.
5. System validates:
   - Email & OTPCode match.
   - Not expired.
   - `Used = FALSE`.
6. On success:
   - Marks OTP row as `Used = TRUE`.
   - Proceeds to profile lookup/creation, same as Google flow.
7. A scheduled cleanup job removes expired OTP rows older than `OTP_Cleanup_Days`. 

### 3.3 Member Profile & ID Rules

#### 3.3.1 MemberID Generation (A0001–A9999)

Membership Master uses `MemberID` values like `A0001`, `A0201`, `A0666`, etc. [file:4]

When creating a **new member** (email not found in Membership Master):

- The system:
  - Scans all existing `MemberID` values in the sheet.
  - Parses the numeric part after `A`.
  - Finds the **first unused integer from 1 to 9999**.
  - Formats it as 4 digits (e.g., 1 → `A0001`, 201 → `A0201`, 666 → `A0666`).
- `Status` is set to `"not active"` until payment is approved. 

#### 3.3.2 FamilyID Generation (B001–B999)

Membership Master uses `FamilyID` values like `B003`, `B014`, `B052`, `B067`, etc. [file:4]

When a member sets or changes their account `Type` to `"Family"` and currently has no `FamilyID`:

- The system:
  - Scans all existing `FamilyID` values in the sheet.
  - Parses the numeric part after `B`.
  - Finds the **first unused integer from 1 to 999**.
  - Formats it as 3 digits (e.g., 1 → `B001`, 36 → `B036`, 76 → `B076`).
- The generated `FamilyID` is stored on that member’s row.
- Future family members can be linked to that `FamilyID` by admins or future “My Family” flows. 

#### 3.3.3 Profile Retrieval

After authentication:

1. Lookup member by email in `Membership-Master-Main-3`. [file:4]
2. If found, load:
   - `MemberID`, `Status`, `Expiration`.
   - `Email`, `First Name`, `Last Name`, `Type`, `FamilyID`, `Gender`, `WeChatID`, `District`.
   - Existing payment fields like `Membership Fee Paid`, `Payment Date`, `Payment Transaction`, `Created`. [file:4]
3. If not found:
   - Create a new member row per 3.3.1 with:
     - `MemberID` = first free `A0001–A9999`.
     - `Status = "not active"`.
     - `Type = "Individual"`.
     - `FamilyID` blank.
     - `JoinYear` auto-set to the current year (but editable later).
4. Augment with additional fields (Section 4.1).

#### 3.3.4 Profile Editing

Members can edit:

- `FirstName`, `LastName` (optional).
- `PhoneNumber` (new column).
- `WeChatID`.
- `District`.
- `JoinYear` (string `YYYY`, overriding auto-computed value).

On save:

- Frontend sends a typed JSON payload including `MemberID` and updated fields.
- Backend updates the matching row and sets `ProfileLastUpdated` to current timestamp. [file:4]

#### 3.3.5 Family Semantics at Renewal

- `Type = "Family"` and non-blank `FamilyID` indicate that the membership applies to all members sharing that `FamilyID`. [file:4]
- When a **family** membership renewal is approved, the system updates `Expiration` for all rows with that `FamilyID`. [file:4]
- ID generation (3.3.2) ensures new families use the first unused `B001–B999`.

### 3.4 Membership Payment Flow (Member View)

#### 3.4.1 Payment Methods & Config

App supports external payment methods with reconciliation from Gmail: 

- Zelle
- Venmo
- PayPal

Values in `Config` sheet: 

- `Individual_Price` (default `30`).
- `Family_Price` (default `50`).
- `Payment_Methods` (e.g., `Zelle,Venmo,PayPal`).
- `Membership_Renewal_Years` (default `1`).
- `Reminder_Days_Before` (e.g., `30`).

No prices or gateways are hard-coded; all retrieved via Config.

#### 3.4.2 Member Renewal Submission

After paying externally, member fills a “Confirm Payment” form:

Fields:

- `membershipType`: `Individual` or `Family`.
- `amount`: prefilled from `Config` but editable (for exceptions).
- `paymentMethod`: from `Payment_Methods`.
- `payerName`: required (e.g., bank account display name).
- `memoField`: member’s transfer memo, ideally containing their MemberID or name.
- `last4Digits`: optional last 4 digits of transaction number.
- `screenshot`: optional upload (stored in Drive, URL captured).
- Optionally, `familyMemberEmails[]` to notify or link.

Frontend builds JSON:

```json
{
  "requestId": "uuid",
  "actorEmail": "member@example.com",
  "payload": {
    "eventType": "MembershipRenewal",
    "memberId": "A0201",
    "email": "member@example.com",
    "membershipType": "Individual",
    "amount": 30,
    "paymentMethod": "Zelle",
    "payerName": "Cathy Lin",
    "memoField": "A0201 2026 membership",
    "last4Digits": "1234",
    "screenshotUrl": "https://drive.google.com/...",
    "familyMemberEmails": []
  }
}
```

This is passed as a string to `submitRenewalRequest(jsonRequest: string)`.

Backend:

- Inserts a row into `WebApp-Events` with:
    - `EventType = "MembershipRenewal"`.
    - `Status = "Pending"`.
    - `PayloadJSON` containing the membership renewal payload.
    - `MemberID`, `Email`, `Timestamp`.
- Logs an entry into `WebApp-ActivityLog` with action `"RENEWAL_SUBMIT"`.

Member sees a confirmation message and instructions that approval will follow once payment is verified.

---

## 4. Data Model – Google Sheets

### 4.1 Membership Master

Sheet: `Membership-Master-Main-3` (existing). 

Existing key columns:

- `MemberID` (`A0001`…`Axxxx`).
- `Status` (`active` / `not active`).
- `Created`.
- `Expiration`.
- `Email`.
- `First Name`, `Last Name`.
- `Type` (`Individual` / `Family`).
- `FamilyID` (`Bxxx`).
- `Gender`.
- `WeChatID`.
- `District`.
- `WebApp`.
- `Payment CheckInfo`.
- `Last Updated`.
- `Membership Fee Paid`.
- `Payment Date`.
- `Payment Transaction`. 

New columns appended:

- `JoinYear`:
    - String `YYYY`, initially derived from earliest known membership year but can be overridden.
- `PhoneNumber`:
    - Free-text phone.
- `LastLoginDate`:
    - Last successful login timestamp.
- `ProfileLastUpdated`:
    - Timestamp of last profile update.
- `Notes`:
    - Admin or system notes.


### 4.2 WebApp-Events

A generic log for all structured web-submissions (membership renewals, future race registrations, etc.). [file:3]

Columns:

- `EventID`:
    - Unique id `EV-[timestamp]-[random]`.
- `EventType`:
    - `MembershipRenewal`, `MembershipSignup`, `RaceRegistration`, etc.
- `Timestamp`.
- `MemberID`.
- `Email`.
- `PayloadJSON`:
    - Serialized JSON of the event payload.
- `Status`:
    - `Pending`, `Matched`, `Approved`, `Rejected`, `Error`.
- `MatchedMessageId`:
    - From Fetch-Gmail `MessageId` when matched. 
- `MatchedTransactionNumber`.
- `AdminApprover`.
- `ApprovalDate`.
- `Notes`.


### 4.3 Payment-History

Canonical payments table for membership and other fees. 

Columns:

- `PaymentID`.
- `EventID`:
    - If derived from WebApp event.
- `EventType`:
    - `MembershipRenewal`, `Donation`, `RaceFee`, etc.
- `MemberID`.
- `PaymentDate`.
- `Amount`.
- `MembershipType`:
    - `Individual` or `Family` for membership events.
- `PaymentMethod`:
    - `Zelle`, `Venmo`, `PayPal`, `Check`, etc.
- `PayerName`.
- `MemoField`.
- `Last4Digits`.
- `TransactionReference`:
    - TransactionNumber from Gmail sheet if applicable. 
- `PeriodStart`, `PeriodEnd`:
    - Membership coverage dates.
- `ProcessedBy`:
    - `System` or admin email.
- `ProcessedDate`.
- `Source`:
    - `WebApp`, `Gmail-Auto`, `Manual-Admin`.
- `Notes`.


### 4.4 Membership-History

Historical record of membership coverage per member and year. 

Columns:

- `HistoryID`.
- `MemberID`.
- `MembershipYear`:
    - `YYYY`.
- `Type`:
    - `Individual` or `Family`.
- `FamilyID`:
    - `Bxxx` if part of a family. [file:4]
- `StartDate`.
- `EndDate`.
- `Status`:
    - `Active`, `Expired`, `Cancelled`.
- `PaymentID`.
- `CreatedBy`.
- `CreatedDate`.
- `Notes`.

Batch scripts can retro-fill this from existing Membership Master and Fetch-Gmail payment data.

### 4.5 Auth-OTP

Manages login OTP codes. 

Columns:

- `Email`.
- `OTPCode`.
- `CreatedAt`.
- `ExpiresAt`.
- `Used` (TRUE/FALSE).
- `IPAddress` (optional).


### 4.6 Config

Key-value configuration. 

Columns:

- `Key`.
- `Value`.
- `Description`.

Initial keys:

- `Individual_Price` → `30`.
- `Family_Price` → `50`.
- `Payment_Methods` → `Zelle,Venmo,PayPal`.
- `Membership_Renewal_Years` → `1`.
- `Reminder_Days_Before` → `30`.
- `OTP_Valid_Hours` → `24`.
- `OTP_Cleanup_Days` → `7`.
- `Admin_Emails` → `admin1@mmrunners.org,...`.
- `App_Base_Url` → GAS deployment URL.


### 4.7 WebApp-ActivityLog

Detailed audit log for debugging.

Columns:

- `LogID`.
- `Timestamp`.
- `SessionID`.
- `MemberID`.
- `Email`.
- `EventID` (optional).
- `Action`:
    - `LOGIN_START`, `LOGIN_SUCCESS`, `OTP_REQUESTED`, `OTP_VERIFY_SUCCESS`, `OTP_VERIFY_FAIL`, `RENEWAL_FORM_OPEN`, `RENEWAL_SUBMIT`, `RECONCILE_MATCH_FOUND`, `RENEWAL_APPROVED`, `ERROR`, etc.
- `State` (JSON snippet, truncated).
- `ErrorCode` (optional).
- `ErrorMessage` (optional, truncated).


### 4.8 Fetch-Gmail Data (Existing)

Existing sheet with imported email data from Gmail. 

Key columns:

- `TimeStamp`.
- `Sender`.
- `Amount`.
- `Memo`.
- `TransactionDate`.
- `TransactionNumber`.
- `MessageId`.
- `Subject`.
- `Original Memo`.
- `Notes`.
- `Processed`.
- `Source` (`Zelle`, `Venmo`, `PayPal`, etc.).

New column:

- `WebAppEventID`:
    - Links each matched payment to the originating `WebApp-Events.EventID`.

---

## 5. API Design \& Module Structure

### 5.1 API Envelope

```ts
interface ApiRequest<T> {
  requestId: string;
  actorEmail?: string;
  payload: T;
}

interface ApiResponseSuccess<T> {
  ok: true;
  requestId: string;
  payload: T;
}

interface ApiResponseError {
  ok: false;
  requestId: string;
  errorCode: string;
  errorMessage: string;
  details?: unknown;
}
```

All exported Apps Script functions:

- Accept `jsonRequest: string` containing `ApiRequest<T>`.
- Return `string` containing `ApiResponseSuccess<T>` or `ApiResponseError`.


### 5.2 Backend Modules

`src/config.ts`:

- Spreadsheet ID and sheet names (Membership Master, WebApp-Events, etc.).
- Column indices as enums/objects (no magic numbers).
- Functions: `getConfigMap`, `getConfigValue`, `setConfigValue`. 

`src/types.ts`:

- `Member`, `MembershipRenewalPayload`, `WebAppEvent`, `PaymentRecord`, `MembershipHistoryRecord`, `OtpRecord`, `ConfigMap`, `ActivityLogEntry`.

`src/sheets.ts`:

- Utilities to:
    - Read ranges and map to typed objects.
    - Write/update rows by key (e.g., MemberID).

`src/auth.ts`:

- `handleGoogleLogin(jsonRequest: string): string`.
- `requestEmailOtp(jsonRequest: string): string`.
- `verifyEmailOtp(jsonRequest: string): string`.
- Uses `Auth-OTP`, Membership Master, and ActivityLog.

`src/members.ts`:

- `getOrCreateMemberProfile(jsonRequest: string): string`.
- `updateMemberProfile(jsonRequest: string): string`.
- Helpers to compute first unused MemberID and FamilyID based on numeric ranges and existing rows.

`src/renewal.ts`:

- `submitRenewalRequest(jsonRequest: string): string`.
- `reconcileWebAppWithGmail(jsonRequest?: string): string`.
- `approveRenewal(jsonRequest: string): string`.

`src/admin.ts`:

- `getPendingEvents(jsonRequest: string): string`.
- `getUnmatchedPayments(jsonRequest: string): string`.
- `getConfig(jsonRequest: string): string`.
- `updateConfigEntry(jsonRequest: string): string`.

`src/ui.ts`:

- `doGet(e)` to serve `index.html` via `HtmlService`.
- Optionally injects minimal config flags and CSRF/session data.

---

## 6. Membership Renewal \& Reconciliation

### 6.1 Membership Renewal Calculation

When a membership renewal is **approved**:

1. Load member row(s) from Membership Master using `MemberID`. 
2. Read `Expiration` as current expiration date.
3. Read `Membership_Renewal_Years` from `Config` (typically `1`). 
4. Compute:
    - `candidateExpiration = today + N years`.
    - `newExpiration = max(candidateExpiration, currentExpiration)` to avoid shortening active memberships.
5. If `membershipType = "Individual"`:
    - Update that member’s `Expiration` to `newExpiration`.
6. If `membershipType = "Family"`:
    - Determine `FamilyID` for the paying member.
    - Update `Expiration` for all members with this `FamilyID`. 
7. Update:
    - Membership Master fields:
        - `Membership Fee Paid`, `Payment Date`, `Payment Transaction`, `Last Updated`.
    - `Payment-History` row tying back to Event and possibly Fetch-Gmail.
    - `Membership-History` entry (one or multiple rows) with coverage period and `MembershipYear`.
8. Notify member(s) by email and/or show confirmation in UI.

### 6.2 Reconciliation with Fetch-Gmail

1. From `WebApp-Events`, get `MembershipRenewal` events where `Status = "Pending"` or `"Matched"`. [file:3]
2. From `Fetch-Gmail`, read payment rows where `Processed` is blank/false. [file:3]
3. For each WebApp event:
    - If a TransactionNumber was captured from the user:
        - Try exact match on `TransactionNumber` and `Amount`.
    - Else, attempt fuzzy matching based on:
        - `Amount`.
        - `Source` vs `paymentMethod` (Zelle/Venmo/PayPal). 
        - Date window (e.g., ±3 days of event timestamp).
        - Similarity between `payerName` and `Sender`.
        - Presence of `MemberID` or member name in `Memo` or `Original Memo`. [file:3]
4. On good match:
    - Update `WebApp-Events`:
        - `Status = "Matched"`.
        - `MatchedMessageId = MessageId`.
        - `MatchedTransactionNumber = TransactionNumber`.
    - Update Fetch-Gmail row:
        - `Processed = TRUE`.
        - `WebAppEventID = EventID`.
    - Log `"RECONCILE_MATCH_FOUND"` activity.
5. Approval:
    - Admin or system calls `approveRenewal` for matched events.
    - Membership periods and history are updated (6.1).
    - `WebApp-Events.Status = "Approved"`.
    - Activity log entry `"RENEWAL_APPROVED"`.
6. If no match is found:
    - Keep status `Pending` or set to `Error` with explanation.
    - Expose such events to admins for manual tie-out.

---

## 7. Frontend Requirements

### 7.1 Structure

Single-page app with primary views:

- Login.
- Dashboard.
- Profile.
- Membership Renew.
- Admin (for users in `Admin_Emails`). 


### 7.2 Login View

- Buttons:
    - “Sign in with Google”.
    - “Sign in with Email Code (OTP)”.
- OTP path:
    - Email field + “Send Code”.
    - Code entry field.
- Show error messages for invalid/expired OTP; log `OTP_VERIFY_FAIL`.


### 7.3 Dashboard

Shows:

- Member name.
- `MemberID`, `FamilyID` (if any), `Type`.
- `Status` and `Expiration`, color-coded (expired/expiring soon).
- `JoinYear`.
- Buttons:
    - “Update Profile”.
    - “Renew Membership”.


### 7.4 Profile View

Fields:

- First Name, Last Name.
- Email (read-only).
- PhoneNumber.
- WeChatID.
- District.
- JoinYear (editable).

Backend call: `updateMemberProfile`, with optimistic UI update once successful.

### 7.5 Renewal View

- Read prices and methods from `Config`. 
- Let user select:
    - `Individual` vs `Family`.
    - Payment method (Zelle, Venmo, PayPal).
- Show instructions:
    - Where to send payment.
    - How to fill memo (e.g., include MemberID and name).
- Display form for payer details (see 3.4.2).
- On submit:
    - Disable button and show spinner.
    - Call `submitRenewalRequest`.
    - Show confirmation message if response is `ok`.


### 7.6 Admin View

Admins (emails in `Admin_Emails`): [file:2]

- Tab: “Pending Membership Events”
    - List `WebApp-Events` membership renewals with `Status` in `Pending`/`Matched`.
    - Show member info, payload details, any matched payment.
    - Buttons:
        - Approve (calls `approveRenewal`).
        - Reject (sets `Status = "Rejected"` and adds a note).
- Tab: “Unmatched Payments”
    - Show Fetch-Gmail rows with `Processed = FALSE`.
    - Admin can manually link to a MemberID and/or EventID.
- Tab: “Config”
    - Show key/value pairs from `Config`.
    - Allow editing via `updateConfigEntry`.
    - All changes logged in `WebApp-ActivityLog`.

---

## 8. Testing \& Documentation

### 8.1 Testing

Use Jest + ts-jest for unit and integration tests.

Unit tests:

- Config:
    - Correct parsing of Config, defaults, and updates.
- ID generation:
    - `MemberID` generator properly finds first unused `A0001–A9999` given holes in the sequence. [file:4]
    - `FamilyID` generator properly finds first unused `B001–B999`. 
- OTP:
    - OTP validity window and `Used` flag.
- Renewal logic:
    - Expiration extension across multiple years and across all family members sharing `FamilyID`. 

Integration tests (using mocked sheets):

- New member registration:
    - Non-existing email receives new `MemberID` and `Status = "not active"`.
- Membership renewal:
    - From WebApp-Events membership renewal + matched Fetch-Gmail row → Payment-History + Membership-History + updated Expiration.
- Admin config updates:
    - `updateConfigEntry` writes to sheet and the new value is reflected in future calls.


### 8.2 Documentation

Add markdown files in `docs/`:

- `architecture.md`:
    - Overview of GAS + TypeScript + CLASP flow.
- `data-model.md`:
    - Column-level documentation for all sheets described in Section 4.
- `api-contract.md`:
    - Each exported Apps Script function, request/response JSON examples.
- `workflows.md`:
    - Plain-language steps for login, profile, family, renewal, and reconciliation flows.
- `deployment.md`:
    - CLASP setup, build commands, deployment steps, and environment configuration.

---

## 9. CLASP Setup \& Implementation Plan

### 9.1 CLASP \& Project Setup

1. Create Apps Script project bound to the spreadsheet that contains Membership Master and related sheets. [file:4]
2. Install CLASP locally and login. [web:12]
3. In project repo:
    - Initialize `.clasp.json` with `rootDir: "dist"`.
    - Configure `tsconfig.json` with:
        - `outDir: "dist"`.
        - `"types": ["google-apps-script"]`.
4. Build \& deploy:

```bash
npm run build
clasp push
clasp deploy --description "MMR Membership MVP"
```

5. Update `Config.App_Base_Url` with web app deployment URL. 

### 9.2 Implementation Steps for Claude Code

1. Scaffold repo:
    - `src/`, `tests/`, `docs/`, `frontend/`, `dist/`.
    - Base configs (`tsconfig`, `jest.config`, `package.json`, `.clasp.json`).
2. Implement `types`, `config`, `sheets`.
3. Implement `auth` (Google + OTP) and tie into Membership Master. 
4. Implement `members` (profile retrieval, new member creation, profile update, ID generation).
5. Implement `renewal` (submission, reconciliation, approval) using WebApp-Events, Payment-History, Membership-History, and Fetch-Gmail.
6. Implement `admin` functions including config management and listing pending events/unmatched payments.
7. Build frontend screens tied to backend APIs.
8. Add tests and write initial docs described in Section 8.