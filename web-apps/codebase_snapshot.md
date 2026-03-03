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
## File: `PRD.md`
---

```markdown
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
```


---
## File: `PRDv2.md`
---

```markdown
# Misty Mountain Runners Membership Web App — Product Requirements Document

_Last updated: 2026-03-02 (rev 2)_

---

## 1. Product Overview & Goals

### 1.1 Objective

Build a membership web application for Misty Mountain Runners that:

- Manages member authentication (Google OAuth + email OTP).
- Displays and updates member profiles and family groupings.
- Handles membership renewals paid externally (Zelle, Venmo, PayPal).
- Matches bank/payment emails (from Gmail) to members.
- Maintains clean Payment History for reporting.

The app runs on **Google Apps Script (GAS)** with Google Sheets as the data store, managed via **CLASP** and GitHub.

### 1.2 Scope — Phase 1 (MVP)

In scope:
- Authentication: Google OAuth for Gmail users, email OTP for non-Gmail users.
- Member self-service: view status/expiration, edit profile, view/override JoinYear.
- Membership payments: external payment via Zelle/Venmo/PayPal, member submits payment details, admin approves.
- Data integration: Membership Master as source of truth; Fetch-Gmail payment data for reconciliation.
- Logging: detailed activity log for debugging and audit.

Non-goals for MVP:
- NYRR leaderboard/ranking, training plans, discount codes.
- Event registration beyond membership fees.
- Screenshot/file upload for payment confirmation.

---

## 2. Tech Stack & Architecture

### 2.1 Tech Stack

- **Backend**: Google Apps Script (GAS), deployed as a web app.
- **Frontend**: HTML/CSS + vanilla JavaScript, served via `HtmlService`. Multi-template approach (separate HTML per view).
- **Data Store**: Google Sheets:
  - `Membership-Master-Main-3` (existing) as primary member database.
  - New sheets: WebApp-Events, Payment-History, Auth-OTP, Config, WebApp-ActivityLog.
  - Existing Fetch-Gmail sheet for Zelle/Venmo/PayPal payment data.
- **Language & Tooling**:
  - TypeScript with `strict: true`.
  - Build via `tsc` to `dist/` directory.
  - CLASP's `rootDir` points to `dist/` for `clasp push`.
- **Version Control**: GitHub repository, deployed via CLASP.

### 2.2 Architectural Principles

- **Separation of concerns**: backend handles business logic and persistence; frontend calls backend via typed API functions.
- **API contract**: all frontend-to-backend communication uses JSON strings. Every exposed GAS function has signature: `functionName(jsonRequest: string): string`.
- **No magic numbers**: all pricing, timing, and config values read from Config sheet.
- **Multiple small `.ts` files** instead of one large file, organized by layer.
- **Existing IDs preserved**: FamilyID (`Bxxx`) and MemberID (`Axxxx`) — no new ID systems.

### 2.3 GAS-Specific Constraints

- All functions exposed to frontend must be in global scope (GAS does not support ES modules at runtime).
- TypeScript compiles to JS files that CLASP pushes. Use a bundler or manual global exports.
- `HtmlService.createHtmlOutputFromFile()` serves each template. Routing via `?page=` query parameter in `doGet(e)`.
- `google.script.run` on the frontend calls server functions. Use `withSuccessHandler` / `withFailureHandler`.

### 2.4 GAS Iframe Navigation (Important)

GAS web apps are served inside a **cross-origin iframe** (at `script.googleusercontent.com`). This creates two navigation constraints:

1. **Relative URLs are wrong**: `window.location.href = '?page=dashboard'` resolves against the inner iframe's domain (`googleusercontent.com`), not the GAS app URL. Always use absolute URLs: `window.top.location.href = appBaseUrl + '?page=dashboard'`.

2. **`window.top` requires user gesture**: The iframe sandbox has `allow-top-navigation-by-user-activation`. Calling `window.top.location.href` from an async callback (e.g., after `google.script.run` success) fails with "no user activation". **Solution**: after async auth success, show a "Continue →" button; navigate from the button's click handler (a genuine user gesture).

3. **`appBaseUrl` injection**: `doGet` injects the real GAS URL server-side by replacing the placeholder `__SCRIPT_URL__` with `ScriptApp.getService().getUrl()` before serving each HTML template. This gives every page the correct absolute base URL at load time without any async calls.

---

## 3. User Roles & Core Flows

### 3.1 Roles

- **Member**: club runner or family member. Can log in, view/update profile, submit membership renewals, view status.
- **Admin**: board/operations volunteers. Approve payments, adjust Config, monitor events and activity logs.
- **System**: background/reconciliation scripts that auto-match payments and update history.

### 3.2 Authentication Flows

#### 3.2.1 Google OAuth Login

Target: members with `@gmail.com` email (~65%).

Flow:
1. User chooses "Sign in with Google".
2. GAS uses `Session.getActiveUser().getEmail()` (requires deploying as "Execute as: User accessing the web app").
3. If email is `@gmail.com`, treat as authenticated.
4. Look up email in Membership Master:
   - **Found (returning member)** → update `LastLoginDate`, return `{ member, isNewMember: false }`. Frontend stores member in `sessionStorage`, shows "Welcome back, [name]!" with "Continue to Dashboard →" button.
   - **Not found (new member)** → return `{ isNewMember: true, email }` (**do not create a record yet**). Frontend stores `pending_email` in `sessionStorage`, shows "Register as New Member →" button → routes to `/newmember` page.

#### 3.2.2 Email OTP Login

Target: non-Gmail users (Yahoo, Hotmail, QQ, corporate, etc.).

Flow:
1. User enters email, selects "Login via Email Code".
2. System generates 6-digit OTP, reads `OTP_Valid_Hours` (default 24) from Config.
3. Writes row to `Auth-OTP`: Email, OTPCode, CreatedAt, ExpiresAt, Used=FALSE.
4. Sends OTP via `MailApp.sendEmail`.
5. User enters OTP on site.
6. System verifies: matching Email+OTPCode, not expired, not Used.
7. If valid: mark Used=TRUE. Look up email in Membership Master:
   - **Found** → same returning-member path as Google OAuth above.
   - **Not found** → same new-member path as Google OAuth above.
8. Cleanup: scheduled script deletes OTP rows older than `OTP_Cleanup_Days` (default 7).

**Key design note**: Auth functions (`handleGoogleLogin`, `verifyEmailOtp`) never auto-create member records. Record creation happens only when the user explicitly submits the New Member registration form (`createNewMember`). This prevents ghost/incomplete records.

**Post-auth navigation**: both auth flows show a "Continue" button rather than navigating automatically. This is required because async API callbacks do not have user activation, and `window.top.location.href` (needed to break out of the GAS iframe) requires a user gesture (see §2.4).

### 3.3 Member Profile & Family Flows

#### 3.3.1 Profile Retrieval

After auth:
1. Query Membership Master by email.
2. If found, load: MemberID, Status, Expiration, Email, First Name, Last Name, Type, FamilyID, Gender, WeChatID, District, Membership Fee Paid, Payment Date, Payment Transaction, Created, JoinYear, PhoneNumber, LastLoginDate, ProfileLastUpdated.
3. Optionally show family members with the same FamilyID.
4. If not found: create new row with new MemberID, Status="not active", Type="Individual", JoinYear=current year (editable). Prompt to complete profile.

#### 3.3.2 Profile Editing

Members can update: First Name, Last Name, PhoneNumber, WeChatID, District, JoinYear.

Changes are validated on frontend, sent as JSON to backend, which updates Membership Master and sets ProfileLastUpdated.

#### 3.3.3 Family Handling

- Existing FamilyID (`Bxxx`) and MemberID (`Axxxx`) semantics preserved.
- If member has Type="Family" or non-blank FamilyID: family renewals apply to all members with that FamilyID.
- MVP: read FamilyID from Membership Master, apply renewals across family. No UI for managing family members yet.

### 3.4 Membership Payment Flow (Member View)

#### 3.4.1 Payment Instructions

Prices and methods from Config (not hard-coded):
- `Individual_Price` (default 30), `Family_Price` (default 50).
- `Payment_Methods` (default "Zelle,Venmo,PayPal").

Flow:
1. Member goes to "Renew Membership".
2. System shows membership type options (Individual/Family) and payment methods from Config.
3. Member selects type and method.
4. App displays instructions: pay outside the app, include MemberID and name in memo, then come back to confirm.

#### 3.4.2 Renewal Submission

After paying externally, member fills "Confirm Payment" form:

- Membership Type: Individual or Family.
- Amount: pre-filled from Config, editable.
- Payment Method: Zelle/Venmo/PayPal.
- Payer Name: required.
- Memo Field: required.
- Last 4 Digits: optional but recommended.

On submit:
1. Frontend calls `submitRenewalRequest(jsonRequest)`.
2. Backend writes row to WebApp-Events with Status="Pending".
3. Logs activity entry with action "RENEWAL_SUBMIT".
4. Member sees confirmation message.

---

## 4. Data Model — Google Sheets

### 4.1 Membership Master (Existing)

Sheet: `Membership-Master-Main-3`

Existing columns: MemberID (Axxxx), Status (active/not active), Created, Expiration, Email, First Name, Last Name, Type (Individual/Family), FamilyID (Bxxx), Gender, WeChatID, District, WebApp, Payment CheckInfo, Last Updated, Membership Fee Paid, Payment Date, Payment Transaction.

New columns (append at end):
- `JoinYear` (string YYYY) — auto-derived from earliest membership year or Created date; member can override.
- `PhoneNumber` (string).
- `LastLoginDate` (datetime).
- `ProfileLastUpdated` (datetime).
- `Notes` (string).

### 4.2 WebApp-Events (Membership Submissions)

Sheet: `WebApp-Events`

Purpose: log of membership renewal/signup submissions via the web app.

Columns (flat, membership-specific):
- `EventID`: unique id (`EV-[timestamp]-[random]`).
- `EventType`: `"MembershipRenewal"` or `"MembershipSignup"`.
- `Timestamp`: submission time.
- `MemberID`: submitter's MemberID.
- `Email`: submitter email.
- `MembershipType`: `"Individual"` or `"Family"`.
- `Amount`: numeric.
- `PaymentMethod`: `"Zelle"`, `"Venmo"`, or `"PayPal"`.
- `PayerName`: string.
- `MemoField`: string.
- `Last4Digits`: string (optional).
- `FamilyMemberEmails`: comma-separated (optional).
- `Status`: `"Pending"`, `"Matched"`, `"Approved"`, `"Rejected"`, `"Error"`.
- `MatchedMessageId`: MessageId from Fetch Gmail if matched.
- `MatchedTransactionNumber`: TransactionNumber from Fetch Gmail if matched.
- `AdminApprover`: admin email who approved.
- `ApprovalDate`: approval time.
- `Notes`: string.

### 4.3 Payment-History

Sheet: `Payment-History`

Purpose: canonical log of all processed payments.

Columns:
- `PaymentID`: unique id.
- `EventID`: link to WebApp-Events.EventID (if web-driven).
- `MemberID`: primary member.
- `PaymentDate`: date payment is accounted.
- `Amount`: numeric.
- `MembershipType`: `"Individual"` or `"Family"`.
- `PaymentMethod`: `"Zelle"`, `"Venmo"`, `"PayPal"`, `"Check"`, etc.
- `PayerName`: from bank/submitter.
- `MemoField`: original memo.
- `Last4Digits`: last four of transaction number.
- `TransactionReference`: TransactionNumber from Gmail sheet.
- `PeriodStart`: membership period start.
- `PeriodEnd`: membership period end.
- `ProcessedBy`: `"System"` or admin email.
- `ProcessedDate`: datetime when row was created.
- `Source`: `"WebApp"`, `"Gmail-Auto"`, `"Manual-Admin"`.
- `Notes`: string.

### 4.4 Auth-OTP

Sheet: `Auth-OTP`

Columns: Email, OTPCode, CreatedAt, ExpiresAt, Used (boolean), IPAddress (optional).

Cleanup: scheduled script deletes rows where CreatedAt > OTP_Cleanup_Days.

### 4.5 Config

Sheet: `Config`

Columns: Key, Value, Description.

Initial keys:
- `Individual_Price` → `30`
- `Family_Price` → `50`
- `Payment_Methods` → `Zelle,Venmo,PayPal`
- `Reminder_Days_Before` → `30`
- `Membership_Renewal_Years` → `1`
- `OTP_Valid_Hours` → `24`
- `OTP_Cleanup_Days` → `7`
- `Admin_Emails` → `admin1@mmrunners.org,admin2@mmrunners.org`
- `App_Base_Url` → `https://script.google.com/...`

### 4.6 WebApp-ActivityLog

Sheet: `WebApp-ActivityLog`

Purpose: detailed step-by-step log for debugging and analytics.

Columns:
- `LogID`: unique id.
- `Timestamp`
- `SessionID`: random per-browser-session.
- `MemberID`: if known.
- `Email`: if known.
- `EventID`: if tied to a WebApp-Events row.
- `Action`: short code — `"LOGIN_START"`, `"LOGIN_SUCCESS"`, `"OTP_REQUESTED"`, `"OTP_VERIFY_SUCCESS"`, `"OTP_VERIFY_FAIL"`, `"RENEWAL_FORM_OPEN"`, `"RENEWAL_SUBMIT"`, `"RECONCILE_MATCH_FOUND"`, `"RENEWAL_APPROVED"`, `"ERROR"`, etc.
- `State`: optional small JSON snapshot (no sensitive data).
- `ErrorCode`: optional.
- `ErrorMessage`: optional truncated error message.

Backend includes a helper `auditLog()` to append entries at critical steps.

### 4.7 Fetch Gmail Sheet (Existing)

Sheet: `Fetch-Gmail-data-in-Google-Spreadsheet-Active-4`

Existing columns: TimeStamp, Sender, Amount, Memo, TransactionDate, TransactionNumber, MessageId, Subject, Original Memo, Notes, Processed, Source (Zelle/Venmo/PayPal).

New column:
- `WebAppEventID`: links to WebApp-Events.EventID when matched.

---

## 5. API Design & Modules

### 5.1 Module Layout (Backend)

Source directory: `src/`

- **`config.ts`** — spreadsheet ID, sheet names, column indices (enums, no magic numbers). Functions: `getConfigMap()`, `getConfigValue(key)`, `setConfigValue(key, value)`.
- **`types.ts`** — shared interfaces: Member, WebAppEvent, PaymentRecord, OtpRecord, ConfigMap, ActivityLogEntry, ApiRequest<T>, ApiResponseSuccess<T>, ApiResponseError.
- **`sheets.ts`** — helpers for reading/writing rows, mapping rows ↔ typed objects.
- **`auth.ts`** — exposed: `handleGoogleLogin(jsonRequest)`, `requestEmailOtp(jsonRequest)`, `verifyEmailOtp(jsonRequest)`. Internals: OTP generation/validation, Membership Master lookup/creation, audit logging.
- **`members.ts`** — `getOrCreateMemberProfile(jsonRequest)`, `updateMemberProfile(jsonRequest)`.
- **`renewal.ts`** — member-facing: `submitRenewalRequest(jsonRequest)`. System/admin: `reconcileWebAppWithGmail(jsonRequest?)`, `approveRenewal(jsonRequest)`.
- **`admin.ts`** — `getPendingEvents(jsonRequest)`, `getUnmatchedPayments(jsonRequest)`, `updateConfigEntry(jsonRequest)`, `getConfig(jsonRequest)`.
- **`ui.ts`** — `doGet(e)`: reads `?page=` parameter, serves corresponding HTML template. Default page: login.
- **`logger.ts`** — `auditLog(action, details)` helper that appends to WebApp-ActivityLog.

All exposed functions: accept single `jsonRequest: string`, return `string` of JSON. Use `ApiRequest`/`ApiResponse` envelopes.

### 5.2 API Envelope Types

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

Frontend helper `callApi(functionName, payload)` wraps in ApiRequest, calls `google.script.run`, parses response.

---

## 6. Renewal & Reconciliation Algorithms

### 6.1 Renewal Calculation

When a renewal is approved:
1. Read member's current Expiration from Membership Master.
2. Read `Membership_Renewal_Years` from Config (usually 1).
3. Compute: `candidateExpiration = today + (years × 1 year)`.
4. `newExpiration = max(candidateExpiration, currentExpiration)` — never shorten active memberships.
5. For family membership: apply newExpiration to all members with same FamilyID.
6. Update Membership Master: Expiration, Membership Fee Paid, Payment Date, Payment Transaction, Last Updated.
7. Insert Payment-History row.
8. Notify member(s) via email.

### 6.2 Reconciliation with Fetch Gmail

Logic:
1. Load WebApp-Events where EventType="MembershipRenewal" and Status="Pending" or "Matched".
2. Load Fetch Gmail rows where Processed is blank or FALSE.
3. For each pending event:
   - If Last4Digits provided: search Gmail for matching TransactionNumber and Amount (exact match).
   - Otherwise fuzzy match: Amount match, PaymentMethod matches Source, date within ±3 days, PayerName ≈ Sender (case-insensitive), Memo/Original Memo contains MemberID or name.
4. If match found:
   - WebApp-Events: Status="Matched", set MatchedMessageId and MatchedTransactionNumber.
   - Fetch Gmail: Processed=TRUE, WebAppEventID=EventID.
   - Log: RECONCILE_MATCH_FOUND.
5. Admin or auto-job calls `approveRenewal` → applies renewal logic (6.1), writes Payment History, sets Status="Approved".
6. If no match: keep Pending or set Error. Expose in admin UI for manual linking.

---

## 7. Frontend — Multi-Template Views

### 7.1 Routing

`doGet(e)` reads `e.parameter.page` and serves the corresponding HTML file:
- No page / `login` → `login.html`
- `dashboard` → `dashboard.html`
- `profile` → `profile.html`
- `renewal` → `renewal.html`
- `admin` → `admin.html`

Each template includes shared CSS and the `callApi` helper via `HtmlService.createTemplateFromFile()`.

### 7.2 Login View (`login.html`)

- "Sign in with Google" button.
- "Sign in with Email Code" section: email input + "Send Code" button, then OTP input field.

### 7.3 Dashboard View (`dashboard.html`)

- Welcome message with name.
- MemberID, FamilyID, Type, Status.
- Expiration (color-coded: red if expired, yellow if within 30 days).
- JoinYear.
- Buttons: "Update Profile", "Renew Membership".

### 7.4 Profile View (`profile.html`)

Editable fields: First Name, Last Name, PhoneNumber, WeChatID, District, JoinYear. Email is view-only. Save button.

### 7.5 Renewal View (`renewal.html`)

- Membership type selector (Individual/Family) with prices from Config.
- Payment method selector from Config.
- Instructions for each payment method.
- Form: Payer Name, Memo, Last 4 Digits (optional).
- Submit button → confirmation message.

### 7.6 Admin View (`admin.html`)

Admin (email in `Admin_Emails` config) can:
- View pending membership submissions from WebApp-Events.
- For each: see member details, matched payment (if any), approve/reject with notes.
- View unmatched Fetch Gmail payments (Processed=FALSE).
- Edit Config entries.

---

## 8. Testing

### 8.1 Tooling

Jest + ts-jest + TypeScript.

### 8.2 Unit Tests

- `config.test.ts`: reading/writing Config.
- `sheets.test.ts`: mapping rows to Member, PaymentRecord, etc.
- `renewal.test.ts`: expiration calculation, family updates across FamilyID.
- `auth.test.ts`: OTP creation, expiry, verification.
- `members.test.ts`: profile creation, profile updates.

### 8.3 Integration Tests (mocked Sheets)

Full renewal scenario:
- Given: Membership Master row, WebApp-Events renewal, Fetch Gmail payment.
- Run: `reconcileWebAppWithGmail` → `approveRenewal`.
- Assert: Membership Master expiration updated, Payment-History row written, WebApp-Events status="Approved".

---

## 9. CLASP Setup & Implementation Plan

### 9.1 CLASP Setup

1. Create Apps Script project linked to the Google Sheet.
2. Install CLASP: `npm install -g @google/clasp && clasp login`.
3. In repo root: `clasp create --type webapp --title "MMRunners Membership" --rootDir dist`.
4. Configure `tsconfig.json`: `outDir: "dist"`, `strict: true`, `types: ["google-apps-script"]`.
5. Build and deploy: `npm run build && clasp push && clasp deploy`.
6. Update `Config.App_Base_Url` with deployment URL.

### 9.2 Implementation Steps

1. **Project setup**: directory structure (`src/`, `frontend/`, `tests/`), `tsconfig.json`, `package.json`, `jest.config.js`, `.clasp.json`.
2. **Types & Config**: `types.ts`, `config.ts`, `sheets.ts`.
3. **Auth module**: Google login + OTP in `auth.ts`.
4. **Members module**: profile retrieval/creation/update in `members.ts`.
5. **Renewal module**: `submitRenewalRequest`, reconciliation, `approveRenewal` in `renewal.ts`.
6. **Admin module**: pending events, unmatched payments, config CRUD in `admin.ts`.
7. **Logger**: `auditLog` helper in `logger.ts`.
8. **Frontend**: login, dashboard, profile, renewal, admin HTML templates.
9. **Tests**: unit + integration tests.

```


---
## File: `PRDv3.md`
---

```markdown
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


```


---
## File: `TODO.md`
---

```markdown
## bugs

- [ ] show sandglass icon waiting after returning user clicking "Continue"
- [ ] blank page. [MMR][renewal] goToStep2, method: Zelle type: Individual
- [ ] after clicking "Save Changes in profile, redirect to dashboard. now it stays in the profile page. 
- [ ] dashboard's Upgrade to Family Membership section, we actually ask users to change their membership type in the profile page. not about paying for the upgrade immediately.
- [ ] we have to remember an active member's type with confirmed payment. because a member can upgrade to family. 
- [ ] Update Profile doesn't have a membership type selection.
- [ ] payment options: Individual, Family, and Family Upgrade. 
- [ ] Admin Panel is not gated. anyone can access it by going to /admin. need to check if the user is in the admin email list.

## features

- [ ] add a page in member dashboard to let them upload their payment proof. We have a preset of events to confirm their payment. input fields include: amount, date, payer name, last 4 digits of confirmation code, payer notes, confirmation screenshot file upload (optional). make the events dropdown reads from a new Google Sheet Member-Portal file. Inside the sheet, we create a new tab called "Payment Confirmation Events". The columns include: Event Name, Description, and Confirmation Method. For example, for the event "Individual Membership" or "Family Membership", the description can be "Confirm your payment for membership renewal", and the confirmation method can be "Match with payment history". For the event "Upgrade to Family Membership", the description can be "Confirm your payment for upgrading to family membership", and the confirmation method can be "Match with payment history". no need for New Membership vs Renewal. The amount is the same. and the confirmation method can be "Match with payment history". For the event "Other Payment", the description can be "Confirm your other payments related to membership", and the confirmation method can be "Manual review".


- [ ] add a membership type selection in the profile page. and only show the payment options that are relevant to the user's current membership type.
- [ ] add a membership type selection in the renewal page. and only show the payment options that are relevant to the user's current membership type. for example, if the user is an individual member, we show the options for Individual and Family Upgrade. if the user is a family member, we only show the option for Family. 
- [ ] add a membership type column in the payment history sheet. and use it in the reconciliation process to improve the matching accuracy. 
- [ ] add



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
  let adminEmail = '';
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
        if (!events.length) { el.innerHTML = '<div class="empty-state">No pending renewals. 🎉</div>'; return; }
        el.innerHTML = events.map(function(ev) {
          var actionsHtml = '';
          if (ev.status !== 'Approved' && ev.status !== 'Rejected') {
            actionsHtml = '<input class="notes-input" id="notes-' + esc(ev.eventID) + '" placeholder="Notes (optional)" />' +
              '<div class="action-row">' +
              '<button class="btn btn-approve" onclick="approve(\'' + esc(ev.eventID) + '\')">✓ Approve</button>' +
              '<button class="btn btn-reject" onclick="reject(\'' + esc(ev.eventID) + '\')">✗ Reject</button>' +
              '</div>';
          } else {
            actionsHtml = '<div style="font-size:13px;color:#888;">Processed by ' + esc(ev.adminApprover) + ' on ' + esc(ev.approvalDate) + '</div>';
          }
          return '<div class="card" id="ev-' + esc(ev.eventID) + '">' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
            '<div><h3>' + esc(ev.payerName || 'Unknown') + ' &mdash; ' + esc(ev.paymentIntent) + ' $' + esc(ev.amount) + '</h3>' +
            '<div class="meta">' + esc(ev.eventID) + ' &bull; ' + new Date(ev.timestamp).toLocaleString() + ' &bull; ' + statusBadge(ev.status) + '</div></div></div>' +
            '<div class="detail-grid">' +
            '<div class="detail-item"><label>Member ID</label><span>' + esc(ev.memberID) + '</span></div>' +
            '<div class="detail-item"><label>Email</label><span>' + esc(ev.email) + '</span></div>' +
            '<div class="detail-item"><label>Payment Method</label><span>' + esc(ev.paymentMethod) + '</span></div>' +
            '<div class="detail-item"><label>Last 4 Digits</label><span>' + esc(ev.last4Digits || '—') + '</span></div>' +
            '<div class="detail-item"><label>Memo</label><span>' + esc(ev.memoField) + '</span></div>' +
            '<div class="detail-item"><label>Matched Transaction</label><span>' + esc(ev.matchedTransactionNumber || '—') + '</span></div>' +
            '</div>' + actionsHtml + '</div>';
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

  if (!adminEmail) {
    document.querySelector('.container').innerHTML =
      '<div class="card" style="text-align:center;padding:40px;">Not authorized. <a href="?page=login">Sign in</a></div>';
  } else {
    loadPending();
    loadUnmatched();
    loadPaymentProofs();
    loadConfig();
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
    .status-urgent    { background: #fdecea; color: #c62828; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .info-item label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.4px; display: block; margin-bottom: 2px; }
    .info-item span { font-size: 15px; color: #1a1a1a; font-weight: 500; }
    .expiry-date { font-size: 18px; font-weight: 700; }
    .expiry-date.expired  { color: #c62828; }
    .expiry-date.expiring { color: #f57c00; }
    .expiry-date.active   { color: #2d7d46; }
    .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 20px; }
    .btn { padding: 11px 20px; border-radius: 8px; border: none; font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-block; }
    .btn-primary   { background: #2d7d46; color: #fff; }
    .btn-primary:hover { background: #235f36; }
    .btn-secondary { background: #fff; color: #2d7d46; border: 1.5px solid #2d7d46; }
    .btn-secondary:hover { background: #f0f8f2; }
    .btn-admin     { background: #5c35a8; color: #fff; }
    .btn-admin:hover { background: #4a2b8a; }
    /* Payment History — outlined slate/grey ghost button */
.btn-ghost {
  background: #fff;
  color: #555;
  border: 1.5px solid #ccc;
}
.btn-ghost:hover {
  background: #f5f5f5;
  border-color: #aaa;
  color: #333;
}

    /* Profile confirm card */
    .profile-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; margin-bottom: 16px; }
    .profile-row label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.4px; display: block; margin-bottom: 2px; }
    .profile-row span { font-size: 14px; color: #1a1a1a; }
    .profile-row span.empty { color: #bbb; font-style: italic; }
    .profile-warning { background: #fff3e0; border: 1px solid #ffb74d; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #e65100; margin-bottom: 14px; }
    /* Family card */
    .family-list { list-style: none; }
    .family-list li { padding: 8px 0; border-bottom: 1px solid #f0f0f0; font-size: 14px; color: #333; }
    .family-list li:last-child { border-bottom: none; }
    .family-upgrade { color: #555; font-size: 14px; line-height: 1.6; margin-bottom: 14px; }
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
      <div class="info-grid" style="margin-bottom:0;">
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
      <div class="actions">
        <a href="?page=renewal" class="btn btn-primary">Renew Membership</a>
        <a href="#" id="paymentProofBtn" class="btn btn-secondary">Submit Payment Proof</a>
        <a href="#" id="paymentHistoryBtn" class="btn btn-ghost">Payment History</a>
        <a href="?page=admin" class="btn btn-admin" id="adminBtn" style="display:none;">Admin Panel</a>
      </div>
    </div>

    <!-- Profile confirmation card -->
    <div class="card" id="profileCard">
      <h2>Is your information correct?</h2>
      <div id="profileWarning" class="profile-warning" style="display:none;">
        Some fields are empty — please update your profile.
      </div>
      <div class="profile-grid" id="profileGrid"></div>
      <a href="?page=profile" class="btn btn-secondary">Update Profile</a>
    </div>

    <!-- Family card -->
    <div class="card" id="familyCard" style="display:none;">
      <h2 id="familyCardTitle">Family Members</h2>
      <div id="familyCardBody"></div>
    </div>

  </div>
</div>

<script>
  console.log('[MMR][dashboard] page script started, location:', window.location.href);
  var appBaseUrl = '__SCRIPT_URL__';
  console.log('[MMR][dashboard] appBaseUrl:', appBaseUrl);

  // Navigate all relative ?page= links through window.top with absolute URL
  document.addEventListener('click', function(e) {
    var a = e.target.closest('a[href]');
    if (a) {
      var h = a.getAttribute('href');
      if (h && h.charAt(0) === '?') {
        e.preventDefault();
        console.log('[MMR][dashboard] nav click to:', h);
        window.top.location.href = appBaseUrl + h;
      }
    }
  });

  // Sign-out: clear sessionStorage before navigating
  document.getElementById('signOutLink').addEventListener('click', function() {
    console.log('[MMR][dashboard] signing out, clearing sessionStorage');
    sessionStorage.removeItem('member');
  });

  const SESSION_ID = Math.random().toString(36).slice(2);
  let currentMember = null;

  function callApi(fn, payload) {
    console.log('[MMR][dashboard] callApi:', fn, JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      const req = { requestId: Math.random().toString(36).slice(2), payload };
      google.script.run
        .withSuccessHandler(r => {
          const res = JSON.parse(r);
          console.log('[MMR][dashboard]', fn, 'success:', JSON.stringify(res.payload || res));
          if (res.ok) resolve(res.payload);
          else reject(new Error(res.errorMessage));
        })
        .withFailureHandler(err => {
          console.error('[MMR][dashboard]', fn, 'failure:', err);
          reject(err);
        })
        [fn](JSON.stringify(req));
    });
  }

  function getDaysUntilExpiry(expirationStr) {
    if (!expirationStr) return -9999;
    const exp = new Date(expirationStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.floor((exp - today) / (1000 * 60 * 60 * 24));
  }

  function renderMember(member, familyMembers) {
    currentMember = member;
    console.log('[MMR][dashboard] renderMember memberID:', member.memberID, '| status:', member.status, '| type:', member.type);

    document.getElementById('welcomeName').textContent =
      'Welcome, ' + (member.firstName || member.email) + '!';
    document.getElementById('memberMeta').textContent =
      member.memberID + (member.familyID ? ' · Family ' + member.familyID : '');

    // ---- Status badge & expiry color ----
    const days = getDaysUntilExpiry(member.expiration);
    const badgeEl = document.getElementById('statusBadge');
    const expiryEl = document.getElementById('expiryDate');
    console.log('[MMR][dashboard] expiration:', member.expiration, '| days until expiry:', days);

    if (member.status === 'active' || member.status === 'Active') {
      if (days < 0) {
        badgeEl.textContent = 'Expired';
        badgeEl.className = 'status-badge status-urgent';
        expiryEl.className = 'expiry-date expired';
      } else if (days <= 7) {
        badgeEl.textContent = 'Expiring Very Soon';
        badgeEl.className = 'status-badge status-urgent';
        expiryEl.className = 'expiry-date expired';
      } else if (days <= 42) {
        badgeEl.textContent = 'Expiring Soon — within 6 weeks';
        badgeEl.className = 'status-badge status-expiring';
        expiryEl.className = 'expiry-date expiring';
      } else {
        badgeEl.textContent = 'Active';
        badgeEl.className = 'status-badge status-active';
        expiryEl.className = 'expiry-date active';
      }
    } else {
      badgeEl.textContent = 'Not Active';
      badgeEl.className = 'status-badge status-inactive';
      expiryEl.className = 'expiry-date expired';
    }

    expiryEl.textContent = member.expiration
      ? new Date(member.expiration).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : 'Not set';

    document.getElementById('joinYear').textContent = member.joinYear || '—';
    document.getElementById('memberType').textContent = member.type || '—';
    document.getElementById('district').textContent = member.district || '—';

    document.getElementById('paymentProofBtn').href = '?page=payment_proof&memberId=' + member.memberID;
    document.getElementById('paymentHistoryBtn').href = '?page=payment_history&memberId=' + member.memberID;

    // ---- Profile confirmation card ----
    renderProfileCard(member);

    // ---- Family card ----
    renderFamilyCard(member, familyMembers || []);

    // ---- Admin button (non-blocking) ----
    callApi('getConfig', { adminEmail: member.email, caller: 'dashboard-admin-check' })
      .then(() => {
        console.log('[MMR][dashboard] admin check: user IS admin');
        document.getElementById('adminBtn').style.display = 'inline-block';
      })
      .catch(err => {
        console.log('[MMR][dashboard] admin check: not admin or error:', err && err.message);
      });

    document.getElementById('loading').style.display = 'none';
    document.getElementById('content').style.display = 'block';
  }

  function renderProfileCard(member) {
    var fields = [
      { label: 'First Name',  value: member.firstName },
      { label: 'Last Name',   value: member.lastName },
      { label: 'Email',       value: member.email },
      { label: 'Phone',       value: member.phoneNumber },
      { label: 'WeChat ID',   value: member.wechatID },
      { label: 'District',    value: member.district },
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

  function renderFamilyCard(member, familyMembers) {
    var card = document.getElementById('familyCard');
    var body = document.getElementById('familyCardBody');
    var title = document.getElementById('familyCardTitle');
    var memberType = (member.type || '').trim();

    if (memberType === 'Individual' || !memberType) {
      // Offer upgrade CTA
      title.textContent = 'Upgrade to Family Membership';
      body.innerHTML = '';
      var p = document.createElement('p');
      p.className = 'family-upgrade';
      p.textContent = 'Add family members under one membership. Renew with a Family plan to get everyone covered.';
      var btn = document.createElement('a');
      btn.href = '?page=renewal';
      btn.className = 'btn btn-secondary';
      btn.textContent = 'Renew as Family →';
      body.appendChild(p);
      body.appendChild(btn);
      card.style.display = 'block';
    } else if (memberType === 'Family') {
      title.textContent = 'Family Members';
      body.innerHTML = '';
      // Other family members (exclude self)
      var others = (familyMembers || []).filter(function(fm) { return fm.memberID !== member.memberID; });
      if (others.length > 0) {
        var ul = document.createElement('ul');
        ul.className = 'family-list';
        others.forEach(function(fm) {
          var li = document.createElement('li');
          li.textContent = (fm.firstName || '') + ' ' + (fm.lastName || '') + ' (' + fm.memberID + ')';
          ul.appendChild(li);
        });
        body.appendChild(ul);
      } else {
        var p2 = document.createElement('p');
        p2.style.color = '#888';
        p2.style.fontSize = '14px';
        p2.textContent = 'You\'re on a Family plan. No linked family members yet.';
        body.appendChild(p2);
      }
      card.style.display = 'block';
    } else {
      card.style.display = 'none';
    }
  }

  // ---- Load member from sessionStorage or server ----
  const cached = sessionStorage.getItem('member');
  if (cached) {
    try {
      const m = JSON.parse(cached);
      console.log('[MMR][dashboard] loaded member from sessionStorage:', m.memberID);
      renderMember(m, []);
    } catch (e) {
      console.error('[MMR][dashboard] failed to parse cached member:', e);
    }
  }

  var memberEmail = '';
  if (cached) {
    try { memberEmail = JSON.parse(cached).email || ''; } catch (_) {}
  }
  console.log('[MMR][dashboard] calling getOrCreateMemberProfile with email:', memberEmail);

  callApi('getOrCreateMemberProfile', { email: memberEmail, sessionID: SESSION_ID })
    .then(function(data) {
      console.log('[MMR][dashboard] getOrCreateMemberProfile success, memberID:', data.member?.memberID);

      // ⚠️ Only trust the server result if memberID matches what's cached.
      // If they differ, the server resolved to the wrong account (e.g. admin@mmrunners.org).
      // In that case, keep the cached session and discard the server response.
      if (cached && data.member.memberID !== currentMember?.memberID) {
        console.warn('[MMR][dashboard] server returned different memberID (' + data.member.memberID +
          ') than cached (' + currentMember?.memberID + ') — ignoring server result.');
        return;
      }

      sessionStorage.setItem('member', JSON.stringify(data.member));
      renderMember(data.member, data.familyMembers);
    })
    .catch(function(err) {
      console.error('[MMR][dashboard] getOrCreateMemberProfile failed:', err.message);
      if (!cached) {
        var loadingEl = document.getElementById('loading');
        loadingEl.style.display = 'block';
        loadingEl.innerHTML = 'Session expired. <a href="?page=login" style="color:#2d7d46">Sign in again</a>';
      }
      // If we had cached member, we already rendered — don't blank the page
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
const SESSIONID = Math.random().toString(36).slice(2);
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
      sessionID:   SESSIONID,
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
## File: `frontend/page_renewal.html`
---

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Misty Mountain Runners — Renew Membership</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; min-height: 100vh; }
    .topbar { background: #2d7d46; color: #fff; padding: 14px 24px; display: flex; justify-content: space-between; align-items: center; }
    .topbar h1 { font-size: 18px; font-weight: 700; }
    .topbar a { color: #fff; text-decoration: none; font-size: 14px; opacity: 0.85; }
    .container { max-width: 560px; margin: 32px auto; padding: 0 16px; }
    .card { background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); padding: 28px; margin-bottom: 20px; }
    h2 { font-size: 18px; font-weight: 700; color: #1a1a1a; margin-bottom: 6px; }
    .field { margin-bottom: 18px; }
    label { display: block; font-size: 13px; font-weight: 600; color: #555; margin-bottom: 6px; }
    .radio-group { display: flex; gap: 12px; }
    .radio-option { flex: 1; border: 2px solid #e0e0e0; border-radius: 10px; padding: 14px; cursor: pointer; text-align: center; transition: border-color 0.2s; }
    .radio-option:hover { border-color: #2d7d46; }
    .radio-option.selected { border-color: #2d7d46; background: #f0f8f2; }
    .radio-option .opt-title { font-weight: 700; font-size: 15px; color: #1a1a1a; }
    .radio-option .opt-price { font-size: 20px; font-weight: 800; color: #2d7d46; margin: 4px 0; }
    .radio-option .opt-desc { font-size: 12px; color: #777; }
    .btn { padding: 12px 24px; border-radius: 8px; border: none; font-size: 15px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-block; }
    .btn-primary { background: #2d7d46; color: #fff; width: 100%; text-align: center; }
    .btn-primary:hover { background: #235f36; }
  </style>
</head>
<body>
<div class="topbar">
  <h1>🏃 Misty Mountain Runners</h1>
  <a href="?page=dashboard">← Dashboard</a>
</div>

<div class="container">
  <div class="card">
    <h2>Choose Your Membership</h2>
    <div class="field" style="margin-top:18px;">
      <label>Membership Type</label>
      <div class="radio-group" id="typeOptions">
        <div class="radio-option selected" id="opt-individual" onclick="selectType('Individual')">
          <div class="opt-title">Individual</div>
          <div class="opt-price" id="price-individual">$30</div>
          <div class="opt-desc">For one member</div>
        </div>
        <div class="radio-option" id="opt-family" onclick="selectType('Family')">
          <div class="opt-title">Family</div>
          <div class="opt-price" id="price-family">$50</div>
          <div class="opt-desc">All family members</div>
        </div>
      </div>
    </div>
    <button class="btn btn-primary" onclick="continueToPayment()">Continue →</button>
  </div>
</div>

<script>
  console.log('[MMR][renewal] page script started');
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

function buildOptions(memberType) {
  // Brand-new / never paid: offer both full tiers, no upgrade
  if (memberType === 'not active' || !memberType) {
    return [
      { intent: 'Individual Renewal', label: 'Individual Membership – $30', amount: 30 },
      { intent: 'Family Renewal',     label: 'Family Membership – $50',     amount: 50 },
    ];
  }
  // Existing individual: renew as individual, or pay delta to upgrade to family
  if (memberType === 'Individual') {
    return [
      { intent: 'Individual Renewal', label: 'Renew Individual Membership – $30',       amount: 30 },
      { intent: 'Family Upgrade',     label: 'Upgrade to Family – $20 (delta only)',     amount: 20 },
    ];
  }
  // Existing family member: only family renewal available
  if (memberType === 'Family') {
    return [
      { intent: 'Family Renewal', label: 'Renew Family Membership – $50', amount: 50 },
    ];
  }
  // Fallback — unknown type, offer both full tiers safely
  return [
    { intent: 'Individual Renewal', label: 'Individual Membership – $30', amount: 30 },
    { intent: 'Family Renewal',     label: 'Family Membership – $50',     amount: 50 },
  ];
}


  let selectedType = 'Individual';
  let config = {};

  function selectType(type) {
    selectedType = type;
    document.getElementById('opt-individual').classList.toggle('selected', type === 'Individual');
    document.getElementById('opt-family').classList.toggle('selected', type === 'Family');
  }

  function getPrice() {
    if (selectedType === 'Family') return parseInt(config['Family_Price'] || '50');
    return parseInt(config['Individual_Price'] || '30');
  }

  function continueToPayment() {
    const amount = getPrice();
    const url = `?page=payment&type=${encodeURIComponent(selectedType + ' Membership')}&amount=${amount}`;
    window.top.location.href = appBaseUrl + url;
  }
  
  function callApi(fn, payload) {
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

  // Init
  (async function() {
    try {
      const data = await callApi('getPublicConfig', {});
      config = data.config || {};
      const ip = config['Individual_Price'];
      const fp = config['Family_Price'];
      if (ip) document.getElementById('price-individual').textContent = '$' + ip;
      if (fp) document.getElementById('price-family').textContent = '$' + fp;
    } catch (err) {
      console.error('[MMR][renewal] init error:', err);
    }
  })();
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
  setupFiles: ['./tests/setup.ts'],
};

```


---
## File: `package-lock.json`
---

```json
{
  "name": "mmrunners-membership",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "mmrunners-membership",
      "version": "1.0.0",
      "devDependencies": {
        "@google/clasp": "^2.4.2",
        "@types/google-apps-script": "^1.0.83",
        "@types/jest": "^29.5.12",
        "jest": "^29.7.0",
        "ts-jest": "^29.1.4",
        "typescript": "^5.4.0"
      }
    },
    "node_modules/@babel/code-frame": {
      "version": "7.29.0",
      "resolved": "https://registry.npmjs.org/@babel/code-frame/-/code-frame-7.29.0.tgz",
      "integrity": "sha512-9NhCeYjq9+3uxgdtp20LSiJXJvN0FeCtNGpJxuMFZ1Kv3cWUNb6DOhJwUvcVCzKGR66cw4njwM6hrJLqgOwbcw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-validator-identifier": "^7.28.5",
        "js-tokens": "^4.0.0",
        "picocolors": "^1.1.1"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/compat-data": {
      "version": "7.29.0",
      "resolved": "https://registry.npmjs.org/@babel/compat-data/-/compat-data-7.29.0.tgz",
      "integrity": "sha512-T1NCJqT/j9+cn8fvkt7jtwbLBfLC/1y1c7NtCeXFRgzGTsafi68MRv8yzkYSapBnFA6L3U2VSc02ciDzoAJhJg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/core": {
      "version": "7.29.0",
      "resolved": "https://registry.npmjs.org/@babel/core/-/core-7.29.0.tgz",
      "integrity": "sha512-CGOfOJqWjg2qW/Mb6zNsDm+u5vFQ8DxXfbM09z69p5Z6+mE1ikP2jUXw+j42Pf1XTYED2Rni5f95npYeuwMDQA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/code-frame": "^7.29.0",
        "@babel/generator": "^7.29.0",
        "@babel/helper-compilation-targets": "^7.28.6",
        "@babel/helper-module-transforms": "^7.28.6",
        "@babel/helpers": "^7.28.6",
        "@babel/parser": "^7.29.0",
        "@babel/template": "^7.28.6",
        "@babel/traverse": "^7.29.0",
        "@babel/types": "^7.29.0",
        "@jridgewell/remapping": "^2.3.5",
        "convert-source-map": "^2.0.0",
        "debug": "^4.1.0",
        "gensync": "^1.0.0-beta.2",
        "json5": "^2.2.3",
        "semver": "^6.3.1"
      },
      "engines": {
        "node": ">=6.9.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/babel"
      }
    },
    "node_modules/@babel/generator": {
      "version": "7.29.1",
      "resolved": "https://registry.npmjs.org/@babel/generator/-/generator-7.29.1.tgz",
      "integrity": "sha512-qsaF+9Qcm2Qv8SRIMMscAvG4O3lJ0F1GuMo5HR/Bp02LopNgnZBC/EkbevHFeGs4ls/oPz9v+Bsmzbkbe+0dUw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/parser": "^7.29.0",
        "@babel/types": "^7.29.0",
        "@jridgewell/gen-mapping": "^0.3.12",
        "@jridgewell/trace-mapping": "^0.3.28",
        "jsesc": "^3.0.2"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helper-compilation-targets": {
      "version": "7.28.6",
      "resolved": "https://registry.npmjs.org/@babel/helper-compilation-targets/-/helper-compilation-targets-7.28.6.tgz",
      "integrity": "sha512-JYtls3hqi15fcx5GaSNL7SCTJ2MNmjrkHXg4FSpOA/grxK8KwyZ5bubHsCq8FXCkua6xhuaaBit+3b7+VZRfcA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/compat-data": "^7.28.6",
        "@babel/helper-validator-option": "^7.27.1",
        "browserslist": "^4.24.0",
        "lru-cache": "^5.1.1",
        "semver": "^6.3.1"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helper-compilation-targets/node_modules/lru-cache": {
      "version": "5.1.1",
      "resolved": "https://registry.npmjs.org/lru-cache/-/lru-cache-5.1.1.tgz",
      "integrity": "sha512-KpNARQA3Iwv+jTA0utUVVbrh+Jlrr1Fv0e56GGzAFOXN7dk/FviaDW8LHmK52DlcH4WP2n6gI8vN1aesBFgo9w==",
      "dev": true,
      "license": "ISC",
      "dependencies": {
        "yallist": "^3.0.2"
      }
    },
    "node_modules/@babel/helper-compilation-targets/node_modules/yallist": {
      "version": "3.1.1",
      "resolved": "https://registry.npmjs.org/yallist/-/yallist-3.1.1.tgz",
      "integrity": "sha512-a4UGQaWPH59mOXUYnAG2ewncQS4i4F43Tv3JoAM+s2VDAmS9NsK8GpDMLrCHPksFT7h3K6TOoUNn2pb7RoXx4g==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/@babel/helper-globals": {
      "version": "7.28.0",
      "resolved": "https://registry.npmjs.org/@babel/helper-globals/-/helper-globals-7.28.0.tgz",
      "integrity": "sha512-+W6cISkXFa1jXsDEdYA8HeevQT/FULhxzR99pxphltZcVaugps53THCeiWA8SguxxpSp3gKPiuYfSWopkLQ4hw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helper-module-imports": {
      "version": "7.28.6",
      "resolved": "https://registry.npmjs.org/@babel/helper-module-imports/-/helper-module-imports-7.28.6.tgz",
      "integrity": "sha512-l5XkZK7r7wa9LucGw9LwZyyCUscb4x37JWTPz7swwFE/0FMQAGpiWUZn8u9DzkSBWEcK25jmvubfpw2dnAMdbw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/traverse": "^7.28.6",
        "@babel/types": "^7.28.6"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helper-module-transforms": {
      "version": "7.28.6",
      "resolved": "https://registry.npmjs.org/@babel/helper-module-transforms/-/helper-module-transforms-7.28.6.tgz",
      "integrity": "sha512-67oXFAYr2cDLDVGLXTEABjdBJZ6drElUSI7WKp70NrpyISso3plG9SAGEF6y7zbha/wOzUByWWTJvEDVNIUGcA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-module-imports": "^7.28.6",
        "@babel/helper-validator-identifier": "^7.28.5",
        "@babel/traverse": "^7.28.6"
      },
      "engines": {
        "node": ">=6.9.0"
      },
      "peerDependencies": {
        "@babel/core": "^7.0.0"
      }
    },
    "node_modules/@babel/helper-plugin-utils": {
      "version": "7.28.6",
      "resolved": "https://registry.npmjs.org/@babel/helper-plugin-utils/-/helper-plugin-utils-7.28.6.tgz",
      "integrity": "sha512-S9gzZ/bz83GRysI7gAD4wPT/AI3uCnY+9xn+Mx/KPs2JwHJIz1W8PZkg2cqyt3RNOBM8ejcXhV6y8Og7ly/Dug==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helper-string-parser": {
      "version": "7.27.1",
      "resolved": "https://registry.npmjs.org/@babel/helper-string-parser/-/helper-string-parser-7.27.1.tgz",
      "integrity": "sha512-qMlSxKbpRlAridDExk92nSobyDdpPijUq2DW6oDnUqd0iOGxmQjyqhMIihI9+zv4LPyZdRje2cavWPbCbWm3eA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helper-validator-identifier": {
      "version": "7.28.5",
      "resolved": "https://registry.npmjs.org/@babel/helper-validator-identifier/-/helper-validator-identifier-7.28.5.tgz",
      "integrity": "sha512-qSs4ifwzKJSV39ucNjsvc6WVHs6b7S03sOh2OcHF9UHfVPqWWALUsNUVzhSBiItjRZoLHx7nIarVjqKVusUZ1Q==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helper-validator-option": {
      "version": "7.27.1",
      "resolved": "https://registry.npmjs.org/@babel/helper-validator-option/-/helper-validator-option-7.27.1.tgz",
      "integrity": "sha512-YvjJow9FxbhFFKDSuFnVCe2WxXk1zWc22fFePVNEaWJEu8IrZVlda6N0uHwzZrUM1il7NC9Mlp4MaJYbYd9JSg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helpers": {
      "version": "7.28.6",
      "resolved": "https://registry.npmjs.org/@babel/helpers/-/helpers-7.28.6.tgz",
      "integrity": "sha512-xOBvwq86HHdB7WUDTfKfT/Vuxh7gElQ+Sfti2Cy6yIWNW05P8iUslOVcZ4/sKbE+/jQaukQAdz/gf3724kYdqw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/template": "^7.28.6",
        "@babel/types": "^7.28.6"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/parser": {
      "version": "7.29.0",
      "resolved": "https://registry.npmjs.org/@babel/parser/-/parser-7.29.0.tgz",
      "integrity": "sha512-IyDgFV5GeDUVX4YdF/3CPULtVGSXXMLh1xVIgdCgxApktqnQV0r7/8Nqthg+8YLGaAtdyIlo2qIdZrbCv4+7ww==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/types": "^7.29.0"
      },
      "bin": {
        "parser": "bin/babel-parser.js"
      },
      "engines": {
        "node": ">=6.0.0"
      }
    },
    "node_modules/@babel/plugin-syntax-async-generators": {
      "version": "7.8.4",
      "resolved": "https://registry.npmjs.org/@babel/plugin-syntax-async-generators/-/plugin-syntax-async-generators-7.8.4.tgz",
      "integrity": "sha512-tycmZxkGfZaxhMRbXlPXuVFpdWlXpir2W4AMhSJgRKzk/eDlIXOhb2LHWoLpDF7TEHylV5zNhykX6KAgHJmTNw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-plugin-utils": "^7.8.0"
      },
      "peerDependencies": {
        "@babel/core": "^7.0.0-0"
      }
    },
    "node_modules/@babel/plugin-syntax-bigint": {
      "version": "7.8.3",
      "resolved": "https://registry.npmjs.org/@babel/plugin-syntax-bigint/-/plugin-syntax-bigint-7.8.3.tgz",
      "integrity": "sha512-wnTnFlG+YxQm3vDxpGE57Pj0srRU4sHE/mDkt1qv2YJJSeUAec2ma4WLUnUPeKjyrfntVwe/N6dCXpU+zL3Npg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-plugin-utils": "^7.8.0"
      },
      "peerDependencies": {
        "@babel/core": "^7.0.0-0"
      }
    },
    "node_modules/@babel/plugin-syntax-class-properties": {
      "version": "7.12.13",
      "resolved": "https://registry.npmjs.org/@babel/plugin-syntax-class-properties/-/plugin-syntax-class-properties-7.12.13.tgz",
      "integrity": "sha512-fm4idjKla0YahUNgFNLCB0qySdsoPiZP3iQE3rky0mBUtMZ23yDJ9SJdg6dXTSDnulOVqiF3Hgr9nbXvXTQZYA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-plugin-utils": "^7.12.13"
      },
      "peerDependencies": {
        "@babel/core": "^7.0.0-0"
      }
    },
    "node_modules/@babel/plugin-syntax-class-static-block": {
      "version": "7.14.5",
      "resolved": "https://registry.npmjs.org/@babel/plugin-syntax-class-static-block/-/plugin-syntax-class-static-block-7.14.5.tgz",
      "integrity": "sha512-b+YyPmr6ldyNnM6sqYeMWE+bgJcJpO6yS4QD7ymxgH34GBPNDM/THBh8iunyvKIZztiwLH4CJZ0RxTk9emgpjw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-plugin-utils": "^7.14.5"
      },
      "engines": {
        "node": ">=6.9.0"
      },
      "peerDependencies": {
        "@babel/core": "^7.0.0-0"
      }
    },
    "node_modules/@babel/plugin-syntax-import-attributes": {
      "version": "7.28.6",
      "resolved": "https://registry.npmjs.org/@babel/plugin-syntax-import-attributes/-/plugin-syntax-import-attributes-7.28.6.tgz",
      "integrity": "sha512-jiLC0ma9XkQT3TKJ9uYvlakm66Pamywo+qwL+oL8HJOvc6TWdZXVfhqJr8CCzbSGUAbDOzlGHJC1U+vRfLQDvw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-plugin-utils": "^7.28.6"
      },
      "engines": {
        "node": ">=6.9.0"
      },
      "peerDependencies": {
        "@babel/core": "^7.0.0-0"
      }
    },
    "node_modules/@babel/plugin-syntax-import-meta": {
      "version": "7.10.4",
      "resolved": "https://registry.npmjs.org/@babel/plugin-syntax-import-meta/-/plugin-syntax-import-meta-7.10.4.tgz",
      "integrity": "sha512-Yqfm+XDx0+Prh3VSeEQCPU81yC+JWZ2pDPFSS4ZdpfZhp4MkFMaDC1UqseovEKwSUpnIL7+vK+Clp7bfh0iD7g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-plugin-utils": "^7.10.4"
      },
      "peerDependencies": {
        "@babel/core": "^7.0.0-0"
      }
    },
    "node_modules/@babel/plugin-syntax-json-strings": {
      "version": "7.8.3",
      "resolved": "https://registry.npmjs.org/@babel/plugin-syntax-json-strings/-/plugin-syntax-json-strings-7.8.3.tgz",
      "integrity": "sha512-lY6kdGpWHvjoe2vk4WrAapEuBR69EMxZl+RoGRhrFGNYVK8mOPAW8VfbT/ZgrFbXlDNiiaxQnAtgVCZ6jv30EA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-plugin-utils": "^7.8.0"
      },
      "peerDependencies": {
        "@babel/core": "^7.0.0-0"
      }
    },
    "node_modules/@babel/plugin-syntax-jsx": {
      "version": "7.28.6",
      "resolved": "https://registry.npmjs.org/@babel/plugin-syntax-jsx/-/plugin-syntax-jsx-7.28.6.tgz",
      "integrity": "sha512-wgEmr06G6sIpqr8YDwA2dSRTE3bJ+V0IfpzfSY3Lfgd7YWOaAdlykvJi13ZKBt8cZHfgH1IXN+CL656W3uUa4w==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-plugin-utils": "^7.28.6"
      },
      "engines": {
        "node": ">=6.9.0"
      },
      "peerDependencies": {
        "@babel/core": "^7.0.0-0"
      }
    },
    "node_modules/@babel/plugin-syntax-logical-assignment-operators": {
      "version": "7.10.4",
      "resolved": "https://registry.npmjs.org/@babel/plugin-syntax-logical-assignment-operators/-/plugin-syntax-logical-assignment-operators-7.10.4.tgz",
      "integrity": "sha512-d8waShlpFDinQ5MtvGU9xDAOzKH47+FFoney2baFIoMr952hKOLp1HR7VszoZvOsV/4+RRszNY7D17ba0te0ig==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-plugin-utils": "^7.10.4"
      },
      "peerDependencies": {
        "@babel/core": "^7.0.0-0"
      }
    },
    "node_modules/@babel/plugin-syntax-nullish-coalescing-operator": {
      "version": "7.8.3",
      "resolved": "https://registry.npmjs.org/@babel/plugin-syntax-nullish-coalescing-operator/-/plugin-syntax-nullish-coalescing-operator-7.8.3.tgz",
      "integrity": "sha512-aSff4zPII1u2QD7y+F8oDsz19ew4IGEJg9SVW+bqwpwtfFleiQDMdzA/R+UlWDzfnHFCxxleFT0PMIrR36XLNQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-plugin-utils": "^7.8.0"
      },
      "peerDependencies": {
        "@babel/core": "^7.0.0-0"
      }
    },
    "node_modules/@babel/plugin-syntax-numeric-separator": {
      "version": "7.10.4",
      "resolved": "https://registry.npmjs.org/@babel/plugin-syntax-numeric-separator/-/plugin-syntax-numeric-separator-7.10.4.tgz",
      "integrity": "sha512-9H6YdfkcK/uOnY/K7/aA2xpzaAgkQn37yzWUMRK7OaPOqOpGS1+n0H5hxT9AUw9EsSjPW8SVyMJwYRtWs3X3ug==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-plugin-utils": "^7.10.4"
      },
      "peerDependencies": {
        "@babel/core": "^7.0.0-0"
      }
    },
    "node_modules/@babel/plugin-syntax-object-rest-spread": {
      "version": "7.8.3",
      "resolved": "https://registry.npmjs.org/@babel/plugin-syntax-object-rest-spread/-/plugin-syntax-object-rest-spread-7.8.3.tgz",
      "integrity": "sha512-XoqMijGZb9y3y2XskN+P1wUGiVwWZ5JmoDRwx5+3GmEplNyVM2s2Dg8ILFQm8rWM48orGy5YpI5Bl8U1y7ydlA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-plugin-utils": "^7.8.0"
      },
      "peerDependencies": {
        "@babel/core": "^7.0.0-0"
      }
    },
    "node_modules/@babel/plugin-syntax-optional-catch-binding": {
      "version": "7.8.3",
      "resolved": "https://registry.npmjs.org/@babel/plugin-syntax-optional-catch-binding/-/plugin-syntax-optional-catch-binding-7.8.3.tgz",
      "integrity": "sha512-6VPD0Pc1lpTqw0aKoeRTMiB+kWhAoT24PA+ksWSBrFtl5SIRVpZlwN3NNPQjehA2E/91FV3RjLWoVTglWcSV3Q==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-plugin-utils": "^7.8.0"
      },
      "peerDependencies": {
        "@babel/core": "^7.0.0-0"
      }
    },
    "node_modules/@babel/plugin-syntax-optional-chaining": {
      "version": "7.8.3",
      "resolved": "https://registry.npmjs.org/@babel/plugin-syntax-optional-chaining/-/plugin-syntax-optional-chaining-7.8.3.tgz",
      "integrity": "sha512-KoK9ErH1MBlCPxV0VANkXW2/dw4vlbGDrFgz8bmUsBGYkFRcbRwMh6cIJubdPrkxRwuGdtCk0v/wPTKbQgBjkg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-plugin-utils": "^7.8.0"
      },
      "peerDependencies": {
        "@babel/core": "^7.0.0-0"
      }
    },
    "node_modules/@babel/plugin-syntax-private-property-in-object": {
      "version": "7.14.5",
      "resolved": "https://registry.npmjs.org/@babel/plugin-syntax-private-property-in-object/-/plugin-syntax-private-property-in-object-7.14.5.tgz",
      "integrity": "sha512-0wVnp9dxJ72ZUJDV27ZfbSj6iHLoytYZmh3rFcxNnvsJF3ktkzLDZPy/mA17HGsaQT3/DQsWYX1f1QGWkCoVUg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-plugin-utils": "^7.14.5"
      },
      "engines": {
        "node": ">=6.9.0"
      },
      "peerDependencies": {
        "@babel/core": "^7.0.0-0"
      }
    },
    "node_modules/@babel/plugin-syntax-top-level-await": {
      "version": "7.14.5",
      "resolved": "https://registry.npmjs.org/@babel/plugin-syntax-top-level-await/-/plugin-syntax-top-level-await-7.14.5.tgz",
      "integrity": "sha512-hx++upLv5U1rgYfwe1xBQUhRmU41NEvpUvrp8jkrSCdvGSnM5/qdRMtylJ6PG5OFkBaHkbTAKTnd3/YyESRHFw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-plugin-utils": "^7.14.5"
      },
      "engines": {
        "node": ">=6.9.0"
      },
      "peerDependencies": {
        "@babel/core": "^7.0.0-0"
      }
    },
    "node_modules/@babel/plugin-syntax-typescript": {
      "version": "7.28.6",
      "resolved": "https://registry.npmjs.org/@babel/plugin-syntax-typescript/-/plugin-syntax-typescript-7.28.6.tgz",
      "integrity": "sha512-+nDNmQye7nlnuuHDboPbGm00Vqg3oO8niRRL27/4LYHUsHYh0zJ1xWOz0uRwNFmM1Avzk8wZbc6rdiYhomzv/A==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-plugin-utils": "^7.28.6"
      },
      "engines": {
        "node": ">=6.9.0"
      },
      "peerDependencies": {
        "@babel/core": "^7.0.0-0"
      }
    },
    "node_modules/@babel/template": {
      "version": "7.28.6",
      "resolved": "https://registry.npmjs.org/@babel/template/-/template-7.28.6.tgz",
      "integrity": "sha512-YA6Ma2KsCdGb+WC6UpBVFJGXL58MDA6oyONbjyF/+5sBgxY/dwkhLogbMT2GXXyU84/IhRw/2D1Os1B/giz+BQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/code-frame": "^7.28.6",
        "@babel/parser": "^7.28.6",
        "@babel/types": "^7.28.6"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/traverse": {
      "version": "7.29.0",
      "resolved": "https://registry.npmjs.org/@babel/traverse/-/traverse-7.29.0.tgz",
      "integrity": "sha512-4HPiQr0X7+waHfyXPZpWPfWL/J7dcN1mx9gL6WdQVMbPnF3+ZhSMs8tCxN7oHddJE9fhNE7+lxdnlyemKfJRuA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/code-frame": "^7.29.0",
        "@babel/generator": "^7.29.0",
        "@babel/helper-globals": "^7.28.0",
        "@babel/parser": "^7.29.0",
        "@babel/template": "^7.28.6",
        "@babel/types": "^7.29.0",
        "debug": "^4.3.1"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/types": {
      "version": "7.29.0",
      "resolved": "https://registry.npmjs.org/@babel/types/-/types-7.29.0.tgz",
      "integrity": "sha512-LwdZHpScM4Qz8Xw2iKSzS+cfglZzJGvofQICy7W7v4caru4EaAmyUuO6BGrbyQ2mYV11W0U8j5mBhd14dd3B0A==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-string-parser": "^7.27.1",
        "@babel/helper-validator-identifier": "^7.28.5"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@bcoe/v8-coverage": {
      "version": "0.2.3",
      "resolved": "https://registry.npmjs.org/@bcoe/v8-coverage/-/v8-coverage-0.2.3.tgz",
      "integrity": "sha512-0hYQ8SB4Db5zvZB4axdMHGwEaQjkZzFjQiN9LVYvIFB2nSUHW9tYpxWriPrWDASIxiaXax83REcLxuSdnGPZtw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@google/clasp": {
      "version": "2.5.0",
      "resolved": "https://registry.npmjs.org/@google/clasp/-/clasp-2.5.0.tgz",
      "integrity": "sha512-HkZnUP5UibGEYXpk89HR24pFctb9VBlrpjCrU6sjepkQOtpr/Y9rrSP3N7EVrqUDg4/JQmmPQ8Z2ybN4XtdOxg==",
      "dev": true,
      "license": "Apache-2.0",
      "dependencies": {
        "@sindresorhus/is": "^4.0.1",
        "chalk": "^4.1.2",
        "chokidar": "^3.5.2",
        "cli-truncate": "^3.0.0",
        "commander": "^8.1.0",
        "debounce": "^1.2.1",
        "dotf": "^2.0.2",
        "find-up": "^6.0.0",
        "fs-extra": "^10.0.0",
        "fuzzy": "^0.1.3",
        "gaxios": "^4.2.1",
        "google-auth-library": "^7.6.2",
        "googleapis": "^84.0.0",
        "inquirer": "^8.1.2",
        "inquirer-autocomplete-prompt-ipt": "^2.0.0",
        "is-reachable": "^5.0.0",
        "log-symbols": "^5.0.0",
        "loud-rejection": "^2.2.0",
        "make-dir": "^3.1.0",
        "multimatch": "^5.0.0",
        "normalize-newline": "^4.1.0",
        "open": "^8.2.1",
        "ora": "^6.0.0",
        "p-map": "^5.1.0",
        "read-pkg-up": "^8.0.0",
        "recursive-readdir": "^2.2.2",
        "server-destroy": "^1.0.1",
        "split-lines": "^3.0.0",
        "strip-bom": "^5.0.0",
        "ts2gas": "^4.2.0",
        "typescript": "^4.4.2"
      },
      "bin": {
        "clasp": "build/src/index.js"
      },
      "engines": {
        "node": "^12.20.0 || ^14.13.1 || >=16.0.0"
      }
    },
    "node_modules/@google/clasp/node_modules/typescript": {
      "version": "4.9.5",
      "resolved": "https://registry.npmjs.org/typescript/-/typescript-4.9.5.tgz",
      "integrity": "sha512-1FXk9E2Hm+QzZQ7z+McJiHL4NW1F2EzMu9Nq9i3zAaGqibafqYwCVU6WyWAuyQRRzOlxou8xZSyXLEN8oKj24g==",
      "dev": true,
      "license": "Apache-2.0",
      "bin": {
        "tsc": "bin/tsc",
        "tsserver": "bin/tsserver"
      },
      "engines": {
        "node": ">=4.2.0"
      }
    },
    "node_modules/@inquirer/external-editor": {
      "version": "1.0.3",
      "resolved": "https://registry.npmjs.org/@inquirer/external-editor/-/external-editor-1.0.3.tgz",
      "integrity": "sha512-RWbSrDiYmO4LbejWY7ttpxczuwQyZLBUyygsA9Nsv95hpzUWwnNTVQmAq3xuh7vNwCp07UTmE5i11XAEExx4RA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "chardet": "^2.1.1",
        "iconv-lite": "^0.7.0"
      },
      "engines": {
        "node": ">=18"
      },
      "peerDependencies": {
        "@types/node": ">=18"
      },
      "peerDependenciesMeta": {
        "@types/node": {
          "optional": true
        }
      }
    },
    "node_modules/@istanbuljs/load-nyc-config": {
      "version": "1.1.0",
      "resolved": "https://registry.npmjs.org/@istanbuljs/load-nyc-config/-/load-nyc-config-1.1.0.tgz",
      "integrity": "sha512-VjeHSlIzpv/NyD3N0YuHfXOPDIixcA1q2ZV98wsMqcYlPmv2n3Yb2lYP9XMElnaFVXg5A7YLTeLu6V84uQDjmQ==",
      "dev": true,
      "license": "ISC",
      "dependencies": {
        "camelcase": "^5.3.1",
        "find-up": "^4.1.0",
        "get-package-type": "^0.1.0",
        "js-yaml": "^3.13.1",
        "resolve-from": "^5.0.0"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/@istanbuljs/load-nyc-config/node_modules/find-up": {
      "version": "4.1.0",
      "resolved": "https://registry.npmjs.org/find-up/-/find-up-4.1.0.tgz",
      "integrity": "sha512-PpOwAdQ/YlXQ2vj8a3h8IipDuYRi3wceVQQGYWxNINccq40Anw7BlsEXCMbt1Zt+OLA6Fq9suIpIWD0OsnISlw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "locate-path": "^5.0.0",
        "path-exists": "^4.0.0"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/@istanbuljs/load-nyc-config/node_modules/locate-path": {
      "version": "5.0.0",
      "resolved": "https://registry.npmjs.org/locate-path/-/locate-path-5.0.0.tgz",
      "integrity": "sha512-t7hw9pI+WvuwNJXwk5zVHpyhIqzg2qTlklJOf0mVxGSbe3Fp2VieZcduNYjaLDoy6p9uGpQEGWG87WpMKlNq8g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "p-locate": "^4.1.0"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/@istanbuljs/load-nyc-config/node_modules/p-limit": {
      "version": "2.3.0",
      "resolved": "https://registry.npmjs.org/p-limit/-/p-limit-2.3.0.tgz",
      "integrity": "sha512-//88mFWSJx8lxCzwdAABTJL2MyWB12+eIY7MDL2SqLmAkeKU9qxRvWuSyTjm3FUmpBEMuFfckAIqEaVGUDxb6w==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "p-try": "^2.0.0"
      },
      "engines": {
        "node": ">=6"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/@istanbuljs/load-nyc-config/node_modules/p-locate": {
      "version": "4.1.0",
      "resolved": "https://registry.npmjs.org/p-locate/-/p-locate-4.1.0.tgz",
      "integrity": "sha512-R79ZZ/0wAxKGu3oYMlz8jy/kbhsNrS7SKZ7PxEHBgJ5+F2mtFW2fK2cOtBh1cHYkQsbzFV7I+EoRKe6Yt0oK7A==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "p-limit": "^2.2.0"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/@istanbuljs/load-nyc-config/node_modules/path-exists": {
      "version": "4.0.0",
      "resolved": "https://registry.npmjs.org/path-exists/-/path-exists-4.0.0.tgz",
      "integrity": "sha512-ak9Qy5Q7jYb2Wwcey5Fpvg2KoAc/ZIhLSLOSBmRmygPsGwkVVt0fZa0qrtMz+m6tJTAHfZQ8FnmB4MG4LWy7/w==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/@istanbuljs/schema": {
      "version": "0.1.3",
      "resolved": "https://registry.npmjs.org/@istanbuljs/schema/-/schema-0.1.3.tgz",
      "integrity": "sha512-ZXRY4jNvVgSVQ8DL3LTcakaAtXwTVUxE81hslsyD2AtoXW/wVob10HkOJ1X/pAlcI7D+2YoZKg5do8G/w6RYgA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/@jest/console": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/@jest/console/-/console-29.7.0.tgz",
      "integrity": "sha512-5Ni4CU7XHQi32IJ398EEP4RrB8eV09sXP2ROqD4bksHrnTree52PsxvX8tpL8LvTZ3pFzXyPbNQReSN41CAhOg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jest/types": "^29.6.3",
        "@types/node": "*",
        "chalk": "^4.0.0",
        "jest-message-util": "^29.7.0",
        "jest-util": "^29.7.0",
        "slash": "^3.0.0"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/@jest/core": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/@jest/core/-/core-29.7.0.tgz",
      "integrity": "sha512-n7aeXWKMnGtDA48y8TLWJPJmLmmZ642Ceo78cYWEpiD7FzDgmNDV/GCVRorPABdXLJZ/9wzzgZAlHjXjxDHGsg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jest/console": "^29.7.0",
        "@jest/reporters": "^29.7.0",
        "@jest/test-result": "^29.7.0",
        "@jest/transform": "^29.7.0",
        "@jest/types": "^29.6.3",
        "@types/node": "*",
        "ansi-escapes": "^4.2.1",
        "chalk": "^4.0.0",
        "ci-info": "^3.2.0",
        "exit": "^0.1.2",
        "graceful-fs": "^4.2.9",
        "jest-changed-files": "^29.7.0",
        "jest-config": "^29.7.0",
        "jest-haste-map": "^29.7.0",
        "jest-message-util": "^29.7.0",
        "jest-regex-util": "^29.6.3",
        "jest-resolve": "^29.7.0",
        "jest-resolve-dependencies": "^29.7.0",
        "jest-runner": "^29.7.0",
        "jest-runtime": "^29.7.0",
        "jest-snapshot": "^29.7.0",
        "jest-util": "^29.7.0",
        "jest-validate": "^29.7.0",
        "jest-watcher": "^29.7.0",
        "micromatch": "^4.0.4",
        "pretty-format": "^29.7.0",
        "slash": "^3.0.0",
        "strip-ansi": "^6.0.0"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      },
      "peerDependencies": {
        "node-notifier": "^8.0.1 || ^9.0.0 || ^10.0.0"
      },
      "peerDependenciesMeta": {
        "node-notifier": {
          "optional": true
        }
      }
    },
    "node_modules/@jest/environment": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/@jest/environment/-/environment-29.7.0.tgz",
      "integrity": "sha512-aQIfHDq33ExsN4jP1NWGXhxgQ/wixs60gDiKO+XVMd8Mn0NWPWgc34ZQDTb2jKaUWQ7MuwoitXAsN2XVXNMpAw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jest/fake-timers": "^29.7.0",
        "@jest/types": "^29.6.3",
        "@types/node": "*",
        "jest-mock": "^29.7.0"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/@jest/expect": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/@jest/expect/-/expect-29.7.0.tgz",
      "integrity": "sha512-8uMeAMycttpva3P1lBHB8VciS9V0XAr3GymPpipdyQXbBcuhkLQOSe8E/p92RyAdToS6ZD1tFkX+CkhoECE0dQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "expect": "^29.7.0",
        "jest-snapshot": "^29.7.0"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/@jest/expect-utils": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/@jest/expect-utils/-/expect-utils-29.7.0.tgz",
      "integrity": "sha512-GlsNBWiFQFCVi9QVSx7f5AgMeLxe9YCCs5PuP2O2LdjDAA8Jh9eX7lA1Jq/xdXw3Wb3hyvlFNfZIfcRetSzYcA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "jest-get-type": "^29.6.3"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/@jest/fake-timers": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/@jest/fake-timers/-/fake-timers-29.7.0.tgz",
      "integrity": "sha512-q4DH1Ha4TTFPdxLsqDXK1d3+ioSL7yL5oCMJZgDYm6i+6CygW5E5xVr/D1HdsGxjt1ZWSfUAs9OxSB/BNelWrQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jest/types": "^29.6.3",
        "@sinonjs/fake-timers": "^10.0.2",
        "@types/node": "*",
        "jest-message-util": "^29.7.0",
        "jest-mock": "^29.7.0",
        "jest-util": "^29.7.0"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/@jest/globals": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/@jest/globals/-/globals-29.7.0.tgz",
      "integrity": "sha512-mpiz3dutLbkW2MNFubUGUEVLkTGiqW6yLVTA+JbP6fI6J5iL9Y0Nlg8k95pcF8ctKwCS7WVxteBs29hhfAotzQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jest/environment": "^29.7.0",
        "@jest/expect": "^29.7.0",
        "@jest/types": "^29.6.3",
        "jest-mock": "^29.7.0"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/@jest/reporters": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/@jest/reporters/-/reporters-29.7.0.tgz",
      "integrity": "sha512-DApq0KJbJOEzAFYjHADNNxAE3KbhxQB1y5Kplb5Waqw6zVbuWatSnMjE5gs8FUgEPmNsnZA3NCWl9NG0ia04Pg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@bcoe/v8-coverage": "^0.2.3",
        "@jest/console": "^29.7.0",
        "@jest/test-result": "^29.7.0",
        "@jest/transform": "^29.7.0",
        "@jest/types": "^29.6.3",
        "@jridgewell/trace-mapping": "^0.3.18",
        "@types/node": "*",
        "chalk": "^4.0.0",
        "collect-v8-coverage": "^1.0.0",
        "exit": "^0.1.2",
        "glob": "^7.1.3",
        "graceful-fs": "^4.2.9",
        "istanbul-lib-coverage": "^3.0.0",
        "istanbul-lib-instrument": "^6.0.0",
        "istanbul-lib-report": "^3.0.0",
        "istanbul-lib-source-maps": "^4.0.0",
        "istanbul-reports": "^3.1.3",
        "jest-message-util": "^29.7.0",
        "jest-util": "^29.7.0",
        "jest-worker": "^29.7.0",
        "slash": "^3.0.0",
        "string-length": "^4.0.1",
        "strip-ansi": "^6.0.0",
        "v8-to-istanbul": "^9.0.1"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      },
      "peerDependencies": {
        "node-notifier": "^8.0.1 || ^9.0.0 || ^10.0.0"
      },
      "peerDependenciesMeta": {
        "node-notifier": {
          "optional": true
        }
      }
    },
    "node_modules/@jest/schemas": {
      "version": "29.6.3",
      "resolved": "https://registry.npmjs.org/@jest/schemas/-/schemas-29.6.3.tgz",
      "integrity": "sha512-mo5j5X+jIZmJQveBKeS/clAueipV7KgiX1vMgCxam1RNYiqE1w62n0/tJJnHtjW8ZHcQco5gY85jA3mi0L+nSA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@sinclair/typebox": "^0.27.8"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/@jest/source-map": {
      "version": "29.6.3",
      "resolved": "https://registry.npmjs.org/@jest/source-map/-/source-map-29.6.3.tgz",
      "integrity": "sha512-MHjT95QuipcPrpLM+8JMSzFx6eHp5Bm+4XeFDJlwsvVBjmKNiIAvasGK2fxz2WbGRlnvqehFbh07MMa7n3YJnw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jridgewell/trace-mapping": "^0.3.18",
        "callsites": "^3.0.0",
        "graceful-fs": "^4.2.9"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/@jest/test-result": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/@jest/test-result/-/test-result-29.7.0.tgz",
      "integrity": "sha512-Fdx+tv6x1zlkJPcWXmMDAG2HBnaR9XPSd5aDWQVsfrZmLVT3lU1cwyxLgRmXR9yrq4NBoEm9BMsfgFzTQAbJYA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jest/console": "^29.7.0",
        "@jest/types": "^29.6.3",
        "@types/istanbul-lib-coverage": "^2.0.0",
        "collect-v8-coverage": "^1.0.0"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/@jest/test-sequencer": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/@jest/test-sequencer/-/test-sequencer-29.7.0.tgz",
      "integrity": "sha512-GQwJ5WZVrKnOJuiYiAF52UNUJXgTZx1NHjFSEB0qEMmSZKAkdMoIzw/Cj6x6NF4AvV23AUqDpFzQkN/eYCYTxw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jest/test-result": "^29.7.0",
        "graceful-fs": "^4.2.9",
        "jest-haste-map": "^29.7.0",
        "slash": "^3.0.0"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/@jest/transform": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/@jest/transform/-/transform-29.7.0.tgz",
      "integrity": "sha512-ok/BTPFzFKVMwO5eOHRrvnBVHdRy9IrsrW1GpMaQ9MCnilNLXQKmAX8s1YXDFaai9xJpac2ySzV0YeRRECr2Vw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/core": "^7.11.6",
        "@jest/types": "^29.6.3",
        "@jridgewell/trace-mapping": "^0.3.18",
        "babel-plugin-istanbul": "^6.1.1",
        "chalk": "^4.0.0",
        "convert-source-map": "^2.0.0",
        "fast-json-stable-stringify": "^2.1.0",
        "graceful-fs": "^4.2.9",
        "jest-haste-map": "^29.7.0",
        "jest-regex-util": "^29.6.3",
        "jest-util": "^29.7.0",
        "micromatch": "^4.0.4",
        "pirates": "^4.0.4",
        "slash": "^3.0.0",
        "write-file-atomic": "^4.0.2"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/@jest/types": {
      "version": "29.6.3",
      "resolved": "https://registry.npmjs.org/@jest/types/-/types-29.6.3.tgz",
      "integrity": "sha512-u3UPsIilWKOM3F9CXtrG8LEJmNxwoCQC/XVj4IKYXvvpx7QIi/Kg1LI5uDmDpKlac62NUtX7eLjRh+jVZcLOzw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jest/schemas": "^29.6.3",
        "@types/istanbul-lib-coverage": "^2.0.0",
        "@types/istanbul-reports": "^3.0.0",
        "@types/node": "*",
        "@types/yargs": "^17.0.8",
        "chalk": "^4.0.0"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/@jridgewell/gen-mapping": {
      "version": "0.3.13",
      "resolved": "https://registry.npmjs.org/@jridgewell/gen-mapping/-/gen-mapping-0.3.13.tgz",
      "integrity": "sha512-2kkt/7niJ6MgEPxF0bYdQ6etZaA+fQvDcLKckhy1yIQOzaoKjBBjSj63/aLVjYE3qhRt5dvM+uUyfCg6UKCBbA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jridgewell/sourcemap-codec": "^1.5.0",
        "@jridgewell/trace-mapping": "^0.3.24"
      }
    },
    "node_modules/@jridgewell/remapping": {
      "version": "2.3.5",
      "resolved": "https://registry.npmjs.org/@jridgewell/remapping/-/remapping-2.3.5.tgz",
      "integrity": "sha512-LI9u/+laYG4Ds1TDKSJW2YPrIlcVYOwi2fUC6xB43lueCjgxV4lffOCZCtYFiH6TNOX+tQKXx97T4IKHbhyHEQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jridgewell/gen-mapping": "^0.3.5",
        "@jridgewell/trace-mapping": "^0.3.24"
      }
    },
    "node_modules/@jridgewell/resolve-uri": {
      "version": "3.1.2",
      "resolved": "https://registry.npmjs.org/@jridgewell/resolve-uri/-/resolve-uri-3.1.2.tgz",
      "integrity": "sha512-bRISgCIjP20/tbWSPWMEi54QVPRZExkuD9lJL+UIxUKtwVJA8wW1Trb1jMs1RFXo1CBTNZ/5hpC9QvmKWdopKw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.0.0"
      }
    },
    "node_modules/@jridgewell/sourcemap-codec": {
      "version": "1.5.5",
      "resolved": "https://registry.npmjs.org/@jridgewell/sourcemap-codec/-/sourcemap-codec-1.5.5.tgz",
      "integrity": "sha512-cYQ9310grqxueWbl+WuIUIaiUaDcj7WOq5fVhEljNVgRfOUhY9fy2zTvfoqWsnebh8Sl70VScFbICvJnLKB0Og==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@jridgewell/trace-mapping": {
      "version": "0.3.31",
      "resolved": "https://registry.npmjs.org/@jridgewell/trace-mapping/-/trace-mapping-0.3.31.tgz",
      "integrity": "sha512-zzNR+SdQSDJzc8joaeP8QQoCQr8NuYx2dIIytl1QeBEZHJ9uW6hebsrYgbz8hJwUQao3TWCMtmfV8Nu1twOLAw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jridgewell/resolve-uri": "^3.1.0",
        "@jridgewell/sourcemap-codec": "^1.4.14"
      }
    },
    "node_modules/@sinclair/typebox": {
      "version": "0.27.10",
      "resolved": "https://registry.npmjs.org/@sinclair/typebox/-/typebox-0.27.10.tgz",
      "integrity": "sha512-MTBk/3jGLNB2tVxv6uLlFh1iu64iYOQ2PbdOSK3NW8JZsmlaOh2q6sdtKowBhfw8QFLmYNzTW4/oK4uATIi6ZA==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@sindresorhus/is": {
      "version": "4.6.0",
      "resolved": "https://registry.npmjs.org/@sindresorhus/is/-/is-4.6.0.tgz",
      "integrity": "sha512-t09vSN3MdfsyCHoFcTRCH/iUtG7OJ0CsjzB8cjAmKc/va/kIgeDI/TxsigdncE/4be734m0cvIYwNaV4i2XqAw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sindresorhus/is?sponsor=1"
      }
    },
    "node_modules/@sinonjs/commons": {
      "version": "3.0.1",
      "resolved": "https://registry.npmjs.org/@sinonjs/commons/-/commons-3.0.1.tgz",
      "integrity": "sha512-K3mCHKQ9sVh8o1C9cxkwxaOmXoAMlDxC1mYyHrjqOWEcBjYr76t96zL2zlj5dUGZ3HSw240X1qgH3Mjf1yJWpQ==",
      "dev": true,
      "license": "BSD-3-Clause",
      "dependencies": {
        "type-detect": "4.0.8"
      }
    },
    "node_modules/@sinonjs/fake-timers": {
      "version": "10.3.0",
      "resolved": "https://registry.npmjs.org/@sinonjs/fake-timers/-/fake-timers-10.3.0.tgz",
      "integrity": "sha512-V4BG07kuYSUkTCSBHG8G8TNhM+F19jXFWnQtzj+we8DrkpSBCee9Z3Ms8yiGer/dlmhe35/Xdgyo3/0rQKg7YA==",
      "dev": true,
      "license": "BSD-3-Clause",
      "dependencies": {
        "@sinonjs/commons": "^3.0.0"
      }
    },
    "node_modules/@szmarczak/http-timer": {
      "version": "4.0.6",
      "resolved": "https://registry.npmjs.org/@szmarczak/http-timer/-/http-timer-4.0.6.tgz",
      "integrity": "sha512-4BAffykYOgO+5nzBWYwE3W90sBgLJoUPRWWcL8wlyiM8IB8ipJz3UMJ9KXQd1RKQXpKp8Tutn80HZtWsu2u76w==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "defer-to-connect": "^2.0.0"
      },
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/@types/babel__core": {
      "version": "7.20.5",
      "resolved": "https://registry.npmjs.org/@types/babel__core/-/babel__core-7.20.5.tgz",
      "integrity": "sha512-qoQprZvz5wQFJwMDqeseRXWv3rqMvhgpbXFfVyWhbx9X47POIA6i/+dXefEmZKoAgOaTdaIgNSMqMIU61yRyzA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/parser": "^7.20.7",
        "@babel/types": "^7.20.7",
        "@types/babel__generator": "*",
        "@types/babel__template": "*",
        "@types/babel__traverse": "*"
      }
    },
    "node_modules/@types/babel__generator": {
      "version": "7.27.0",
      "resolved": "https://registry.npmjs.org/@types/babel__generator/-/babel__generator-7.27.0.tgz",
      "integrity": "sha512-ufFd2Xi92OAVPYsy+P4n7/U7e68fex0+Ee8gSG9KX7eo084CWiQ4sdxktvdl0bOPupXtVJPY19zk6EwWqUQ8lg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/types": "^7.0.0"
      }
    },
    "node_modules/@types/babel__template": {
      "version": "7.4.4",
      "resolved": "https://registry.npmjs.org/@types/babel__template/-/babel__template-7.4.4.tgz",
      "integrity": "sha512-h/NUaSyG5EyxBIp8YRxo4RMe2/qQgvyowRwVMzhYhBCONbW8PUsg4lkFMrhgZhUe5z3L3MiLDuvyJ/CaPa2A8A==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/parser": "^7.1.0",
        "@babel/types": "^7.0.0"
      }
    },
    "node_modules/@types/babel__traverse": {
      "version": "7.28.0",
      "resolved": "https://registry.npmjs.org/@types/babel__traverse/-/babel__traverse-7.28.0.tgz",
      "integrity": "sha512-8PvcXf70gTDZBgt9ptxJ8elBeBjcLOAcOtoO/mPJjtji1+CdGbHgm77om1GrsPxsiE+uXIpNSK64UYaIwQXd4Q==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/types": "^7.28.2"
      }
    },
    "node_modules/@types/cacheable-request": {
      "version": "6.0.3",
      "resolved": "https://registry.npmjs.org/@types/cacheable-request/-/cacheable-request-6.0.3.tgz",
      "integrity": "sha512-IQ3EbTzGxIigb1I3qPZc1rWJnH0BmSKv5QYTalEwweFvyBDLSAe24zP0le/hyi7ecGfZVlIVAg4BZqb8WBwKqw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/http-cache-semantics": "*",
        "@types/keyv": "^3.1.4",
        "@types/node": "*",
        "@types/responselike": "^1.0.0"
      }
    },
    "node_modules/@types/google-apps-script": {
      "version": "1.0.100",
      "resolved": "https://registry.npmjs.org/@types/google-apps-script/-/google-apps-script-1.0.100.tgz",
      "integrity": "sha512-POgcjcDbrjYJYf3Av6j5n+z9/z/WulCNh9Gj199HgrcgRLzcQLg5ALw6jdWcgBkzgTLNYZSe7/01aOfiNzzn9g==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@types/graceful-fs": {
      "version": "4.1.9",
      "resolved": "https://registry.npmjs.org/@types/graceful-fs/-/graceful-fs-4.1.9.tgz",
      "integrity": "sha512-olP3sd1qOEe5dXTSaFvQG+02VdRXcdytWLAZsAq1PecU8uqQAhkrnbli7DagjtXKW/Bl7YJbUsa8MPcuc8LHEQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/node": "*"
      }
    },
    "node_modules/@types/http-cache-semantics": {
      "version": "4.2.0",
      "resolved": "https://registry.npmjs.org/@types/http-cache-semantics/-/http-cache-semantics-4.2.0.tgz",
      "integrity": "sha512-L3LgimLHXtGkWikKnsPg0/VFx9OGZaC+eN1u4r+OB1XRqH3meBIAVC2zr1WdMH+RHmnRkqliQAOHNJ/E0j/e0Q==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@types/istanbul-lib-coverage": {
      "version": "2.0.6",
      "resolved": "https://registry.npmjs.org/@types/istanbul-lib-coverage/-/istanbul-lib-coverage-2.0.6.tgz",
      "integrity": "sha512-2QF/t/auWm0lsy8XtKVPG19v3sSOQlJe/YHZgfjb/KBBHOGSV+J2q/S671rcq9uTBrLAXmZpqJiaQbMT+zNU1w==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@types/istanbul-lib-report": {
      "version": "3.0.3",
      "resolved": "https://registry.npmjs.org/@types/istanbul-lib-report/-/istanbul-lib-report-3.0.3.tgz",
      "integrity": "sha512-NQn7AHQnk/RSLOxrBbGyJM/aVQ+pjj5HCgasFxc0K/KhoATfQ/47AyUl15I2yBUpihjmas+a+VJBOqecrFH+uA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/istanbul-lib-coverage": "*"
      }
    },
    "node_modules/@types/istanbul-reports": {
      "version": "3.0.4",
      "resolved": "https://registry.npmjs.org/@types/istanbul-reports/-/istanbul-reports-3.0.4.tgz",
      "integrity": "sha512-pk2B1NWalF9toCRu6gjBzR69syFjP4Od8WRAX+0mmf9lAjCRicLOWc+ZrxZHx/0XRjotgkF9t6iaMJ+aXcOdZQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/istanbul-lib-report": "*"
      }
    },
    "node_modules/@types/jest": {
      "version": "29.5.14",
      "resolved": "https://registry.npmjs.org/@types/jest/-/jest-29.5.14.tgz",
      "integrity": "sha512-ZN+4sdnLUbo8EVvVc2ao0GFW6oVrQRPn4K2lglySj7APvSrgzxHiNNK99us4WDMi57xxA2yggblIAMNhXOotLQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "expect": "^29.0.0",
        "pretty-format": "^29.0.0"
      }
    },
    "node_modules/@types/keyv": {
      "version": "3.1.4",
      "resolved": "https://registry.npmjs.org/@types/keyv/-/keyv-3.1.4.tgz",
      "integrity": "sha512-BQ5aZNSCpj7D6K2ksrRCTmKRLEpnPvWDiLPfoGyhZ++8YtiK9d/3DBKPJgry359X/P1PfruyYwvnvwFjuEiEIg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/node": "*"
      }
    },
    "node_modules/@types/minimatch": {
      "version": "3.0.5",
      "resolved": "https://registry.npmjs.org/@types/minimatch/-/minimatch-3.0.5.tgz",
      "integrity": "sha512-Klz949h02Gz2uZCMGwDUSDS1YBlTdDDgbWHi+81l29tQALUtvz4rAYi5uoVhE5Lagoq6DeqAUlbrHvW/mXDgdQ==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@types/node": {
      "version": "25.3.3",
      "resolved": "https://registry.npmjs.org/@types/node/-/node-25.3.3.tgz",
      "integrity": "sha512-DpzbrH7wIcBaJibpKo9nnSQL0MTRdnWttGyE5haGwK86xgMOkFLp7vEyfQPGLOJh5wNYiJ3V9PmUMDhV9u8kkQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "undici-types": "~7.18.0"
      }
    },
    "node_modules/@types/normalize-package-data": {
      "version": "2.4.4",
      "resolved": "https://registry.npmjs.org/@types/normalize-package-data/-/normalize-package-data-2.4.4.tgz",
      "integrity": "sha512-37i+OaWTh9qeK4LSHPsyRC7NahnGotNuZvjLSgcPzblpHB3rrCJxAOgI5gCdKm7coonsaX1Of0ILiTcnZjbfxA==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@types/responselike": {
      "version": "1.0.3",
      "resolved": "https://registry.npmjs.org/@types/responselike/-/responselike-1.0.3.tgz",
      "integrity": "sha512-H/+L+UkTV33uf49PH5pCAUBVPNj2nDBXTN+qS1dOwyyg24l3CcicicCA7ca+HMvJBZcFgl5r8e+RR6elsb4Lyw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/node": "*"
      }
    },
    "node_modules/@types/stack-utils": {
      "version": "2.0.3",
      "resolved": "https://registry.npmjs.org/@types/stack-utils/-/stack-utils-2.0.3.tgz",
      "integrity": "sha512-9aEbYZ3TbYMznPdcdr3SmIrLXwC/AKZXQeCf9Pgao5CKb8CyHuEX5jzWPTkvregvhRJHcpRO6BFoGW9ycaOkYw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@types/yargs": {
      "version": "17.0.35",
      "resolved": "https://registry.npmjs.org/@types/yargs/-/yargs-17.0.35.tgz",
      "integrity": "sha512-qUHkeCyQFxMXg79wQfTtfndEC+N9ZZg76HJftDJp+qH2tV7Gj4OJi7l+PiWwJ+pWtW8GwSmqsDj/oymhrTWXjg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/yargs-parser": "*"
      }
    },
    "node_modules/@types/yargs-parser": {
      "version": "21.0.3",
      "resolved": "https://registry.npmjs.org/@types/yargs-parser/-/yargs-parser-21.0.3.tgz",
      "integrity": "sha512-I4q9QU9MQv4oEOz4tAHJtNz1cwuLxn2F3xcc2iV5WdqLPpUnj30aUuxt1mAxYTG+oe8CZMV/+6rU4S4gRDzqtQ==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/abort-controller": {
      "version": "3.0.0",
      "resolved": "https://registry.npmjs.org/abort-controller/-/abort-controller-3.0.0.tgz",
      "integrity": "sha512-h8lQ8tacZYnR3vNQTgibj+tODHI5/+l06Au2Pcriv/Gmet0eaj4TwWH41sO9wnHDiQsEj19q0drzdWdeAHtweg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "event-target-shim": "^5.0.0"
      },
      "engines": {
        "node": ">=6.5"
      }
    },
    "node_modules/agent-base": {
      "version": "6.0.2",
      "resolved": "https://registry.npmjs.org/agent-base/-/agent-base-6.0.2.tgz",
      "integrity": "sha512-RZNwNclF7+MS/8bDg70amg32dyeZGZxiDuQmZxKLAlQjr3jGyLx+4Kkk58UO7D2QdgFIQCovuSuZESne6RG6XQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "debug": "4"
      },
      "engines": {
        "node": ">= 6.0.0"
      }
    },
    "node_modules/aggregate-error": {
      "version": "4.0.1",
      "resolved": "https://registry.npmjs.org/aggregate-error/-/aggregate-error-4.0.1.tgz",
      "integrity": "sha512-0poP0T7el6Vq3rstR8Mn4V/IQrpBLO6POkUSrN7RhyY+GF/InCFShQzsQ39T25gkHhLgSLByyAz+Kjb+c2L98w==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "clean-stack": "^4.0.0",
        "indent-string": "^5.0.0"
      },
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/ansi-escapes": {
      "version": "4.3.2",
      "resolved": "https://registry.npmjs.org/ansi-escapes/-/ansi-escapes-4.3.2.tgz",
      "integrity": "sha512-gKXj5ALrKWQLsYG9jlTRmR/xKluxHV+Z9QEwNIgCfM1/uwPMCuzVVnh5mwTd+OuBZcwSIMbqssNWRm1lE51QaQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "type-fest": "^0.21.3"
      },
      "engines": {
        "node": ">=8"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/ansi-regex": {
      "version": "5.0.1",
      "resolved": "https://registry.npmjs.org/ansi-regex/-/ansi-regex-5.0.1.tgz",
      "integrity": "sha512-quJQXlTSUGL2LH9SUXo8VwsY4soanhgo6LNSm84E1LBcE8s3O0wpdiRzyR9z/ZZJMlMWv37qOOb9pdJlMUEKFQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/ansi-styles": {
      "version": "4.3.0",
      "resolved": "https://registry.npmjs.org/ansi-styles/-/ansi-styles-4.3.0.tgz",
      "integrity": "sha512-zbB9rCJAT1rbjiVDb2hqKFHNYLxgtk8NURxZ3IZwD3F6NtxbXZQCnnSi1Lkx+IDohdPlFp222wVALIheZJQSEg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "color-convert": "^2.0.1"
      },
      "engines": {
        "node": ">=8"
      },
      "funding": {
        "url": "https://github.com/chalk/ansi-styles?sponsor=1"
      }
    },
    "node_modules/anymatch": {
      "version": "3.1.3",
      "resolved": "https://registry.npmjs.org/anymatch/-/anymatch-3.1.3.tgz",
      "integrity": "sha512-KMReFUr0B4t+D+OBkjR3KYqvocp2XaSzO55UcB6mgQMd3KbcE+mWTyvVV7D/zsdEbNnV6acZUutkiHQXvTr1Rw==",
      "dev": true,
      "license": "ISC",
      "dependencies": {
        "normalize-path": "^3.0.0",
        "picomatch": "^2.0.4"
      },
      "engines": {
        "node": ">= 8"
      }
    },
    "node_modules/argparse": {
      "version": "1.0.10",
      "resolved": "https://registry.npmjs.org/argparse/-/argparse-1.0.10.tgz",
      "integrity": "sha512-o5Roy6tNG4SL/FOkCAN6RzjiakZS25RLYFrcMttJqbdd8BWrnA+fGz57iN5Pb06pvBGvl5gQ0B48dJlslXvoTg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "sprintf-js": "~1.0.2"
      }
    },
    "node_modules/array-differ": {
      "version": "3.0.0",
      "resolved": "https://registry.npmjs.org/array-differ/-/array-differ-3.0.0.tgz",
      "integrity": "sha512-THtfYS6KtME/yIAhKjZ2ul7XI96lQGHRputJQHO80LAWQnuGP4iCIN8vdMRboGbIEYBwU33q8Tch1os2+X0kMg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/array-find-index": {
      "version": "1.0.2",
      "resolved": "https://registry.npmjs.org/array-find-index/-/array-find-index-1.0.2.tgz",
      "integrity": "sha512-M1HQyIXcBGtVywBt8WVdim+lrNaK7VHp99Qt5pSNziXznKHViIBbXWtfRTpEFpF/c4FdfxNAsCCwPp5phBYJtw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/array-union": {
      "version": "2.1.0",
      "resolved": "https://registry.npmjs.org/array-union/-/array-union-2.1.0.tgz",
      "integrity": "sha512-HGyxoOTYUyCM6stUe6EJgnd4EoewAI7zMdfqO+kGjnlZmBDz/cR5pf8r/cR4Wq60sL/p0IkcjUEEPwS3GFrIyw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/arrify": {
      "version": "2.0.1",
      "resolved": "https://registry.npmjs.org/arrify/-/arrify-2.0.1.tgz",
      "integrity": "sha512-3duEwti880xqi4eAMN8AyR4a0ByT90zoYdLlevfrvU43vb0YZwZVfxOgxWrLXXXpyugL0hNZc9G6BiB5B3nUug==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/babel-jest": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/babel-jest/-/babel-jest-29.7.0.tgz",
      "integrity": "sha512-BrvGY3xZSwEcCzKvKsCi2GgHqDqsYkOP4/by5xCgIwGXQxIEh+8ew3gmrE1y7XRR6LHZIj6yLYnUi/mm2KXKBg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jest/transform": "^29.7.0",
        "@types/babel__core": "^7.1.14",
        "babel-plugin-istanbul": "^6.1.1",
        "babel-preset-jest": "^29.6.3",
        "chalk": "^4.0.0",
        "graceful-fs": "^4.2.9",
        "slash": "^3.0.0"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      },
      "peerDependencies": {
        "@babel/core": "^7.8.0"
      }
    },
    "node_modules/babel-plugin-istanbul": {
      "version": "6.1.1",
      "resolved": "https://registry.npmjs.org/babel-plugin-istanbul/-/babel-plugin-istanbul-6.1.1.tgz",
      "integrity": "sha512-Y1IQok9821cC9onCx5otgFfRm7Lm+I+wwxOx738M/WLPZ9Q42m4IG5W0FNX8WLL2gYMZo3JkuXIH2DOpWM+qwA==",
      "dev": true,
      "license": "BSD-3-Clause",
      "dependencies": {
        "@babel/helper-plugin-utils": "^7.0.0",
        "@istanbuljs/load-nyc-config": "^1.0.0",
        "@istanbuljs/schema": "^0.1.2",
        "istanbul-lib-instrument": "^5.0.4",
        "test-exclude": "^6.0.0"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/babel-plugin-istanbul/node_modules/istanbul-lib-instrument": {
      "version": "5.2.1",
      "resolved": "https://registry.npmjs.org/istanbul-lib-instrument/-/istanbul-lib-instrument-5.2.1.tgz",
      "integrity": "sha512-pzqtp31nLv/XFOzXGuvhCb8qhjmTVo5vjVk19XE4CRlSWz0KoeJ3bw9XsA7nOp9YBf4qHjwBxkDzKcME/J29Yg==",
      "dev": true,
      "license": "BSD-3-Clause",
      "dependencies": {
        "@babel/core": "^7.12.3",
        "@babel/parser": "^7.14.7",
        "@istanbuljs/schema": "^0.1.2",
        "istanbul-lib-coverage": "^3.2.0",
        "semver": "^6.3.0"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/babel-plugin-jest-hoist": {
      "version": "29.6.3",
      "resolved": "https://registry.npmjs.org/babel-plugin-jest-hoist/-/babel-plugin-jest-hoist-29.6.3.tgz",
      "integrity": "sha512-ESAc/RJvGTFEzRwOTT4+lNDk/GNHMkKbNzsvT0qKRfDyyYTskxB5rnU2njIDYVxXCBHHEI1c0YwHob3WaYujOg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/template": "^7.3.3",
        "@babel/types": "^7.3.3",
        "@types/babel__core": "^7.1.14",
        "@types/babel__traverse": "^7.0.6"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/babel-preset-current-node-syntax": {
      "version": "1.2.0",
      "resolved": "https://registry.npmjs.org/babel-preset-current-node-syntax/-/babel-preset-current-node-syntax-1.2.0.tgz",
      "integrity": "sha512-E/VlAEzRrsLEb2+dv8yp3bo4scof3l9nR4lrld+Iy5NyVqgVYUJnDAmunkhPMisRI32Qc4iRiz425d8vM++2fg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/plugin-syntax-async-generators": "^7.8.4",
        "@babel/plugin-syntax-bigint": "^7.8.3",
        "@babel/plugin-syntax-class-properties": "^7.12.13",
        "@babel/plugin-syntax-class-static-block": "^7.14.5",
        "@babel/plugin-syntax-import-attributes": "^7.24.7",
        "@babel/plugin-syntax-import-meta": "^7.10.4",
        "@babel/plugin-syntax-json-strings": "^7.8.3",
        "@babel/plugin-syntax-logical-assignment-operators": "^7.10.4",
        "@babel/plugin-syntax-nullish-coalescing-operator": "^7.8.3",
        "@babel/plugin-syntax-numeric-separator": "^7.10.4",
        "@babel/plugin-syntax-object-rest-spread": "^7.8.3",
        "@babel/plugin-syntax-optional-catch-binding": "^7.8.3",
        "@babel/plugin-syntax-optional-chaining": "^7.8.3",
        "@babel/plugin-syntax-private-property-in-object": "^7.14.5",
        "@babel/plugin-syntax-top-level-await": "^7.14.5"
      },
      "peerDependencies": {
        "@babel/core": "^7.0.0 || ^8.0.0-0"
      }
    },
    "node_modules/babel-preset-jest": {
      "version": "29.6.3",
      "resolved": "https://registry.npmjs.org/babel-preset-jest/-/babel-preset-jest-29.6.3.tgz",
      "integrity": "sha512-0B3bhxR6snWXJZtR/RliHTDPRgn1sNHOR0yVtq/IiQFyuOVjFS+wuio/R4gSNkyYmKmJB4wGZv2NZanmKmTnNA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "babel-plugin-jest-hoist": "^29.6.3",
        "babel-preset-current-node-syntax": "^1.0.0"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      },
      "peerDependencies": {
        "@babel/core": "^7.0.0"
      }
    },
    "node_modules/balanced-match": {
      "version": "1.0.2",
      "resolved": "https://registry.npmjs.org/balanced-match/-/balanced-match-1.0.2.tgz",
      "integrity": "sha512-3oSeUO0TMV67hN1AmbXsK4yaqU7tjiHlbxRDZOpH0KW9+CeX4bRAaX0Anxt0tx2MrpRpWwQaPwIlISEJhYU5Pw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/base64-js": {
      "version": "1.5.1",
      "resolved": "https://registry.npmjs.org/base64-js/-/base64-js-1.5.1.tgz",
      "integrity": "sha512-AKpaYlHn8t4SVbOHCy+b5+KKgvR4vrsD8vbvrbiQJps7fKDTkjkDry6ji0rUJjC0kzbNePLwzxq8iypo41qeWA==",
      "dev": true,
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/feross"
        },
        {
          "type": "patreon",
          "url": "https://www.patreon.com/feross"
        },
        {
          "type": "consulting",
          "url": "https://feross.org/support"
        }
      ],
      "license": "MIT"
    },
    "node_modules/baseline-browser-mapping": {
      "version": "2.10.0",
      "resolved": "https://registry.npmjs.org/baseline-browser-mapping/-/baseline-browser-mapping-2.10.0.tgz",
      "integrity": "sha512-lIyg0szRfYbiy67j9KN8IyeD7q7hcmqnJ1ddWmNt19ItGpNN64mnllmxUNFIOdOm6by97jlL6wfpTTJrmnjWAA==",
      "dev": true,
      "license": "Apache-2.0",
      "bin": {
        "baseline-browser-mapping": "dist/cli.cjs"
      },
      "engines": {
        "node": ">=6.0.0"
      }
    },
    "node_modules/bignumber.js": {
      "version": "9.3.1",
      "resolved": "https://registry.npmjs.org/bignumber.js/-/bignumber.js-9.3.1.tgz",
      "integrity": "sha512-Ko0uX15oIUS7wJ3Rb30Fs6SkVbLmPBAKdlm7q9+ak9bbIeFf0MwuBsQV6z7+X768/cHsfg+WlysDWJcmthjsjQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": "*"
      }
    },
    "node_modules/binary-extensions": {
      "version": "2.3.0",
      "resolved": "https://registry.npmjs.org/binary-extensions/-/binary-extensions-2.3.0.tgz",
      "integrity": "sha512-Ceh+7ox5qe7LJuLHoY0feh3pHuUDHAcRUeyL2VYghZwfpkNIy/+8Ocg0a3UuSoYzavmylwuLWQOf3hl0jjMMIw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/bl": {
      "version": "5.1.0",
      "resolved": "https://registry.npmjs.org/bl/-/bl-5.1.0.tgz",
      "integrity": "sha512-tv1ZJHLfTDnXE6tMHv73YgSJaWR2AFuPwMntBe7XL/GBFHnT0CLnsHMogfk5+GzCDC5ZWarSCYaIGATZt9dNsQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "buffer": "^6.0.3",
        "inherits": "^2.0.4",
        "readable-stream": "^3.4.0"
      }
    },
    "node_modules/brace-expansion": {
      "version": "1.1.12",
      "resolved": "https://registry.npmjs.org/brace-expansion/-/brace-expansion-1.1.12.tgz",
      "integrity": "sha512-9T9UjW3r0UW5c1Q7GTwllptXwhvYmEzFhzMfZ9H7FQWt+uZePjZPjBP/W1ZEyZ1twGWom5/56TF4lPcqjnDHcg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "balanced-match": "^1.0.0",
        "concat-map": "0.0.1"
      }
    },
    "node_modules/braces": {
      "version": "3.0.3",
      "resolved": "https://registry.npmjs.org/braces/-/braces-3.0.3.tgz",
      "integrity": "sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "fill-range": "^7.1.1"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/browserslist": {
      "version": "4.28.1",
      "resolved": "https://registry.npmjs.org/browserslist/-/browserslist-4.28.1.tgz",
      "integrity": "sha512-ZC5Bd0LgJXgwGqUknZY/vkUQ04r8NXnJZ3yYi4vDmSiZmC/pdSN0NbNRPxZpbtO4uAfDUAFffO8IZoM3Gj8IkA==",
      "dev": true,
      "funding": [
        {
          "type": "opencollective",
          "url": "https://opencollective.com/browserslist"
        },
        {
          "type": "tidelift",
          "url": "https://tidelift.com/funding/github/npm/browserslist"
        },
        {
          "type": "github",
          "url": "https://github.com/sponsors/ai"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "baseline-browser-mapping": "^2.9.0",
        "caniuse-lite": "^1.0.30001759",
        "electron-to-chromium": "^1.5.263",
        "node-releases": "^2.0.27",
        "update-browserslist-db": "^1.2.0"
      },
      "bin": {
        "browserslist": "cli.js"
      },
      "engines": {
        "node": "^6 || ^7 || ^8 || ^9 || ^10 || ^11 || ^12 || >=13.7"
      }
    },
    "node_modules/bs-logger": {
      "version": "0.2.6",
      "resolved": "https://registry.npmjs.org/bs-logger/-/bs-logger-0.2.6.tgz",
      "integrity": "sha512-pd8DCoxmbgc7hyPKOvxtqNcjYoOsABPQdcCUjGp3d42VR2CX1ORhk2A87oqqu5R1kk+76nsxZupkmyd+MVtCog==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "fast-json-stable-stringify": "2.x"
      },
      "engines": {
        "node": ">= 6"
      }
    },
    "node_modules/bser": {
      "version": "2.1.1",
      "resolved": "https://registry.npmjs.org/bser/-/bser-2.1.1.tgz",
      "integrity": "sha512-gQxTNE/GAfIIrmHLUE3oJyp5FO6HRBfhjnw4/wMmA63ZGDJnWBmgY/lyQBpnDUkGmAhbSe39tx2d/iTOAfglwQ==",
      "dev": true,
      "license": "Apache-2.0",
      "dependencies": {
        "node-int64": "^0.4.0"
      }
    },
    "node_modules/buffer": {
      "version": "6.0.3",
      "resolved": "https://registry.npmjs.org/buffer/-/buffer-6.0.3.tgz",
      "integrity": "sha512-FTiCpNxtwiZZHEZbcbTIcZjERVICn9yq/pDFkTl95/AxzD1naBctN7YO68riM/gLSDY7sdrMby8hofADYuuqOA==",
      "dev": true,
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/feross"
        },
        {
          "type": "patreon",
          "url": "https://www.patreon.com/feross"
        },
        {
          "type": "consulting",
          "url": "https://feross.org/support"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "base64-js": "^1.3.1",
        "ieee754": "^1.2.1"
      }
    },
    "node_modules/buffer-equal-constant-time": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/buffer-equal-constant-time/-/buffer-equal-constant-time-1.0.1.tgz",
      "integrity": "sha512-zRpUiDwd/xk6ADqPMATG8vc9VPrkck7T07OIx0gnjmJAnHnTVXNQG3vfvWNuiZIkwu9KrKdA1iJKfsfTVxE6NA==",
      "dev": true,
      "license": "BSD-3-Clause"
    },
    "node_modules/buffer-from": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/buffer-from/-/buffer-from-1.1.2.tgz",
      "integrity": "sha512-E+XQCRwSbaaiChtv6k6Dwgc+bx+Bs6vuKJHHl5kox/BaKbhiXzqQOwK4cO22yElGp2OCmjwVhT3HmxgyPGnJfQ==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/cacheable-lookup": {
      "version": "5.0.4",
      "resolved": "https://registry.npmjs.org/cacheable-lookup/-/cacheable-lookup-5.0.4.tgz",
      "integrity": "sha512-2/kNscPhpcxrOigMZzbiWF7dz8ilhb/nIHU3EyZiXWXpeq/au8qJ8VhdftMkty3n7Gj6HIGalQG8oiBNB3AJgA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=10.6.0"
      }
    },
    "node_modules/cacheable-request": {
      "version": "7.0.4",
      "resolved": "https://registry.npmjs.org/cacheable-request/-/cacheable-request-7.0.4.tgz",
      "integrity": "sha512-v+p6ongsrp0yTGbJXjgxPow2+DL93DASP4kXCDKb8/bwRtt9OEF3whggkkDkGNzgcWy2XaF4a8nZglC7uElscg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "clone-response": "^1.0.2",
        "get-stream": "^5.1.0",
        "http-cache-semantics": "^4.0.0",
        "keyv": "^4.0.0",
        "lowercase-keys": "^2.0.0",
        "normalize-url": "^6.0.1",
        "responselike": "^2.0.0"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/call-bind-apply-helpers": {
      "version": "1.0.2",
      "resolved": "https://registry.npmjs.org/call-bind-apply-helpers/-/call-bind-apply-helpers-1.0.2.tgz",
      "integrity": "sha512-Sp1ablJ0ivDkSzjcaJdxEunN5/XvksFJ2sMBFfq6x0ryhQV/2b/KwFe21cMpmHtPOSij8K99/wSfoEuTObmuMQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "es-errors": "^1.3.0",
        "function-bind": "^1.1.2"
      },
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/call-bound": {
      "version": "1.0.4",
      "resolved": "https://registry.npmjs.org/call-bound/-/call-bound-1.0.4.tgz",
      "integrity": "sha512-+ys997U96po4Kx/ABpBCqhA9EuxJaQWDQg7295H4hBphv3IZg0boBKuwYpt4YXp6MZ5AmZQnU/tyMTlRpaSejg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "call-bind-apply-helpers": "^1.0.2",
        "get-intrinsic": "^1.3.0"
      },
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/callsites": {
      "version": "3.1.0",
      "resolved": "https://registry.npmjs.org/callsites/-/callsites-3.1.0.tgz",
      "integrity": "sha512-P8BjAsXvZS+VIDUI11hHCQEv74YT67YUi5JJFNWIqL235sBmjX4+qx9Muvls5ivyNENctx46xQLQ3aTuE7ssaQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/camelcase": {
      "version": "5.3.1",
      "resolved": "https://registry.npmjs.org/camelcase/-/camelcase-5.3.1.tgz",
      "integrity": "sha512-L28STB170nwWS63UjtlEOE3dldQApaJXZkOI1uMFfzf3rRuPegHaHesyee+YxQ+W6SvRDQV6UrdOdRiR153wJg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/caniuse-lite": {
      "version": "1.0.30001775",
      "resolved": "https://registry.npmjs.org/caniuse-lite/-/caniuse-lite-1.0.30001775.tgz",
      "integrity": "sha512-s3Qv7Lht9zbVKE9XoTyRG6wVDCKdtOFIjBGg3+Yhn6JaytuNKPIjBMTMIY1AnOH3seL5mvF+x33oGAyK3hVt3A==",
      "dev": true,
      "funding": [
        {
          "type": "opencollective",
          "url": "https://opencollective.com/browserslist"
        },
        {
          "type": "tidelift",
          "url": "https://tidelift.com/funding/github/npm/caniuse-lite"
        },
        {
          "type": "github",
          "url": "https://github.com/sponsors/ai"
        }
      ],
      "license": "CC-BY-4.0"
    },
    "node_modules/chalk": {
      "version": "4.1.2",
      "resolved": "https://registry.npmjs.org/chalk/-/chalk-4.1.2.tgz",
      "integrity": "sha512-oKnbhFyRIXpUuez8iBMmyEa4nbj4IOQyuhc/wy9kY7/WVPcwIO9VA668Pu8RkO7+0G76SLROeyw9CpQ061i4mA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "ansi-styles": "^4.1.0",
        "supports-color": "^7.1.0"
      },
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/chalk/chalk?sponsor=1"
      }
    },
    "node_modules/char-regex": {
      "version": "1.0.2",
      "resolved": "https://registry.npmjs.org/char-regex/-/char-regex-1.0.2.tgz",
      "integrity": "sha512-kWWXztvZ5SBQV+eRgKFeh8q5sLuZY2+8WUIzlxWVTg+oGwY14qylx1KbKzHd8P6ZYkAg0xyIDU9JMHhyJMZ1jw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/chardet": {
      "version": "2.1.1",
      "resolved": "https://registry.npmjs.org/chardet/-/chardet-2.1.1.tgz",
      "integrity": "sha512-PsezH1rqdV9VvyNhxxOW32/d75r01NY7TQCmOqomRo15ZSOKbpTFVsfjghxo6JloQUCGnH4k1LGu0R4yCLlWQQ==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/chokidar": {
      "version": "3.6.0",
      "resolved": "https://registry.npmjs.org/chokidar/-/chokidar-3.6.0.tgz",
      "integrity": "sha512-7VT13fmjotKpGipCW9JEQAusEPE+Ei8nl6/g4FBAmIm0GOOLMua9NDDo/DWp0ZAxCr3cPq5ZpBqmPAQgDda2Pw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "anymatch": "~3.1.2",
        "braces": "~3.0.2",
        "glob-parent": "~5.1.2",
        "is-binary-path": "~2.1.0",
        "is-glob": "~4.0.1",
        "normalize-path": "~3.0.0",
        "readdirp": "~3.6.0"
      },
      "engines": {
        "node": ">= 8.10.0"
      },
      "funding": {
        "url": "https://paulmillr.com/funding/"
      },
      "optionalDependencies": {
        "fsevents": "~2.3.2"
      }
    },
    "node_modules/ci-info": {
      "version": "3.9.0",
      "resolved": "https://registry.npmjs.org/ci-info/-/ci-info-3.9.0.tgz",
      "integrity": "sha512-NIxF55hv4nSqQswkAeiOi1r83xy8JldOFDTWiug55KBu9Jnblncd2U6ViHmYgHf01TPZS77NJBhBMKdWj9HQMQ==",
      "dev": true,
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/sibiraj-s"
        }
      ],
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/cjs-module-lexer": {
      "version": "1.4.3",
      "resolved": "https://registry.npmjs.org/cjs-module-lexer/-/cjs-module-lexer-1.4.3.tgz",
      "integrity": "sha512-9z8TZaGM1pfswYeXrUpzPrkx8UnWYdhJclsiYMm6x/w5+nN+8Tf/LnAgfLGQCm59qAOxU8WwHEq2vNwF6i4j+Q==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/clean-stack": {
      "version": "4.2.0",
      "resolved": "https://registry.npmjs.org/clean-stack/-/clean-stack-4.2.0.tgz",
      "integrity": "sha512-LYv6XPxoyODi36Dp976riBtSY27VmFo+MKqEU9QCCWyTrdEPDog+RWA7xQWHi6Vbp61j5c4cdzzX1NidnwtUWg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "escape-string-regexp": "5.0.0"
      },
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/clean-stack/node_modules/escape-string-regexp": {
      "version": "5.0.0",
      "resolved": "https://registry.npmjs.org/escape-string-regexp/-/escape-string-regexp-5.0.0.tgz",
      "integrity": "sha512-/veY75JbMK4j1yjvuUxuVsiS/hr/4iHs9FTT6cgTexxdE0Ly/glccBAkloH/DofkjRbZU3bnoj38mOmhkZ0lHw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/cli-cursor": {
      "version": "3.1.0",
      "resolved": "https://registry.npmjs.org/cli-cursor/-/cli-cursor-3.1.0.tgz",
      "integrity": "sha512-I/zHAwsKf9FqGoXM4WWRACob9+SNukZTd94DWF57E4toouRulbCxcUh6RKUEOQlYTHJnzkPMySvPNaaSLNfLZw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "restore-cursor": "^3.1.0"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/cli-spinners": {
      "version": "2.9.2",
      "resolved": "https://registry.npmjs.org/cli-spinners/-/cli-spinners-2.9.2.tgz",
      "integrity": "sha512-ywqV+5MmyL4E7ybXgKys4DugZbX0FC6LnwrhjuykIjnK9k8OQacQ7axGKnjDXWNhns0xot3bZI5h55H8yo9cJg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/cli-truncate": {
      "version": "3.1.0",
      "resolved": "https://registry.npmjs.org/cli-truncate/-/cli-truncate-3.1.0.tgz",
      "integrity": "sha512-wfOBkjXteqSnI59oPcJkcPl/ZmwvMMOj340qUIY1SKZCv0B9Cf4D4fAucRkIKQmsIuYK3x1rrgU7MeGRruiuiA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "slice-ansi": "^5.0.0",
        "string-width": "^5.0.0"
      },
      "engines": {
        "node": "^12.20.0 || ^14.13.1 || >=16.0.0"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/cli-width": {
      "version": "3.0.0",
      "resolved": "https://registry.npmjs.org/cli-width/-/cli-width-3.0.0.tgz",
      "integrity": "sha512-FxqpkPPwu1HjuN93Omfm4h8uIanXofW0RxVEW3k5RKx+mJJYSthzNhp32Kzxxy3YAEZ/Dc/EWN1vZRY0+kOhbw==",
      "dev": true,
      "license": "ISC",
      "engines": {
        "node": ">= 10"
      }
    },
    "node_modules/cliui": {
      "version": "8.0.1",
      "resolved": "https://registry.npmjs.org/cliui/-/cliui-8.0.1.tgz",
      "integrity": "sha512-BSeNnyus75C4//NQ9gQt1/csTXyo/8Sb+afLAkzAptFuMsod9HFokGNudZpi/oQV73hnVK+sR+5PVRMd+Dr7YQ==",
      "dev": true,
      "license": "ISC",
      "dependencies": {
        "string-width": "^4.2.0",
        "strip-ansi": "^6.0.1",
        "wrap-ansi": "^7.0.0"
      },
      "engines": {
        "node": ">=12"
      }
    },
    "node_modules/cliui/node_modules/emoji-regex": {
      "version": "8.0.0",
      "resolved": "https://registry.npmjs.org/emoji-regex/-/emoji-regex-8.0.0.tgz",
      "integrity": "sha512-MSjYzcWNOA0ewAHpz0MxpYFvwg6yjy1NG3xteoqz644VCo/RPgnr1/GGt+ic3iJTzQ8Eu3TdM14SawnVUmGE6A==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/cliui/node_modules/is-fullwidth-code-point": {
      "version": "3.0.0",
      "resolved": "https://registry.npmjs.org/is-fullwidth-code-point/-/is-fullwidth-code-point-3.0.0.tgz",
      "integrity": "sha512-zymm5+u+sCsSWyD9qNaejV3DFvhCKclKdizYaJUuHA83RLjb7nSuGnddCHGv0hk+KY7BMAlsWeK4Ueg6EV6XQg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/cliui/node_modules/string-width": {
      "version": "4.2.3",
      "resolved": "https://registry.npmjs.org/string-width/-/string-width-4.2.3.tgz",
      "integrity": "sha512-wKyQRQpjJ0sIp62ErSZdGsjMJWsap5oRNihHhu6G7JVO/9jIB6UyevL+tXuOqrng8j/cxKTWyWUwvSTriiZz/g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "emoji-regex": "^8.0.0",
        "is-fullwidth-code-point": "^3.0.0",
        "strip-ansi": "^6.0.1"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/cliui/node_modules/wrap-ansi": {
      "version": "7.0.0",
      "resolved": "https://registry.npmjs.org/wrap-ansi/-/wrap-ansi-7.0.0.tgz",
      "integrity": "sha512-YVGIj2kamLSTxw6NsZjoBxfSwsn0ycdesmc4p+Q21c5zPuZ1pl+NfxVdxPtdHvmNVOQ6XSYG4AUtyt/Fi7D16Q==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "ansi-styles": "^4.0.0",
        "string-width": "^4.1.0",
        "strip-ansi": "^6.0.0"
      },
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/chalk/wrap-ansi?sponsor=1"
      }
    },
    "node_modules/clone": {
      "version": "1.0.4",
      "resolved": "https://registry.npmjs.org/clone/-/clone-1.0.4.tgz",
      "integrity": "sha512-JQHZ2QMW6l3aH/j6xCqQThY/9OH4D/9ls34cgkUBiEeocRTU04tHfKPBsUK1PqZCUQM7GiA0IIXJSuXHI64Kbg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=0.8"
      }
    },
    "node_modules/clone-response": {
      "version": "1.0.3",
      "resolved": "https://registry.npmjs.org/clone-response/-/clone-response-1.0.3.tgz",
      "integrity": "sha512-ROoL94jJH2dUVML2Y/5PEDNaSHgeOdSDicUyS7izcF63G6sTc/FTjLub4b8Il9S8S0beOfYt0TaA5qvFK+w0wA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "mimic-response": "^1.0.0"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/co": {
      "version": "4.6.0",
      "resolved": "https://registry.npmjs.org/co/-/co-4.6.0.tgz",
      "integrity": "sha512-QVb0dM5HvG+uaxitm8wONl7jltx8dqhfU33DcqtOZcLSVIKSDDLDi7+0LbAKiyI8hD9u42m2YxXSkMGWThaecQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "iojs": ">= 1.0.0",
        "node": ">= 0.12.0"
      }
    },
    "node_modules/collect-v8-coverage": {
      "version": "1.0.3",
      "resolved": "https://registry.npmjs.org/collect-v8-coverage/-/collect-v8-coverage-1.0.3.tgz",
      "integrity": "sha512-1L5aqIkwPfiodaMgQunkF1zRhNqifHBmtbbbxcr6yVxxBnliw4TDOW6NxpO8DJLgJ16OT+Y4ztZqP6p/FtXnAw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/color-convert": {
      "version": "2.0.1",
      "resolved": "https://registry.npmjs.org/color-convert/-/color-convert-2.0.1.tgz",
      "integrity": "sha512-RRECPsj7iu/xb5oKYcsFHSppFNnsj/52OVTRKb4zP5onXwVF3zVmmToNcOfGC+CRDpfK/U584fMg38ZHCaElKQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "color-name": "~1.1.4"
      },
      "engines": {
        "node": ">=7.0.0"
      }
    },
    "node_modules/color-name": {
      "version": "1.1.4",
      "resolved": "https://registry.npmjs.org/color-name/-/color-name-1.1.4.tgz",
      "integrity": "sha512-dOy+3AuW3a2wNbZHIuMZpTcgjGuLU/uBL/ubcZF9OXbDo8ff4O8yVp5Bf0efS8uEoYo5q4Fx7dY9OgQGXgAsQA==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/commander": {
      "version": "8.3.0",
      "resolved": "https://registry.npmjs.org/commander/-/commander-8.3.0.tgz",
      "integrity": "sha512-OkTL9umf+He2DZkUq8f8J9of7yL6RJKI24dVITBmNfZBmri9zYZQrKkuXiKhyfPSu8tUhnVBB1iKXevvnlR4Ww==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">= 12"
      }
    },
    "node_modules/concat-map": {
      "version": "0.0.1",
      "resolved": "https://registry.npmjs.org/concat-map/-/concat-map-0.0.1.tgz",
      "integrity": "sha512-/Srv4dswyQNBfohGpz9o6Yb3Gz3SrUDqBH5rTuhGR7ahtlbYKnVxw2bCFMRljaA7EXHaXZ8wsHdodFvbkhKmqg==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/convert-source-map": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/convert-source-map/-/convert-source-map-2.0.0.tgz",
      "integrity": "sha512-Kvp459HrV2FEJ1CAsi1Ku+MY3kasH19TFykTz2xWmMeq6bk2NU3XXvfJ+Q61m0xktWwt+1HSYf3JZsTms3aRJg==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/create-jest": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/create-jest/-/create-jest-29.7.0.tgz",
      "integrity": "sha512-Adz2bdH0Vq3F53KEMJOoftQFutWCukm6J24wbPWRO4k1kMY7gS7ds/uoJkNuV8wDCtWWnuwGcJwpWcih+zEW1Q==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jest/types": "^29.6.3",
        "chalk": "^4.0.0",
        "exit": "^0.1.2",
        "graceful-fs": "^4.2.9",
        "jest-config": "^29.7.0",
        "jest-util": "^29.7.0",
        "prompts": "^2.0.1"
      },
      "bin": {
        "create-jest": "bin/create-jest.js"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/cross-spawn": {
      "version": "7.0.6",
      "resolved": "https://registry.npmjs.org/cross-spawn/-/cross-spawn-7.0.6.tgz",
      "integrity": "sha512-uV2QOWP2nWzsy2aMp8aRibhi9dlzF5Hgh5SHaB9OiTGEyDTiJJyx0uy51QXdyWbtAHNua4XJzUKca3OzKUd3vA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "path-key": "^3.1.0",
        "shebang-command": "^2.0.0",
        "which": "^2.0.1"
      },
      "engines": {
        "node": ">= 8"
      }
    },
    "node_modules/currently-unhandled": {
      "version": "0.4.1",
      "resolved": "https://registry.npmjs.org/currently-unhandled/-/currently-unhandled-0.4.1.tgz",
      "integrity": "sha512-/fITjgjGU50vjQ4FH6eUoYu+iUoUKIXws2hL15JJpIR+BbTxaXQsMuuyjtNh2WqsSBS5nsaZHFsFecyw5CCAng==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "array-find-index": "^1.0.1"
      },
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/debounce": {
      "version": "1.2.1",
      "resolved": "https://registry.npmjs.org/debounce/-/debounce-1.2.1.tgz",
      "integrity": "sha512-XRRe6Glud4rd/ZGQfiV1ruXSfbvfJedlV9Y6zOlP+2K04vBYiJEte6stfFkCP03aMnY5tsipamumUjL14fofug==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/debug": {
      "version": "4.4.3",
      "resolved": "https://registry.npmjs.org/debug/-/debug-4.4.3.tgz",
      "integrity": "sha512-RGwwWnwQvkVfavKVt22FGLw+xYSdzARwm0ru6DhTVA3umU5hZc28V3kO4stgYryrTlLpuvgI9GiijltAjNbcqA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "ms": "^2.1.3"
      },
      "engines": {
        "node": ">=6.0"
      },
      "peerDependenciesMeta": {
        "supports-color": {
          "optional": true
        }
      }
    },
    "node_modules/decompress-response": {
      "version": "6.0.0",
      "resolved": "https://registry.npmjs.org/decompress-response/-/decompress-response-6.0.0.tgz",
      "integrity": "sha512-aW35yZM6Bb/4oJlZncMH2LCoZtJXTRxES17vE3hoRiowU2kWHaJKFkSBDnDR+cm9J+9QhXmREyIfv0pji9ejCQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "mimic-response": "^3.1.0"
      },
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/decompress-response/node_modules/mimic-response": {
      "version": "3.1.0",
      "resolved": "https://registry.npmjs.org/mimic-response/-/mimic-response-3.1.0.tgz",
      "integrity": "sha512-z0yWI+4FDrrweS8Zmt4Ej5HdJmky15+L2e6Wgn3+iK5fWzb6T3fhNFq2+MeTRb064c6Wr4N/wv0DzQTjNzHNGQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/dedent": {
      "version": "1.7.2",
      "resolved": "https://registry.npmjs.org/dedent/-/dedent-1.7.2.tgz",
      "integrity": "sha512-WzMx3mW98SN+zn3hgemf4OzdmyNhhhKz5Ay0pUfQiMQ3e1g+xmTJWp/pKdwKVXhdSkAEGIIzqeuWrL3mV/AXbA==",
      "dev": true,
      "license": "MIT",
      "peerDependencies": {
        "babel-plugin-macros": "^3.1.0"
      },
      "peerDependenciesMeta": {
        "babel-plugin-macros": {
          "optional": true
        }
      }
    },
    "node_modules/deepmerge": {
      "version": "4.3.1",
      "resolved": "https://registry.npmjs.org/deepmerge/-/deepmerge-4.3.1.tgz",
      "integrity": "sha512-3sUqbMEc77XqpdNO7FRyRog+eW3ph+GYCbj+rK+uYyRMuwsVy0rMiVtPn+QJlKFvWP/1PYpapqYn0Me2knFn+A==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/defaults": {
      "version": "1.0.4",
      "resolved": "https://registry.npmjs.org/defaults/-/defaults-1.0.4.tgz",
      "integrity": "sha512-eFuaLoy/Rxalv2kr+lqMlUnrDWV+3j4pljOIJgLIhI058IQfWJ7vXhyEIHu+HtC738klGALYxOKDO0bQP3tg8A==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "clone": "^1.0.2"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/defer-to-connect": {
      "version": "2.0.1",
      "resolved": "https://registry.npmjs.org/defer-to-connect/-/defer-to-connect-2.0.1.tgz",
      "integrity": "sha512-4tvttepXG1VaYGrRibk5EwJd1t4udunSOVMdLSAL6mId1ix438oPwPZMALY41FCijukO1L0twNcGsdzS7dHgDg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/define-lazy-prop": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/define-lazy-prop/-/define-lazy-prop-2.0.0.tgz",
      "integrity": "sha512-Ds09qNh8yw3khSjiJjiUInaGX9xlqZDY7JVryGxdxV7NPeuqQfplOpQ66yJFZut3jLa5zOwkXw1g9EI2uKh4Og==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/detect-newline": {
      "version": "3.1.0",
      "resolved": "https://registry.npmjs.org/detect-newline/-/detect-newline-3.1.0.tgz",
      "integrity": "sha512-TLz+x/vEXm/Y7P7wn1EJFNLxYpUD4TgMosxY6fAVJUnJMbupHBOncxyWUG9OpTaH9EBD7uFI5LfEgmMOc54DsA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/diff-sequences": {
      "version": "29.6.3",
      "resolved": "https://registry.npmjs.org/diff-sequences/-/diff-sequences-29.6.3.tgz",
      "integrity": "sha512-EjePK1srD3P08o2j4f0ExnylqRs5B9tJjcp9t1krH2qRi8CCdsYfwe9JgSLurFBWwq4uOlipzfk5fHNvwFKr8Q==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/dotf": {
      "version": "2.0.2",
      "resolved": "https://registry.npmjs.org/dotf/-/dotf-2.0.2.tgz",
      "integrity": "sha512-4cN2fwEqHimE11jVc8uMNiEB2A2YOL5Fdyd1p14UbAvRh/5vAxjEaiVPx45zD5IQcwc/uQIxI9Jh18skB/uYFQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "graceful-fs": "^4.2.8",
        "jsonfile": "^6.1.0"
      },
      "engines": {
        "node": "^12.20.0 || ^14.13.1 || >=16.0.0"
      }
    },
    "node_modules/dunder-proto": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/dunder-proto/-/dunder-proto-1.0.1.tgz",
      "integrity": "sha512-KIN/nDJBQRcXw0MLVhZE9iQHmG68qAVIBg9CqmUYjmQIhgij9U5MFvrqkUL5FbtyyzZuOeOt0zdeRe4UY7ct+A==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "call-bind-apply-helpers": "^1.0.1",
        "es-errors": "^1.3.0",
        "gopd": "^1.2.0"
      },
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/eastasianwidth": {
      "version": "0.2.0",
      "resolved": "https://registry.npmjs.org/eastasianwidth/-/eastasianwidth-0.2.0.tgz",
      "integrity": "sha512-I88TYZWc9XiYHRQ4/3c5rjjfgkjhLyW2luGIheGERbNQ6OY7yTybanSpDXZa8y7VUP9YmDcYa+eyq4ca7iLqWA==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/ecdsa-sig-formatter": {
      "version": "1.0.11",
      "resolved": "https://registry.npmjs.org/ecdsa-sig-formatter/-/ecdsa-sig-formatter-1.0.11.tgz",
      "integrity": "sha512-nagl3RYrbNv6kQkeJIpt6NJZy8twLB/2vtz6yN9Z4vRKHN4/QZJIEbqohALSgwKdnksuY3k5Addp5lg8sVoVcQ==",
      "dev": true,
      "license": "Apache-2.0",
      "dependencies": {
        "safe-buffer": "^5.0.1"
      }
    },
    "node_modules/electron-to-chromium": {
      "version": "1.5.302",
      "resolved": "https://registry.npmjs.org/electron-to-chromium/-/electron-to-chromium-1.5.302.tgz",
      "integrity": "sha512-sM6HAN2LyK82IyPBpznDRqlTQAtuSaO+ShzFiWTvoMJLHyZ+Y39r8VMfHzwbU8MVBzQ4Wdn85+wlZl2TLGIlwg==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/emittery": {
      "version": "0.13.1",
      "resolved": "https://registry.npmjs.org/emittery/-/emittery-0.13.1.tgz",
      "integrity": "sha512-DeWwawk6r5yR9jFgnDKYt4sLS0LmHJJi3ZOnb5/JdbYwj3nW+FxQnHIjhBKz8YLC7oRNPVM9NQ47I3CVx34eqQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/sindresorhus/emittery?sponsor=1"
      }
    },
    "node_modules/emoji-regex": {
      "version": "9.2.2",
      "resolved": "https://registry.npmjs.org/emoji-regex/-/emoji-regex-9.2.2.tgz",
      "integrity": "sha512-L18DaJsXSUk2+42pv8mLs5jJT2hqFkFE4j21wOmgbUqsZ2hL72NsUU785g9RXgo3s0ZNgVl42TiHp3ZtOv/Vyg==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/end-of-stream": {
      "version": "1.4.5",
      "resolved": "https://registry.npmjs.org/end-of-stream/-/end-of-stream-1.4.5.tgz",
      "integrity": "sha512-ooEGc6HP26xXq/N+GCGOT0JKCLDGrq2bQUZrQ7gyrJiZANJ/8YDTxTpQBXGMn+WbIQXNVpyWymm7KYVICQnyOg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "once": "^1.4.0"
      }
    },
    "node_modules/error-ex": {
      "version": "1.3.4",
      "resolved": "https://registry.npmjs.org/error-ex/-/error-ex-1.3.4.tgz",
      "integrity": "sha512-sqQamAnR14VgCr1A618A3sGrygcpK+HEbenA/HiEAkkUwcZIIB/tgWqHFxWgOyDh4nB4JCRimh79dR5Ywc9MDQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "is-arrayish": "^0.2.1"
      }
    },
    "node_modules/es-define-property": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/es-define-property/-/es-define-property-1.0.1.tgz",
      "integrity": "sha512-e3nRfgfUZ4rNGL232gUgX06QNyyez04KdjFrF+LTRoOXmrOgFKDg4BCdsjW8EnT69eqdYGmRpJwiPVYNrCaW3g==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/es-errors": {
      "version": "1.3.0",
      "resolved": "https://registry.npmjs.org/es-errors/-/es-errors-1.3.0.tgz",
      "integrity": "sha512-Zf5H2Kxt2xjTvbJvP2ZWLEICxA6j+hAmMzIlypy4xcBg1vKVnx89Wy0GbS+kf5cwCVFFzdCFh2XSCFNULS6csw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/es-object-atoms": {
      "version": "1.1.1",
      "resolved": "https://registry.npmjs.org/es-object-atoms/-/es-object-atoms-1.1.1.tgz",
      "integrity": "sha512-FGgH2h8zKNim9ljj7dankFPcICIK9Cp5bm+c2gQSYePhpaG5+esrLODihIorn+Pe6FGJzWhXQotPv73jTaldXA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "es-errors": "^1.3.0"
      },
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/escalade": {
      "version": "3.2.0",
      "resolved": "https://registry.npmjs.org/escalade/-/escalade-3.2.0.tgz",
      "integrity": "sha512-WUj2qlxaQtO4g6Pq5c29GTcWGDyd8itL8zTlipgECz3JesAiiOKotd8JU6otB3PACgG6xkJUyVhboMS+bje/jA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/escape-string-regexp": {
      "version": "1.0.5",
      "resolved": "https://registry.npmjs.org/escape-string-regexp/-/escape-string-regexp-1.0.5.tgz",
      "integrity": "sha512-vbRorB5FUQWvla16U8R/qgaFIya2qGzwDrNmCZuYKrbdSUMG6I1ZCGQRefkRVhuOkIGVne7BQ35DSfo1qvJqFg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=0.8.0"
      }
    },
    "node_modules/esprima": {
      "version": "4.0.1",
      "resolved": "https://registry.npmjs.org/esprima/-/esprima-4.0.1.tgz",
      "integrity": "sha512-eGuFFw7Upda+g4p+QHvnW0RyTX/SVeJBDM/gCtMARO0cLuT2HcEKnTPvhjV6aGeqrCB/sbNop0Kszm0jsaWU4A==",
      "dev": true,
      "license": "BSD-2-Clause",
      "bin": {
        "esparse": "bin/esparse.js",
        "esvalidate": "bin/esvalidate.js"
      },
      "engines": {
        "node": ">=4"
      }
    },
    "node_modules/event-target-shim": {
      "version": "5.0.1",
      "resolved": "https://registry.npmjs.org/event-target-shim/-/event-target-shim-5.0.1.tgz",
      "integrity": "sha512-i/2XbnSz/uxRCU6+NdVJgKWDTM427+MqYbkQzD321DuCQJUqOuJKIA0IM2+W2xtYHdKOmZ4dR6fExsd4SXL+WQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/execa": {
      "version": "5.1.1",
      "resolved": "https://registry.npmjs.org/execa/-/execa-5.1.1.tgz",
      "integrity": "sha512-8uSpZZocAZRBAPIEINJj3Lo9HyGitllczc27Eh5YYojjMFMn8yHMDMaUHE2Jqfq05D/wucwI4JGURyXt1vchyg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "cross-spawn": "^7.0.3",
        "get-stream": "^6.0.0",
        "human-signals": "^2.1.0",
        "is-stream": "^2.0.0",
        "merge-stream": "^2.0.0",
        "npm-run-path": "^4.0.1",
        "onetime": "^5.1.2",
        "signal-exit": "^3.0.3",
        "strip-final-newline": "^2.0.0"
      },
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sindresorhus/execa?sponsor=1"
      }
    },
    "node_modules/execa/node_modules/get-stream": {
      "version": "6.0.1",
      "resolved": "https://registry.npmjs.org/get-stream/-/get-stream-6.0.1.tgz",
      "integrity": "sha512-ts6Wi+2j3jQjqi70w5AlN8DFnkSwC+MqmxEzdEALB2qXZYV3X/b1CTfgPLGJNMeAWxdPfU8FO1ms3NUfaHCPYg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/exit": {
      "version": "0.1.2",
      "resolved": "https://registry.npmjs.org/exit/-/exit-0.1.2.tgz",
      "integrity": "sha512-Zk/eNKV2zbjpKzrsQ+n1G6poVbErQxJ0LBOJXaKZ1EViLzH+hrLu9cdXI4zw9dBQJslwBEpbQ2P1oS7nDxs6jQ==",
      "dev": true,
      "engines": {
        "node": ">= 0.8.0"
      }
    },
    "node_modules/expect": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/expect/-/expect-29.7.0.tgz",
      "integrity": "sha512-2Zks0hf1VLFYI1kbh0I5jP3KHHyCHpkfyHBzsSXRFgl/Bg9mWYfMW8oD+PdMPlEwy5HNsR9JutYy6pMeOh61nw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jest/expect-utils": "^29.7.0",
        "jest-get-type": "^29.6.3",
        "jest-matcher-utils": "^29.7.0",
        "jest-message-util": "^29.7.0",
        "jest-util": "^29.7.0"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/extend": {
      "version": "3.0.2",
      "resolved": "https://registry.npmjs.org/extend/-/extend-3.0.2.tgz",
      "integrity": "sha512-fjquC59cD7CyW6urNXK0FBufkZcoiGG80wTuPujX590cB5Ttln20E2UB4S/WARVqhXffZl2LNgS+gQdPIIim/g==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/fast-json-stable-stringify": {
      "version": "2.1.0",
      "resolved": "https://registry.npmjs.org/fast-json-stable-stringify/-/fast-json-stable-stringify-2.1.0.tgz",
      "integrity": "sha512-lhd/wF+Lk98HZoTCtlVraHtfh5XYijIjalXck7saUtuanSDyLMxnHhSXEDJqHxD7msR8D0uCmqlkwjCV8xvwHw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/fast-text-encoding": {
      "version": "1.0.6",
      "resolved": "https://registry.npmjs.org/fast-text-encoding/-/fast-text-encoding-1.0.6.tgz",
      "integrity": "sha512-VhXlQgj9ioXCqGstD37E/HBeqEGV/qOD/kmbVG8h5xKBYvM1L3lR1Zn4555cQ8GkYbJa8aJSipLPndE1k6zK2w==",
      "dev": true,
      "license": "Apache-2.0"
    },
    "node_modules/fb-watchman": {
      "version": "2.0.2",
      "resolved": "https://registry.npmjs.org/fb-watchman/-/fb-watchman-2.0.2.tgz",
      "integrity": "sha512-p5161BqbuCaSnB8jIbzQHOlpgsPmK5rJVDfDKO91Axs5NC1uu3HRQm6wt9cd9/+GtQQIO53JdGXXoyDpTAsgYA==",
      "dev": true,
      "license": "Apache-2.0",
      "dependencies": {
        "bser": "2.1.1"
      }
    },
    "node_modules/figures": {
      "version": "3.2.0",
      "resolved": "https://registry.npmjs.org/figures/-/figures-3.2.0.tgz",
      "integrity": "sha512-yaduQFRKLXYOGgEn6AZau90j3ggSOyiqXU0F9JZfeXYhNa+Jk4X+s45A2zg5jns87GAFa34BBm2kXw4XpNcbdg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "escape-string-regexp": "^1.0.5"
      },
      "engines": {
        "node": ">=8"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/fill-range": {
      "version": "7.1.1",
      "resolved": "https://registry.npmjs.org/fill-range/-/fill-range-7.1.1.tgz",
      "integrity": "sha512-YsGpe3WHLK8ZYi4tWDg2Jy3ebRz2rXowDxnld4bkQB00cc/1Zw9AWnC0i9ztDJitivtQvaI9KaLyKrc+hBW0yg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "to-regex-range": "^5.0.1"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/find-up": {
      "version": "6.3.0",
      "resolved": "https://registry.npmjs.org/find-up/-/find-up-6.3.0.tgz",
      "integrity": "sha512-v2ZsoEuVHYy8ZIlYqwPe/39Cy+cFDzp4dXPaxNvkEuouymu+2Jbz0PxpKarJHYJTmv2HWT3O382qY8l4jMWthw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "locate-path": "^7.1.0",
        "path-exists": "^5.0.0"
      },
      "engines": {
        "node": "^12.20.0 || ^14.13.1 || >=16.0.0"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/fs-extra": {
      "version": "10.1.0",
      "resolved": "https://registry.npmjs.org/fs-extra/-/fs-extra-10.1.0.tgz",
      "integrity": "sha512-oRXApq54ETRj4eMiFzGnHWGy+zo5raudjuxN0b8H7s/RU2oW0Wvsx9O0ACRN/kRq9E8Vu/ReskGB5o3ji+FzHQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "graceful-fs": "^4.2.0",
        "jsonfile": "^6.0.1",
        "universalify": "^2.0.0"
      },
      "engines": {
        "node": ">=12"
      }
    },
    "node_modules/fs.realpath": {
      "version": "1.0.0",
      "resolved": "https://registry.npmjs.org/fs.realpath/-/fs.realpath-1.0.0.tgz",
      "integrity": "sha512-OO0pH2lK6a0hZnAdau5ItzHPI6pUlvI7jMVnxUQRtw4owF2wk8lOSabtGDCTP4Ggrg2MbGnWO9X8K1t4+fGMDw==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/fsevents": {
      "version": "2.3.3",
      "resolved": "https://registry.npmjs.org/fsevents/-/fsevents-2.3.3.tgz",
      "integrity": "sha512-5xoDfX+fL7faATnagmWPpbFtwh/R77WmMMqqHGS65C3vvB0YHrgF+B1YmZ3441tMj5n63k0212XNoJwzlhffQw==",
      "dev": true,
      "hasInstallScript": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": "^8.16.0 || ^10.6.0 || >=11.0.0"
      }
    },
    "node_modules/function-bind": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/function-bind/-/function-bind-1.1.2.tgz",
      "integrity": "sha512-7XHNxH7qX9xG5mIwxkhumTox/MIRNcOgDrxWsMt2pAr23WHp6MrRlN7FBSFpCpr+oVO0F744iUgR82nJMfG2SA==",
      "dev": true,
      "license": "MIT",
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/fuzzy": {
      "version": "0.1.3",
      "resolved": "https://registry.npmjs.org/fuzzy/-/fuzzy-0.1.3.tgz",
      "integrity": "sha512-/gZffu4ykarLrCiP3Ygsa86UAo1E5vEVlvTrpkKywXSbP9Xhln3oSp9QSV57gEq3JFFpGJ4GZ+5zdEp3FcUh4w==",
      "dev": true,
      "engines": {
        "node": ">= 0.6.0"
      }
    },
    "node_modules/gaxios": {
      "version": "4.3.3",
      "resolved": "https://registry.npmjs.org/gaxios/-/gaxios-4.3.3.tgz",
      "integrity": "sha512-gSaYYIO1Y3wUtdfHmjDUZ8LWaxJQpiavzbF5Kq53akSzvmVg0RfyOcFDbO1KJ/KCGRFz2qG+lS81F0nkr7cRJA==",
      "dev": true,
      "license": "Apache-2.0",
      "dependencies": {
        "abort-controller": "^3.0.0",
        "extend": "^3.0.2",
        "https-proxy-agent": "^5.0.0",
        "is-stream": "^2.0.0",
        "node-fetch": "^2.6.7"
      },
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/gcp-metadata": {
      "version": "4.3.1",
      "resolved": "https://registry.npmjs.org/gcp-metadata/-/gcp-metadata-4.3.1.tgz",
      "integrity": "sha512-x850LS5N7V1F3UcV7PoupzGsyD6iVwTVvsh3tbXfkctZnBnjW5yu5z1/3k3SehF7TyoTIe78rJs02GMMy+LF+A==",
      "dev": true,
      "license": "Apache-2.0",
      "dependencies": {
        "gaxios": "^4.0.0",
        "json-bigint": "^1.0.0"
      },
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/gensync": {
      "version": "1.0.0-beta.2",
      "resolved": "https://registry.npmjs.org/gensync/-/gensync-1.0.0-beta.2.tgz",
      "integrity": "sha512-3hN7NaskYvMDLQY55gnW3NQ+mesEAepTqlg+VEbj7zzqEMBVNhzcGYYeqFo/TlYz6eQiFcp1HcsCZO+nGgS8zg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/get-caller-file": {
      "version": "2.0.5",
      "resolved": "https://registry.npmjs.org/get-caller-file/-/get-caller-file-2.0.5.tgz",
      "integrity": "sha512-DyFP3BM/3YHTQOCUL/w0OZHR0lpKeGrxotcHWcqNEdnltqFwXVfhEBQ94eIo34AfQpo0rGki4cyIiftY06h2Fg==",
      "dev": true,
      "license": "ISC",
      "engines": {
        "node": "6.* || 8.* || >= 10.*"
      }
    },
    "node_modules/get-intrinsic": {
      "version": "1.3.0",
      "resolved": "https://registry.npmjs.org/get-intrinsic/-/get-intrinsic-1.3.0.tgz",
      "integrity": "sha512-9fSjSaos/fRIVIp+xSJlE6lfwhES7LNtKaCBIamHsjr2na1BiABJPo0mOjjz8GJDURarmCPGqaiVg5mfjb98CQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "call-bind-apply-helpers": "^1.0.2",
        "es-define-property": "^1.0.1",
        "es-errors": "^1.3.0",
        "es-object-atoms": "^1.1.1",
        "function-bind": "^1.1.2",
        "get-proto": "^1.0.1",
        "gopd": "^1.2.0",
        "has-symbols": "^1.1.0",
        "hasown": "^2.0.2",
        "math-intrinsics": "^1.1.0"
      },
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/get-package-type": {
      "version": "0.1.0",
      "resolved": "https://registry.npmjs.org/get-package-type/-/get-package-type-0.1.0.tgz",
      "integrity": "sha512-pjzuKtY64GYfWizNAJ0fr9VqttZkNiK2iS430LtIHzjBEr6bX8Am2zm4sW4Ro5wjWW5cAlRL1qAMTcXbjNAO2Q==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8.0.0"
      }
    },
    "node_modules/get-proto": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/get-proto/-/get-proto-1.0.1.tgz",
      "integrity": "sha512-sTSfBjoXBp89JvIKIefqw7U2CCebsc74kiY6awiGogKtoSGbgjYE/G/+l9sF3MWFPNc9IcoOC4ODfKHfxFmp0g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "dunder-proto": "^1.0.1",
        "es-object-atoms": "^1.0.0"
      },
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/get-stream": {
      "version": "5.2.0",
      "resolved": "https://registry.npmjs.org/get-stream/-/get-stream-5.2.0.tgz",
      "integrity": "sha512-nBF+F1rAZVCu/p7rjzgA+Yb4lfYXrpl7a6VmJrU8wF9I1CKvP/QwPNZHnOlwbTkY6dvtFIzFMSyQXbLoTQPRpA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "pump": "^3.0.0"
      },
      "engines": {
        "node": ">=8"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/glob": {
      "version": "7.2.3",
      "resolved": "https://registry.npmjs.org/glob/-/glob-7.2.3.tgz",
      "integrity": "sha512-nFR0zLpU2YCaRxwoCJvL6UvCH2JFyFVIvwTLsIf21AuHlMskA1hhTdk+LlYJtOlYt9v6dvszD2BGRqBL+iQK9Q==",
      "deprecated": "Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be purchased (at exorbitant rates) by contacting i@izs.me",
      "dev": true,
      "license": "ISC",
      "dependencies": {
        "fs.realpath": "^1.0.0",
        "inflight": "^1.0.4",
        "inherits": "2",
        "minimatch": "^3.1.1",
        "once": "^1.3.0",
        "path-is-absolute": "^1.0.0"
      },
      "engines": {
        "node": "*"
      },
      "funding": {
        "url": "https://github.com/sponsors/isaacs"
      }
    },
    "node_modules/glob-parent": {
      "version": "5.1.2",
      "resolved": "https://registry.npmjs.org/glob-parent/-/glob-parent-5.1.2.tgz",
      "integrity": "sha512-AOIgSQCepiJYwP3ARnGx+5VnTu2HBYdzbGP45eLw1vr3zB3vZLeyed1sC9hnbcOc9/SrMyM5RPQrkGz4aS9Zow==",
      "dev": true,
      "license": "ISC",
      "dependencies": {
        "is-glob": "^4.0.1"
      },
      "engines": {
        "node": ">= 6"
      }
    },
    "node_modules/google-auth-library": {
      "version": "7.14.1",
      "resolved": "https://registry.npmjs.org/google-auth-library/-/google-auth-library-7.14.1.tgz",
      "integrity": "sha512-5Rk7iLNDFhFeBYc3s8l1CqzbEBcdhwR193RlD4vSNFajIcINKI8W8P0JLmBpwymHqqWbX34pJDQu39cSy/6RsA==",
      "dev": true,
      "license": "Apache-2.0",
      "dependencies": {
        "arrify": "^2.0.0",
        "base64-js": "^1.3.0",
        "ecdsa-sig-formatter": "^1.0.11",
        "fast-text-encoding": "^1.0.0",
        "gaxios": "^4.0.0",
        "gcp-metadata": "^4.2.0",
        "gtoken": "^5.0.4",
        "jws": "^4.0.0",
        "lru-cache": "^6.0.0"
      },
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/google-p12-pem": {
      "version": "3.1.4",
      "resolved": "https://registry.npmjs.org/google-p12-pem/-/google-p12-pem-3.1.4.tgz",
      "integrity": "sha512-HHuHmkLgwjdmVRngf5+gSmpkyaRI6QmOg77J8tkNBHhNEI62sGHyw4/+UkgyZEI7h84NbWprXDJ+sa3xOYFvTg==",
      "deprecated": "Package is no longer maintained",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "node-forge": "^1.3.1"
      },
      "bin": {
        "gp12-pem": "build/src/bin/gp12-pem.js"
      },
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/googleapis": {
      "version": "84.0.0",
      "resolved": "https://registry.npmjs.org/googleapis/-/googleapis-84.0.0.tgz",
      "integrity": "sha512-5WWLwmraulw3p55lu0gNpLz2FME1gcuR7QxgmUdAVHMiVN4LEasYjJV9p36gxcf2TMe6bn6+PgQ/63+CvBEgoQ==",
      "dev": true,
      "license": "Apache-2.0",
      "dependencies": {
        "google-auth-library": "^7.0.2",
        "googleapis-common": "^5.0.2"
      },
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/googleapis-common": {
      "version": "5.1.0",
      "resolved": "https://registry.npmjs.org/googleapis-common/-/googleapis-common-5.1.0.tgz",
      "integrity": "sha512-RXrif+Gzhq1QAzfjxulbGvAY3FPj8zq/CYcvgjzDbaBNCD6bUl+86I7mUs4DKWHGruuK26ijjR/eDpWIDgNROA==",
      "dev": true,
      "license": "Apache-2.0",
      "dependencies": {
        "extend": "^3.0.2",
        "gaxios": "^4.0.0",
        "google-auth-library": "^7.14.0",
        "qs": "^6.7.0",
        "url-template": "^2.0.8",
        "uuid": "^8.0.0"
      },
      "engines": {
        "node": ">=10.10.0"
      }
    },
    "node_modules/gopd": {
      "version": "1.2.0",
      "resolved": "https://registry.npmjs.org/gopd/-/gopd-1.2.0.tgz",
      "integrity": "sha512-ZUKRh6/kUFoAiTAtTYPZJ3hw9wNxx+BIBOijnlG9PnrJsCcSjs1wyyD6vJpaYtgnzDrKYRSqf3OO6Rfa93xsRg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/got": {
      "version": "11.8.6",
      "resolved": "https://registry.npmjs.org/got/-/got-11.8.6.tgz",
      "integrity": "sha512-6tfZ91bOr7bOXnK7PRDCGBLa1H4U080YHNaAQ2KsMGlLEzRbk44nsZF2E1IeRc3vtJHPVbKCYgdFbaGO2ljd8g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@sindresorhus/is": "^4.0.0",
        "@szmarczak/http-timer": "^4.0.5",
        "@types/cacheable-request": "^6.0.1",
        "@types/responselike": "^1.0.0",
        "cacheable-lookup": "^5.0.3",
        "cacheable-request": "^7.0.2",
        "decompress-response": "^6.0.0",
        "http2-wrapper": "^1.0.0-beta.5.2",
        "lowercase-keys": "^2.0.0",
        "p-cancelable": "^2.0.0",
        "responselike": "^2.0.0"
      },
      "engines": {
        "node": ">=10.19.0"
      },
      "funding": {
        "url": "https://github.com/sindresorhus/got?sponsor=1"
      }
    },
    "node_modules/graceful-fs": {
      "version": "4.2.11",
      "resolved": "https://registry.npmjs.org/graceful-fs/-/graceful-fs-4.2.11.tgz",
      "integrity": "sha512-RbJ5/jmFcNNCcDV5o9eTnBLJ/HszWV0P73bc+Ff4nS/rJj+YaS6IGyiOL0VoBYX+l1Wrl3k63h/KrH+nhJ0XvQ==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/gtoken": {
      "version": "5.3.2",
      "resolved": "https://registry.npmjs.org/gtoken/-/gtoken-5.3.2.tgz",
      "integrity": "sha512-gkvEKREW7dXWF8NV8pVrKfW7WqReAmjjkMBh6lNCCGOM4ucS0r0YyXXl0r/9Yj8wcW/32ISkfc8h5mPTDbtifQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "gaxios": "^4.0.0",
        "google-p12-pem": "^3.1.3",
        "jws": "^4.0.0"
      },
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/handlebars": {
      "version": "4.7.8",
      "resolved": "https://registry.npmjs.org/handlebars/-/handlebars-4.7.8.tgz",
      "integrity": "sha512-vafaFqs8MZkRrSX7sFVUdo3ap/eNiLnb4IakshzvP56X5Nr1iGKAIqdX6tMlm6HcNRIkr6AxO5jFEoJzzpT8aQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "minimist": "^1.2.5",
        "neo-async": "^2.6.2",
        "source-map": "^0.6.1",
        "wordwrap": "^1.0.0"
      },
      "bin": {
        "handlebars": "bin/handlebars"
      },
      "engines": {
        "node": ">=0.4.7"
      },
      "optionalDependencies": {
        "uglify-js": "^3.1.4"
      }
    },
    "node_modules/has-flag": {
      "version": "4.0.0",
      "resolved": "https://registry.npmjs.org/has-flag/-/has-flag-4.0.0.tgz",
      "integrity": "sha512-EykJT/Q1KjTWctppgIAgfSO0tKVuZUjhgMr17kqTumMl6Afv3EISleU7qZUzoXDFTAHTDC4NOoG/ZxU3EvlMPQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/has-symbols": {
      "version": "1.1.0",
      "resolved": "https://registry.npmjs.org/has-symbols/-/has-symbols-1.1.0.tgz",
      "integrity": "sha512-1cDNdwJ2Jaohmb3sg4OmKaMBwuC48sYni5HUw2DvsC8LjGTLK9h+eb1X6RyuOHe4hT0ULCW68iomhjUoKUqlPQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/hasown": {
      "version": "2.0.2",
      "resolved": "https://registry.npmjs.org/hasown/-/hasown-2.0.2.tgz",
      "integrity": "sha512-0hJU9SCPvmMzIBdZFqNPXWa6dqh7WdH0cII9y+CyS8rG3nL48Bclra9HmKhVVUHyPWNH5Y7xDwAB7bfgSjkUMQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "function-bind": "^1.1.2"
      },
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/hosted-git-info": {
      "version": "4.1.0",
      "resolved": "https://registry.npmjs.org/hosted-git-info/-/hosted-git-info-4.1.0.tgz",
      "integrity": "sha512-kyCuEOWjJqZuDbRHzL8V93NzQhwIB71oFWSyzVo+KPZI+pnQPPxucdkrOZvkLRnrf5URsQM+IJ09Dw29cRALIA==",
      "dev": true,
      "license": "ISC",
      "dependencies": {
        "lru-cache": "^6.0.0"
      },
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/html-escaper": {
      "version": "2.0.2",
      "resolved": "https://registry.npmjs.org/html-escaper/-/html-escaper-2.0.2.tgz",
      "integrity": "sha512-H2iMtd0I4Mt5eYiapRdIDjp+XzelXQ0tFE4JS7YFwFevXXMmOp9myNrUvCg0D6ws8iqkRPBfKHgbwig1SmlLfg==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/http-cache-semantics": {
      "version": "4.2.0",
      "resolved": "https://registry.npmjs.org/http-cache-semantics/-/http-cache-semantics-4.2.0.tgz",
      "integrity": "sha512-dTxcvPXqPvXBQpq5dUr6mEMJX4oIEFv6bwom3FDwKRDsuIjjJGANqhBuoAn9c1RQJIdAKav33ED65E2ys+87QQ==",
      "dev": true,
      "license": "BSD-2-Clause"
    },
    "node_modules/http2-wrapper": {
      "version": "1.0.3",
      "resolved": "https://registry.npmjs.org/http2-wrapper/-/http2-wrapper-1.0.3.tgz",
      "integrity": "sha512-V+23sDMr12Wnz7iTcDeJr3O6AIxlnvT/bmaAAAP/Xda35C90p9599p0F1eHR/N1KILWSoWVAiOMFjBBXaXSMxg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "quick-lru": "^5.1.1",
        "resolve-alpn": "^1.0.0"
      },
      "engines": {
        "node": ">=10.19.0"
      }
    },
    "node_modules/https-proxy-agent": {
      "version": "5.0.1",
      "resolved": "https://registry.npmjs.org/https-proxy-agent/-/https-proxy-agent-5.0.1.tgz",
      "integrity": "sha512-dFcAjpTQFgoLMzC2VwU+C/CbS7uRL0lWmxDITmqm7C+7F0Odmj6s9l6alZc6AELXhrnggM2CeWSXHGOdX2YtwA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "agent-base": "6",
        "debug": "4"
      },
      "engines": {
        "node": ">= 6"
      }
    },
    "node_modules/human-signals": {
      "version": "2.1.0",
      "resolved": "https://registry.npmjs.org/human-signals/-/human-signals-2.1.0.tgz",
      "integrity": "sha512-B4FFZ6q/T2jhhksgkbEW3HBvWIfDW85snkQgawt07S7J5QXTk6BkNV+0yAeZrM5QpMAdYlocGoljn0sJ/WQkFw==",
      "dev": true,
      "license": "Apache-2.0",
      "engines": {
        "node": ">=10.17.0"
      }
    },
    "node_modules/iconv-lite": {
      "version": "0.7.2",
      "resolved": "https://registry.npmjs.org/iconv-lite/-/iconv-lite-0.7.2.tgz",
      "integrity": "sha512-im9DjEDQ55s9fL4EYzOAv0yMqmMBSZp6G0VvFyTMPKWxiSBHUj9NW/qqLmXUwXrrM7AvqSlTCfvqRb0cM8yYqw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "safer-buffer": ">= 2.1.2 < 3.0.0"
      },
      "engines": {
        "node": ">=0.10.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/express"
      }
    },
    "node_modules/ieee754": {
      "version": "1.2.1",
      "resolved": "https://registry.npmjs.org/ieee754/-/ieee754-1.2.1.tgz",
      "integrity": "sha512-dcyqhDvX1C46lXZcVqCpK+FtMRQVdIMN6/Df5js2zouUsqG7I6sFxitIC+7KYK29KdXOLHdu9zL4sFnoVQnqaA==",
      "dev": true,
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/feross"
        },
        {
          "type": "patreon",
          "url": "https://www.patreon.com/feross"
        },
        {
          "type": "consulting",
          "url": "https://feross.org/support"
        }
      ],
      "license": "BSD-3-Clause"
    },
    "node_modules/import-local": {
      "version": "3.2.0",
      "resolved": "https://registry.npmjs.org/import-local/-/import-local-3.2.0.tgz",
      "integrity": "sha512-2SPlun1JUPWoM6t3F0dw0FkCF/jWY8kttcY4f599GLTSjh2OCuuhdTkJQsEcZzBqbXZGKMK2OqW1oZsjtf/gQA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "pkg-dir": "^4.2.0",
        "resolve-cwd": "^3.0.0"
      },
      "bin": {
        "import-local-fixture": "fixtures/cli.js"
      },
      "engines": {
        "node": ">=8"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/imurmurhash": {
      "version": "0.1.4",
      "resolved": "https://registry.npmjs.org/imurmurhash/-/imurmurhash-0.1.4.tgz",
      "integrity": "sha512-JmXMZ6wuvDmLiHEml9ykzqO6lwFbof0GG4IkcGaENdCRDDmMVnny7s5HsIgHCbaq0w2MyPhDqkhTUgS2LU2PHA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=0.8.19"
      }
    },
    "node_modules/indent-string": {
      "version": "5.0.0",
      "resolved": "https://registry.npmjs.org/indent-string/-/indent-string-5.0.0.tgz",
      "integrity": "sha512-m6FAo/spmsW2Ab2fU35JTYwtOKa2yAwXSwgjSv1TJzh4Mh7mC3lzAOVLBprb72XsTrgkEIsl7YrFNAiDiRhIGg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/inflight": {
      "version": "1.0.6",
      "resolved": "https://registry.npmjs.org/inflight/-/inflight-1.0.6.tgz",
      "integrity": "sha512-k92I/b08q4wvFscXCLvqfsHCrjrF7yiXsQuIVvVE7N82W3+aqpzuUdBbfhWcy/FZR3/4IgflMgKLOsvPDrGCJA==",
      "deprecated": "This module is not supported, and leaks memory. Do not use it. Check out lru-cache if you want a good and tested way to coalesce async requests by a key value, which is much more comprehensive and powerful.",
      "dev": true,
      "license": "ISC",
      "dependencies": {
        "once": "^1.3.0",
        "wrappy": "1"
      }
    },
    "node_modules/inherits": {
      "version": "2.0.4",
      "resolved": "https://registry.npmjs.org/inherits/-/inherits-2.0.4.tgz",
      "integrity": "sha512-k/vGaX4/Yla3WzyMCvTQOXYeIHvqOKtnqBduzTHpzpQZzAskKMhZ2K+EnBiSM9zGSoIFeMpXKxa4dYeZIQqewQ==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/inquirer": {
      "version": "8.2.7",
      "resolved": "https://registry.npmjs.org/inquirer/-/inquirer-8.2.7.tgz",
      "integrity": "sha512-UjOaSel/iddGZJ5xP/Eixh6dY1XghiBw4XK13rCCIJcJfyhhoul/7KhLLUGtebEj6GDYM6Vnx/mVsjx2L/mFIA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@inquirer/external-editor": "^1.0.0",
        "ansi-escapes": "^4.2.1",
        "chalk": "^4.1.1",
        "cli-cursor": "^3.1.0",
        "cli-width": "^3.0.0",
        "figures": "^3.0.0",
        "lodash": "^4.17.21",
        "mute-stream": "0.0.8",
        "ora": "^5.4.1",
        "run-async": "^2.4.0",
        "rxjs": "^7.5.5",
        "string-width": "^4.1.0",
        "strip-ansi": "^6.0.0",
        "through": "^2.3.6",
        "wrap-ansi": "^6.0.1"
      },
      "engines": {
        "node": ">=12.0.0"
      }
    },
    "node_modules/inquirer-autocomplete-prompt-ipt": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/inquirer-autocomplete-prompt-ipt/-/inquirer-autocomplete-prompt-ipt-2.0.0.tgz",
      "integrity": "sha512-2qkl1lWeXbFN/O3+xdqJUdMfnNirvWKqgsgmhOjpOiVCcnJf+XYSEjFfdTgk+MDTtVt5AZiWR9Ji+f4YsWBdUw==",
      "dev": true,
      "license": "ISC",
      "dependencies": {
        "ansi-escapes": "^4.2.1",
        "chalk": "^2.4.2",
        "figures": "^3.1.0",
        "run-async": "^2.3.0",
        "rxjs": "^6.5.3"
      },
      "engines": {
        "node": ">=10"
      },
      "peerDependencies": {
        "inquirer": ">=7"
      }
    },
    "node_modules/inquirer-autocomplete-prompt-ipt/node_modules/ansi-styles": {
      "version": "3.2.1",
      "resolved": "https://registry.npmjs.org/ansi-styles/-/ansi-styles-3.2.1.tgz",
      "integrity": "sha512-VT0ZI6kZRdTh8YyJw3SMbYm/u+NqfsAxEpWO0Pf9sq8/e94WxxOpPKx9FR1FlyCtOVDNOQ+8ntlqFxiRc+r5qA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "color-convert": "^1.9.0"
      },
      "engines": {
        "node": ">=4"
      }
    },
    "node_modules/inquirer-autocomplete-prompt-ipt/node_modules/chalk": {
      "version": "2.4.2",
      "resolved": "https://registry.npmjs.org/chalk/-/chalk-2.4.2.tgz",
      "integrity": "sha512-Mti+f9lpJNcwF4tWV8/OrTTtF1gZi+f8FqlyAdouralcFWFQWF2+NgCHShjkCb+IFBLq9buZwE1xckQU4peSuQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "ansi-styles": "^3.2.1",
        "escape-string-regexp": "^1.0.5",
        "supports-color": "^5.3.0"
      },
      "engines": {
        "node": ">=4"
      }
    },
    "node_modules/inquirer-autocomplete-prompt-ipt/node_modules/color-convert": {
      "version": "1.9.3",
      "resolved": "https://registry.npmjs.org/color-convert/-/color-convert-1.9.3.tgz",
      "integrity": "sha512-QfAUtd+vFdAtFQcC8CCyYt1fYWxSqAiK2cSD6zDB8N3cpsEBAvRxp9zOGg6G/SHHJYAT88/az/IuDGALsNVbGg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "color-name": "1.1.3"
      }
    },
    "node_modules/inquirer-autocomplete-prompt-ipt/node_modules/color-name": {
      "version": "1.1.3",
      "resolved": "https://registry.npmjs.org/color-name/-/color-name-1.1.3.tgz",
      "integrity": "sha512-72fSenhMw2HZMTVHeCA9KCmpEIbzWiQsjN+BHcBbS9vr1mtt+vJjPdksIBNUmKAW8TFUDPJK5SUU3QhE9NEXDw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/inquirer-autocomplete-prompt-ipt/node_modules/has-flag": {
      "version": "3.0.0",
      "resolved": "https://registry.npmjs.org/has-flag/-/has-flag-3.0.0.tgz",
      "integrity": "sha512-sKJf1+ceQBr4SMkvQnBDNDtf4TXpVhVGateu0t918bl30FnbE2m4vNLX+VWe/dpjlb+HugGYzW7uQXH98HPEYw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=4"
      }
    },
    "node_modules/inquirer-autocomplete-prompt-ipt/node_modules/rxjs": {
      "version": "6.6.7",
      "resolved": "https://registry.npmjs.org/rxjs/-/rxjs-6.6.7.tgz",
      "integrity": "sha512-hTdwr+7yYNIT5n4AMYp85KA6yw2Va0FLa3Rguvbpa4W3I5xynaBZo41cM3XM+4Q6fRMj3sBYIR1VAmZMXYJvRQ==",
      "dev": true,
      "license": "Apache-2.0",
      "dependencies": {
        "tslib": "^1.9.0"
      },
      "engines": {
        "npm": ">=2.0.0"
      }
    },
    "node_modules/inquirer-autocomplete-prompt-ipt/node_modules/supports-color": {
      "version": "5.5.0",
      "resolved": "https://registry.npmjs.org/supports-color/-/supports-color-5.5.0.tgz",
      "integrity": "sha512-QjVjwdXIt408MIiAqCX4oUKsgU2EqAGzs2Ppkm4aQYbjm+ZEWEcW4SfFNTr4uMNZma0ey4f5lgLrkB0aX0QMow==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "has-flag": "^3.0.0"
      },
      "engines": {
        "node": ">=4"
      }
    },
    "node_modules/inquirer-autocomplete-prompt-ipt/node_modules/tslib": {
      "version": "1.14.1",
      "resolved": "https://registry.npmjs.org/tslib/-/tslib-1.14.1.tgz",
      "integrity": "sha512-Xni35NKzjgMrwevysHTCArtLDpPvye8zV/0E4EyYn43P7/7qvQwPh9BGkHewbMulVntbigmcT7rdX3BNo9wRJg==",
      "dev": true,
      "license": "0BSD"
    },
    "node_modules/inquirer/node_modules/bl": {
      "version": "4.1.0",
      "resolved": "https://registry.npmjs.org/bl/-/bl-4.1.0.tgz",
      "integrity": "sha512-1W07cM9gS6DcLperZfFSj+bWLtaPGSOHWhPiGzXmvVJbRLdG82sH/Kn8EtW1VqWVA54AKf2h5k5BbnIbwF3h6w==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "buffer": "^5.5.0",
        "inherits": "^2.0.4",
        "readable-stream": "^3.4.0"
      }
    },
    "node_modules/inquirer/node_modules/buffer": {
      "version": "5.7.1",
      "resolved": "https://registry.npmjs.org/buffer/-/buffer-5.7.1.tgz",
      "integrity": "sha512-EHcyIPBQ4BSGlvjB16k5KgAJ27CIsHY/2JBmCRReo48y9rQ3MaUzWX3KVlBa4U7MyX02HdVj0K7C3WaB3ju7FQ==",
      "dev": true,
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/feross"
        },
        {
          "type": "patreon",
          "url": "https://www.patreon.com/feross"
        },
        {
          "type": "consulting",
          "url": "https://feross.org/support"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "base64-js": "^1.3.1",
        "ieee754": "^1.1.13"
      }
    },
    "node_modules/inquirer/node_modules/emoji-regex": {
      "version": "8.0.0",
      "resolved": "https://registry.npmjs.org/emoji-regex/-/emoji-regex-8.0.0.tgz",
      "integrity": "sha512-MSjYzcWNOA0ewAHpz0MxpYFvwg6yjy1NG3xteoqz644VCo/RPgnr1/GGt+ic3iJTzQ8Eu3TdM14SawnVUmGE6A==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/inquirer/node_modules/is-fullwidth-code-point": {
      "version": "3.0.0",
      "resolved": "https://registry.npmjs.org/is-fullwidth-code-point/-/is-fullwidth-code-point-3.0.0.tgz",
      "integrity": "sha512-zymm5+u+sCsSWyD9qNaejV3DFvhCKclKdizYaJUuHA83RLjb7nSuGnddCHGv0hk+KY7BMAlsWeK4Ueg6EV6XQg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/inquirer/node_modules/is-interactive": {
      "version": "1.0.0",
      "resolved": "https://registry.npmjs.org/is-interactive/-/is-interactive-1.0.0.tgz",
      "integrity": "sha512-2HvIEKRoqS62guEC+qBjpvRubdX910WCMuJTZ+I9yvqKU2/12eSL549HMwtabb4oupdj2sMP50k+XJfB/8JE6w==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/inquirer/node_modules/is-unicode-supported": {
      "version": "0.1.0",
      "resolved": "https://registry.npmjs.org/is-unicode-supported/-/is-unicode-supported-0.1.0.tgz",
      "integrity": "sha512-knxG2q4UC3u8stRGyAVJCOdxFmv5DZiRcdlIaAQXAbSfJya+OhopNotLQrstBhququ4ZpuKbDc/8S6mgXgPFPw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/inquirer/node_modules/log-symbols": {
      "version": "4.1.0",
      "resolved": "https://registry.npmjs.org/log-symbols/-/log-symbols-4.1.0.tgz",
      "integrity": "sha512-8XPvpAA8uyhfteu8pIvQxpJZ7SYYdpUivZpGy6sFsBuKRY/7rQGavedeB8aK+Zkyq6upMFVL/9AW6vOYzfRyLg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "chalk": "^4.1.0",
        "is-unicode-supported": "^0.1.0"
      },
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/inquirer/node_modules/ora": {
      "version": "5.4.1",
      "resolved": "https://registry.npmjs.org/ora/-/ora-5.4.1.tgz",
      "integrity": "sha512-5b6Y85tPxZZ7QytO+BQzysW31HJku27cRIlkbAXaNx+BdcVi+LlRFmVXzeF6a7JCwJpyw5c4b+YSVImQIrBpuQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "bl": "^4.1.0",
        "chalk": "^4.1.0",
        "cli-cursor": "^3.1.0",
        "cli-spinners": "^2.5.0",
        "is-interactive": "^1.0.0",
        "is-unicode-supported": "^0.1.0",
        "log-symbols": "^4.1.0",
        "strip-ansi": "^6.0.0",
        "wcwidth": "^1.0.1"
      },
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/inquirer/node_modules/string-width": {
      "version": "4.2.3",
      "resolved": "https://registry.npmjs.org/string-width/-/string-width-4.2.3.tgz",
      "integrity": "sha512-wKyQRQpjJ0sIp62ErSZdGsjMJWsap5oRNihHhu6G7JVO/9jIB6UyevL+tXuOqrng8j/cxKTWyWUwvSTriiZz/g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "emoji-regex": "^8.0.0",
        "is-fullwidth-code-point": "^3.0.0",
        "strip-ansi": "^6.0.1"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/is-arrayish": {
      "version": "0.2.1",
      "resolved": "https://registry.npmjs.org/is-arrayish/-/is-arrayish-0.2.1.tgz",
      "integrity": "sha512-zz06S8t0ozoDXMG+ube26zeCTNXcKIPJZJi8hBrF4idCLms4CG9QtK7qBl1boi5ODzFpjswb5JPmHCbMpjaYzg==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/is-binary-path": {
      "version": "2.1.0",
      "resolved": "https://registry.npmjs.org/is-binary-path/-/is-binary-path-2.1.0.tgz",
      "integrity": "sha512-ZMERYes6pDydyuGidse7OsHxtbI7WVeUEozgR/g7rd0xUimYNlvZRE/K2MgZTjWy725IfelLeVcEM97mmtRGXw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "binary-extensions": "^2.0.0"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/is-core-module": {
      "version": "2.16.1",
      "resolved": "https://registry.npmjs.org/is-core-module/-/is-core-module-2.16.1.tgz",
      "integrity": "sha512-UfoeMA6fIJ8wTYFEUjelnaGI67v6+N7qXJEvQuIGa99l4xsCruSYOVSQ0uPANn4dAzm8lkYPaKLrrijLq7x23w==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "hasown": "^2.0.2"
      },
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/is-docker": {
      "version": "2.2.1",
      "resolved": "https://registry.npmjs.org/is-docker/-/is-docker-2.2.1.tgz",
      "integrity": "sha512-F+i2BKsFrH66iaUFc0woD8sLy8getkwTwtOBjvs56Cx4CgJDeKQeqfz8wAYiSb8JOprWhHH5p77PbmYCvvUuXQ==",
      "dev": true,
      "license": "MIT",
      "bin": {
        "is-docker": "cli.js"
      },
      "engines": {
        "node": ">=8"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/is-extglob": {
      "version": "2.1.1",
      "resolved": "https://registry.npmjs.org/is-extglob/-/is-extglob-2.1.1.tgz",
      "integrity": "sha512-SbKbANkN603Vi4jEZv49LeVJMn4yGwsbzZworEoyEiutsN3nJYdbO36zfhGJ6QEDpOZIFkDtnq5JRxmvl3jsoQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/is-fullwidth-code-point": {
      "version": "4.0.0",
      "resolved": "https://registry.npmjs.org/is-fullwidth-code-point/-/is-fullwidth-code-point-4.0.0.tgz",
      "integrity": "sha512-O4L094N2/dZ7xqVdrXhh9r1KODPJpFms8B5sGdJLPy664AgvXsreZUyCQQNItZRDlYug4xStLjNp/sz3HvBowQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/is-generator-fn": {
      "version": "2.1.0",
      "resolved": "https://registry.npmjs.org/is-generator-fn/-/is-generator-fn-2.1.0.tgz",
      "integrity": "sha512-cTIB4yPYL/Grw0EaSzASzg6bBy9gqCofvWN8okThAYIxKJZC+udlRAmGbM0XLeniEJSs8uEgHPGuHSe1XsOLSQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/is-glob": {
      "version": "4.0.3",
      "resolved": "https://registry.npmjs.org/is-glob/-/is-glob-4.0.3.tgz",
      "integrity": "sha512-xelSayHH36ZgE7ZWhli7pW34hNbNl8Ojv5KVmkJD4hBdD3th8Tfk9vYasLM+mXWOZhFkgZfxhLSnrwRr4elSSg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "is-extglob": "^2.1.1"
      },
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/is-interactive": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/is-interactive/-/is-interactive-2.0.0.tgz",
      "integrity": "sha512-qP1vozQRI+BMOPcjFzrjXuQvdak2pHNUMZoeG2eRbiSqyvbEf/wQtEOTOX1guk6E3t36RkaqiSt8A/6YElNxLQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/is-number": {
      "version": "7.0.0",
      "resolved": "https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz",
      "integrity": "sha512-41Cifkg6e8TylSpdtTpeLVMqvSBEVzTttHvERD741+pnZ8ANv0004MRL43QKPDlK9cGvNp6NZWZUBlbGXYxxng==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=0.12.0"
      }
    },
    "node_modules/is-port-reachable": {
      "version": "3.1.0",
      "resolved": "https://registry.npmjs.org/is-port-reachable/-/is-port-reachable-3.1.0.tgz",
      "integrity": "sha512-vjc0SSRNZ32s9SbZBzGaiP6YVB+xglLShhgZD/FHMZUXBvQWaV9CtzgeVhjccFJrI6RAMV+LX7NYxueW/A8W5A==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/is-reachable": {
      "version": "5.2.1",
      "resolved": "https://registry.npmjs.org/is-reachable/-/is-reachable-5.2.1.tgz",
      "integrity": "sha512-ViPrrlmt9FTTclYbz6mL/PFyF1TXSpJ9y/zw9QMVJxbhU/7DFkvk/5cTv7S0sXtqbJj32zZ+jKpNAjrYTUZBPQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "arrify": "^2.0.1",
        "got": "^11.7.0",
        "is-port-reachable": "^3.0.0",
        "p-any": "^3.0.0",
        "p-timeout": "^3.2.0",
        "prepend-http": "^3.0.1",
        "router-ips": "^1.0.0",
        "url-parse": "^1.5.10"
      },
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/is-stream": {
      "version": "2.0.1",
      "resolved": "https://registry.npmjs.org/is-stream/-/is-stream-2.0.1.tgz",
      "integrity": "sha512-hFoiJiTl63nn+kstHGBtewWSKnQLpyb155KHheA1l39uvtO9nWIop1p3udqPcUd/xbF1VLMO4n7OI6p7RbngDg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/is-unicode-supported": {
      "version": "1.3.0",
      "resolved": "https://registry.npmjs.org/is-unicode-supported/-/is-unicode-supported-1.3.0.tgz",
      "integrity": "sha512-43r2mRvz+8JRIKnWJ+3j8JtjRKZ6GmjzfaE/qiBJnikNnYv/6bagRJ1kUhNk8R5EX/GkobD+r+sfxCPJsiKBLQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/is-wsl": {
      "version": "2.2.0",
      "resolved": "https://registry.npmjs.org/is-wsl/-/is-wsl-2.2.0.tgz",
      "integrity": "sha512-fKzAra0rGJUUBwGBgNkHZuToZcn+TtXHpeCgmkMJMMYx1sQDYaCSyjJBSCa2nH1DGm7s3n1oBnohoVTBaN7Lww==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "is-docker": "^2.0.0"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/isexe": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/isexe/-/isexe-2.0.0.tgz",
      "integrity": "sha512-RHxMLp9lnKHGHRng9QFhRCMbYAcVpn69smSGcq3f36xjgVVWThj4qqLbTLlq7Ssj8B+fIQ1EuCEGI2lKsyQeIw==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/istanbul-lib-coverage": {
      "version": "3.2.2",
      "resolved": "https://registry.npmjs.org/istanbul-lib-coverage/-/istanbul-lib-coverage-3.2.2.tgz",
      "integrity": "sha512-O8dpsF+r0WV/8MNRKfnmrtCWhuKjxrq2w+jpzBL5UZKTi2LeVWnWOmWRxFlesJONmc+wLAGvKQZEOanko0LFTg==",
      "dev": true,
      "license": "BSD-3-Clause",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/istanbul-lib-instrument": {
      "version": "6.0.3",
      "resolved": "https://registry.npmjs.org/istanbul-lib-instrument/-/istanbul-lib-instrument-6.0.3.tgz",
      "integrity": "sha512-Vtgk7L/R2JHyyGW07spoFlB8/lpjiOLTjMdms6AFMraYt3BaJauod/NGrfnVG/y4Ix1JEuMRPDPEj2ua+zz1/Q==",
      "dev": true,
      "license": "BSD-3-Clause",
      "dependencies": {
        "@babel/core": "^7.23.9",
        "@babel/parser": "^7.23.9",
        "@istanbuljs/schema": "^0.1.3",
        "istanbul-lib-coverage": "^3.2.0",
        "semver": "^7.5.4"
      },
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/istanbul-lib-instrument/node_modules/semver": {
      "version": "7.7.4",
      "resolved": "https://registry.npmjs.org/semver/-/semver-7.7.4.tgz",
      "integrity": "sha512-vFKC2IEtQnVhpT78h1Yp8wzwrf8CM+MzKMHGJZfBtzhZNycRFnXsHk6E5TxIkkMsgNS7mdX3AGB7x2QM2di4lA==",
      "dev": true,
      "license": "ISC",
      "bin": {
        "semver": "bin/semver.js"
      },
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/istanbul-lib-report": {
      "version": "3.0.1",
      "resolved": "https://registry.npmjs.org/istanbul-lib-report/-/istanbul-lib-report-3.0.1.tgz",
      "integrity": "sha512-GCfE1mtsHGOELCU8e/Z7YWzpmybrx/+dSTfLrvY8qRmaY6zXTKWn6WQIjaAFw069icm6GVMNkgu0NzI4iPZUNw==",
      "dev": true,
      "license": "BSD-3-Clause",
      "dependencies": {
        "istanbul-lib-coverage": "^3.0.0",
        "make-dir": "^4.0.0",
        "supports-color": "^7.1.0"
      },
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/istanbul-lib-report/node_modules/make-dir": {
      "version": "4.0.0",
      "resolved": "https://registry.npmjs.org/make-dir/-/make-dir-4.0.0.tgz",
      "integrity": "sha512-hXdUTZYIVOt1Ex//jAQi+wTZZpUpwBj/0QsOzqegb3rGMMeJiSEu5xLHnYfBrRV4RH2+OCSOO95Is/7x1WJ4bw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "semver": "^7.5.3"
      },
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/istanbul-lib-report/node_modules/semver": {
      "version": "7.7.4",
      "resolved": "https://registry.npmjs.org/semver/-/semver-7.7.4.tgz",
      "integrity": "sha512-vFKC2IEtQnVhpT78h1Yp8wzwrf8CM+MzKMHGJZfBtzhZNycRFnXsHk6E5TxIkkMsgNS7mdX3AGB7x2QM2di4lA==",
      "dev": true,
      "license": "ISC",
      "bin": {
        "semver": "bin/semver.js"
      },
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/istanbul-lib-source-maps": {
      "version": "4.0.1",
      "resolved": "https://registry.npmjs.org/istanbul-lib-source-maps/-/istanbul-lib-source-maps-4.0.1.tgz",
      "integrity": "sha512-n3s8EwkdFIJCG3BPKBYvskgXGoy88ARzvegkitk60NxRdwltLOTaH7CUiMRXvwYorl0Q712iEjcWB+fK/MrWVw==",
      "dev": true,
      "license": "BSD-3-Clause",
      "dependencies": {
        "debug": "^4.1.1",
        "istanbul-lib-coverage": "^3.0.0",
        "source-map": "^0.6.1"
      },
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/istanbul-reports": {
      "version": "3.2.0",
      "resolved": "https://registry.npmjs.org/istanbul-reports/-/istanbul-reports-3.2.0.tgz",
      "integrity": "sha512-HGYWWS/ehqTV3xN10i23tkPkpH46MLCIMFNCaaKNavAXTF1RkqxawEPtnjnGZ6XKSInBKkiOA5BKS+aZiY3AvA==",
      "dev": true,
      "license": "BSD-3-Clause",
      "dependencies": {
        "html-escaper": "^2.0.0",
        "istanbul-lib-report": "^3.0.0"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/jest": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/jest/-/jest-29.7.0.tgz",
      "integrity": "sha512-NIy3oAFp9shda19hy4HK0HRTWKtPJmGdnvywu01nOqNC2vZg+Z+fvJDxpMQA88eb2I9EcafcdjYgsDthnYTvGw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jest/core": "^29.7.0",
        "@jest/types": "^29.6.3",
        "import-local": "^3.0.2",
        "jest-cli": "^29.7.0"
      },
      "bin": {
        "jest": "bin/jest.js"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      },
      "peerDependencies": {
        "node-notifier": "^8.0.1 || ^9.0.0 || ^10.0.0"
      },
      "peerDependenciesMeta": {
        "node-notifier": {
          "optional": true
        }
      }
    },
    "node_modules/jest-changed-files": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/jest-changed-files/-/jest-changed-files-29.7.0.tgz",
      "integrity": "sha512-fEArFiwf1BpQ+4bXSprcDc3/x4HSzL4al2tozwVpDFpsxALjLYdyiIK4e5Vz66GQJIbXJ82+35PtysofptNX2w==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "execa": "^5.0.0",
        "jest-util": "^29.7.0",
        "p-limit": "^3.1.0"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/jest-circus": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/jest-circus/-/jest-circus-29.7.0.tgz",
      "integrity": "sha512-3E1nCMgipcTkCocFwM90XXQab9bS+GMsjdpmPrlelaxwD93Ad8iVEjX/vvHPdLPnFf+L40u+5+iutRdA1N9myw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jest/environment": "^29.7.0",
        "@jest/expect": "^29.7.0",
        "@jest/test-result": "^29.7.0",
        "@jest/types": "^29.6.3",
        "@types/node": "*",
        "chalk": "^4.0.0",
        "co": "^4.6.0",
        "dedent": "^1.0.0",
        "is-generator-fn": "^2.0.0",
        "jest-each": "^29.7.0",
        "jest-matcher-utils": "^29.7.0",
        "jest-message-util": "^29.7.0",
        "jest-runtime": "^29.7.0",
        "jest-snapshot": "^29.7.0",
        "jest-util": "^29.7.0",
        "p-limit": "^3.1.0",
        "pretty-format": "^29.7.0",
        "pure-rand": "^6.0.0",
        "slash": "^3.0.0",
        "stack-utils": "^2.0.3"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/jest-cli": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/jest-cli/-/jest-cli-29.7.0.tgz",
      "integrity": "sha512-OVVobw2IubN/GSYsxETi+gOe7Ka59EFMR/twOU3Jb2GnKKeMGJB5SGUUrEz3SFVmJASUdZUzy83sLNNQ2gZslg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jest/core": "^29.7.0",
        "@jest/test-result": "^29.7.0",
        "@jest/types": "^29.6.3",
        "chalk": "^4.0.0",
        "create-jest": "^29.7.0",
        "exit": "^0.1.2",
        "import-local": "^3.0.2",
        "jest-config": "^29.7.0",
        "jest-util": "^29.7.0",
        "jest-validate": "^29.7.0",
        "yargs": "^17.3.1"
      },
      "bin": {
        "jest": "bin/jest.js"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      },
      "peerDependencies": {
        "node-notifier": "^8.0.1 || ^9.0.0 || ^10.0.0"
      },
      "peerDependenciesMeta": {
        "node-notifier": {
          "optional": true
        }
      }
    },
    "node_modules/jest-config": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/jest-config/-/jest-config-29.7.0.tgz",
      "integrity": "sha512-uXbpfeQ7R6TZBqI3/TxCU4q4ttk3u0PJeC+E0zbfSoSjq6bJ7buBPxzQPL0ifrkY4DNu4JUdk0ImlBUYi840eQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/core": "^7.11.6",
        "@jest/test-sequencer": "^29.7.0",
        "@jest/types": "^29.6.3",
        "babel-jest": "^29.7.0",
        "chalk": "^4.0.0",
        "ci-info": "^3.2.0",
        "deepmerge": "^4.2.2",
        "glob": "^7.1.3",
        "graceful-fs": "^4.2.9",
        "jest-circus": "^29.7.0",
        "jest-environment-node": "^29.7.0",
        "jest-get-type": "^29.6.3",
        "jest-regex-util": "^29.6.3",
        "jest-resolve": "^29.7.0",
        "jest-runner": "^29.7.0",
        "jest-util": "^29.7.0",
        "jest-validate": "^29.7.0",
        "micromatch": "^4.0.4",
        "parse-json": "^5.2.0",
        "pretty-format": "^29.7.0",
        "slash": "^3.0.0",
        "strip-json-comments": "^3.1.1"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      },
      "peerDependencies": {
        "@types/node": "*",
        "ts-node": ">=9.0.0"
      },
      "peerDependenciesMeta": {
        "@types/node": {
          "optional": true
        },
        "ts-node": {
          "optional": true
        }
      }
    },
    "node_modules/jest-diff": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/jest-diff/-/jest-diff-29.7.0.tgz",
      "integrity": "sha512-LMIgiIrhigmPrs03JHpxUh2yISK3vLFPkAodPeo0+BuF7wA2FoQbkEg1u8gBYBThncu7e1oEDUfIXVuTqLRUjw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "chalk": "^4.0.0",
        "diff-sequences": "^29.6.3",
        "jest-get-type": "^29.6.3",
        "pretty-format": "^29.7.0"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/jest-docblock": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/jest-docblock/-/jest-docblock-29.7.0.tgz",
      "integrity": "sha512-q617Auw3A612guyaFgsbFeYpNP5t2aoUNLwBUbc/0kD1R4t9ixDbyFTHd1nok4epoVFpr7PmeWHrhvuV3XaJ4g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "detect-newline": "^3.0.0"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/jest-each": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/jest-each/-/jest-each-29.7.0.tgz",
      "integrity": "sha512-gns+Er14+ZrEoC5fhOfYCY1LOHHr0TI+rQUHZS8Ttw2l7gl+80eHc/gFf2Ktkw0+SIACDTeWvpFcv3B04VembQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jest/types": "^29.6.3",
        "chalk": "^4.0.0",
        "jest-get-type": "^29.6.3",
        "jest-util": "^29.7.0",
        "pretty-format": "^29.7.0"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/jest-environment-node": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/jest-environment-node/-/jest-environment-node-29.7.0.tgz",
      "integrity": "sha512-DOSwCRqXirTOyheM+4d5YZOrWcdu0LNZ87ewUoywbcb2XR4wKgqiG8vNeYwhjFMbEkfju7wx2GYH0P2gevGvFw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jest/environment": "^29.7.0",
        "@jest/fake-timers": "^29.7.0",
        "@jest/types": "^29.6.3",
        "@types/node": "*",
        "jest-mock": "^29.7.0",
        "jest-util": "^29.7.0"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/jest-get-type": {
      "version": "29.6.3",
      "resolved": "https://registry.npmjs.org/jest-get-type/-/jest-get-type-29.6.3.tgz",
      "integrity": "sha512-zrteXnqYxfQh7l5FHyL38jL39di8H8rHoecLH3JNxH3BwOrBsNeabdap5e0I23lD4HHI8W5VFBZqG4Eaq5LNcw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/jest-haste-map": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/jest-haste-map/-/jest-haste-map-29.7.0.tgz",
      "integrity": "sha512-fP8u2pyfqx0K1rGn1R9pyE0/KTn+G7PxktWidOBTqFPLYX0b9ksaMFkhK5vrS3DVun09pckLdlx90QthlW7AmA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jest/types": "^29.6.3",
        "@types/graceful-fs": "^4.1.3",
        "@types/node": "*",
        "anymatch": "^3.0.3",
        "fb-watchman": "^2.0.0",
        "graceful-fs": "^4.2.9",
        "jest-regex-util": "^29.6.3",
        "jest-util": "^29.7.0",
        "jest-worker": "^29.7.0",
        "micromatch": "^4.0.4",
        "walker": "^1.0.8"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      },
      "optionalDependencies": {
        "fsevents": "^2.3.2"
      }
    },
    "node_modules/jest-leak-detector": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/jest-leak-detector/-/jest-leak-detector-29.7.0.tgz",
      "integrity": "sha512-kYA8IJcSYtST2BY9I+SMC32nDpBT3J2NvWJx8+JCuCdl/CR1I4EKUJROiP8XtCcxqgTTBGJNdbB1A8XRKbTetw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "jest-get-type": "^29.6.3",
        "pretty-format": "^29.7.0"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/jest-matcher-utils": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/jest-matcher-utils/-/jest-matcher-utils-29.7.0.tgz",
      "integrity": "sha512-sBkD+Xi9DtcChsI3L3u0+N0opgPYnCRPtGcQYrgXmR+hmt/fYfWAL0xRXYU8eWOdfuLgBe0YCW3AFtnRLagq/g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "chalk": "^4.0.0",
        "jest-diff": "^29.7.0",
        "jest-get-type": "^29.6.3",
        "pretty-format": "^29.7.0"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/jest-message-util": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/jest-message-util/-/jest-message-util-29.7.0.tgz",
      "integrity": "sha512-GBEV4GRADeP+qtB2+6u61stea8mGcOT4mCtrYISZwfu9/ISHFJ/5zOMXYbpBE9RsS5+Gb63DW4FgmnKJ79Kf6w==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/code-frame": "^7.12.13",
        "@jest/types": "^29.6.3",
        "@types/stack-utils": "^2.0.0",
        "chalk": "^4.0.0",
        "graceful-fs": "^4.2.9",
        "micromatch": "^4.0.4",
        "pretty-format": "^29.7.0",
        "slash": "^3.0.0",
        "stack-utils": "^2.0.3"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/jest-mock": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/jest-mock/-/jest-mock-29.7.0.tgz",
      "integrity": "sha512-ITOMZn+UkYS4ZFh83xYAOzWStloNzJFO2s8DWrE4lhtGD+AorgnbkiKERe4wQVBydIGPx059g6riW5Btp6Llnw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jest/types": "^29.6.3",
        "@types/node": "*",
        "jest-util": "^29.7.0"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/jest-pnp-resolver": {
      "version": "1.2.3",
      "resolved": "https://registry.npmjs.org/jest-pnp-resolver/-/jest-pnp-resolver-1.2.3.tgz",
      "integrity": "sha512-+3NpwQEnRoIBtx4fyhblQDPgJI0H1IEIkX7ShLUjPGA7TtUTvI1oiKi3SR4oBR0hQhQR80l4WAe5RrXBwWMA8w==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6"
      },
      "peerDependencies": {
        "jest-resolve": "*"
      },
      "peerDependenciesMeta": {
        "jest-resolve": {
          "optional": true
        }
      }
    },
    "node_modules/jest-regex-util": {
      "version": "29.6.3",
      "resolved": "https://registry.npmjs.org/jest-regex-util/-/jest-regex-util-29.6.3.tgz",
      "integrity": "sha512-KJJBsRCyyLNWCNBOvZyRDnAIfUiRJ8v+hOBQYGn8gDyF3UegwiP4gwRR3/SDa42g1YbVycTidUF3rKjyLFDWbg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/jest-resolve": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/jest-resolve/-/jest-resolve-29.7.0.tgz",
      "integrity": "sha512-IOVhZSrg+UvVAshDSDtHyFCCBUl/Q3AAJv8iZ6ZjnZ74xzvwuzLXid9IIIPgTnY62SJjfuupMKZsZQRsCvxEgA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "chalk": "^4.0.0",
        "graceful-fs": "^4.2.9",
        "jest-haste-map": "^29.7.0",
        "jest-pnp-resolver": "^1.2.2",
        "jest-util": "^29.7.0",
        "jest-validate": "^29.7.0",
        "resolve": "^1.20.0",
        "resolve.exports": "^2.0.0",
        "slash": "^3.0.0"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/jest-resolve-dependencies": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/jest-resolve-dependencies/-/jest-resolve-dependencies-29.7.0.tgz",
      "integrity": "sha512-un0zD/6qxJ+S0et7WxeI3H5XSe9lTBBR7bOHCHXkKR6luG5mwDDlIzVQ0V5cZCuoTgEdcdwzTghYkTWfubi+nA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "jest-regex-util": "^29.6.3",
        "jest-snapshot": "^29.7.0"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/jest-runner": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/jest-runner/-/jest-runner-29.7.0.tgz",
      "integrity": "sha512-fsc4N6cPCAahybGBfTRcq5wFR6fpLznMg47sY5aDpsoejOcVYFb07AHuSnR0liMcPTgBsA3ZJL6kFOjPdoNipQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jest/console": "^29.7.0",
        "@jest/environment": "^29.7.0",
        "@jest/test-result": "^29.7.0",
        "@jest/transform": "^29.7.0",
        "@jest/types": "^29.6.3",
        "@types/node": "*",
        "chalk": "^4.0.0",
        "emittery": "^0.13.1",
        "graceful-fs": "^4.2.9",
        "jest-docblock": "^29.7.0",
        "jest-environment-node": "^29.7.0",
        "jest-haste-map": "^29.7.0",
        "jest-leak-detector": "^29.7.0",
        "jest-message-util": "^29.7.0",
        "jest-resolve": "^29.7.0",
        "jest-runtime": "^29.7.0",
        "jest-util": "^29.7.0",
        "jest-watcher": "^29.7.0",
        "jest-worker": "^29.7.0",
        "p-limit": "^3.1.0",
        "source-map-support": "0.5.13"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/jest-runtime": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/jest-runtime/-/jest-runtime-29.7.0.tgz",
      "integrity": "sha512-gUnLjgwdGqW7B4LvOIkbKs9WGbn+QLqRQQ9juC6HndeDiezIwhDP+mhMwHWCEcfQ5RUXa6OPnFF8BJh5xegwwQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jest/environment": "^29.7.0",
        "@jest/fake-timers": "^29.7.0",
        "@jest/globals": "^29.7.0",
        "@jest/source-map": "^29.6.3",
        "@jest/test-result": "^29.7.0",
        "@jest/transform": "^29.7.0",
        "@jest/types": "^29.6.3",
        "@types/node": "*",
        "chalk": "^4.0.0",
        "cjs-module-lexer": "^1.0.0",
        "collect-v8-coverage": "^1.0.0",
        "glob": "^7.1.3",
        "graceful-fs": "^4.2.9",
        "jest-haste-map": "^29.7.0",
        "jest-message-util": "^29.7.0",
        "jest-mock": "^29.7.0",
        "jest-regex-util": "^29.6.3",
        "jest-resolve": "^29.7.0",
        "jest-snapshot": "^29.7.0",
        "jest-util": "^29.7.0",
        "slash": "^3.0.0",
        "strip-bom": "^4.0.0"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/jest-runtime/node_modules/strip-bom": {
      "version": "4.0.0",
      "resolved": "https://registry.npmjs.org/strip-bom/-/strip-bom-4.0.0.tgz",
      "integrity": "sha512-3xurFv5tEgii33Zi8Jtp55wEIILR9eh34FAW00PZf+JnSsTmV/ioewSgQl97JHvgjoRGwPShsWm+IdrxB35d0w==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/jest-snapshot": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/jest-snapshot/-/jest-snapshot-29.7.0.tgz",
      "integrity": "sha512-Rm0BMWtxBcioHr1/OX5YCP8Uov4riHvKPknOGs804Zg9JGZgmIBkbtlxJC/7Z4msKYVbIJtfU+tKb8xlYNfdkw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/core": "^7.11.6",
        "@babel/generator": "^7.7.2",
        "@babel/plugin-syntax-jsx": "^7.7.2",
        "@babel/plugin-syntax-typescript": "^7.7.2",
        "@babel/types": "^7.3.3",
        "@jest/expect-utils": "^29.7.0",
        "@jest/transform": "^29.7.0",
        "@jest/types": "^29.6.3",
        "babel-preset-current-node-syntax": "^1.0.0",
        "chalk": "^4.0.0",
        "expect": "^29.7.0",
        "graceful-fs": "^4.2.9",
        "jest-diff": "^29.7.0",
        "jest-get-type": "^29.6.3",
        "jest-matcher-utils": "^29.7.0",
        "jest-message-util": "^29.7.0",
        "jest-util": "^29.7.0",
        "natural-compare": "^1.4.0",
        "pretty-format": "^29.7.0",
        "semver": "^7.5.3"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/jest-snapshot/node_modules/semver": {
      "version": "7.7.4",
      "resolved": "https://registry.npmjs.org/semver/-/semver-7.7.4.tgz",
      "integrity": "sha512-vFKC2IEtQnVhpT78h1Yp8wzwrf8CM+MzKMHGJZfBtzhZNycRFnXsHk6E5TxIkkMsgNS7mdX3AGB7x2QM2di4lA==",
      "dev": true,
      "license": "ISC",
      "bin": {
        "semver": "bin/semver.js"
      },
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/jest-util": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/jest-util/-/jest-util-29.7.0.tgz",
      "integrity": "sha512-z6EbKajIpqGKU56y5KBUgy1dt1ihhQJgWzUlZHArA/+X2ad7Cb5iF+AK1EWVL/Bo7Rz9uurpqw6SiBCefUbCGA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jest/types": "^29.6.3",
        "@types/node": "*",
        "chalk": "^4.0.0",
        "ci-info": "^3.2.0",
        "graceful-fs": "^4.2.9",
        "picomatch": "^2.2.3"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/jest-validate": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/jest-validate/-/jest-validate-29.7.0.tgz",
      "integrity": "sha512-ZB7wHqaRGVw/9hST/OuFUReG7M8vKeq0/J2egIGLdvjHCmYqGARhzXmtgi+gVeZ5uXFF219aOc3Ls2yLg27tkw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jest/types": "^29.6.3",
        "camelcase": "^6.2.0",
        "chalk": "^4.0.0",
        "jest-get-type": "^29.6.3",
        "leven": "^3.1.0",
        "pretty-format": "^29.7.0"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/jest-validate/node_modules/camelcase": {
      "version": "6.3.0",
      "resolved": "https://registry.npmjs.org/camelcase/-/camelcase-6.3.0.tgz",
      "integrity": "sha512-Gmy6FhYlCY7uOElZUSbxo2UCDH8owEk996gkbrpsgGtrJLM3J7jGxl9Ic7Qwwj4ivOE5AWZWRMecDdF7hqGjFA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/jest-watcher": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/jest-watcher/-/jest-watcher-29.7.0.tgz",
      "integrity": "sha512-49Fg7WXkU3Vl2h6LbLtMQ/HyB6rXSIX7SqvBLQmssRBGN9I0PNvPmAmCWSOY6SOvrjhI/F7/bGAv9RtnsPA03g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jest/test-result": "^29.7.0",
        "@jest/types": "^29.6.3",
        "@types/node": "*",
        "ansi-escapes": "^4.2.1",
        "chalk": "^4.0.0",
        "emittery": "^0.13.1",
        "jest-util": "^29.7.0",
        "string-length": "^4.0.1"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/jest-worker": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/jest-worker/-/jest-worker-29.7.0.tgz",
      "integrity": "sha512-eIz2msL/EzL9UFTFFx7jBTkeZfku0yUAyZZZmJ93H2TYEiroIx2PQjEXcwYtYl8zXCxb+PAmA2hLIt/6ZEkPHw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/node": "*",
        "jest-util": "^29.7.0",
        "merge-stream": "^2.0.0",
        "supports-color": "^8.0.0"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/jest-worker/node_modules/supports-color": {
      "version": "8.1.1",
      "resolved": "https://registry.npmjs.org/supports-color/-/supports-color-8.1.1.tgz",
      "integrity": "sha512-MpUEN2OodtUzxvKQl72cUF7RQ5EiHsGvSsVG0ia9c5RbWGL2CI4C7EpPS8UTBIplnlzZiNuV56w+FuNxy3ty2Q==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "has-flag": "^4.0.0"
      },
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/chalk/supports-color?sponsor=1"
      }
    },
    "node_modules/js-tokens": {
      "version": "4.0.0",
      "resolved": "https://registry.npmjs.org/js-tokens/-/js-tokens-4.0.0.tgz",
      "integrity": "sha512-RdJUflcE3cUzKiMqQgsCu06FPu9UdIJO0beYbPhHN4k6apgJtifcoCtT9bcxOpYBtpD2kCM6Sbzg4CausW/PKQ==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/js-yaml": {
      "version": "3.14.2",
      "resolved": "https://registry.npmjs.org/js-yaml/-/js-yaml-3.14.2.tgz",
      "integrity": "sha512-PMSmkqxr106Xa156c2M265Z+FTrPl+oxd/rgOQy2tijQeK5TxQ43psO1ZCwhVOSdnn+RzkzlRz/eY4BgJBYVpg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "argparse": "^1.0.7",
        "esprima": "^4.0.0"
      },
      "bin": {
        "js-yaml": "bin/js-yaml.js"
      }
    },
    "node_modules/jsesc": {
      "version": "3.1.0",
      "resolved": "https://registry.npmjs.org/jsesc/-/jsesc-3.1.0.tgz",
      "integrity": "sha512-/sM3dO2FOzXjKQhJuo0Q173wf2KOo8t4I8vHy6lF9poUp7bKT0/NHE8fPX23PwfhnykfqnC2xRxOnVw5XuGIaA==",
      "dev": true,
      "license": "MIT",
      "bin": {
        "jsesc": "bin/jsesc"
      },
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/json-bigint": {
      "version": "1.0.0",
      "resolved": "https://registry.npmjs.org/json-bigint/-/json-bigint-1.0.0.tgz",
      "integrity": "sha512-SiPv/8VpZuWbvLSMtTDU8hEfrZWg/mH/nV/b4o0CYbSxu1UIQPLdwKOCIyLQX+VIPO5vrLX3i8qtqFyhdPSUSQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "bignumber.js": "^9.0.0"
      }
    },
    "node_modules/json-buffer": {
      "version": "3.0.1",
      "resolved": "https://registry.npmjs.org/json-buffer/-/json-buffer-3.0.1.tgz",
      "integrity": "sha512-4bV5BfR2mqfQTJm+V5tPPdf+ZpuhiIvTuAB5g8kcrXOZpTT/QwwVRWBywX1ozr6lEuPdbHxwaJlm9G6mI2sfSQ==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/json-parse-even-better-errors": {
      "version": "2.3.1",
      "resolved": "https://registry.npmjs.org/json-parse-even-better-errors/-/json-parse-even-better-errors-2.3.1.tgz",
      "integrity": "sha512-xyFwyhro/JEof6Ghe2iz2NcXoj2sloNsWr/XsERDK/oiPCfaNhl5ONfp+jQdAZRQQ0IJWNzH9zIZF7li91kh2w==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/json5": {
      "version": "2.2.3",
      "resolved": "https://registry.npmjs.org/json5/-/json5-2.2.3.tgz",
      "integrity": "sha512-XmOWe7eyHYH14cLdVPoyg+GOH3rYX++KpzrylJwSW98t3Nk+U8XOl8FWKOgwtzdb8lXGf6zYwDUzeHMWfxasyg==",
      "dev": true,
      "license": "MIT",
      "bin": {
        "json5": "lib/cli.js"
      },
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/jsonfile": {
      "version": "6.2.0",
      "resolved": "https://registry.npmjs.org/jsonfile/-/jsonfile-6.2.0.tgz",
      "integrity": "sha512-FGuPw30AdOIUTRMC2OMRtQV+jkVj2cfPqSeWXv1NEAJ1qZ5zb1X6z1mFhbfOB/iy3ssJCD+3KuZ8r8C3uVFlAg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "universalify": "^2.0.0"
      },
      "optionalDependencies": {
        "graceful-fs": "^4.1.6"
      }
    },
    "node_modules/jwa": {
      "version": "2.0.1",
      "resolved": "https://registry.npmjs.org/jwa/-/jwa-2.0.1.tgz",
      "integrity": "sha512-hRF04fqJIP8Abbkq5NKGN0Bbr3JxlQ+qhZufXVr0DvujKy93ZCbXZMHDL4EOtodSbCWxOqR8MS1tXA5hwqCXDg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "buffer-equal-constant-time": "^1.0.1",
        "ecdsa-sig-formatter": "1.0.11",
        "safe-buffer": "^5.0.1"
      }
    },
    "node_modules/jws": {
      "version": "4.0.1",
      "resolved": "https://registry.npmjs.org/jws/-/jws-4.0.1.tgz",
      "integrity": "sha512-EKI/M/yqPncGUUh44xz0PxSidXFr/+r0pA70+gIYhjv+et7yxM+s29Y+VGDkovRofQem0fs7Uvf4+YmAdyRduA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "jwa": "^2.0.1",
        "safe-buffer": "^5.0.1"
      }
    },
    "node_modules/keyv": {
      "version": "4.5.4",
      "resolved": "https://registry.npmjs.org/keyv/-/keyv-4.5.4.tgz",
      "integrity": "sha512-oxVHkHR/EJf2CNXnWxRLW6mg7JyCCUcG0DtEGmL2ctUo1PNTin1PUil+r/+4r5MpVgC/fn1kjsx7mjSujKqIpw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "json-buffer": "3.0.1"
      }
    },
    "node_modules/kleur": {
      "version": "3.0.3",
      "resolved": "https://registry.npmjs.org/kleur/-/kleur-3.0.3.tgz",
      "integrity": "sha512-eTIzlVOSUR+JxdDFepEYcBMtZ9Qqdef+rnzWdRZuMbOywu5tO2w2N7rqjoANZ5k9vywhL6Br1VRjUIgTQx4E8w==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/leven": {
      "version": "3.1.0",
      "resolved": "https://registry.npmjs.org/leven/-/leven-3.1.0.tgz",
      "integrity": "sha512-qsda+H8jTaUaN/x5vzW2rzc+8Rw4TAQ/4KjB46IwK5VH+IlVeeeje/EoZRpiXvIqjFgK84QffqPztGI3VBLG1A==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/lines-and-columns": {
      "version": "1.2.4",
      "resolved": "https://registry.npmjs.org/lines-and-columns/-/lines-and-columns-1.2.4.tgz",
      "integrity": "sha512-7ylylesZQ/PV29jhEDl3Ufjo6ZX7gCqJr5F7PKrqc93v7fzSymt1BpwEU8nAUXs8qzzvqhbjhK5QZg6Mt/HkBg==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/locate-path": {
      "version": "7.2.0",
      "resolved": "https://registry.npmjs.org/locate-path/-/locate-path-7.2.0.tgz",
      "integrity": "sha512-gvVijfZvn7R+2qyPX8mAuKcFGDf6Nc61GdvGafQsHL0sBIxfKzA+usWn4GFC/bk+QdwPUD4kWFJLhElipq+0VA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "p-locate": "^6.0.0"
      },
      "engines": {
        "node": "^12.20.0 || ^14.13.1 || >=16.0.0"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/lodash": {
      "version": "4.17.23",
      "resolved": "https://registry.npmjs.org/lodash/-/lodash-4.17.23.tgz",
      "integrity": "sha512-LgVTMpQtIopCi79SJeDiP0TfWi5CNEc/L/aRdTh3yIvmZXTnheWpKjSZhnvMl8iXbC1tFg9gdHHDMLoV7CnG+w==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/lodash.memoize": {
      "version": "4.1.2",
      "resolved": "https://registry.npmjs.org/lodash.memoize/-/lodash.memoize-4.1.2.tgz",
      "integrity": "sha512-t7j+NzmgnQzTAYXcsHYLgimltOV1MXHtlOWf6GjL9Kj8GK5FInw5JotxvbOs+IvV1/Dzo04/fCGfLVs7aXb4Ag==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/log-symbols": {
      "version": "5.1.0",
      "resolved": "https://registry.npmjs.org/log-symbols/-/log-symbols-5.1.0.tgz",
      "integrity": "sha512-l0x2DvrW294C9uDCoQe1VSU4gf529FkSZ6leBl4TiqZH/e+0R7hSfHQBNut2mNygDgHwvYHfFLn6Oxb3VWj2rA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "chalk": "^5.0.0",
        "is-unicode-supported": "^1.1.0"
      },
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/log-symbols/node_modules/chalk": {
      "version": "5.6.2",
      "resolved": "https://registry.npmjs.org/chalk/-/chalk-5.6.2.tgz",
      "integrity": "sha512-7NzBL0rN6fMUW+f7A6Io4h40qQlG+xGmtMxfbnH/K7TAtt8JQWVQK+6g0UXKMeVJoyV5EkkNsErQ8pVD3bLHbA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": "^12.17.0 || ^14.13 || >=16.0.0"
      },
      "funding": {
        "url": "https://github.com/chalk/chalk?sponsor=1"
      }
    },
    "node_modules/loud-rejection": {
      "version": "2.2.0",
      "resolved": "https://registry.npmjs.org/loud-rejection/-/loud-rejection-2.2.0.tgz",
      "integrity": "sha512-S0FayMXku80toa5sZ6Ro4C+s+EtFDCsyJNG/AzFMfX3AxD5Si4dZsgzm/kKnbOxHl5Cv8jBlno8+3XYIh2pNjQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "currently-unhandled": "^0.4.1",
        "signal-exit": "^3.0.2"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/lowercase-keys": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/lowercase-keys/-/lowercase-keys-2.0.0.tgz",
      "integrity": "sha512-tqNXrS78oMOE73NMxK4EMLQsQowWf8jKooH9g7xPavRT706R6bkQJ6DY2Te7QukaZsulxa30wQ7bk0pm4XiHmA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/lru-cache": {
      "version": "6.0.0",
      "resolved": "https://registry.npmjs.org/lru-cache/-/lru-cache-6.0.0.tgz",
      "integrity": "sha512-Jo6dJ04CmSjuznwJSS3pUeWmd/H0ffTlkXXgwZi+eq1UCmqQwCh+eLsYOYCwY991i2Fah4h1BEMCx4qThGbsiA==",
      "dev": true,
      "license": "ISC",
      "dependencies": {
        "yallist": "^4.0.0"
      },
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/make-dir": {
      "version": "3.1.0",
      "resolved": "https://registry.npmjs.org/make-dir/-/make-dir-3.1.0.tgz",
      "integrity": "sha512-g3FeP20LNwhALb/6Cz6Dd4F2ngze0jz7tbzrD2wAV+o9FeNHe4rL+yK2md0J/fiSf1sa1ADhXqi5+oVwOM/eGw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "semver": "^6.0.0"
      },
      "engines": {
        "node": ">=8"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/make-error": {
      "version": "1.3.6",
      "resolved": "https://registry.npmjs.org/make-error/-/make-error-1.3.6.tgz",
      "integrity": "sha512-s8UhlNe7vPKomQhC1qFelMokr/Sc3AgNbso3n74mVPA5LTZwkB9NlXf4XPamLxJE8h0gh73rM94xvwRT2CVInw==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/makeerror": {
      "version": "1.0.12",
      "resolved": "https://registry.npmjs.org/makeerror/-/makeerror-1.0.12.tgz",
      "integrity": "sha512-JmqCvUhmt43madlpFzG4BQzG2Z3m6tvQDNKdClZnO3VbIudJYmxsT0FNJMeiB2+JTSlTQTSbU8QdesVmwJcmLg==",
      "dev": true,
      "license": "BSD-3-Clause",
      "dependencies": {
        "tmpl": "1.0.5"
      }
    },
    "node_modules/math-intrinsics": {
      "version": "1.1.0",
      "resolved": "https://registry.npmjs.org/math-intrinsics/-/math-intrinsics-1.1.0.tgz",
      "integrity": "sha512-/IXtbwEk5HTPyEwyKX6hGkYXxM9nbj64B+ilVJnC/R6B0pH5G4V3b0pVbL7DBj4tkhBAppbQUlf6F6Xl9LHu1g==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/merge-stream": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/merge-stream/-/merge-stream-2.0.0.tgz",
      "integrity": "sha512-abv/qOcuPfk3URPfDzmZU1LKmuw8kT+0nIHvKrKgFrwifol/doWcdA4ZqsWQ8ENrFKkd67Mfpo/LovbIUsbt3w==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/micromatch": {
      "version": "4.0.8",
      "resolved": "https://registry.npmjs.org/micromatch/-/micromatch-4.0.8.tgz",
      "integrity": "sha512-PXwfBhYu0hBCPw8Dn0E+WDYb7af3dSLVWKi3HGv84IdF4TyFoC0ysxFd0Goxw7nSv4T/PzEJQxsYsEiFCKo2BA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "braces": "^3.0.3",
        "picomatch": "^2.3.1"
      },
      "engines": {
        "node": ">=8.6"
      }
    },
    "node_modules/mimic-fn": {
      "version": "2.1.0",
      "resolved": "https://registry.npmjs.org/mimic-fn/-/mimic-fn-2.1.0.tgz",
      "integrity": "sha512-OqbOk5oEQeAZ8WXWydlu9HJjz9WVdEIvamMCcXmuqUYjTknH/sqsWvhQ3vgwKFRR1HpjvNBKQ37nbJgYzGqGcg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/mimic-response": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/mimic-response/-/mimic-response-1.0.1.tgz",
      "integrity": "sha512-j5EctnkH7amfV/q5Hgmoal1g2QHFJRraOtmx0JpIqkxhBhI/lJSl1nMpQ45hVarwNETOoWEimndZ4QK0RHxuxQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=4"
      }
    },
    "node_modules/minimatch": {
      "version": "3.1.5",
      "resolved": "https://registry.npmjs.org/minimatch/-/minimatch-3.1.5.tgz",
      "integrity": "sha512-VgjWUsnnT6n+NUk6eZq77zeFdpW2LWDzP6zFGrCbHXiYNul5Dzqk2HHQ5uFH2DNW5Xbp8+jVzaeNt94ssEEl4w==",
      "dev": true,
      "license": "ISC",
      "dependencies": {
        "brace-expansion": "^1.1.7"
      },
      "engines": {
        "node": "*"
      }
    },
    "node_modules/minimist": {
      "version": "1.2.8",
      "resolved": "https://registry.npmjs.org/minimist/-/minimist-1.2.8.tgz",
      "integrity": "sha512-2yyAR8qBkN3YuheJanUpWC5U3bb5osDywNB8RzDVlDwDHbocAJveqqj1u8+SVD7jkWT4yvsHCpWqqWqAxb0zCA==",
      "dev": true,
      "license": "MIT",
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/ms": {
      "version": "2.1.3",
      "resolved": "https://registry.npmjs.org/ms/-/ms-2.1.3.tgz",
      "integrity": "sha512-6FlzubTLZG3J2a/NVCAleEhjzq5oxgHyaCU9yYXvcLsvoVaHJq/s5xXI6/XXP6tz7R9xAOtHnSO/tXtF3WRTlA==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/multimatch": {
      "version": "5.0.0",
      "resolved": "https://registry.npmjs.org/multimatch/-/multimatch-5.0.0.tgz",
      "integrity": "sha512-ypMKuglUrZUD99Tk2bUQ+xNQj43lPEfAeX2o9cTteAmShXy2VHDJpuwu1o0xqoKCt9jLVAvwyFKdLTPXKAfJyA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/minimatch": "^3.0.3",
        "array-differ": "^3.0.0",
        "array-union": "^2.1.0",
        "arrify": "^2.0.1",
        "minimatch": "^3.0.4"
      },
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/mute-stream": {
      "version": "0.0.8",
      "resolved": "https://registry.npmjs.org/mute-stream/-/mute-stream-0.0.8.tgz",
      "integrity": "sha512-nnbWWOkoWyUsTjKrhgD0dcz22mdkSnpYqbEjIm2nhwhuxlSkpywJmBo8h0ZqJdkp73mb90SssHkN4rsRaBAfAA==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/natural-compare": {
      "version": "1.4.0",
      "resolved": "https://registry.npmjs.org/natural-compare/-/natural-compare-1.4.0.tgz",
      "integrity": "sha512-OWND8ei3VtNC9h7V60qff3SVobHr996CTwgxubgyQYEpg290h9J0buyECNNJexkFm5sOajh5G116RYA1c8ZMSw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/neo-async": {
      "version": "2.6.2",
      "resolved": "https://registry.npmjs.org/neo-async/-/neo-async-2.6.2.tgz",
      "integrity": "sha512-Yd3UES5mWCSqR+qNT93S3UoYUkqAZ9lLg8a7g9rimsWmYGK8cVToA4/sF3RrshdyV3sAGMXVUmpMYOw+dLpOuw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/node-fetch": {
      "version": "2.7.0",
      "resolved": "https://registry.npmjs.org/node-fetch/-/node-fetch-2.7.0.tgz",
      "integrity": "sha512-c4FRfUm/dbcWZ7U+1Wq0AwCyFL+3nt2bEw05wfxSz+DWpWsitgmSgYmy2dQdWyKC1694ELPqMs/YzUSNozLt8A==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "whatwg-url": "^5.0.0"
      },
      "engines": {
        "node": "4.x || >=6.0.0"
      },
      "peerDependencies": {
        "encoding": "^0.1.0"
      },
      "peerDependenciesMeta": {
        "encoding": {
          "optional": true
        }
      }
    },
    "node_modules/node-forge": {
      "version": "1.3.3",
      "resolved": "https://registry.npmjs.org/node-forge/-/node-forge-1.3.3.tgz",
      "integrity": "sha512-rLvcdSyRCyouf6jcOIPe/BgwG/d7hKjzMKOas33/pHEr6gbq18IK9zV7DiPvzsz0oBJPme6qr6H6kGZuI9/DZg==",
      "dev": true,
      "license": "(BSD-3-Clause OR GPL-2.0)",
      "engines": {
        "node": ">= 6.13.0"
      }
    },
    "node_modules/node-int64": {
      "version": "0.4.0",
      "resolved": "https://registry.npmjs.org/node-int64/-/node-int64-0.4.0.tgz",
      "integrity": "sha512-O5lz91xSOeoXP6DulyHfllpq+Eg00MWitZIbtPfoSEvqIHdl5gfcY6hYzDWnj0qD5tz52PI08u9qUvSVeUBeHw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/node-releases": {
      "version": "2.0.27",
      "resolved": "https://registry.npmjs.org/node-releases/-/node-releases-2.0.27.tgz",
      "integrity": "sha512-nmh3lCkYZ3grZvqcCH+fjmQ7X+H0OeZgP40OierEaAptX4XofMh5kwNbWh7lBduUzCcV/8kZ+NDLCwm2iorIlA==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/normalize-newline": {
      "version": "4.1.0",
      "resolved": "https://registry.npmjs.org/normalize-newline/-/normalize-newline-4.1.0.tgz",
      "integrity": "sha512-ff4jKqMI8Xl50/4Mms/9jPobzAV/UK+kXG2XJ/7AqOmxIx8mqfqTIHYxuAnEgJ2AQeBbLnlbmZ5+38Y9A0w/YA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "replace-buffer": "^1.2.1"
      },
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/normalize-package-data": {
      "version": "3.0.3",
      "resolved": "https://registry.npmjs.org/normalize-package-data/-/normalize-package-data-3.0.3.tgz",
      "integrity": "sha512-p2W1sgqij3zMMyRC067Dg16bfzVH+w7hyegmpIvZ4JNjqtGOVAIvLmjBx3yP7YTe9vKJgkoNOPjwQGogDoMXFA==",
      "dev": true,
      "license": "BSD-2-Clause",
      "dependencies": {
        "hosted-git-info": "^4.0.1",
        "is-core-module": "^2.5.0",
        "semver": "^7.3.4",
        "validate-npm-package-license": "^3.0.1"
      },
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/normalize-package-data/node_modules/semver": {
      "version": "7.7.4",
      "resolved": "https://registry.npmjs.org/semver/-/semver-7.7.4.tgz",
      "integrity": "sha512-vFKC2IEtQnVhpT78h1Yp8wzwrf8CM+MzKMHGJZfBtzhZNycRFnXsHk6E5TxIkkMsgNS7mdX3AGB7x2QM2di4lA==",
      "dev": true,
      "license": "ISC",
      "bin": {
        "semver": "bin/semver.js"
      },
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/normalize-path": {
      "version": "3.0.0",
      "resolved": "https://registry.npmjs.org/normalize-path/-/normalize-path-3.0.0.tgz",
      "integrity": "sha512-6eZs5Ls3WtCisHWp9S2GUy8dqkpGi4BVSz3GaqiE6ezub0512ESztXUwUB6C6IKbQkY2Pnb/mD4WYojCRwcwLA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/normalize-url": {
      "version": "6.1.0",
      "resolved": "https://registry.npmjs.org/normalize-url/-/normalize-url-6.1.0.tgz",
      "integrity": "sha512-DlL+XwOy3NxAQ8xuC0okPgK46iuVNAK01YN7RueYBqqFeGsBjV9XmCAzAdgt+667bCl5kPh9EqKKDwnaPG1I7A==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/npm-run-path": {
      "version": "4.0.1",
      "resolved": "https://registry.npmjs.org/npm-run-path/-/npm-run-path-4.0.1.tgz",
      "integrity": "sha512-S48WzZW777zhNIrn7gxOlISNAqi9ZC/uQFnRdbeIHhZhCA6UqpkOT8T1G7BvfdgP4Er8gF4sUbaS0i7QvIfCWw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "path-key": "^3.0.0"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/object-inspect": {
      "version": "1.13.4",
      "resolved": "https://registry.npmjs.org/object-inspect/-/object-inspect-1.13.4.tgz",
      "integrity": "sha512-W67iLl4J2EXEGTbfeHCffrjDfitvLANg0UlX3wFUUSTx92KXRFegMHUVgSqE+wvhAbi4WqjGg9czysTV2Epbew==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/once": {
      "version": "1.4.0",
      "resolved": "https://registry.npmjs.org/once/-/once-1.4.0.tgz",
      "integrity": "sha512-lNaJgI+2Q5URQBkccEKHTQOPaXdUxnZZElQTZY0MFUAuaEqe1E+Nyvgdz/aIyNi6Z9MzO5dv1H8n58/GELp3+w==",
      "dev": true,
      "license": "ISC",
      "dependencies": {
        "wrappy": "1"
      }
    },
    "node_modules/onetime": {
      "version": "5.1.2",
      "resolved": "https://registry.npmjs.org/onetime/-/onetime-5.1.2.tgz",
      "integrity": "sha512-kbpaSSGJTWdAY5KPVeMOKXSrPtr8C8C7wodJbcsd51jRnmD+GZu8Y0VoU6Dm5Z4vWr0Ig/1NKuWRKf7j5aaYSg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "mimic-fn": "^2.1.0"
      },
      "engines": {
        "node": ">=6"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/open": {
      "version": "8.4.2",
      "resolved": "https://registry.npmjs.org/open/-/open-8.4.2.tgz",
      "integrity": "sha512-7x81NCL719oNbsq/3mh+hVrAWmFuEYUqrq/Iw3kUzH8ReypT9QQ0BLoJS7/G9k6N81XjW4qHWtjWwe/9eLy1EQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "define-lazy-prop": "^2.0.0",
        "is-docker": "^2.1.1",
        "is-wsl": "^2.2.0"
      },
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/ora": {
      "version": "6.3.1",
      "resolved": "https://registry.npmjs.org/ora/-/ora-6.3.1.tgz",
      "integrity": "sha512-ERAyNnZOfqM+Ao3RAvIXkYh5joP220yf59gVe2X/cI6SiCxIdi4c9HZKZD8R6q/RDXEje1THBju6iExiSsgJaQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "chalk": "^5.0.0",
        "cli-cursor": "^4.0.0",
        "cli-spinners": "^2.6.1",
        "is-interactive": "^2.0.0",
        "is-unicode-supported": "^1.1.0",
        "log-symbols": "^5.1.0",
        "stdin-discarder": "^0.1.0",
        "strip-ansi": "^7.0.1",
        "wcwidth": "^1.0.1"
      },
      "engines": {
        "node": "^12.20.0 || ^14.13.1 || >=16.0.0"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/ora/node_modules/ansi-regex": {
      "version": "6.2.2",
      "resolved": "https://registry.npmjs.org/ansi-regex/-/ansi-regex-6.2.2.tgz",
      "integrity": "sha512-Bq3SmSpyFHaWjPk8If9yc6svM8c56dB5BAtW4Qbw5jHTwwXXcTLoRMkpDJp6VL0XzlWaCHTXrkFURMYmD0sLqg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/chalk/ansi-regex?sponsor=1"
      }
    },
    "node_modules/ora/node_modules/chalk": {
      "version": "5.6.2",
      "resolved": "https://registry.npmjs.org/chalk/-/chalk-5.6.2.tgz",
      "integrity": "sha512-7NzBL0rN6fMUW+f7A6Io4h40qQlG+xGmtMxfbnH/K7TAtt8JQWVQK+6g0UXKMeVJoyV5EkkNsErQ8pVD3bLHbA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": "^12.17.0 || ^14.13 || >=16.0.0"
      },
      "funding": {
        "url": "https://github.com/chalk/chalk?sponsor=1"
      }
    },
    "node_modules/ora/node_modules/cli-cursor": {
      "version": "4.0.0",
      "resolved": "https://registry.npmjs.org/cli-cursor/-/cli-cursor-4.0.0.tgz",
      "integrity": "sha512-VGtlMu3x/4DOtIUwEkRezxUZ2lBacNJCHash0N0WeZDBS+7Ux1dm3XWAgWYxLJFMMdOeXMHXorshEFhbMSGelg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "restore-cursor": "^4.0.0"
      },
      "engines": {
        "node": "^12.20.0 || ^14.13.1 || >=16.0.0"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/ora/node_modules/restore-cursor": {
      "version": "4.0.0",
      "resolved": "https://registry.npmjs.org/restore-cursor/-/restore-cursor-4.0.0.tgz",
      "integrity": "sha512-I9fPXU9geO9bHOt9pHHOhOkYerIMsmVaWB0rA2AI9ERh/+x/i7MV5HKBNrg+ljO5eoPVgCcnFuRjJ9uH6I/3eg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "onetime": "^5.1.0",
        "signal-exit": "^3.0.2"
      },
      "engines": {
        "node": "^12.20.0 || ^14.13.1 || >=16.0.0"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/ora/node_modules/strip-ansi": {
      "version": "7.2.0",
      "resolved": "https://registry.npmjs.org/strip-ansi/-/strip-ansi-7.2.0.tgz",
      "integrity": "sha512-yDPMNjp4WyfYBkHnjIRLfca1i6KMyGCtsVgoKe/z1+6vukgaENdgGBZt+ZmKPc4gavvEZ5OgHfHdrazhgNyG7w==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "ansi-regex": "^6.2.2"
      },
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/chalk/strip-ansi?sponsor=1"
      }
    },
    "node_modules/p-any": {
      "version": "3.0.0",
      "resolved": "https://registry.npmjs.org/p-any/-/p-any-3.0.0.tgz",
      "integrity": "sha512-5rqbqfsRWNb0sukt0awwgJMlaep+8jV45S15SKKB34z4UuzjcofIfnriCBhWjZP2jbVtjt9yRl7buB6RlKsu9w==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "p-cancelable": "^2.0.0",
        "p-some": "^5.0.0"
      },
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/p-cancelable": {
      "version": "2.1.1",
      "resolved": "https://registry.npmjs.org/p-cancelable/-/p-cancelable-2.1.1.tgz",
      "integrity": "sha512-BZOr3nRQHOntUjTrH8+Lh54smKHoHyur8We1V8DSMVrl5A2malOOwuJRnKRDjSnkoeBh4at6BwEnb5I7Jl31wg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/p-finally": {
      "version": "1.0.0",
      "resolved": "https://registry.npmjs.org/p-finally/-/p-finally-1.0.0.tgz",
      "integrity": "sha512-LICb2p9CB7FS+0eR1oqWnHhp0FljGLZCWBE9aix0Uye9W8LTQPwMTYVGWQWIw9RdQiDg4+epXQODwIYJtSJaow==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=4"
      }
    },
    "node_modules/p-limit": {
      "version": "3.1.0",
      "resolved": "https://registry.npmjs.org/p-limit/-/p-limit-3.1.0.tgz",
      "integrity": "sha512-TYOanM3wGwNGsZN2cVTYPArw454xnXj5qmWF1bEoAc4+cU/ol7GVh7odevjp1FNHduHc3KZMcFduxU5Xc6uJRQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "yocto-queue": "^0.1.0"
      },
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/p-locate": {
      "version": "6.0.0",
      "resolved": "https://registry.npmjs.org/p-locate/-/p-locate-6.0.0.tgz",
      "integrity": "sha512-wPrq66Llhl7/4AGC6I+cqxT07LhXvWL08LNXz1fENOw0Ap4sRZZ/gZpTTJ5jpurzzzfS2W/Ge9BY3LgLjCShcw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "p-limit": "^4.0.0"
      },
      "engines": {
        "node": "^12.20.0 || ^14.13.1 || >=16.0.0"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/p-locate/node_modules/p-limit": {
      "version": "4.0.0",
      "resolved": "https://registry.npmjs.org/p-limit/-/p-limit-4.0.0.tgz",
      "integrity": "sha512-5b0R4txpzjPWVw/cXXUResoD4hb6U/x9BH08L7nw+GN1sezDzPdxeRvpc9c433fZhBan/wusjbCsqwqm4EIBIQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "yocto-queue": "^1.0.0"
      },
      "engines": {
        "node": "^12.20.0 || ^14.13.1 || >=16.0.0"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/p-locate/node_modules/yocto-queue": {
      "version": "1.2.2",
      "resolved": "https://registry.npmjs.org/yocto-queue/-/yocto-queue-1.2.2.tgz",
      "integrity": "sha512-4LCcse/U2MHZ63HAJVE+v71o7yOdIe4cZ70Wpf8D/IyjDKYQLV5GD46B+hSTjJsvV5PztjvHoU580EftxjDZFQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=12.20"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/p-map": {
      "version": "5.5.0",
      "resolved": "https://registry.npmjs.org/p-map/-/p-map-5.5.0.tgz",
      "integrity": "sha512-VFqfGDHlx87K66yZrNdI4YGtD70IRyd+zSvgks6mzHPRNkoKy+9EKP4SFC77/vTTQYmRmti7dvqC+m5jBrBAcg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "aggregate-error": "^4.0.0"
      },
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/p-some": {
      "version": "5.0.0",
      "resolved": "https://registry.npmjs.org/p-some/-/p-some-5.0.0.tgz",
      "integrity": "sha512-Js5XZxo6vHjB9NOYAzWDYAIyyiPvva0DWESAIWIK7uhSpGsyg5FwUPxipU/SOQx5x9EqhOh545d1jo6cVkitig==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "aggregate-error": "^3.0.0",
        "p-cancelable": "^2.0.0"
      },
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/p-some/node_modules/aggregate-error": {
      "version": "3.1.0",
      "resolved": "https://registry.npmjs.org/aggregate-error/-/aggregate-error-3.1.0.tgz",
      "integrity": "sha512-4I7Td01quW/RpocfNayFdFVk1qSuoh0E7JrbRJ16nH01HhKFQ88INq9Sd+nd72zqRySlr9BmDA8xlEJ6vJMrYA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "clean-stack": "^2.0.0",
        "indent-string": "^4.0.0"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/p-some/node_modules/clean-stack": {
      "version": "2.2.0",
      "resolved": "https://registry.npmjs.org/clean-stack/-/clean-stack-2.2.0.tgz",
      "integrity": "sha512-4diC9HaTE+KRAMWhDhrGOECgWZxoevMc5TlkObMqNSsVU62PYzXZ/SMTjzyGAFF1YusgxGcSWTEXBhp0CPwQ1A==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/p-some/node_modules/indent-string": {
      "version": "4.0.0",
      "resolved": "https://registry.npmjs.org/indent-string/-/indent-string-4.0.0.tgz",
      "integrity": "sha512-EdDDZu4A2OyIK7Lr/2zG+w5jmbuk1DVBnEwREQvBzspBJkCEbRa8GxU1lghYcaGJCnRWibjDXlq779X1/y5xwg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/p-timeout": {
      "version": "3.2.0",
      "resolved": "https://registry.npmjs.org/p-timeout/-/p-timeout-3.2.0.tgz",
      "integrity": "sha512-rhIwUycgwwKcP9yTOOFK/AKsAopjjCakVqLHePO3CC6Mir1Z99xT+R63jZxAT5lFZLa2inS5h+ZS2GvR99/FBg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "p-finally": "^1.0.0"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/p-try": {
      "version": "2.2.0",
      "resolved": "https://registry.npmjs.org/p-try/-/p-try-2.2.0.tgz",
      "integrity": "sha512-R4nPAVTAU0B9D35/Gk3uJf/7XYbQcyohSKdvAxIRSNghFl4e71hVoGnBNQz9cWaXxO2I10KTC+3jMdvvoKw6dQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/parse-json": {
      "version": "5.2.0",
      "resolved": "https://registry.npmjs.org/parse-json/-/parse-json-5.2.0.tgz",
      "integrity": "sha512-ayCKvm/phCGxOkYRSCM82iDwct8/EonSEgCSxWxD7ve6jHggsFl4fZVQBPRNgQoKiuV/odhFrGzQXZwbifC8Rg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/code-frame": "^7.0.0",
        "error-ex": "^1.3.1",
        "json-parse-even-better-errors": "^2.3.0",
        "lines-and-columns": "^1.1.6"
      },
      "engines": {
        "node": ">=8"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/path-exists": {
      "version": "5.0.0",
      "resolved": "https://registry.npmjs.org/path-exists/-/path-exists-5.0.0.tgz",
      "integrity": "sha512-RjhtfwJOxzcFmNOi6ltcbcu4Iu+FL3zEj83dk4kAS+fVpTxXLO1b38RvJgT/0QwvV/L3aY9TAnyv0EOqW4GoMQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": "^12.20.0 || ^14.13.1 || >=16.0.0"
      }
    },
    "node_modules/path-is-absolute": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/path-is-absolute/-/path-is-absolute-1.0.1.tgz",
      "integrity": "sha512-AVbw3UJ2e9bq64vSaS9Am0fje1Pa8pbGqTTsmXfaIiMpnr5DlDhfJOuLj9Sf95ZPVDAUerDfEk88MPmPe7UCQg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/path-key": {
      "version": "3.1.1",
      "resolved": "https://registry.npmjs.org/path-key/-/path-key-3.1.1.tgz",
      "integrity": "sha512-ojmeN0qd+y0jszEtoY48r0Peq5dwMEkIlCOu6Q5f41lfkswXuKtYrhgoTpLnyIcHm24Uhqx+5Tqm2InSwLhE6Q==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/path-parse": {
      "version": "1.0.7",
      "resolved": "https://registry.npmjs.org/path-parse/-/path-parse-1.0.7.tgz",
      "integrity": "sha512-LDJzPVEEEPR+y48z93A0Ed0yXb8pAByGWo/k5YYdYgpY2/2EsOsksJrq7lOHxryrVOn1ejG6oAp8ahvOIQD8sw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/picocolors": {
      "version": "1.1.1",
      "resolved": "https://registry.npmjs.org/picocolors/-/picocolors-1.1.1.tgz",
      "integrity": "sha512-xceH2snhtb5M9liqDsmEw56le376mTZkEX/jEb/RxNFyegNul7eNslCXP9FDj/Lcu0X8KEyMceP2ntpaHrDEVA==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/picomatch": {
      "version": "2.3.1",
      "resolved": "https://registry.npmjs.org/picomatch/-/picomatch-2.3.1.tgz",
      "integrity": "sha512-JU3teHTNjmE2VCGFzuY8EXzCDVwEqB2a8fsIvwaStHhAWJEeVd1o1QD80CU6+ZdEXXSLbSsuLwJjkCBWqRQUVA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8.6"
      },
      "funding": {
        "url": "https://github.com/sponsors/jonschlinkert"
      }
    },
    "node_modules/pirates": {
      "version": "4.0.7",
      "resolved": "https://registry.npmjs.org/pirates/-/pirates-4.0.7.tgz",
      "integrity": "sha512-TfySrs/5nm8fQJDcBDuUng3VOUKsd7S+zqvbOTiGXHfxX4wK31ard+hoNuvkicM/2YFzlpDgABOevKSsB4G/FA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">= 6"
      }
    },
    "node_modules/pkg-dir": {
      "version": "4.2.0",
      "resolved": "https://registry.npmjs.org/pkg-dir/-/pkg-dir-4.2.0.tgz",
      "integrity": "sha512-HRDzbaKjC+AOWVXxAU/x54COGeIv9eb+6CkDSQoNTt4XyWoIJvuPsXizxu/Fr23EiekbtZwmh1IcIG/l/a10GQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "find-up": "^4.0.0"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/pkg-dir/node_modules/find-up": {
      "version": "4.1.0",
      "resolved": "https://registry.npmjs.org/find-up/-/find-up-4.1.0.tgz",
      "integrity": "sha512-PpOwAdQ/YlXQ2vj8a3h8IipDuYRi3wceVQQGYWxNINccq40Anw7BlsEXCMbt1Zt+OLA6Fq9suIpIWD0OsnISlw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "locate-path": "^5.0.0",
        "path-exists": "^4.0.0"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/pkg-dir/node_modules/locate-path": {
      "version": "5.0.0",
      "resolved": "https://registry.npmjs.org/locate-path/-/locate-path-5.0.0.tgz",
      "integrity": "sha512-t7hw9pI+WvuwNJXwk5zVHpyhIqzg2qTlklJOf0mVxGSbe3Fp2VieZcduNYjaLDoy6p9uGpQEGWG87WpMKlNq8g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "p-locate": "^4.1.0"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/pkg-dir/node_modules/p-limit": {
      "version": "2.3.0",
      "resolved": "https://registry.npmjs.org/p-limit/-/p-limit-2.3.0.tgz",
      "integrity": "sha512-//88mFWSJx8lxCzwdAABTJL2MyWB12+eIY7MDL2SqLmAkeKU9qxRvWuSyTjm3FUmpBEMuFfckAIqEaVGUDxb6w==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "p-try": "^2.0.0"
      },
      "engines": {
        "node": ">=6"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/pkg-dir/node_modules/p-locate": {
      "version": "4.1.0",
      "resolved": "https://registry.npmjs.org/p-locate/-/p-locate-4.1.0.tgz",
      "integrity": "sha512-R79ZZ/0wAxKGu3oYMlz8jy/kbhsNrS7SKZ7PxEHBgJ5+F2mtFW2fK2cOtBh1cHYkQsbzFV7I+EoRKe6Yt0oK7A==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "p-limit": "^2.2.0"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/pkg-dir/node_modules/path-exists": {
      "version": "4.0.0",
      "resolved": "https://registry.npmjs.org/path-exists/-/path-exists-4.0.0.tgz",
      "integrity": "sha512-ak9Qy5Q7jYb2Wwcey5Fpvg2KoAc/ZIhLSLOSBmRmygPsGwkVVt0fZa0qrtMz+m6tJTAHfZQ8FnmB4MG4LWy7/w==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/prepend-http": {
      "version": "3.0.1",
      "resolved": "https://registry.npmjs.org/prepend-http/-/prepend-http-3.0.1.tgz",
      "integrity": "sha512-BLxfZh+m6UiAiCPZFJ4+vYoL7NrRs5XgCTRrjseATAggXhdZKKxn+JUNmuVYWY23bDHgaEHodxw8mnmtVEDtHw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/pretty-format": {
      "version": "29.7.0",
      "resolved": "https://registry.npmjs.org/pretty-format/-/pretty-format-29.7.0.tgz",
      "integrity": "sha512-Pdlw/oPxN+aXdmM9R00JVC9WVFoCLTKJvDVLgmJ+qAffBMxsV85l/Lu7sNx4zSzPyoL2euImuEwHhOXdEgNFZQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jest/schemas": "^29.6.3",
        "ansi-styles": "^5.0.0",
        "react-is": "^18.0.0"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || >=18.0.0"
      }
    },
    "node_modules/pretty-format/node_modules/ansi-styles": {
      "version": "5.2.0",
      "resolved": "https://registry.npmjs.org/ansi-styles/-/ansi-styles-5.2.0.tgz",
      "integrity": "sha512-Cxwpt2SfTzTtXcfOlzGEee8O+c+MmUgGrNiBcXnuWxuFJHe6a5Hz7qwhwe5OgaSYI0IJvkLqWX1ASG+cJOkEiA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/chalk/ansi-styles?sponsor=1"
      }
    },
    "node_modules/prompts": {
      "version": "2.4.2",
      "resolved": "https://registry.npmjs.org/prompts/-/prompts-2.4.2.tgz",
      "integrity": "sha512-NxNv/kLguCA7p3jE8oL2aEBsrJWgAakBpgmgK6lpPWV+WuOmY6r2/zbAVnP+T8bQlA0nzHXSJSJW0Hq7ylaD2Q==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "kleur": "^3.0.3",
        "sisteransi": "^1.0.5"
      },
      "engines": {
        "node": ">= 6"
      }
    },
    "node_modules/pump": {
      "version": "3.0.4",
      "resolved": "https://registry.npmjs.org/pump/-/pump-3.0.4.tgz",
      "integrity": "sha512-VS7sjc6KR7e1ukRFhQSY5LM2uBWAUPiOPa/A3mkKmiMwSmRFUITt0xuj+/lesgnCv+dPIEYlkzrcyXgquIHMcA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "end-of-stream": "^1.1.0",
        "once": "^1.3.1"
      }
    },
    "node_modules/pure-rand": {
      "version": "6.1.0",
      "resolved": "https://registry.npmjs.org/pure-rand/-/pure-rand-6.1.0.tgz",
      "integrity": "sha512-bVWawvoZoBYpp6yIoQtQXHZjmz35RSVHnUOTefl8Vcjr8snTPY1wnpSPMWekcFwbxI6gtmT7rSYPFvz71ldiOA==",
      "dev": true,
      "funding": [
        {
          "type": "individual",
          "url": "https://github.com/sponsors/dubzzz"
        },
        {
          "type": "opencollective",
          "url": "https://opencollective.com/fast-check"
        }
      ],
      "license": "MIT"
    },
    "node_modules/qs": {
      "version": "6.15.0",
      "resolved": "https://registry.npmjs.org/qs/-/qs-6.15.0.tgz",
      "integrity": "sha512-mAZTtNCeetKMH+pSjrb76NAM8V9a05I9aBZOHztWy/UqcJdQYNsf59vrRKWnojAT9Y+GbIvoTBC++CPHqpDBhQ==",
      "dev": true,
      "license": "BSD-3-Clause",
      "dependencies": {
        "side-channel": "^1.1.0"
      },
      "engines": {
        "node": ">=0.6"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/querystringify": {
      "version": "2.2.0",
      "resolved": "https://registry.npmjs.org/querystringify/-/querystringify-2.2.0.tgz",
      "integrity": "sha512-FIqgj2EUvTa7R50u0rGsyTftzjYmv/a3hO345bZNrqabNqjtgiDMgmo4mkUjd+nzU5oF3dClKqFIPUKybUyqoQ==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/quick-lru": {
      "version": "5.1.1",
      "resolved": "https://registry.npmjs.org/quick-lru/-/quick-lru-5.1.1.tgz",
      "integrity": "sha512-WuyALRjWPDGtt/wzJiadO5AXY+8hZ80hVpe6MyivgraREW751X3SbhRvG3eLKOYN+8VEvqLcf3wdnt44Z4S4SA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/react-is": {
      "version": "18.3.1",
      "resolved": "https://registry.npmjs.org/react-is/-/react-is-18.3.1.tgz",
      "integrity": "sha512-/LLMVyas0ljjAtoYiPqYiL8VWXzUUdThrmU5+n20DZv+a+ClRoevUzw5JxU+Ieh5/c87ytoTBV9G1FiKfNJdmg==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/read-pkg": {
      "version": "6.0.0",
      "resolved": "https://registry.npmjs.org/read-pkg/-/read-pkg-6.0.0.tgz",
      "integrity": "sha512-X1Fu3dPuk/8ZLsMhEj5f4wFAF0DWoK7qhGJvgaijocXxBmSToKfbFtqbxMO7bVjNA1dmE5huAzjXj/ey86iw9Q==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/normalize-package-data": "^2.4.0",
        "normalize-package-data": "^3.0.2",
        "parse-json": "^5.2.0",
        "type-fest": "^1.0.1"
      },
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/read-pkg-up": {
      "version": "8.0.0",
      "resolved": "https://registry.npmjs.org/read-pkg-up/-/read-pkg-up-8.0.0.tgz",
      "integrity": "sha512-snVCqPczksT0HS2EC+SxUndvSzn6LRCwpfSvLrIfR5BKDQQZMaI6jPRC9dYvYFDRAuFEAnkwww8kBBNE/3VvzQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "find-up": "^5.0.0",
        "read-pkg": "^6.0.0",
        "type-fest": "^1.0.1"
      },
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/read-pkg-up/node_modules/find-up": {
      "version": "5.0.0",
      "resolved": "https://registry.npmjs.org/find-up/-/find-up-5.0.0.tgz",
      "integrity": "sha512-78/PXT1wlLLDgTzDs7sjq9hzz0vXD+zn+7wypEe4fXQxCmdmqfGsEPQxmiCSQI3ajFV91bVSsvNtrJRiW6nGng==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "locate-path": "^6.0.0",
        "path-exists": "^4.0.0"
      },
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/read-pkg-up/node_modules/locate-path": {
      "version": "6.0.0",
      "resolved": "https://registry.npmjs.org/locate-path/-/locate-path-6.0.0.tgz",
      "integrity": "sha512-iPZK6eYjbxRu3uB4/WZ3EsEIMJFMqAoopl3R+zuq0UjcAm/MO6KCweDgPfP3elTztoKP3KtnVHxTn2NHBSDVUw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "p-locate": "^5.0.0"
      },
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/read-pkg-up/node_modules/p-locate": {
      "version": "5.0.0",
      "resolved": "https://registry.npmjs.org/p-locate/-/p-locate-5.0.0.tgz",
      "integrity": "sha512-LaNjtRWUBY++zB5nE/NwcaoMylSPk+S+ZHNB1TzdbMJMny6dynpAGt7X/tl/QYq3TIeE6nxHppbo2LGymrG5Pw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "p-limit": "^3.0.2"
      },
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/read-pkg-up/node_modules/path-exists": {
      "version": "4.0.0",
      "resolved": "https://registry.npmjs.org/path-exists/-/path-exists-4.0.0.tgz",
      "integrity": "sha512-ak9Qy5Q7jYb2Wwcey5Fpvg2KoAc/ZIhLSLOSBmRmygPsGwkVVt0fZa0qrtMz+m6tJTAHfZQ8FnmB4MG4LWy7/w==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/read-pkg-up/node_modules/type-fest": {
      "version": "1.4.0",
      "resolved": "https://registry.npmjs.org/type-fest/-/type-fest-1.4.0.tgz",
      "integrity": "sha512-yGSza74xk0UG8k+pLh5oeoYirvIiWo5t0/o3zHHAO2tRDiZcxWP7fywNlXhqb6/r6sWvwi+RsyQMWhVLe4BVuA==",
      "dev": true,
      "license": "(MIT OR CC0-1.0)",
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/read-pkg/node_modules/type-fest": {
      "version": "1.4.0",
      "resolved": "https://registry.npmjs.org/type-fest/-/type-fest-1.4.0.tgz",
      "integrity": "sha512-yGSza74xk0UG8k+pLh5oeoYirvIiWo5t0/o3zHHAO2tRDiZcxWP7fywNlXhqb6/r6sWvwi+RsyQMWhVLe4BVuA==",
      "dev": true,
      "license": "(MIT OR CC0-1.0)",
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/readable-stream": {
      "version": "3.6.2",
      "resolved": "https://registry.npmjs.org/readable-stream/-/readable-stream-3.6.2.tgz",
      "integrity": "sha512-9u/sniCrY3D5WdsERHzHE4G2YCXqoG5FTHUiCC4SIbr6XcLZBY05ya9EKjYek9O5xOAwjGq+1JdGBAS7Q9ScoA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "inherits": "^2.0.3",
        "string_decoder": "^1.1.1",
        "util-deprecate": "^1.0.1"
      },
      "engines": {
        "node": ">= 6"
      }
    },
    "node_modules/readdirp": {
      "version": "3.6.0",
      "resolved": "https://registry.npmjs.org/readdirp/-/readdirp-3.6.0.tgz",
      "integrity": "sha512-hOS089on8RduqdbhvQ5Z37A0ESjsqz6qnRcffsMU3495FuTdqSm+7bhJ29JvIOsBDEEnan5DPu9t3To9VRlMzA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "picomatch": "^2.2.1"
      },
      "engines": {
        "node": ">=8.10.0"
      }
    },
    "node_modules/recursive-readdir": {
      "version": "2.2.3",
      "resolved": "https://registry.npmjs.org/recursive-readdir/-/recursive-readdir-2.2.3.tgz",
      "integrity": "sha512-8HrF5ZsXk5FAH9dgsx3BlUer73nIhuj+9OrQwEbLTPOBzGkL1lsFCR01am+v+0m2Cmbs1nP12hLDl5FA7EszKA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "minimatch": "^3.0.5"
      },
      "engines": {
        "node": ">=6.0.0"
      }
    },
    "node_modules/replace-buffer": {
      "version": "1.2.1",
      "resolved": "https://registry.npmjs.org/replace-buffer/-/replace-buffer-1.2.1.tgz",
      "integrity": "sha512-ly3OKwKu+3T55DjP5PjIMzxgz9lFx6dQnBmAIxryZyRKl8f22juy12ShOyuq8WrQE5UlFOseZgQZDua0iF9DHw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=4"
      }
    },
    "node_modules/require-directory": {
      "version": "2.1.1",
      "resolved": "https://registry.npmjs.org/require-directory/-/require-directory-2.1.1.tgz",
      "integrity": "sha512-fGxEI7+wsG9xrvdjsrlmL22OMTTiHRwAMroiEeMgq8gzoLC/PQr7RsRDSTLUg/bZAZtF+TVIkHc6/4RIKrui+Q==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/requires-port": {
      "version": "1.0.0",
      "resolved": "https://registry.npmjs.org/requires-port/-/requires-port-1.0.0.tgz",
      "integrity": "sha512-KigOCHcocU3XODJxsu8i/j8T9tzT4adHiecwORRQ0ZZFcp7ahwXuRU1m+yuO90C5ZUyGeGfocHDI14M3L3yDAQ==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/resolve": {
      "version": "1.22.11",
      "resolved": "https://registry.npmjs.org/resolve/-/resolve-1.22.11.tgz",
      "integrity": "sha512-RfqAvLnMl313r7c9oclB1HhUEAezcpLjz95wFH4LVuhk9JF/r22qmVP9AMmOU4vMX7Q8pN8jwNg/CSpdFnMjTQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "is-core-module": "^2.16.1",
        "path-parse": "^1.0.7",
        "supports-preserve-symlinks-flag": "^1.0.0"
      },
      "bin": {
        "resolve": "bin/resolve"
      },
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/resolve-alpn": {
      "version": "1.2.1",
      "resolved": "https://registry.npmjs.org/resolve-alpn/-/resolve-alpn-1.2.1.tgz",
      "integrity": "sha512-0a1F4l73/ZFZOakJnQ3FvkJ2+gSTQWz/r2KE5OdDY0TxPm5h4GkqkWWfM47T7HsbnOtcJVEF4epCVy6u7Q3K+g==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/resolve-cwd": {
      "version": "3.0.0",
      "resolved": "https://registry.npmjs.org/resolve-cwd/-/resolve-cwd-3.0.0.tgz",
      "integrity": "sha512-OrZaX2Mb+rJCpH/6CpSqt9xFVpN++x01XnN2ie9g6P5/3xelLAkXWVADpdz1IHD/KFfEXyE6V0U01OQ3UO2rEg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "resolve-from": "^5.0.0"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/resolve-from": {
      "version": "5.0.0",
      "resolved": "https://registry.npmjs.org/resolve-from/-/resolve-from-5.0.0.tgz",
      "integrity": "sha512-qYg9KP24dD5qka9J47d0aVky0N+b4fTU89LN9iDnjB5waksiC49rvMB0PrUJQGoTmH50XPiqOvAjDfaijGxYZw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/resolve.exports": {
      "version": "2.0.3",
      "resolved": "https://registry.npmjs.org/resolve.exports/-/resolve.exports-2.0.3.tgz",
      "integrity": "sha512-OcXjMsGdhL4XnbShKpAcSqPMzQoYkYyhbEaeSko47MjRP9NfEQMhZkXL1DoFlt9LWQn4YttrdnV6X2OiyzBi+A==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/responselike": {
      "version": "2.0.1",
      "resolved": "https://registry.npmjs.org/responselike/-/responselike-2.0.1.tgz",
      "integrity": "sha512-4gl03wn3hj1HP3yzgdI7d3lCkF95F21Pz4BPGvKHinyQzALR5CapwC8yIi0Rh58DEMQ/SguC03wFj2k0M/mHhw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "lowercase-keys": "^2.0.0"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/restore-cursor": {
      "version": "3.1.0",
      "resolved": "https://registry.npmjs.org/restore-cursor/-/restore-cursor-3.1.0.tgz",
      "integrity": "sha512-l+sSefzHpj5qimhFSE5a8nufZYAM3sBSVMAPtYkmC+4EH2anSGaEMXSD0izRQbu9nfyQ9y5JrVmp7E8oZrUjvA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "onetime": "^5.1.0",
        "signal-exit": "^3.0.2"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/router-ips": {
      "version": "1.0.0",
      "resolved": "https://registry.npmjs.org/router-ips/-/router-ips-1.0.0.tgz",
      "integrity": "sha512-yBo6F52Un/WYioXbedBGvrKIiofbwt+4cUhdqDb9fNMJBI4D4jOy7jlxxaRVEvICPKU7xMmJDtDFR6YswX/sFQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=4"
      }
    },
    "node_modules/run-async": {
      "version": "2.4.1",
      "resolved": "https://registry.npmjs.org/run-async/-/run-async-2.4.1.tgz",
      "integrity": "sha512-tvVnVv01b8c1RrA6Ep7JkStj85Guv/YrMcwqYQnwjsAS2cTmmPGBBjAjpCW7RrSodNSoE2/qg9O4bceNvUuDgQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=0.12.0"
      }
    },
    "node_modules/rxjs": {
      "version": "7.8.2",
      "resolved": "https://registry.npmjs.org/rxjs/-/rxjs-7.8.2.tgz",
      "integrity": "sha512-dhKf903U/PQZY6boNNtAGdWbG85WAbjT/1xYoZIC7FAY0yWapOBQVsVrDl58W86//e1VpMNBtRV4MaXfdMySFA==",
      "dev": true,
      "license": "Apache-2.0",
      "dependencies": {
        "tslib": "^2.1.0"
      }
    },
    "node_modules/safe-buffer": {
      "version": "5.2.1",
      "resolved": "https://registry.npmjs.org/safe-buffer/-/safe-buffer-5.2.1.tgz",
      "integrity": "sha512-rp3So07KcdmmKbGvgaNxQSJr7bGVSVk5S9Eq1F+ppbRo70+YeaDxkw5Dd8NPN+GD6bjnYm2VuPuCXmpuYvmCXQ==",
      "dev": true,
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/feross"
        },
        {
          "type": "patreon",
          "url": "https://www.patreon.com/feross"
        },
        {
          "type": "consulting",
          "url": "https://feross.org/support"
        }
      ],
      "license": "MIT"
    },
    "node_modules/safer-buffer": {
      "version": "2.1.2",
      "resolved": "https://registry.npmjs.org/safer-buffer/-/safer-buffer-2.1.2.tgz",
      "integrity": "sha512-YZo3K82SD7Riyi0E1EQPojLz7kpepnSQI9IyPbHHg1XXXevb5dJI7tpyN2ADxGcQbHG7vcyRHk0cbwqcQriUtg==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/semver": {
      "version": "6.3.1",
      "resolved": "https://registry.npmjs.org/semver/-/semver-6.3.1.tgz",
      "integrity": "sha512-BR7VvDCVHO+q2xBEWskxS6DJE1qRnb7DxzUrogb71CWoSficBxYsiAGd+Kl0mmq/MprG9yArRkyrQxTO6XjMzA==",
      "dev": true,
      "license": "ISC",
      "bin": {
        "semver": "bin/semver.js"
      }
    },
    "node_modules/server-destroy": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/server-destroy/-/server-destroy-1.0.1.tgz",
      "integrity": "sha512-rb+9B5YBIEzYcD6x2VKidaa+cqYBJQKnU4oe4E3ANwRRN56yk/ua1YCJT1n21NTS8w6CcOclAKNP3PhdCXKYtQ==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/shebang-command": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/shebang-command/-/shebang-command-2.0.0.tgz",
      "integrity": "sha512-kHxr2zZpYtdmrN1qDjrrX/Z1rR1kG8Dx+gkpK1G4eXmvXswmcE1hTWBWYUzlraYw1/yZp6YuDY77YtvbN0dmDA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "shebang-regex": "^3.0.0"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/shebang-regex": {
      "version": "3.0.0",
      "resolved": "https://registry.npmjs.org/shebang-regex/-/shebang-regex-3.0.0.tgz",
      "integrity": "sha512-7++dFhtcx3353uBaq8DDR4NuxBetBzC7ZQOhmTQInHEd6bSrXdiEyzCvG07Z44UYdLShWUyXt5M/yhz8ekcb1A==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/side-channel": {
      "version": "1.1.0",
      "resolved": "https://registry.npmjs.org/side-channel/-/side-channel-1.1.0.tgz",
      "integrity": "sha512-ZX99e6tRweoUXqR+VBrslhda51Nh5MTQwou5tnUDgbtyM0dBgmhEDtWGP/xbKn6hqfPRHujUNwz5fy/wbbhnpw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "es-errors": "^1.3.0",
        "object-inspect": "^1.13.3",
        "side-channel-list": "^1.0.0",
        "side-channel-map": "^1.0.1",
        "side-channel-weakmap": "^1.0.2"
      },
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/side-channel-list": {
      "version": "1.0.0",
      "resolved": "https://registry.npmjs.org/side-channel-list/-/side-channel-list-1.0.0.tgz",
      "integrity": "sha512-FCLHtRD/gnpCiCHEiJLOwdmFP+wzCmDEkc9y7NsYxeF4u7Btsn1ZuwgwJGxImImHicJArLP4R0yX4c2KCrMrTA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "es-errors": "^1.3.0",
        "object-inspect": "^1.13.3"
      },
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/side-channel-map": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/side-channel-map/-/side-channel-map-1.0.1.tgz",
      "integrity": "sha512-VCjCNfgMsby3tTdo02nbjtM/ewra6jPHmpThenkTYh8pG9ucZ/1P8So4u4FGBek/BjpOVsDCMoLA/iuBKIFXRA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "call-bound": "^1.0.2",
        "es-errors": "^1.3.0",
        "get-intrinsic": "^1.2.5",
        "object-inspect": "^1.13.3"
      },
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/side-channel-weakmap": {
      "version": "1.0.2",
      "resolved": "https://registry.npmjs.org/side-channel-weakmap/-/side-channel-weakmap-1.0.2.tgz",
      "integrity": "sha512-WPS/HvHQTYnHisLo9McqBHOJk2FkHO/tlpvldyrnem4aeQp4hai3gythswg6p01oSoTl58rcpiFAjF2br2Ak2A==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "call-bound": "^1.0.2",
        "es-errors": "^1.3.0",
        "get-intrinsic": "^1.2.5",
        "object-inspect": "^1.13.3",
        "side-channel-map": "^1.0.1"
      },
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/signal-exit": {
      "version": "3.0.7",
      "resolved": "https://registry.npmjs.org/signal-exit/-/signal-exit-3.0.7.tgz",
      "integrity": "sha512-wnD2ZE+l+SPC/uoS0vXeE9L1+0wuaMqKlfz9AMUo38JsyLSBWSFcHR1Rri62LZc12vLr1gb3jl7iwQhgwpAbGQ==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/sisteransi": {
      "version": "1.0.5",
      "resolved": "https://registry.npmjs.org/sisteransi/-/sisteransi-1.0.5.tgz",
      "integrity": "sha512-bLGGlR1QxBcynn2d5YmDX4MGjlZvy2MRBDRNHLJ8VI6l6+9FUiyTFNJ0IveOSP0bcXgVDPRcfGqA0pjaqUpfVg==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/slash": {
      "version": "3.0.0",
      "resolved": "https://registry.npmjs.org/slash/-/slash-3.0.0.tgz",
      "integrity": "sha512-g9Q1haeby36OSStwb4ntCGGGaKsaVSjQ68fBxoQcutl5fS1vuY18H3wSt3jFyFtrkx+Kz0V1G85A4MyAdDMi2Q==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/slice-ansi": {
      "version": "5.0.0",
      "resolved": "https://registry.npmjs.org/slice-ansi/-/slice-ansi-5.0.0.tgz",
      "integrity": "sha512-FC+lgizVPfie0kkhqUScwRu1O/lF6NOgJmlCgK+/LYxDCTk8sGelYaHDhFcDN+Sn3Cv+3VSa4Byeo+IMCzpMgQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "ansi-styles": "^6.0.0",
        "is-fullwidth-code-point": "^4.0.0"
      },
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/chalk/slice-ansi?sponsor=1"
      }
    },
    "node_modules/slice-ansi/node_modules/ansi-styles": {
      "version": "6.2.3",
      "resolved": "https://registry.npmjs.org/ansi-styles/-/ansi-styles-6.2.3.tgz",
      "integrity": "sha512-4Dj6M28JB+oAH8kFkTLUo+a2jwOFkuqb3yucU0CANcRRUbxS0cP0nZYCGjcc3BNXwRIsUVmDGgzawme7zvJHvg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/chalk/ansi-styles?sponsor=1"
      }
    },
    "node_modules/source-map": {
      "version": "0.6.1",
      "resolved": "https://registry.npmjs.org/source-map/-/source-map-0.6.1.tgz",
      "integrity": "sha512-UjgapumWlbMhkBgzT7Ykc5YXUT46F0iKu8SGXq0bcwP5dz/h0Plj6enJqjz1Zbq2l5WaqYnrVbwWOWMyF3F47g==",
      "dev": true,
      "license": "BSD-3-Clause",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/source-map-support": {
      "version": "0.5.13",
      "resolved": "https://registry.npmjs.org/source-map-support/-/source-map-support-0.5.13.tgz",
      "integrity": "sha512-SHSKFHadjVA5oR4PPqhtAVdcBWwRYVd6g6cAXnIbRiIwc2EhPrTuKUBdSLvlEKyIP3GCf89fltvcZiP9MMFA1w==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "buffer-from": "^1.0.0",
        "source-map": "^0.6.0"
      }
    },
    "node_modules/spdx-correct": {
      "version": "3.2.0",
      "resolved": "https://registry.npmjs.org/spdx-correct/-/spdx-correct-3.2.0.tgz",
      "integrity": "sha512-kN9dJbvnySHULIluDHy32WHRUu3Og7B9sbY7tsFLctQkIqnMh3hErYgdMjTYuqmcXX+lK5T1lnUt3G7zNswmZA==",
      "dev": true,
      "license": "Apache-2.0",
      "dependencies": {
        "spdx-expression-parse": "^3.0.0",
        "spdx-license-ids": "^3.0.0"
      }
    },
    "node_modules/spdx-exceptions": {
      "version": "2.5.0",
      "resolved": "https://registry.npmjs.org/spdx-exceptions/-/spdx-exceptions-2.5.0.tgz",
      "integrity": "sha512-PiU42r+xO4UbUS1buo3LPJkjlO7430Xn5SVAhdpzzsPHsjbYVflnnFdATgabnLude+Cqu25p6N+g2lw/PFsa4w==",
      "dev": true,
      "license": "CC-BY-3.0"
    },
    "node_modules/spdx-expression-parse": {
      "version": "3.0.1",
      "resolved": "https://registry.npmjs.org/spdx-expression-parse/-/spdx-expression-parse-3.0.1.tgz",
      "integrity": "sha512-cbqHunsQWnJNE6KhVSMsMeH5H/L9EpymbzqTQ3uLwNCLZ1Q481oWaofqH7nO6V07xlXwY6PhQdQ2IedWx/ZK4Q==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "spdx-exceptions": "^2.1.0",
        "spdx-license-ids": "^3.0.0"
      }
    },
    "node_modules/spdx-license-ids": {
      "version": "3.0.23",
      "resolved": "https://registry.npmjs.org/spdx-license-ids/-/spdx-license-ids-3.0.23.tgz",
      "integrity": "sha512-CWLcCCH7VLu13TgOH+r8p1O/Znwhqv/dbb6lqWy67G+pT1kHmeD/+V36AVb/vq8QMIQwVShJ6Ssl5FPh0fuSdw==",
      "dev": true,
      "license": "CC0-1.0"
    },
    "node_modules/split-lines": {
      "version": "3.0.0",
      "resolved": "https://registry.npmjs.org/split-lines/-/split-lines-3.0.0.tgz",
      "integrity": "sha512-d0TpRBL/VfKDXsk8JxPF7zgF5pCUDdBMSlEL36xBgVeaX448t+yGXcJaikUyzkoKOJ0l6KpMfygzJU9naIuivw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/sprintf-js": {
      "version": "1.0.3",
      "resolved": "https://registry.npmjs.org/sprintf-js/-/sprintf-js-1.0.3.tgz",
      "integrity": "sha512-D9cPgkvLlV3t3IzL0D0YLvGA9Ahk4PcvVwUbN0dSGr1aP0Nrt4AEnTUbuGvquEC0mA64Gqt1fzirlRs5ibXx8g==",
      "dev": true,
      "license": "BSD-3-Clause"
    },
    "node_modules/stack-utils": {
      "version": "2.0.6",
      "resolved": "https://registry.npmjs.org/stack-utils/-/stack-utils-2.0.6.tgz",
      "integrity": "sha512-XlkWvfIm6RmsWtNJx+uqtKLS8eqFbxUg0ZzLXqY0caEy9l7hruX8IpiDnjsLavoBgqCCR71TqWO8MaXYheJ3RQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "escape-string-regexp": "^2.0.0"
      },
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/stack-utils/node_modules/escape-string-regexp": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/escape-string-regexp/-/escape-string-regexp-2.0.0.tgz",
      "integrity": "sha512-UpzcLCXolUWcNu5HtVMHYdXJjArjsF9C0aNnquZYY4uW/Vu0miy5YoWvbV345HauVvcAUnpRuhMMcqTcGOY2+w==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/stdin-discarder": {
      "version": "0.1.0",
      "resolved": "https://registry.npmjs.org/stdin-discarder/-/stdin-discarder-0.1.0.tgz",
      "integrity": "sha512-xhV7w8S+bUwlPTb4bAOUQhv8/cSS5offJuX8GQGq32ONF0ZtDWKfkdomM3HMRA+LhX6um/FZ0COqlwsjD53LeQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "bl": "^5.0.0"
      },
      "engines": {
        "node": "^12.20.0 || ^14.13.1 || >=16.0.0"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/string_decoder": {
      "version": "1.3.0",
      "resolved": "https://registry.npmjs.org/string_decoder/-/string_decoder-1.3.0.tgz",
      "integrity": "sha512-hkRX8U1WjJFd8LsDJ2yQ/wWWxaopEsABU1XfkM8A+j0+85JAGppt16cr1Whg6KIbb4okU6Mql6BOj+uup/wKeA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "safe-buffer": "~5.2.0"
      }
    },
    "node_modules/string-length": {
      "version": "4.0.2",
      "resolved": "https://registry.npmjs.org/string-length/-/string-length-4.0.2.tgz",
      "integrity": "sha512-+l6rNN5fYHNhZZy41RXsYptCjA2Igmq4EG7kZAYFQI1E1VTXarr6ZPXBg6eq7Y6eK4FEhY6AJlyuFIb/v/S0VQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "char-regex": "^1.0.2",
        "strip-ansi": "^6.0.0"
      },
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/string-width": {
      "version": "5.1.2",
      "resolved": "https://registry.npmjs.org/string-width/-/string-width-5.1.2.tgz",
      "integrity": "sha512-HnLOCR3vjcY8beoNLtcjZ5/nxn2afmME6lhrDrebokqMap+XbeW8n9TXpPDOqdGK5qcI3oT0GKTW6wC7EMiVqA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "eastasianwidth": "^0.2.0",
        "emoji-regex": "^9.2.2",
        "strip-ansi": "^7.0.1"
      },
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/string-width/node_modules/ansi-regex": {
      "version": "6.2.2",
      "resolved": "https://registry.npmjs.org/ansi-regex/-/ansi-regex-6.2.2.tgz",
      "integrity": "sha512-Bq3SmSpyFHaWjPk8If9yc6svM8c56dB5BAtW4Qbw5jHTwwXXcTLoRMkpDJp6VL0XzlWaCHTXrkFURMYmD0sLqg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/chalk/ansi-regex?sponsor=1"
      }
    },
    "node_modules/string-width/node_modules/strip-ansi": {
      "version": "7.2.0",
      "resolved": "https://registry.npmjs.org/strip-ansi/-/strip-ansi-7.2.0.tgz",
      "integrity": "sha512-yDPMNjp4WyfYBkHnjIRLfca1i6KMyGCtsVgoKe/z1+6vukgaENdgGBZt+ZmKPc4gavvEZ5OgHfHdrazhgNyG7w==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "ansi-regex": "^6.2.2"
      },
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/chalk/strip-ansi?sponsor=1"
      }
    },
    "node_modules/strip-ansi": {
      "version": "6.0.1",
      "resolved": "https://registry.npmjs.org/strip-ansi/-/strip-ansi-6.0.1.tgz",
      "integrity": "sha512-Y38VPSHcqkFrCpFnQ9vuSXmquuv5oXOKpGeT6aGrr3o3Gc9AlVa6JBfUSOCnbxGGZF+/0ooI7KrPuUSztUdU5A==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "ansi-regex": "^5.0.1"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/strip-bom": {
      "version": "5.0.0",
      "resolved": "https://registry.npmjs.org/strip-bom/-/strip-bom-5.0.0.tgz",
      "integrity": "sha512-p+byADHF7SzEcVnLvc/r3uognM1hUhObuHXxJcgLCfD194XAkaLbjq3Wzb0N5G2tgIjH0dgT708Z51QxMeu60A==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/strip-final-newline": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/strip-final-newline/-/strip-final-newline-2.0.0.tgz",
      "integrity": "sha512-BrpvfNAE3dcvq7ll3xVumzjKjZQ5tI1sEUIKr3Uoks0XUl45St3FlatVqef9prk4jRDzhW6WZg+3bk93y6pLjA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/strip-json-comments": {
      "version": "3.1.1",
      "resolved": "https://registry.npmjs.org/strip-json-comments/-/strip-json-comments-3.1.1.tgz",
      "integrity": "sha512-6fPc+R4ihwqP6N/aIv2f1gMH8lOVtWQHoqC4yK6oSDVVocumAsfCqjkXnqiYMhmMwS/mEHLp7Vehlt3ql6lEig==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/supports-color": {
      "version": "7.2.0",
      "resolved": "https://registry.npmjs.org/supports-color/-/supports-color-7.2.0.tgz",
      "integrity": "sha512-qpCAvRl9stuOHveKsn7HncJRvv501qIacKzQlO/+Lwxc9+0q2wLyv4Dfvt80/DPn2pqOBsJdDiogXGR9+OvwRw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "has-flag": "^4.0.0"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/supports-preserve-symlinks-flag": {
      "version": "1.0.0",
      "resolved": "https://registry.npmjs.org/supports-preserve-symlinks-flag/-/supports-preserve-symlinks-flag-1.0.0.tgz",
      "integrity": "sha512-ot0WnXS9fgdkgIcePe6RHNk1WA8+muPa6cSjeR3V8K27q9BB1rTE3R1p7Hv0z1ZyAc8s6Vvv8DIyWf681MAt0w==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/test-exclude": {
      "version": "6.0.0",
      "resolved": "https://registry.npmjs.org/test-exclude/-/test-exclude-6.0.0.tgz",
      "integrity": "sha512-cAGWPIyOHU6zlmg88jwm7VRyXnMN7iV68OGAbYDk/Mh/xC/pzVPlQtY6ngoIH/5/tciuhGfvESU8GrHrcxD56w==",
      "dev": true,
      "license": "ISC",
      "dependencies": {
        "@istanbuljs/schema": "^0.1.2",
        "glob": "^7.1.4",
        "minimatch": "^3.0.4"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/through": {
      "version": "2.3.8",
      "resolved": "https://registry.npmjs.org/through/-/through-2.3.8.tgz",
      "integrity": "sha512-w89qg7PI8wAdvX60bMDP+bFoD5Dvhm9oLheFp5O4a2QF0cSBGsBX4qZmadPMvVqlLJBBci+WqGGOAPvcDeNSVg==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/tmpl": {
      "version": "1.0.5",
      "resolved": "https://registry.npmjs.org/tmpl/-/tmpl-1.0.5.tgz",
      "integrity": "sha512-3f0uOEAQwIqGuWW2MVzYg8fV/QNnc/IpuJNG837rLuczAaLVHslWHZQj4IGiEl5Hs3kkbhwL9Ab7Hrsmuj+Smw==",
      "dev": true,
      "license": "BSD-3-Clause"
    },
    "node_modules/to-regex-range": {
      "version": "5.0.1",
      "resolved": "https://registry.npmjs.org/to-regex-range/-/to-regex-range-5.0.1.tgz",
      "integrity": "sha512-65P7iz6X5yEr1cwcgvQxbbIw7Uk3gOy5dIdtZ4rDveLqhrdJP+Li/Hx6tyK0NEb+2GCyneCMJiGqrADCSNk8sQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "is-number": "^7.0.0"
      },
      "engines": {
        "node": ">=8.0"
      }
    },
    "node_modules/tr46": {
      "version": "0.0.3",
      "resolved": "https://registry.npmjs.org/tr46/-/tr46-0.0.3.tgz",
      "integrity": "sha512-N3WMsuqV66lT30CrXNbEjx4GEwlow3v6rr4mCcv6prnfwhS01rkgyFdjPNBYd9br7LpXV1+Emh01fHnq2Gdgrw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/ts-jest": {
      "version": "29.4.6",
      "resolved": "https://registry.npmjs.org/ts-jest/-/ts-jest-29.4.6.tgz",
      "integrity": "sha512-fSpWtOO/1AjSNQguk43hb/JCo16oJDnMJf3CdEGNkqsEX3t0KX96xvyX1D7PfLCpVoKu4MfVrqUkFyblYoY4lA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "bs-logger": "^0.2.6",
        "fast-json-stable-stringify": "^2.1.0",
        "handlebars": "^4.7.8",
        "json5": "^2.2.3",
        "lodash.memoize": "^4.1.2",
        "make-error": "^1.3.6",
        "semver": "^7.7.3",
        "type-fest": "^4.41.0",
        "yargs-parser": "^21.1.1"
      },
      "bin": {
        "ts-jest": "cli.js"
      },
      "engines": {
        "node": "^14.15.0 || ^16.10.0 || ^18.0.0 || >=20.0.0"
      },
      "peerDependencies": {
        "@babel/core": ">=7.0.0-beta.0 <8",
        "@jest/transform": "^29.0.0 || ^30.0.0",
        "@jest/types": "^29.0.0 || ^30.0.0",
        "babel-jest": "^29.0.0 || ^30.0.0",
        "jest": "^29.0.0 || ^30.0.0",
        "jest-util": "^29.0.0 || ^30.0.0",
        "typescript": ">=4.3 <6"
      },
      "peerDependenciesMeta": {
        "@babel/core": {
          "optional": true
        },
        "@jest/transform": {
          "optional": true
        },
        "@jest/types": {
          "optional": true
        },
        "babel-jest": {
          "optional": true
        },
        "esbuild": {
          "optional": true
        },
        "jest-util": {
          "optional": true
        }
      }
    },
    "node_modules/ts-jest/node_modules/semver": {
      "version": "7.7.4",
      "resolved": "https://registry.npmjs.org/semver/-/semver-7.7.4.tgz",
      "integrity": "sha512-vFKC2IEtQnVhpT78h1Yp8wzwrf8CM+MzKMHGJZfBtzhZNycRFnXsHk6E5TxIkkMsgNS7mdX3AGB7x2QM2di4lA==",
      "dev": true,
      "license": "ISC",
      "bin": {
        "semver": "bin/semver.js"
      },
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/ts-jest/node_modules/type-fest": {
      "version": "4.41.0",
      "resolved": "https://registry.npmjs.org/type-fest/-/type-fest-4.41.0.tgz",
      "integrity": "sha512-TeTSQ6H5YHvpqVwBRcnLDCBnDOHWYu7IvGbHT6N8AOymcr9PJGjc1GTtiWZTYg0NCgYwvnYWEkVChQAr9bjfwA==",
      "dev": true,
      "license": "(MIT OR CC0-1.0)",
      "engines": {
        "node": ">=16"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/ts2gas": {
      "version": "4.2.0",
      "resolved": "https://registry.npmjs.org/ts2gas/-/ts2gas-4.2.0.tgz",
      "integrity": "sha512-5xZugaeM3wKQPj/vrWnrtYjNh4xnIz6cGSW/smCe9OTmkh1+KvHpm7M7HLq/OnBaljf4+yKctC4AYimBi4T1/Q==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "type-fest": "^2.1.0",
        "typescript": "^4.4.2"
      },
      "engines": {
        "node": "^12.20.0 || ^14.13.1 || >=16.0.0"
      }
    },
    "node_modules/ts2gas/node_modules/type-fest": {
      "version": "2.19.0",
      "resolved": "https://registry.npmjs.org/type-fest/-/type-fest-2.19.0.tgz",
      "integrity": "sha512-RAH822pAdBgcNMAfWnCBU3CFZcfZ/i1eZjwFU/dsLKumyuuP3niueg2UAukXYF0E2AAoc82ZSSf9J0WQBinzHA==",
      "dev": true,
      "license": "(MIT OR CC0-1.0)",
      "engines": {
        "node": ">=12.20"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/ts2gas/node_modules/typescript": {
      "version": "4.9.5",
      "resolved": "https://registry.npmjs.org/typescript/-/typescript-4.9.5.tgz",
      "integrity": "sha512-1FXk9E2Hm+QzZQ7z+McJiHL4NW1F2EzMu9Nq9i3zAaGqibafqYwCVU6WyWAuyQRRzOlxou8xZSyXLEN8oKj24g==",
      "dev": true,
      "license": "Apache-2.0",
      "bin": {
        "tsc": "bin/tsc",
        "tsserver": "bin/tsserver"
      },
      "engines": {
        "node": ">=4.2.0"
      }
    },
    "node_modules/tslib": {
      "version": "2.8.1",
      "resolved": "https://registry.npmjs.org/tslib/-/tslib-2.8.1.tgz",
      "integrity": "sha512-oJFu94HQb+KVduSUQL7wnpmqnfmLsOA/nAh6b6EH0wCEoK0/mPeXU6c3wKDV83MkOuHPRHtSXKKU99IBazS/2w==",
      "dev": true,
      "license": "0BSD"
    },
    "node_modules/type-detect": {
      "version": "4.0.8",
      "resolved": "https://registry.npmjs.org/type-detect/-/type-detect-4.0.8.tgz",
      "integrity": "sha512-0fr/mIH1dlO+x7TlcMy+bIDqKPsw/70tVyeHW787goQjhmqaZe10uwLujubK9q9Lg6Fiho1KUKDYz0Z7k7g5/g==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=4"
      }
    },
    "node_modules/type-fest": {
      "version": "0.21.3",
      "resolved": "https://registry.npmjs.org/type-fest/-/type-fest-0.21.3.tgz",
      "integrity": "sha512-t0rzBq87m3fVcduHDUFhKmyyX+9eo6WQjZvf51Ea/M0Q7+T374Jp1aUiyUl0GKxp8M/OETVHSDvmkyPgvX+X2w==",
      "dev": true,
      "license": "(MIT OR CC0-1.0)",
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/typescript": {
      "version": "5.9.3",
      "resolved": "https://registry.npmjs.org/typescript/-/typescript-5.9.3.tgz",
      "integrity": "sha512-jl1vZzPDinLr9eUt3J/t7V6FgNEw9QjvBPdysz9KfQDD41fQrC2Y4vKQdiaUpFT4bXlb1RHhLpp8wtm6M5TgSw==",
      "dev": true,
      "license": "Apache-2.0",
      "bin": {
        "tsc": "bin/tsc",
        "tsserver": "bin/tsserver"
      },
      "engines": {
        "node": ">=14.17"
      }
    },
    "node_modules/uglify-js": {
      "version": "3.19.3",
      "resolved": "https://registry.npmjs.org/uglify-js/-/uglify-js-3.19.3.tgz",
      "integrity": "sha512-v3Xu+yuwBXisp6QYTcH4UbH+xYJXqnq2m/LtQVWKWzYc1iehYnLixoQDN9FH6/j9/oybfd6W9Ghwkl8+UMKTKQ==",
      "dev": true,
      "license": "BSD-2-Clause",
      "optional": true,
      "bin": {
        "uglifyjs": "bin/uglifyjs"
      },
      "engines": {
        "node": ">=0.8.0"
      }
    },
    "node_modules/undici-types": {
      "version": "7.18.2",
      "resolved": "https://registry.npmjs.org/undici-types/-/undici-types-7.18.2.tgz",
      "integrity": "sha512-AsuCzffGHJybSaRrmr5eHr81mwJU3kjw6M+uprWvCXiNeN9SOGwQ3Jn8jb8m3Z6izVgknn1R0FTCEAP2QrLY/w==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/universalify": {
      "version": "2.0.1",
      "resolved": "https://registry.npmjs.org/universalify/-/universalify-2.0.1.tgz",
      "integrity": "sha512-gptHNQghINnc/vTGIk0SOFGFNXw7JVrlRUtConJRlvaw6DuX0wO5Jeko9sWrMBhh+PsYAZ7oXAiOnf/UKogyiw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">= 10.0.0"
      }
    },
    "node_modules/update-browserslist-db": {
      "version": "1.2.3",
      "resolved": "https://registry.npmjs.org/update-browserslist-db/-/update-browserslist-db-1.2.3.tgz",
      "integrity": "sha512-Js0m9cx+qOgDxo0eMiFGEueWztz+d4+M3rGlmKPT+T4IS/jP4ylw3Nwpu6cpTTP8R1MAC1kF4VbdLt3ARf209w==",
      "dev": true,
      "funding": [
        {
          "type": "opencollective",
          "url": "https://opencollective.com/browserslist"
        },
        {
          "type": "tidelift",
          "url": "https://tidelift.com/funding/github/npm/browserslist"
        },
        {
          "type": "github",
          "url": "https://github.com/sponsors/ai"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "escalade": "^3.2.0",
        "picocolors": "^1.1.1"
      },
      "bin": {
        "update-browserslist-db": "cli.js"
      },
      "peerDependencies": {
        "browserslist": ">= 4.21.0"
      }
    },
    "node_modules/url-parse": {
      "version": "1.5.10",
      "resolved": "https://registry.npmjs.org/url-parse/-/url-parse-1.5.10.tgz",
      "integrity": "sha512-WypcfiRhfeUP9vvF0j6rw0J3hrWrw6iZv3+22h6iRMJ/8z1Tj6XfLP4DsUix5MhMPnXpiHDoKyoZ/bdCkwBCiQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "querystringify": "^2.1.1",
        "requires-port": "^1.0.0"
      }
    },
    "node_modules/url-template": {
      "version": "2.0.8",
      "resolved": "https://registry.npmjs.org/url-template/-/url-template-2.0.8.tgz",
      "integrity": "sha512-XdVKMF4SJ0nP/O7XIPB0JwAEuT9lDIYnNsK8yGVe43y0AWoKeJNdv3ZNWh7ksJ6KqQFjOO6ox/VEitLnaVNufw==",
      "dev": true,
      "license": "BSD"
    },
    "node_modules/util-deprecate": {
      "version": "1.0.2",
      "resolved": "https://registry.npmjs.org/util-deprecate/-/util-deprecate-1.0.2.tgz",
      "integrity": "sha512-EPD5q1uXyFxJpCrLnCc1nHnq3gOa6DZBocAIiI2TaSCA7VCJ1UJDMagCzIkXNsUYfD1daK//LTEQ8xiIbrHtcw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/uuid": {
      "version": "8.3.2",
      "resolved": "https://registry.npmjs.org/uuid/-/uuid-8.3.2.tgz",
      "integrity": "sha512-+NYs2QeMWy+GWFOEm9xnn6HCDp0l7QBD7ml8zLUmJ+93Q5NF0NocErnwkTkXVFNiX3/fpC6afS8Dhb/gz7R7eg==",
      "dev": true,
      "license": "MIT",
      "bin": {
        "uuid": "dist/bin/uuid"
      }
    },
    "node_modules/v8-to-istanbul": {
      "version": "9.3.0",
      "resolved": "https://registry.npmjs.org/v8-to-istanbul/-/v8-to-istanbul-9.3.0.tgz",
      "integrity": "sha512-kiGUalWN+rgBJ/1OHZsBtU4rXZOfj/7rKQxULKlIzwzQSvMJUUNgPwJEEh7gU6xEVxC0ahoOBvN2YI8GH6FNgA==",
      "dev": true,
      "license": "ISC",
      "dependencies": {
        "@jridgewell/trace-mapping": "^0.3.12",
        "@types/istanbul-lib-coverage": "^2.0.1",
        "convert-source-map": "^2.0.0"
      },
      "engines": {
        "node": ">=10.12.0"
      }
    },
    "node_modules/validate-npm-package-license": {
      "version": "3.0.4",
      "resolved": "https://registry.npmjs.org/validate-npm-package-license/-/validate-npm-package-license-3.0.4.tgz",
      "integrity": "sha512-DpKm2Ui/xN7/HQKCtpZxoRWBhZ9Z0kqtygG8XCgNQ8ZlDnxuQmWhj566j8fN4Cu3/JmbhsDo7fcAJq4s9h27Ew==",
      "dev": true,
      "license": "Apache-2.0",
      "dependencies": {
        "spdx-correct": "^3.0.0",
        "spdx-expression-parse": "^3.0.0"
      }
    },
    "node_modules/walker": {
      "version": "1.0.8",
      "resolved": "https://registry.npmjs.org/walker/-/walker-1.0.8.tgz",
      "integrity": "sha512-ts/8E8l5b7kY0vlWLewOkDXMmPdLcVV4GmOQLyxuSswIJsweeFZtAsMF7k1Nszz+TYBQrlYRmzOnr398y1JemQ==",
      "dev": true,
      "license": "Apache-2.0",
      "dependencies": {
        "makeerror": "1.0.12"
      }
    },
    "node_modules/wcwidth": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/wcwidth/-/wcwidth-1.0.1.tgz",
      "integrity": "sha512-XHPEwS0q6TaxcvG85+8EYkbiCux2XtWG2mkc47Ng2A77BQu9+DqIOJldST4HgPkuea7dvKSj5VgX3P1d4rW8Tg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "defaults": "^1.0.3"
      }
    },
    "node_modules/webidl-conversions": {
      "version": "3.0.1",
      "resolved": "https://registry.npmjs.org/webidl-conversions/-/webidl-conversions-3.0.1.tgz",
      "integrity": "sha512-2JAn3z8AR6rjK8Sm8orRC0h/bcl/DqL7tRPdGZ4I1CjdF+EaMLmYxBHyXuKL849eucPFhvBoxMsflfOb8kxaeQ==",
      "dev": true,
      "license": "BSD-2-Clause"
    },
    "node_modules/whatwg-url": {
      "version": "5.0.0",
      "resolved": "https://registry.npmjs.org/whatwg-url/-/whatwg-url-5.0.0.tgz",
      "integrity": "sha512-saE57nupxk6v3HY35+jzBwYa0rKSy0XR8JSxZPwgLr7ys0IBzhGviA1/TUGJLmSVqs8pb9AnvICXEuOHLprYTw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "tr46": "~0.0.3",
        "webidl-conversions": "^3.0.0"
      }
    },
    "node_modules/which": {
      "version": "2.0.2",
      "resolved": "https://registry.npmjs.org/which/-/which-2.0.2.tgz",
      "integrity": "sha512-BLI3Tl1TW3Pvl70l3yq3Y64i+awpwXqsGBYWkkqMtnbXgrMD+yj7rhW0kuEDxzJaYXGjEW5ogapKNMEKNMjibA==",
      "dev": true,
      "license": "ISC",
      "dependencies": {
        "isexe": "^2.0.0"
      },
      "bin": {
        "node-which": "bin/node-which"
      },
      "engines": {
        "node": ">= 8"
      }
    },
    "node_modules/wordwrap": {
      "version": "1.0.0",
      "resolved": "https://registry.npmjs.org/wordwrap/-/wordwrap-1.0.0.tgz",
      "integrity": "sha512-gvVzJFlPycKc5dZN4yPkP8w7Dc37BtP1yczEneOb4uq34pXZcvrtRTmWV8W+Ume+XCxKgbjM+nevkyFPMybd4Q==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/wrap-ansi": {
      "version": "6.2.0",
      "resolved": "https://registry.npmjs.org/wrap-ansi/-/wrap-ansi-6.2.0.tgz",
      "integrity": "sha512-r6lPcBGxZXlIcymEu7InxDMhdW0KDxpLgoFLcguasxCaJ/SOIZwINatK9KY/tf+ZrlywOKU0UDj3ATXUBfxJXA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "ansi-styles": "^4.0.0",
        "string-width": "^4.1.0",
        "strip-ansi": "^6.0.0"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/wrap-ansi/node_modules/emoji-regex": {
      "version": "8.0.0",
      "resolved": "https://registry.npmjs.org/emoji-regex/-/emoji-regex-8.0.0.tgz",
      "integrity": "sha512-MSjYzcWNOA0ewAHpz0MxpYFvwg6yjy1NG3xteoqz644VCo/RPgnr1/GGt+ic3iJTzQ8Eu3TdM14SawnVUmGE6A==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/wrap-ansi/node_modules/is-fullwidth-code-point": {
      "version": "3.0.0",
      "resolved": "https://registry.npmjs.org/is-fullwidth-code-point/-/is-fullwidth-code-point-3.0.0.tgz",
      "integrity": "sha512-zymm5+u+sCsSWyD9qNaejV3DFvhCKclKdizYaJUuHA83RLjb7nSuGnddCHGv0hk+KY7BMAlsWeK4Ueg6EV6XQg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/wrap-ansi/node_modules/string-width": {
      "version": "4.2.3",
      "resolved": "https://registry.npmjs.org/string-width/-/string-width-4.2.3.tgz",
      "integrity": "sha512-wKyQRQpjJ0sIp62ErSZdGsjMJWsap5oRNihHhu6G7JVO/9jIB6UyevL+tXuOqrng8j/cxKTWyWUwvSTriiZz/g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "emoji-regex": "^8.0.0",
        "is-fullwidth-code-point": "^3.0.0",
        "strip-ansi": "^6.0.1"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/wrappy": {
      "version": "1.0.2",
      "resolved": "https://registry.npmjs.org/wrappy/-/wrappy-1.0.2.tgz",
      "integrity": "sha512-l4Sp/DRseor9wL6EvV2+TuQn63dMkPjZ/sp9XkghTEbV9KlPS1xUsZ3u7/IQO4wxtcFB4bgpQPRcR3QCvezPcQ==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/write-file-atomic": {
      "version": "4.0.2",
      "resolved": "https://registry.npmjs.org/write-file-atomic/-/write-file-atomic-4.0.2.tgz",
      "integrity": "sha512-7KxauUdBmSdWnmpaGFg+ppNjKF8uNLry8LyzjauQDOVONfFLNKrKvQOxZ/VuTIcS/gge/YNahf5RIIQWTSarlg==",
      "dev": true,
      "license": "ISC",
      "dependencies": {
        "imurmurhash": "^0.1.4",
        "signal-exit": "^3.0.7"
      },
      "engines": {
        "node": "^12.13.0 || ^14.15.0 || >=16.0.0"
      }
    },
    "node_modules/y18n": {
      "version": "5.0.8",
      "resolved": "https://registry.npmjs.org/y18n/-/y18n-5.0.8.tgz",
      "integrity": "sha512-0pfFzegeDWJHJIAmTLRP2DwHjdF5s7jo9tuztdQxAhINCdvS+3nGINqPd00AphqJR/0LhANUS6/+7SCb98YOfA==",
      "dev": true,
      "license": "ISC",
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/yallist": {
      "version": "4.0.0",
      "resolved": "https://registry.npmjs.org/yallist/-/yallist-4.0.0.tgz",
      "integrity": "sha512-3wdGidZyq5PB084XLES5TpOSRA3wjXAlIWMhum2kRcv/41Sn2emQ0dycQW4uZXLejwKvg6EsvbdlVL+FYEct7A==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/yargs": {
      "version": "17.7.2",
      "resolved": "https://registry.npmjs.org/yargs/-/yargs-17.7.2.tgz",
      "integrity": "sha512-7dSzzRQ++CKnNI/krKnYRV7JKKPUXMEh61soaHKg9mrWEhzFWhFnxPxGl+69cD1Ou63C13NUPCnmIcrvqCuM6w==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "cliui": "^8.0.1",
        "escalade": "^3.1.1",
        "get-caller-file": "^2.0.5",
        "require-directory": "^2.1.1",
        "string-width": "^4.2.3",
        "y18n": "^5.0.5",
        "yargs-parser": "^21.1.1"
      },
      "engines": {
        "node": ">=12"
      }
    },
    "node_modules/yargs-parser": {
      "version": "21.1.1",
      "resolved": "https://registry.npmjs.org/yargs-parser/-/yargs-parser-21.1.1.tgz",
      "integrity": "sha512-tVpsJW7DdjecAiFpbIB1e3qxIQsE6NoPc5/eTdrbbIC4h0LVsWhnoa3g+m2HclBIujHzsxZ4VJVA+GUuc2/LBw==",
      "dev": true,
      "license": "ISC",
      "engines": {
        "node": ">=12"
      }
    },
    "node_modules/yargs/node_modules/emoji-regex": {
      "version": "8.0.0",
      "resolved": "https://registry.npmjs.org/emoji-regex/-/emoji-regex-8.0.0.tgz",
      "integrity": "sha512-MSjYzcWNOA0ewAHpz0MxpYFvwg6yjy1NG3xteoqz644VCo/RPgnr1/GGt+ic3iJTzQ8Eu3TdM14SawnVUmGE6A==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/yargs/node_modules/is-fullwidth-code-point": {
      "version": "3.0.0",
      "resolved": "https://registry.npmjs.org/is-fullwidth-code-point/-/is-fullwidth-code-point-3.0.0.tgz",
      "integrity": "sha512-zymm5+u+sCsSWyD9qNaejV3DFvhCKclKdizYaJUuHA83RLjb7nSuGnddCHGv0hk+KY7BMAlsWeK4Ueg6EV6XQg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/yargs/node_modules/string-width": {
      "version": "4.2.3",
      "resolved": "https://registry.npmjs.org/string-width/-/string-width-4.2.3.tgz",
      "integrity": "sha512-wKyQRQpjJ0sIp62ErSZdGsjMJWsap5oRNihHhu6G7JVO/9jIB6UyevL+tXuOqrng8j/cxKTWyWUwvSTriiZz/g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "emoji-regex": "^8.0.0",
        "is-fullwidth-code-point": "^3.0.0",
        "strip-ansi": "^6.0.1"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/yocto-queue": {
      "version": "0.1.0",
      "resolved": "https://registry.npmjs.org/yocto-queue/-/yocto-queue-0.1.0.tgz",
      "integrity": "sha512-rVksvsnNCdJ/ohGc6xgPwyN8eheCxsiLM8mxuE/t/mOVqJewPuO1miLpTHQiRgTKCLexL4MeAFVagts7HmNZ2Q==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    }
  }
}

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
    "@types/google-apps-script": "^1.0.83",
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
    const sheet = getSheet(SHEET_NAMES.PAYMENT_PROOFS);
    const data = sheet.getDataRange().getValues().slice(1); // skip header
    const proofs = data.map(row => ({
      eventId: row[PP_COL.EVENT_ID],
      timestamp: row[PP_COL.TIMESTAMP],
      memberId: row[PP_COL.MEMBER_ID],
      email: row[PP_COL.EMAIL],
      eventName: row[PP_COL.EVENT_NAME],
      amount: row[PP_COL.AMOUNT],
      paymentDate: row[PP_COL.PAYMENT_DATE],
      payerName: row[PP_COL.PAYER_NAME],
      last4Digits: row[PP_COL.LAST_4_DIGITS],
      notes: row[PP_COL.NOTES],
      screenshotFileId: row[PP_COL.SCREENSHOT_FILE_ID],
      status: row[PP_COL.STATUS],
      gdriveFilePath: row[PP_COL.GDRIVE_FILE_PATH],
      ocrText: row[PP_COL.OCR_TEXT],
      ocrTimestamp: row[PP_COL.OCR_TIMESTAMP],
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
                        'IndividualPrice','FamilyPrice'];
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
  const adminEmails = getConfigValue('Admin_Emails')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  return adminEmails.includes(email.trim().toLowerCase());
}

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
    const otpCode = generateOtpCode();
    const otpValidHours = parseInt(getConfigValue('OTP_Valid_Hours'), 10) || 24;
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

    MailApp.sendEmail({
      to: email,
      subject: 'Your Misty Mountain Runners Login Code',
      body: `Your login code is: ${otpCode}\n\nThis code expires in ${otpValidHours} hours.\n\nIf you did not request this code, please ignore this email.`,
    });

    console.log('[mmr][requestEmailOtp] OTP sent to:', email);
    auditLog('OTP_REQUESTED', { sessionID: payload.sessionID, email });
    return jsonOk(req.requestId, { message: 'Code sent. Please check your email.' });
  } catch (e: any) {
    console.error('[mmr][requestEmailOtp] error:', String(e));
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
      return jsonError(req.requestId, 'INVALID_OTP', 'Invalid or expired code. Please try again.');
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

```


---
## File: `src/config.ts`
---

```typescript
// ============================================================
// Spreadsheet configuration
// MEMBERSHIP_SPREADSHEET_ID: the workbook containing Membership-Master-Main-3
//   and all new sheets (WebApp-Events, Payment-History, Auth-OTP, Config, WebApp-ActivityLog).
// GMAIL_SPREADSHEET_ID: the separate workbook containing the Fetch-Gmail sheet.
// Update both IDs before deploying.
// ============================================================

const MEMBERSHIP_SPREADSHEET_ID = '11SFvgApmDtEv4jz5bTYI9_zEhCFMQAXC4b2z_4s3ljk';
const GMAIL_SPREADSHEET_ID = '1rVOvhXzSxCRpWdAw3jYq5tWrYdCYtXmfqblTHP_wPqA';

// Sheet names
const SHEET_NAMES = {
  MEMBERSHIP_MASTER: 'Main',
  WEBAPP_EVENTS: 'WebApp-Events',
  PAYMENT_HISTORY: 'Payment-History',
  AUTH_OTP: 'Auth-OTP',
  CONFIG: 'Config',
  ACTIVITY_LOG: 'WebApp-ActivityLog',
  FETCH_GMAIL: 'Active',
  PAYMENT_EVENTS: 'Payment Confirmation Events',
  PAYMENT_PROOFS: 'Payment-Proofs',
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
  PAYMENT_CHECK_INFO: 13,
  LAST_UPDATED: 14,
  MEMBERSHIP_FEE_PAID: 15,
  PAYMENT_DATE: 16,
  PAYMENT_TRANSACTION: 17,
  // New columns appended after existing ones
  JOIN_YEAR: 18,
  PHONE_NUMBER: 19,
  LAST_LOGIN_DATE: 20,
  PROFILE_LAST_UPDATED: 21,
  NOTES: 22,
};

// WebApp-Events column indices (0-based)
const WE_COL = {
  EVENT_ID: 0,
  EVENT_TYPE: 1,
  TIMESTAMP: 2,
  MEMBER_ID: 3,
  EMAIL: 4,
  PAYMENT_INTENT: 5,
  AMOUNT: 6,
  PAYMENT_METHOD: 7,
  PAYER_NAME: 8,
  MEMO_FIELD: 9,
  LAST_4_DIGITS: 10,
  FAMILY_MEMBER_EMAILS: 11,
  STATUS: 12,
  MATCHED_MESSAGE_ID: 13,
  MATCHED_TRANSACTION_NUMBER: 14,
  ADMIN_APPROVER: 15,
  APPROVAL_DATE: 16,
  NOTES: 17,
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

// Payment-Proofs column indices (0-based)
const PP_COL = {
  EVENT_ID: 0,
  TIMESTAMP: 1,
  MEMBER_ID: 2,
  EMAIL: 3,
  EVENT_NAME: 4,
  AMOUNT: 5,
  PAYMENT_DATE: 6,
  PAYER_NAME: 7,
  LAST_4_DIGITS: 8,
  NOTES: 9,
  SCREENSHOT_FILE_ID: 10,
  STATUS: 11,
  GDRIVE_FILE_PATH: 12,
  OCR_TEXT: 13,
  OCR_TIMESTAMP: 14,
};


// ============================================================
// Sheet headers for auto-creation (new sheets only)
// Existing sheets (Membership Master, Fetch-Gmail) must already exist.
// ============================================================

const SHEET_HEADERS: Record<string, string[]> = {
  [SHEET_NAMES.WEBAPP_EVENTS]: [
    'EventID', 'EventType', 'Timestamp', 'MemberID', 'Email',
    'PaymentIntent', 'Amount', 'PaymentMethod', 'PayerName', 'MemoField',
    'Last4Digits', 'FamilyMemberEmails', 'Status',
    'MatchedMessageId', 'MatchedTransactionNumber',
    'AdminApprover', 'ApprovalDate', 'Notes',
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
  [SHEET_NAMES.PAYMENT_PROOFS]: [
    'EventID', 'Timestamp', 'MemberID', 'Email', 'EventName', 'Amount',
    'PaymentDate', 'PayerName', 'Last4Digits', 'Notes', 'ScreenshotFileID', 'Status',
    'GDrive File Path', 'OCR Text', 'OCR Timestamp',
  ],
};

// Default Config values seeded on first creation
const DEFAULT_CONFIG_ROWS: string[][] = [
  ['IndividualPrice',        '30',                      'Price for individual membership'],
  ['FamilyPrice',            '50',                      'Price for family membership'],
  ['FamilyUpgradePrice',     '20',                      'Price for family membership'],
  ['PaymentMethods',         'Zelle,Venmo,PayPal',      'Comma-separated accepted payment methods'],
  ['ZelleHandle',            'zelle@example.com',       'Zelle payment handle'],
  ['VenmoHandle',            '@venmo-user',             'Venmo payment handle'],
  ['PayPalHandle',           'paypal@example.com',      'PayPal payment handle'],
  ['ReminderDaysBefore',     '30',                      'Days before expiry to send reminder'],
  ['MembershipRenewalYears', '1',                       'Years added per renewal'],
  ['OTPValidHours',          '24',                      'Hours before OTP expires'],
  ['OTPCleanupDays',         '7',                       'Days before used/expired OTPs are deleted'],
  ['AdminEmails',            'admin@mmrunners.org',     'Comma-separated admin email addresses'],
  ['AppBaseUrl',             '',                        'Deployed web app URL (set after first deploy)'],
  ['PaymentProofFolderId',   '',                        'Google Drive folder ID for payment proofs'],
  ['ZelleQRCodeFileId',      '',                        'Google Drive file ID for Zelle QR code image'],
  ['VenmoQRCodeFileId',      '',                        'Google Drive file ID for Venmo QR code image'],
];

// Default Payment Events values seeded on first creation
const DEFAULT_PAYMENT_EVENTS_ROWS: string[][] = [
  ['Individual Membership', 'Confirm your payment for individual membership renewal', 'Match with payment history'],
  ['Family Membership', 'Confirm your payment for family membership renewal', 'Match with payment history'],
  ['Upgrade to Family Membership', 'Confirm your payment for upgrading to family membership', 'Match with payment history'],
  ['Other Payment', 'Confirm your other payments related to membership', 'Manual review'],
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
      PROFILE_LAST_UPDATED: now,
    };
    if (payload.firstName !== undefined) updates['FIRST_NAME'] = payload.firstName.trim();
    if (payload.lastName !== undefined) updates['LAST_NAME'] = payload.lastName.trim();
    if (payload.phoneNumber !== undefined) updates['PHONE_NUMBER'] = payload.phoneNumber.trim();
    if (payload.wechatID !== undefined) updates['WECHAT_ID'] = payload.wechatID.trim();
    if (payload.district !== undefined) updates['DISTRICT'] = payload.district.trim();
    if (payload.joinYear !== undefined) updates['JOIN_YEAR'] = payload.joinYear.trim();

    console.log('[mmr][updateMemberProfile] updating fields:', Object.keys(updates));
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
    newRow[MM_COL.STATUS] = 'not active';
    newRow[MM_COL.CREATED] = now;
    newRow[MM_COL.EMAIL] = email;
    newRow[MM_COL.FIRST_NAME] = payload.firstName.trim();
    newRow[MM_COL.LAST_NAME] = (payload.lastName || '').trim();
    newRow[MM_COL.TYPE] = 'Individual';
    newRow[MM_COL.PHONE_NUMBER] = (payload.phoneNumber || '').trim();
    newRow[MM_COL.DISTRICT] = (payload.district || '').trim();
    newRow[MM_COL.JOIN_YEAR] = currentYear;
    newRow[MM_COL.LAST_UPDATED] = now;
    newRow[MM_COL.PROFILE_LAST_UPDATED] = now;
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
  const { payload } = req;
  try {
    const email = payload.email.trim().toLowerCase();

    // 1. Get memberID from Membership Master
    const found = findMemberByEmail(email);
    if (!found) {
      return jsonError(req.requestId, 'MEMBER_NOT_FOUND', 'Member not found.');
    }
    const memberID = found.member.memberID;

    // 2. Load approved Payment-History rows for this member
    const payments = getPaymentHistoryByMemberID(memberID);

    // 3. Load ALL WebApp-Events rows for this member (Pending/Matched/Approved/Rejected)
    const events = getWebAppEventsByMemberID(memberID);

    auditLog('PAYMENT_HISTORY_VIEW', { sessionID: payload.sessionID, memberID });

    return jsonOk(req.requestId, {
      memberID,
      payments,   // confirmed Payment-History rows
      events,     // all submission events including pending ones
    });
  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}


```


---
## File: `src/ocr.ts`
---

```typescript
// ============================================================
// OCR processing for payment proofs
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

    const sheet = getSheet(SHEET_NAMES.PAYMENT_PROOFS);
    const data = sheet.getDataRange().getValues();
    let rowIndex = -1;
    let fileId = '';

    for (let i = 1; i < data.length; i++) {
      if (data[i][PP_COL.EVENT_ID] === payload.eventId) {
        rowIndex = i;
        fileId = data[i][PP_COL.SCREENSHOT_FILE_ID];
        break;
      }
    }

    if (rowIndex === -1) {
      return jsonError(req.requestId, 'NOT_FOUND', 'Payment proof event not found.');
    }

    if (!fileId) {
      return jsonError(req.requestId, 'BAD_REQUEST', 'No screenshot file ID found for this payment proof.');
    }

    const ocrText = ocrImageToText_(fileId);
    const file = DriveApp.getFileById(fileId);
    const filePath = file.getUrl();
    const timestamp = new Date().toISOString();

    sheet.getRange(rowIndex + 1, PP_COL.GDRIVE_FILE_PATH + 1).setValue(filePath);
    sheet.getRange(rowIndex + 1, PP_COL.OCR_TEXT + 1).setValue(ocrText);
    sheet.getRange(rowIndex + 1, PP_COL.OCR_TIMESTAMP + 1).setValue(timestamp);

    return jsonOk(req.requestId, { message: 'OCR process completed successfully.' });

  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
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
  const req = JSON.parse(jsonRequest) as ApiRequest<any>; // Define a proper type later
  const { payload } = req;
  try {
    console.log('[mmr][submitPaymentProof] payload:', payload);

    const folderId = getConfigValue('Payment_Proof_Folder_Id');
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

    appendPaymentProof({
      eventID: `PP-${Date.now()}`,
      timestamp: new Date().toISOString(),
      memberID: payload.memberID,
      email: payload.email,
      eventName: payload.eventName,
      amount: payload.amount,
      paymentDate: payload.paymentDate,
      payerName: payload.payerName,
      last4Digits: payload.last4Digits,
      notes: payload.notes,
      screenshotFileId: fileId,
      status: 'Pending Review',
    });

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
// Membership renewal: submit, reconcile, approve, reject
// Depends on: config.ts, sheets.ts, logger.ts
// Exposed GAS functions: submitRenewalRequest, reconcileWebAppWithGmail,
//                        approveRenewal, rejectRenewal
// ============================================================

function submitRenewalRequest(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<RenewalSubmitPayload>;
  const { payload } = req;
  try {
    console.log('[mmr][submitRenewalRequest] memberID:', payload.memberId, '| type:', payload.paymentIntent, '| amount:', payload.amount, '| method:', payload.paymentMethod);
    auditLog('RENEWAL_FORM_OPEN', {
      memberID: payload.memberId,
      email: payload.email,
      sessionID: payload.sessionID,
    });

    const eventID = appendWebAppEvent({
      eventType: 'MembershipRenewal',
      timestamp: new Date().toISOString(),
      memberID: payload.memberId,
      email: payload.email,
      paymentIntent: payload.paymentIntent,   // 'Individual Renewal' | 'Family Renewal' | 'Family Upgrade'
      amount: payload.amount,
      paymentMethod: payload.paymentMethod,
      payerName: payload.payerName,
      memoField: payload.memoField,
      last4Digits: payload.last4Digits ?? '',
      familyMemberEmails: payload.familyMemberEmails ?? '',
      status: 'Pending',
      matchedMessageId: '',
      matchedTransactionNumber: '',
      adminApprover: '',
      approvalDate: '',
      notes: '',
    });

    auditLog('RENEWAL_SUBMIT', {
      eventID,
      memberID: payload.memberId,
      email: payload.email,
    });

    return jsonOk(req.requestId, {
      eventID,
      message: 'Payment submitted. We will verify and approve within 1–2 business days.',
    });
  } catch (e: any) {
    auditLog('ERROR', {
      memberID: payload.memberId,
      email: payload.email,
      errorMessage: String(e),
    });
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
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
          STATUS: 'Matched',
          MATCHED_MESSAGE_ID: gmailMatch.messageId,
          MATCHED_TRANSACTION_NUMBER: gmailMatch.transactionNumber,
        });
        markGmailPaymentProcessed(gmailMatch.rowIndex, event.eventID);
        auditLog('RECONCILE_MATCH_FOUND', {
          eventID: event.eventID,
          memberID: event.memberID,
        });
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
  const windowMs = 3 * 24 * 60 * 60 * 1000; // ±3 days

  for (const row of gmailRows) {
    // Exact match on last 4 digits of transaction number
    if (event.last4Digits && row.transactionNumber.endsWith(event.last4Digits)) {
      if (row.amount === event.amount) return row;
    }

    // Fuzzy match
    const rowDate = new Date(row.transactionDate || row.timestamp);
    if (Math.abs(eventDate.getTime() - rowDate.getTime()) > windowMs) continue;
    if (row.amount !== event.amount) continue;
    if (row.source.toLowerCase() !== event.paymentMethod.toLowerCase()) continue;

    const senderLower = row.sender.toLowerCase();
    const payerLower = event.payerName.toLowerCase();
    const memoLower = (row.memo + ' ' + row.originalMemo).toLowerCase();

    const senderMatch =
      senderLower.includes(payerLower) || payerLower.includes(senderLower);
    const memoMatch =
      memoLower.includes(event.memberID.toLowerCase()) ||
      memoLower.includes(payerLower);

    if (senderMatch || memoMatch) return row;
  }

  return null;
}

function approveRenewal(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<ApproveRenewalPayload>;
  const payload = req.payload;
  try {
    const found = findWebAppEvent(payload.eventID);
    if (!found) return jsonError(req.requestId, 'NOT_FOUND', 'Event not found.');

    const event = found.event;
    const renewalYears = parseInt(getConfigValue('MembershipRenewalYears'), 10) || 1;
    const today = new Date();
    const intent = event.paymentIntent as PaymentIntent;

    // ── Branch C: Family Upgrade ──────────────────────────────────────
    if (intent === 'Family Upgrade') {
      const primary = findMemberByID(event.memberID);
      if (!primary) return jsonError(req.requestId, 'NOT_FOUND', 'Member not found.');
      if (primary.member.status !== 'active') {
        return jsonError(req.requestId, 'INVALID_STATE',
          'Family upgrade requires an active Individual membership first.');
      }
      // Assign FamilyID if blank
      let familyID = primary.member.familyID;
      if (!familyID) {
        familyID = generateFamilyID();
        updateMemberRow(primary.rowIndex, { FAMILYID: familyID });
      }
      // Set Type → Family, do NOT change Expiration
      updateMemberRow(primary.rowIndex, { TYPE: 'Family' });

      const periodStart = primary.member.expiration
        ? new Date(primary.member.expiration).toISOString().split('T')[0]
        : today.toISOString().split('T')[0];
      const periodEnd = primary.member.expiration
        ? new Date(primary.member.expiration).toISOString().split('T')[0]
        : periodStart;

      appendPaymentRecord({ ...baseRecord(event, payload), paymentIntent: intent,
        periodStart, periodEnd });
      updateWebAppEventRow(found.rowIndex, { STATUS: 'Approved',
        ADMINAPPROVER: payload.adminEmail, APPROVALDATE: new Date().toISOString(),
        NOTES: payload.notes ?? '' });
      auditLog('UPGRADEAPPROVED', { eventID: event.eventID, memberID: event.memberID });
      return jsonOk(req.requestId, { message: 'Family upgrade approved.', periodEnd });
    }

    // ── Branch B: Family Renewal ──────────────────────────────────────
    // ── Branch A: Individual Renewal ─────────────────────────────────
    // (shared expiration logic for both)
    let membersToUpdate: Array<{ rowIndex: number; member: Member }> = [];

    if (intent === 'Family Renewal') {
      const primary = findMemberByID(event.memberID);
      if (!primary) return jsonError(req.requestId, 'NOT_FOUND', 'Member not found.');
      // Assign FamilyID if blank
      if (!primary.member.familyID) {
        const newFamilyID = generateFamilyID();
        updateMemberRow(primary.rowIndex, { FAMILYID: newFamilyID });
        primary.member.familyID = newFamilyID;
      }
      membersToUpdate = findMembersByFamilyID(primary.member.familyID);
      if (membersToUpdate.length === 0) membersToUpdate = [primary];
    } else {
      // Individual Renewal
      const m = findMemberByID(event.memberID);
      if (!m) return jsonError(req.requestId, 'NOT_FOUND', 'Member not found.');
      membersToUpdate = [m];
    }

    // Compute newExpiration = max(today + N years, currentExpiration)
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

    const now = new Date().toISOString();
    const periodStart = today.toISOString().split('T')[0];
    const periodEnd = newExpiration.toISOString().split('T')[0];
    const memberType = intent === 'Family Renewal' ? 'Family' : 'Individual';

    for (const { rowIndex } of membersToUpdate) {
      updateMemberRow(rowIndex, {
        STATUS: 'active', EXPIRATION: periodEnd, TYPE: memberType,
        MEMBERSHIPFEEPAID: event.amount, PAYMENTDATE: now,
        PAYMENTTRANSACTION: event.matchedTransactionNumber || event.last4Digits,
        LASTUPDATED: now,
      });
    }

    appendPaymentRecord({ ...baseRecord(event, payload), paymentIntent: intent,
      periodStart, periodEnd });
    updateWebAppEventRow(found.rowIndex, { STATUS: 'Approved',
      ADMINAPPROVER: payload.adminEmail, APPROVALDATE: now,
      NOTES: payload.notes ?? '' });
    auditLog('RENEWALAPPROVED', { eventID: event.eventID, memberID: event.memberID,
      email: event.email });

    return jsonOk(req.requestId, { message: 'Renewal approved.', periodEnd });

  } catch (e: any) {
    auditLog('ERROR', { eventID: payload.eventID, errorMessage: String(e) });
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

// Helper to avoid repeating shared Payment-History fields
function baseRecord(event: WebAppEvent, payload: ApproveRenewalPayload) {
  return {
    eventID: event.eventID, memberID: event.memberID,
    paymentDate: new Date().toISOString().split('T')[0],
    amount: event.amount, paymentMethod: event.paymentMethod,
    payerName: event.payerName, memoField: event.memoField,
    last4Digits: event.last4Digits,
    transactionReference: event.matchedTransactionNumber,
    processedBy: payload.adminEmail,
    processedDate: new Date().toISOString(),
    source: 'WebApp', notes: payload.notes ?? '',
  };
}


function rejectRenewal(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<RejectRenewalPayload>;
  const { payload } = req;
  try {
    console.log('[mmr][rejectRenewal] eventID:', payload.eventID, '| admin:', payload.adminEmail);
    const found = findWebAppEvent(payload.eventID);
    if (!found) return jsonError(req.requestId, 'NOT_FOUND', 'Event not found.');

    const now = new Date().toISOString();
    updateWebAppEventRow(found.rowIndex, {
      STATUS: 'Rejected',
      ADMIN_APPROVER: payload.adminEmail,
      APPROVAL_DATE: now,
      NOTES: payload.notes,
    });

    auditLog('RENEWAL_REJECTED', { eventID: payload.eventID, memberID: found.event.memberID });
    return jsonOk(req.requestId, { message: 'Renewal rejected.' });
  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

function testApproveRenewal() {
  const req = JSON.stringify({
    requestId: 'test-003',
    payload: {
      eventID: 'EV-test-003',
      adminEmail: 'cathylin@gmail.com',
      notes: 'Manual test approval'
    }
  });
  const result = approveRenewal(req);
  console.log('approveRenewal result:', result);
}

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

// ---- Membership Master ----

function deriveStatus(expirationStr: string): Member['status'] {
  if (!expirationStr || expirationStr.trim() === '') return 'not active';
  const exp = new Date(expirationStr);
  if (isNaN(exp.getTime())) return 'not active';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return exp >= today ? 'active' : 'expired';
}

function rowToMember(row: any[]): Member {
  const expiration = String(row[MM_COL.EXPIRATION] ?? '');
  return {
    memberID: String(row[MM_COL.MEMBER_ID] ?? ''),
    status: deriveStatus(expiration),          // ← calculated, not read from sheet
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
    paymentCheckInfo: String(row[MM_COL.PAYMENT_CHECK_INFO] ?? ''),
    lastUpdated: String(row[MM_COL.LAST_UPDATED] ?? ''),
    membershipFeePaid: String(row[MM_COL.MEMBERSHIP_FEE_PAID] ?? ''),
    paymentDate: String(row[MM_COL.PAYMENT_DATE] ?? ''),
    paymentTransaction: String(row[MM_COL.PAYMENT_TRANSACTION] ?? ''),
    joinYear: String(row[MM_COL.JOIN_YEAR] ?? ''),
    phoneNumber: String(row[MM_COL.PHONE_NUMBER] ?? ''),
    lastLoginDate: String(row[MM_COL.LAST_LOGIN_DATE] ?? ''),
    profileLastUpdated: String(row[MM_COL.PROFILE_LAST_UPDATED] ?? ''),
    notes: String(row[MM_COL.NOTES] ?? ''),
  };
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
    eventID: String(row[WE_COL.EVENT_ID] ?? ''),
    eventType: String(row[WE_COL.EVENT_TYPE] ?? '') as WebAppEvent['eventType'],
    timestamp: String(row[WE_COL.TIMESTAMP] ?? ''),
    memberID: String(row[WE_COL.MEMBER_ID] ?? ''),
    email: String(row[WE_COL.EMAIL] ?? ''),
    paymentIntent: String(row[WE_COL.PAYMENT_INTENT] ?? '') as WebAppEvent['paymentIntent'],
    amount: Number(row[WE_COL.AMOUNT] ?? 0),
    paymentMethod: String(row[WE_COL.PAYMENT_METHOD] ?? '') as WebAppEvent['paymentMethod'],
    payerName: String(row[WE_COL.PAYER_NAME] ?? ''),
    memoField: String(row[WE_COL.MEMO_FIELD] ?? ''),
    last4Digits: String(row[WE_COL.LAST_4_DIGITS] ?? ''),
    familyMemberEmails: String(row[WE_COL.FAMILY_MEMBER_EMAILS] ?? ''),
    status: String(row[WE_COL.STATUS] ?? '') as WebAppEvent['status'],
    matchedMessageId: String(row[WE_COL.MATCHED_MESSAGE_ID] ?? ''),
    matchedTransactionNumber: String(row[WE_COL.MATCHED_TRANSACTION_NUMBER] ?? ''),
    adminApprover: String(row[WE_COL.ADMIN_APPROVER] ?? ''),
    approvalDate: String(row[WE_COL.APPROVAL_DATE] ?? ''),
    notes: String(row[WE_COL.NOTES] ?? ''),
  };
}

function appendWebAppEvent(event: Omit<WebAppEvent, 'eventID'>): string {
  const sheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
  const eventID = generateEventID();
  sheet.appendRow([
    eventID,
    event.eventType,
    event.timestamp,
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
    '', '', '', '', '',
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

// ---- Auth-OTP ----

function appendOtpRecord(record: OtpRecord): void {
  const sheet = getSheet(SHEET_NAMES.AUTH_OTP);
  sheet.appendRow([
    record.email,
    record.otpCode,
    record.createdAt,
    record.expiresAt,
    record.used,
    record.ipAddress,
  ]);
}

function findValidOtp(email: string, otpCode: string): { rowIndex: number } | null {
  const sheet = getSheet(SHEET_NAMES.AUTH_OTP);
  const data = sheet.getDataRange().getValues();
  const now = new Date();
  for (let i = 1; i < data.length; i++) {
    const rowEmail = String(data[i][OTP_COL.EMAIL]).toLowerCase();
    const rowCode = String(data[i][OTP_COL.OTP_CODE]);
    const used = data[i][OTP_COL.USED];
    const expiresAt = new Date(data[i][OTP_COL.EXPIRES_AT]);
    if (
      rowEmail === email.toLowerCase() &&
      rowCode === otpCode &&
    //  !used && // allow reuse of OTP until expiry to avoid user frustration with multiple attempts
      now <= expiresAt
    ) {
      return { rowIndex: i + 1 };
    }
  }
  return null;
}

function markOtpUsed(rowIndex: number): void {
  const sheet = getSheet(SHEET_NAMES.AUTH_OTP);
  sheet.getRange(rowIndex, OTP_COL.USED + 1).setValue(true);
}

function cleanupExpiredOtps(): void {
  const sheet = getSheet(SHEET_NAMES.AUTH_OTP);
  const data = sheet.getDataRange().getValues();
  const cleanupDays = parseInt(getConfigValue('OTP_Cleanup_Days'), 10) || 7;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - cleanupDays);
  // Delete from bottom up to preserve row indices
  for (let i = data.length - 1; i >= 1; i--) {
    const createdAt = new Date(data[i][OTP_COL.CREATED_AT]);
    if (createdAt < cutoff) {
      sheet.deleteRow(i + 1);
    }
  }
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



function appendPaymentProof(proof: PaymentProof): void {

  const sheet = getSheet(SHEET_NAMES.PAYMENT_PROOFS);

  sheet.appendRow([

    proof.eventID,

    proof.timestamp,

    proof.memberID,

    proof.email,

    proof.eventName,

    proof.amount,

    proof.paymentDate,

    proof.payerName,

    proof.last4Digits,

    proof.notes,

    proof.screenshotFileId,

    proof.status,

  ]);

}

function getPaymentHistoryByMemberID(memberID: string): PaymentHistoryItem[] {
  const sheet = getSheet(SHEET_NAMES.PAYMENT_HISTORY);
  if (!sheet) return [];

  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];

  // Column index helpers — adjust names to match your actual sheet headers
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
      eventID:       String(row[col('EventID')]       || ''),
      eventType:     String(row[col('EventType')]     || ''),
      timestamp:     String(row[col('Timestamp')]     || ''),
      paymentIntent: String(row[col('PaymentIntent')] || ''),
      amount:        Number(row[col('Amount')]        || 0),
      paymentMethod: String(row[col('PaymentMethod')] || ''),
      status:        String(row[col('Status')]        || '') as WebAppEventSummary['status'],
      notes:         String(row[col('Notes')]         || ''),
    }));
}


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
  status: 'active' | 'not active' | 'expired';
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
  paymentCheckInfo: string;
  lastUpdated: string;
  membershipFeePaid: string;
  paymentDate: string;
  paymentTransaction: string;
  // New columns
  joinYear: string;
  phoneNumber: string;
  lastLoginDate: string;
  profileLastUpdated: string;
  notes: string;
}

/// ADD this type
type PaymentIntent = 'Individual Renewal' | 'Family Renewal' | 'Family Upgrade';

// UPDATE WebAppEvent — replace membershipType with paymentIntent
interface WebAppEvent {
  eventID: string;
  eventType: string;
  timestamp: string;
  memberID: string;
  email: string;
  paymentIntent: PaymentIntent;   // ← was membershipType: string
  amount: number;
  paymentMethod: string;
  payerName: string;
  memoField: string;
  last4Digits: string;
  familyMemberEmails: string;
  status: 'Pending' | 'Matched' | 'Approved' | 'Rejected' | 'Error';
  matchedMessageId: string;
  matchedTransactionNumber: string;
  adminApprover: string;
  approvalDate: string;
  notes: string;
}

// UPDATE PaymentHistoryItem — replace membershipType with paymentIntent
interface PaymentHistoryItem {
  paymentID: string;
  eventID: string;
  paymentDate: string;
  amount: number;
  paymentIntent: PaymentIntent;   // ← was membershipType
  paymentMethod: string;
  payerName: string;
  periodStart: string;
  periodEnd: string;
  source: string;
  notes: string;
}

// ADD RenewalSubmitPayload — replace old payload interface
interface RenewalSubmitPayload {
  memberId: string;
  email: string;
  paymentIntent: PaymentIntent;   // ← was membershipType
  amount: number;
  paymentMethod: string;
  payerName: string;
  memoField: string;
  last4Digits?: string;
  familyMemberEmails?: string;
  sessionID: string;
}


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

interface OtpRecord {
  email: string;
  otpCode: string;
  createdAt: string;
  expiresAt: string;
  used: boolean;
  ipAddress: string;
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

// Payload for the pre-OTP email lookup
interface LookupEmailPayload {
  email: string;
  sessionID: string;
}

// Response for lookupEmail
interface LookupEmailResponse {
  found: boolean;
  firstName?: string;   // only present if found
  memberID?: string;    // only present if found
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
}

interface ApproveRenewalPayload {
  eventID: string;
  adminEmail: string;
  notes?: string;
}

interface RejectRenewalPayload {
  eventID: string;
  adminEmail: string;
  notes: string;
}

interface PaymentProof {
  eventID: string;
  timestamp: string;
  memberID: string;
  email: string;
  eventName: string;
  amount: number;
  paymentDate: string;
  payerName: string;
  last4Digits: string;
  notes: string;
  screenshotFileId: string;
  status: 'Pending Review' | 'Approved' | 'Rejected';
}

interface WebAppEventSummary {
  eventID:             string;
  eventType:           string;
  timestamp:           string;
  paymentIntent:       string;
  amount:              number;
  paymentMethod:       string;
  status:              'Pending' | 'Matched' | 'Approved' | 'Rejected' | 'Error';
  notes:               string;
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

// Route ?page= to the matching HTML template
// Route ?page= to the matching HTML template
function doGet(e: GoogleAppsScript.Events.DoGet): GoogleAppsScript.HTML.HtmlOutput {
  try {
    console.log('mmr:doGet called, parameters =', JSON.stringify(e.parameter));
    console.log('mmr:doGet page =', e.parameter.page);

    const page = (e && e.parameter && e.parameter['page']) || 'login';
    console.log('mmr:doGet serving page =', page);

    if (page === 'image') {
      const fileId = e.parameter['id'];
      return serveImage(fileId);
    }

    try {
      const allowedPages = ['login', 'dashboard', 'profile', 'renewal', 'admin', 'newmember', 'payment_proof', 'payment', 'image', 'payment_history'];
      const safePage = allowedPages.includes(page) ? page : 'login';
      const fileName = `page_${safePage}`;
      console.log(`doGet: serving "${fileName}", page param="${page}"`);

      let scriptUrl = '';
      try { scriptUrl = ScriptApp.getService().getUrl(); } catch (_) {}
      console.log('mmr:doGet SCRIPTURL =', scriptUrl);

      // Serialize all URL params as JSON so the page can read type, amount, etc.
      const urlParamsJson = JSON.stringify(e.parameter || {});
      console.log('mmr:doGet urlParamsJson =', urlParamsJson);

      const raw = HtmlService.createHtmlOutputFromFile(fileName).getContent();
      const content = raw
        .replace('__SCRIPT_URL__', scriptUrl)
        .replace('__URL_PARAMS__', urlParamsJson);  // ← NEW

      console.log(`doGet: content length=${content.length}, scriptUrl=${scriptUrl}`);
      const output = HtmlService.createHtmlOutput(content)
        .setTitle('Misty Mountain Runners — Membership')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
      console.log('mmr:doGet output created successfully for page =', page);
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

```


---
## File: `tests/auth.test.ts`
---

```typescript
// Tests for auth.ts — OTP creation, verification, Google login

require('../src/types');
require('../src/config');
require('../src/sheets');
require('../src/logger');
require('../src/members');
require('../src/auth');

declare function requestEmailOtp(jsonRequest: string): string;
declare function verifyEmailOtp(jsonRequest: string): string;
declare function handleGoogleLogin(jsonRequest: string): string;
declare function __seedSheet(name: string, rows: any[][]): void;
declare function __getSheet(name: string): any[][];

const MM = 'Membership-Master-Main-3';
const OTP = 'Auth-OTP';
const LOG = 'WebApp-ActivityLog';
const CFG = 'Config';

function blankRow(len = 23) { return new Array(len).fill(''); }

function req(payload: any): string {
  return JSON.stringify({ requestId: 'test-req', payload });
}

describe('requestEmailOtp', () => {
  beforeEach(() => {
    __seedSheet(CFG, [['Key', 'Value', 'Desc'], ['OTP_Valid_Hours', '24', ''], ['OTP_Cleanup_Days', '7', '']]);
    __seedSheet(OTP, [['Email', 'Code', 'CreatedAt', 'ExpiresAt', 'Used', 'IP']]);
    __seedSheet(LOG, [[]]);
  });

  it('rejects invalid email', () => {
    const res = JSON.parse(requestEmailOtp(req({ email: 'notanemail', sessionID: 'S1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_EMAIL');
  });

  it('sends OTP and appends to sheet', () => {
    const res = JSON.parse(requestEmailOtp(req({ email: 'user@yahoo.com', sessionID: 'S1' })));
    expect(res.ok).toBe(true);
    const rows = __getSheet(OTP);
    expect(rows).toHaveLength(2); // header + new OTP row
    expect(rows[1][0]).toBe('user@yahoo.com');
    expect(rows[1][4]).toBe(false); // not used
  });
});

describe('lookupEmail', () => {
  beforeEach(() => {
    __seedSheet(CFG, [['Key', 'Value', 'Desc']]);
    __seedSheet(LOG, [[]]);
  });

  it('returns found:false for unknown email', () => {
    __seedSheet(MM, [blankRow()]);
    const res = JSON.parse(
      (global as any).lookupEmail(req({ email: 'unknown@test.com', sessionID: 'S1' }))
    );
    expect(res.ok).toBe(true);
    expect(res.payload.found).toBe(false);
  });

  it('returns found:true with firstName and memberID only', () => {
    const row = blankRow();
    row[0] = 'A0042'; row[4] = 'jane@yahoo.com';
    row[5] = 'Jane';  row[6] = 'Doe';
    row[1] = 'active';
    __seedSheet(MM, [blankRow(), row]);
    const res = JSON.parse(
      (global as any).lookupEmail(req({ email: 'jane@yahoo.com', sessionID: 'S1' }))
    );
    expect(res.ok).toBe(true);
    expect(res.payload.found).toBe(true);
    expect(res.payload.memberID).toBe('A0042');
    expect(res.payload.firstName).toBe('Jane');
    // Should NOT expose status or expiration
    expect(res.payload.status).toBeUndefined();
    expect(res.payload.expiration).toBeUndefined();
  });

  it('rejects invalid email format', () => {
    const res = JSON.parse(
      (global as any).lookupEmail(req({ email: 'notanemail', sessionID: 'S1' }))
    );
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_EMAIL');
  });
});

describe('verifyEmailOtp', () => {
  beforeEach(() => {
    __seedSheet(CFG, [['Key', 'Value', 'Desc']]);
    __seedSheet(MM, [blankRow()]);
    __seedSheet(LOG, [[]]);
  });

  it('returns error for invalid OTP', () => {
    const future = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    __seedSheet(OTP, [
      ['Email', 'Code', 'CreatedAt', 'ExpiresAt', 'Used', 'IP'],
      ['u@test.com', '999999', new Date().toISOString(), future, false, ''],
    ]);
    const res = JSON.parse(verifyEmailOtp(req({ email: 'u@test.com', otpCode: '000000', sessionID: 'S1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_OTP');
  });

  it('logs in successfully with valid OTP', () => {
    const future = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    __seedSheet(OTP, [
      ['Email', 'Code', 'CreatedAt', 'ExpiresAt', 'Used', 'IP'],
      ['u@test.com', '123456', new Date().toISOString(), future, false, ''],
    ]);
    const res = JSON.parse(verifyEmailOtp(req({ email: 'u@test.com', otpCode: '123456', sessionID: 'S1' })));
    expect(res.ok).toBe(true);
    expect(res.payload.member.email).toBe('u@test.com');
    // OTP should be marked used
    const otpRows = __getSheet(OTP);
    expect(otpRows[1][4]).toBe(true);
  });
});

describe('handleGoogleLogin', () => {
  beforeEach(() => {
    __seedSheet(CFG, [['Key', 'Value', 'Desc']]);
    __seedSheet(MM, [blankRow()]);
    __seedSheet(LOG, [[]]);
    // Session mock returns admin@mmrunners.org by default (set in setup.ts)
  });

  it('creates a new member on first login (Google Workspace account)', () => {
    const res = JSON.parse(handleGoogleLogin(req({ email: '', sessionID: 'S1' })));
    expect(res.ok).toBe(true);
    expect(res.payload.member.email).toBe('admin@mmrunners.org');
    expect(res.payload.member.status).toBe('not active');
  });

  it('returns existing member on second login', () => {
    // Pre-seed existing member
    const row = blankRow();
    row[0] = 'A0001'; row[4] = 'admin@mmrunners.org'; row[1] = 'active';
    __seedSheet(MM, [blankRow(), row]);
    const res = JSON.parse(handleGoogleLogin(req({ email: '', sessionID: 'S1' })));
    expect(res.ok).toBe(true);
    expect(res.payload.member.memberID).toBe('A0001');
    expect(res.payload.member.status).toBe('active');
  });
});

```


---
## File: `tests/config.test.ts`
---

```typescript
// Tests for config.ts helpers (getConfigMap, getConfigValue, setConfigValue)

// Load source files (global scope — no exports)
require('../src/types');
require('../src/config');

declare function getConfigMap(): Record<string, string>;
declare function getConfigValue(key: string): string;
declare function setConfigValue(key: string, value: string): void;
declare function __seedSheet(name: string, rows: any[][]): void;
declare function __getSheet(name: string): any[][];

const SHEET = 'Config';

describe('getConfigMap', () => {
  it('returns empty map when sheet has only header', () => {
    __seedSheet(SHEET, [['Key', 'Value', 'Description']]);
    expect(getConfigMap()).toEqual({});
  });

  it('parses key-value rows correctly', () => {
    __seedSheet(SHEET, [
      ['Key', 'Value', 'Description'],
      ['Individual_Price', '30', 'Price for individual'],
      ['Family_Price', '50', 'Price for family'],
    ]);
    const map = getConfigMap();
    expect(map['Individual_Price']).toBe('30');
    expect(map['Family_Price']).toBe('50');
  });

  it('skips rows with empty keys', () => {
    __seedSheet(SHEET, [
      ['Key', 'Value', 'Description'],
      ['', '99', 'blank key should be skipped'],
      ['Valid_Key', 'abc', ''],
    ]);
    const map = getConfigMap();
    expect(Object.keys(map)).toHaveLength(1);
    expect(map['Valid_Key']).toBe('abc');
  });
});

describe('getConfigValue', () => {
  it('returns value for existing key', () => {
    __seedSheet(SHEET, [
      ['Key', 'Value', 'Description'],
      ['OTP_Valid_Hours', '24', ''],
    ]);
    expect(getConfigValue('OTP_Valid_Hours')).toBe('24');
  });

  it('returns empty string for missing key', () => {
    __seedSheet(SHEET, [['Key', 'Value', 'Description']]);
    expect(getConfigValue('Nonexistent')).toBe('');
  });
});

describe('setConfigValue', () => {
  it('updates an existing key', () => {
    __seedSheet(SHEET, [
      ['Key', 'Value', 'Description'],
      ['Individual_Price', '30', ''],
    ]);
    setConfigValue('Individual_Price', '35');
    expect(getConfigValue('Individual_Price')).toBe('35');
  });

  it('appends a new key if not found', () => {
    __seedSheet(SHEET, [['Key', 'Value', 'Description']]);
    setConfigValue('New_Key', 'new_value');
    expect(getConfigValue('New_Key')).toBe('new_value');
  });
});

```


---
## File: `tests/members.test.ts`
---

```typescript
// Tests for members.ts — profile creation and updates

require('../src/types');
require('../src/config');
require('../src/sheets');
require('../src/logger');
require('../src/members');

declare function getOrCreateMemberProfile(jsonRequest: string): string;
declare function updateMemberProfile(jsonRequest: string): string;
declare function __seedSheet(name: string, rows: any[][]): void;
declare function __getSheet(name: string): any[][];

const MM = 'Membership-Master-Main-3';
const LOG = 'WebApp-ActivityLog';
const CFG = 'Config';

function blankRow(len = 23) { return new Array(len).fill(''); }
function req(payload: any): string {
  return JSON.stringify({ requestId: 'test-req', payload });
}

describe('getOrCreateMemberProfile', () => {
  beforeEach(() => {
    __seedSheet(CFG, [['Key', 'Value', 'Desc']]);
    __seedSheet(LOG, [[]]);
  });

  it('creates a new inactive member for unknown email', () => {
    __seedSheet(MM, [blankRow()]);
    const res = JSON.parse(getOrCreateMemberProfile(req({ email: 'new@example.com', sessionID: 'S1' })));
    expect(res.ok).toBe(true);
    expect(res.payload.member.email).toBe('new@example.com');
    expect(res.payload.member.status).toBe('not active');
    expect(res.payload.member.memberID).toMatch(/^A\d{4}$/);
  });

  it('returns existing member without creating a duplicate', () => {
    const row = blankRow();
    row[0] = 'A0010'; row[4] = 'existing@example.com'; row[1] = 'active';
    __seedSheet(MM, [blankRow(), row]);
    const res = JSON.parse(getOrCreateMemberProfile(req({ email: 'existing@example.com', sessionID: 'S1' })));
    expect(res.ok).toBe(true);
    expect(res.payload.member.memberID).toBe('A0010');
    // Ensure no duplicate was created
    expect(__getSheet(MM)).toHaveLength(2);
  });

  it('sets joinYear to current year for new member', () => {
    __seedSheet(MM, [blankRow()]);
    const res = JSON.parse(getOrCreateMemberProfile(req({ email: 'brand@new.com', sessionID: 'S1' })));
    expect(res.payload.member.joinYear).toBe(String(new Date().getFullYear()));
  });
});

describe('updateMemberProfile', () => {
  beforeEach(() => {
    __seedSheet(LOG, [[]]);
    const row = blankRow();
    row[0] = 'A0001'; row[4] = 'user@test.com'; row[5] = 'Jane'; row[6] = 'Doe';
    __seedSheet(MM, [blankRow(), row]);
  });

  it('returns NOT_FOUND for unknown MemberID', () => {
    const res = JSON.parse(updateMemberProfile(req({ memberID: 'A9999', firstName: 'Test' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('NOT_FOUND');
  });

  it('updates allowed fields', () => {
    const res = JSON.parse(updateMemberProfile(req({
      memberID: 'A0001',
      firstName: 'Janet',
      phoneNumber: '917-555-0000',
      district: 'Queens',
      joinYear: '2020',
    })));
    expect(res.ok).toBe(true);
    expect(res.payload.member.firstName).toBe('Janet');
    expect(res.payload.member.phoneNumber).toBe('917-555-0000');
    expect(res.payload.member.district).toBe('Queens');
    expect(res.payload.member.joinYear).toBe('2020');
  });

  it('does not overwrite fields that are not provided', () => {
    const res = JSON.parse(updateMemberProfile(req({
      memberID: 'A0001',
      district: 'Brooklyn',
    })));
    // firstName should still be Jane (unchanged)
    expect(res.payload.member.firstName).toBe('Jane');
    expect(res.payload.member.district).toBe('Brooklyn');
  });
});

```


---
## File: `tests/renewal.test.ts`
---

```typescript
// Tests for renewal.ts — submit, reconcile, approve, reject

require('../src/types');
require('../src/config');
require('../src/sheets');
require('../src/logger');
require('../src/members');
require('../src/renewal');

declare function submitRenewalRequest(jsonRequest: string): string;
declare function approveRenewal(jsonRequest: string): string;
declare function rejectRenewal(jsonRequest: string): string;
declare function reconcileWebAppWithGmail(): string;
declare function __seedSheet(name: string, rows: any[][]): void;
declare function __getSheet(name: string): any[][];

const MM = 'Membership-Master-Main-3';
const WE = 'WebApp-Events';
const PH = 'Payment-History';
const LOG = 'WebApp-ActivityLog';
const CFG = 'Config';
const FG = 'Fetch-Gmail-data-in-Google-Spreadsheet-Active-4';

function blankRow(len = 23) { return new Array(len).fill(''); }
function req(payload: any): string {
  return JSON.stringify({ requestId: 'test-req', payload });
}
function weHeader() {
  return ['EventID','EventType','Timestamp','MemberID','Email','MembershipType','Amount','PaymentMethod','PayerName','MemoField','Last4Digits','FamilyEmails','Status','MatchedMsgID','MatchedTxNum','AdminApprover','ApprovalDate','Notes'];
}

describe('submitRenewalRequest', () => {
  beforeEach(() => {
    __seedSheet(WE, [weHeader()]);
    __seedSheet(LOG, [[]]);
  });

  it('appends a Pending event to WebApp-Events', () => {
    const res = JSON.parse(submitRenewalRequest(req({
      memberId: 'A0001', email: 'user@test.com',
      membershipType: 'Individual', amount: 30,
      paymentMethod: 'Zelle', payerName: 'Test User',
      memoField: 'A0001 2026 membership', sessionID: 'S1',
    })));
    expect(res.ok).toBe(true);
    expect(res.payload.eventID).toMatch(/^EV-/);
    const rows = __getSheet(WE);
    expect(rows).toHaveLength(2);
    expect(rows[1][12]).toBe('Pending');
  });
});

describe('approveRenewal', () => {
  beforeEach(() => {
    __seedSheet(LOG, [[]]);
    __seedSheet(PH, [['PaymentID']]);
    __seedSheet(CFG, [['Key', 'Value', 'Desc'], ['Membership_Renewal_Years', '1', '']]);
  });

  it('returns NOT_FOUND for unknown event', () => {
    __seedSheet(WE, [weHeader()]);
    const res = JSON.parse(approveRenewal(req({ eventID: 'EV-FAKE', adminEmail: 'admin@test.com' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('NOT_FOUND');
  });

  it('activates member and writes Payment-History', () => {
    // Seed member
    const memberRow = blankRow();
    memberRow[0] = 'A0001'; memberRow[4] = 'user@test.com'; memberRow[1] = 'not active';
    __seedSheet(MM, [blankRow(), memberRow]);

    // Seed event
    const eventRow = weHeader().map(() => '');
    eventRow[0] = 'EV-001'; eventRow[1] = 'MembershipRenewal'; eventRow[2] = new Date().toISOString();
    eventRow[3] = 'A0001'; eventRow[4] = 'user@test.com';
    eventRow[5] = 'Individual'; eventRow[6] = 30; eventRow[7] = 'Zelle';
    eventRow[8] = 'Test User'; eventRow[9] = 'A0001 2026'; eventRow[12] = 'Matched';
    __seedSheet(WE, [weHeader(), eventRow]);

    const res = JSON.parse(approveRenewal(req({ eventID: 'EV-001', adminEmail: 'admin@test.com', notes: '' })));
    expect(res.ok).toBe(true);
    expect(res.payload.periodEnd).toBeTruthy();

    // Member should be active
    const mmRows = __getSheet(MM);
    expect(mmRows[1][1]).toBe('active');

    // Payment-History should have a new row
    const phRows = __getSheet(PH);
    expect(phRows).toHaveLength(2);

    // Event status should be Approved
    const weRows = __getSheet(WE);
    expect(weRows[1][12]).toBe('Approved');
  });

  it('extends expiration from current if still active', () => {
    const futureExp = '2027-06-15'; // currently active member
    const memberRow = blankRow();
    memberRow[0] = 'A0001'; memberRow[4] = 'u@t.com'; memberRow[1] = 'active';
    memberRow[3] = futureExp;
    __seedSheet(MM, [blankRow(), memberRow]);

    const eventRow = weHeader().map(() => '');
    eventRow[0] = 'EV-002'; eventRow[1] = 'MembershipRenewal'; eventRow[2] = new Date().toISOString();
    eventRow[3] = 'A0001'; eventRow[4] = 'u@t.com';
    eventRow[5] = 'Individual'; eventRow[6] = 30; eventRow[7] = 'Zelle';
    eventRow[8] = 'User'; eventRow[9] = 'A0001'; eventRow[12] = 'Matched';
    __seedSheet(WE, [weHeader(), eventRow]);

    const res = JSON.parse(approveRenewal(req({ eventID: 'EV-002', adminEmail: 'admin@t.com' })));
    expect(res.ok).toBe(true);
    // New expiry should be at least 2028-06-15 (1 year past current 2027-06-15)
    const periodEnd = new Date(res.payload.periodEnd);
    expect(periodEnd.getFullYear()).toBeGreaterThanOrEqual(2028);
  });

  it('updates all family members for Family renewal', () => {
    const r1 = blankRow(); r1[0] = 'A0001'; r1[4] = 'p@t.com'; r1[1] = 'not active'; r1[8] = 'B001';
    const r2 = blankRow(); r2[0] = 'A0002'; r2[4] = 'c@t.com'; r2[1] = 'not active'; r2[8] = 'B001';
    __seedSheet(MM, [blankRow(), r1, r2]);

    const eventRow = weHeader().map(() => '');
    eventRow[0] = 'EV-003'; eventRow[1] = 'MembershipRenewal'; eventRow[2] = new Date().toISOString();
    eventRow[3] = 'A0001'; eventRow[4] = 'p@t.com';
    eventRow[5] = 'Family'; eventRow[6] = 50; eventRow[7] = 'Venmo';
    eventRow[8] = 'Parent'; eventRow[9] = 'B001 family 2026'; eventRow[12] = 'Matched';
    __seedSheet(WE, [weHeader(), eventRow]);

    const res = JSON.parse(approveRenewal(req({ eventID: 'EV-003', adminEmail: 'admin@t.com' })));
    expect(res.ok).toBe(true);
    const mmRows = __getSheet(MM);
    // Both family members should be active
    expect(mmRows[1][1]).toBe('active');
    expect(mmRows[2][1]).toBe('active');
  });
});

describe('rejectRenewal', () => {
  beforeEach(() => {
    __seedSheet(LOG, [[]]);
  });

  it('sets status to Rejected', () => {
    const eventRow = weHeader().map(() => '');
    eventRow[0] = 'EV-REJ'; eventRow[12] = 'Pending';
    __seedSheet(WE, [weHeader(), eventRow]);

    const res = JSON.parse(rejectRenewal(req({ eventID: 'EV-REJ', adminEmail: 'admin@t.com', notes: 'Payment not found' })));
    expect(res.ok).toBe(true);
    const weRows = __getSheet(WE);
    expect(weRows[1][12]).toBe('Rejected');
  });
});

describe('reconcileWebAppWithGmail', () => {
  beforeEach(() => {
    __seedSheet(LOG, [[]]);
    __seedSheet(CFG, [['Key', 'Value', 'Desc']]);
  });

  it('matches event to Gmail payment by last 4 digits', () => {
    const eventRow = weHeader().map(() => '');
    eventRow[0] = 'EV-REC'; eventRow[2] = new Date().toISOString();
    eventRow[3] = 'A0001'; eventRow[5] = 'Individual'; eventRow[6] = 30;
    eventRow[7] = 'Zelle'; eventRow[8] = 'Alice'; eventRow[10] = '5678'; eventRow[12] = 'Pending';
    __seedSheet(WE, [weHeader(), eventRow]);

    const fgHeader = ['TS','Sender','Amount','Memo','TxDate','TxNum','MsgId','Subj','OrigMemo','Notes','Processed','Source','WebAppEventID'];
    const fgRow = ['2026-01-01','Alice',30,'A0001 2026','2026-01-01','TX005678','MSG1','Zelle','','',false,'Zelle',''];
    __seedSheet(FG, [fgHeader, fgRow]);

    const res = JSON.parse(reconcileWebAppWithGmail());
    expect(res.ok).toBe(true);
    expect(res.payload.matchCount).toBe(1);

    // Event status should be Matched
    const weRows = __getSheet(WE);
    expect(weRows[1][12]).toBe('Matched');

    // Gmail row should be marked processed
    const fgRows = __getSheet(FG);
    expect(fgRows[1][10]).toBe(true);
  });
});

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
// Tests for sheets.ts — row mapping and sheet helpers

require('../src/types');
require('../src/config');
require('../src/sheets');

declare function findMemberByEmail(email: string): { member: any; rowIndex: number } | null;
declare function findMemberByID(id: string): { member: any; rowIndex: number } | null;
declare function findMembersByFamilyID(familyID: string): Array<{ member: any; rowIndex: number }>;
declare function generateMemberID(): string;
declare function appendPaymentRecord(record: any): string;
declare function appendOtpRecord(record: any): void;
declare function findValidOtp(email: string, code: string): { rowIndex: number } | null;
declare function markOtpUsed(rowIndex: number): void;
declare function getUnmatchedGmailPayments(): any[];
declare function __seedSheet(name: string, rows: any[][]): void;
declare function __getSheet(name: string): any[][];

const MM = 'Membership-Master-Main-3';
const OTP = 'Auth-OTP';
const PH = 'Payment-History';
const FG = 'Fetch-Gmail-data-in-Google-Spreadsheet-Active-4';

function blankRow(len = 23) { return new Array(len).fill(''); }

describe('findMemberByEmail', () => {
  it('returns null when sheet is empty', () => {
    __seedSheet(MM, [['MemberID', 'Status']]);
    expect(findMemberByEmail('test@gmail.com')).toBeNull();
  });

  it('finds member by email (case-insensitive)', () => {
    const row = blankRow();
    row[0] = 'A0001'; row[1] = 'active'; row[4] = 'Test@Gmail.Com';
    __seedSheet(MM, [blankRow(), row]);
    const result = findMemberByEmail('test@gmail.com');
    expect(result).not.toBeNull();
    expect(result!.member.memberID).toBe('A0001');
  });
});

describe('findMemberByID', () => {
  it('returns null for unknown ID', () => {
    __seedSheet(MM, [blankRow()]);
    expect(findMemberByID('A9999')).toBeNull();
  });

  it('finds by exact MemberID', () => {
    const row = blankRow();
    row[0] = 'A0042'; row[4] = 'foo@bar.com';
    __seedSheet(MM, [blankRow(), row]);
    const result = findMemberByID('A0042');
    expect(result!.member.email).toBe('foo@bar.com');
  });
});

describe('findMembersByFamilyID', () => {
  it('returns all members with same familyID', () => {
    const r1 = blankRow(); r1[0] = 'A0001'; r1[8] = 'B001';
    const r2 = blankRow(); r2[0] = 'A0002'; r2[8] = 'B001';
    const r3 = blankRow(); r3[0] = 'A0003'; r3[8] = 'B002';
    __seedSheet(MM, [blankRow(), r1, r2, r3]);
    const results = findMembersByFamilyID('B001');
    expect(results).toHaveLength(2);
    expect(results.map(r => r.member.memberID)).toContain('A0001');
    expect(results.map(r => r.member.memberID)).toContain('A0002');
  });
});

describe('generateMemberID', () => {
  it('returns A0001 for empty sheet', () => {
    __seedSheet(MM, [blankRow()]);
    expect(generateMemberID()).toBe('A0001');
  });

  it('increments past max existing ID', () => {
    const r1 = blankRow(); r1[0] = 'A0050';
    const r2 = blankRow(); r2[0] = 'A0023';
    __seedSheet(MM, [blankRow(), r1, r2]);
    expect(generateMemberID()).toBe('A0051');
  });
});

describe('OTP helpers', () => {
  it('findValidOtp returns null for expired OTP', () => {
    const past = new Date(Date.now() - 1000 * 60 * 60).toISOString();
    __seedSheet(OTP, [
      ['Email', 'Code', 'CreatedAt', 'ExpiresAt', 'Used', 'IP'],
      ['u@test.com', '123456', past, past, false, ''],
    ]);
    expect(findValidOtp('u@test.com', '123456')).toBeNull();
  });

  it('findValidOtp returns rowIndex for valid OTP', () => {
    const future = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    __seedSheet(OTP, [
      ['Email', 'Code', 'CreatedAt', 'ExpiresAt', 'Used', 'IP'],
      ['u@test.com', '654321', new Date().toISOString(), future, false, ''],
    ]);
    const result = findValidOtp('u@test.com', '654321');
    expect(result).not.toBeNull();
    expect(result!.rowIndex).toBe(2);
  });

  it('findValidOtp returns null for used OTP', () => {
    const future = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    __seedSheet(OTP, [
      ['Email', 'Code', 'CreatedAt', 'ExpiresAt', 'Used', 'IP'],
      ['u@test.com', '111111', new Date().toISOString(), future, true, ''],
    ]);
    expect(findValidOtp('u@test.com', '111111')).toBeNull();
  });
});

describe('appendPaymentRecord', () => {
  it('appends a row and returns a payment ID', () => {
    __seedSheet(PH, [['PaymentID']]);
    const id = appendPaymentRecord({
      eventID: 'EV-1', memberID: 'A0001', paymentDate: '2026-01-01',
      amount: 30, membershipType: 'Individual', paymentMethod: 'Zelle',
      payerName: 'Test', memoField: 'A0001 2026', last4Digits: '1234',
      transactionReference: '', periodStart: '2026-01-01', periodEnd: '2026-12-31',
      processedBy: 'admin@test.com', processedDate: '2026-01-01', source: 'WebApp', notes: '',
    });
    expect(id).toMatch(/^PY-/);
    const rows = __getSheet(PH);
    expect(rows).toHaveLength(2); // header + appended row
  });
});

describe('getUnmatchedGmailPayments', () => {
  it('returns only unprocessed rows', () => {
    __seedSheet(FG, [
      ['TS', 'Sender', 'Amount', 'Memo', 'TxDate', 'TxNum', 'MsgId', 'Subj', 'OrigMemo', 'Notes', 'Processed', 'Source', 'WebAppEventID'],
      ['2026-01-01', 'Alice', 30, 'A0001 2026', '2026-01-01', 'TX001', 'MSG1', 'Zelle', '', '', false, 'Zelle', ''],
      ['2026-01-02', 'Bob', 50, 'B001 2026', '2026-01-02', 'TX002', 'MSG2', 'Venmo', '', '', true, 'Venmo', 'EV-1'],
    ]);
    const results = getUnmatchedGmailPayments();
    expect(results).toHaveLength(1);
    expect(results[0].sender).toBe('Alice');
  });
});

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
    "types": ["jest", "node"],
    "outDir": "dist-test"
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}

```


