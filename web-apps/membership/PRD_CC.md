# Misty Mountain Runners Membership Web App — Product Requirements Document

_Last updated: 2026-03-02_

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
   - Found → load member record, proceed to dashboard.
   - Not found → create new inactive member with new MemberID, prompt to complete profile.

#### 3.2.2 Email OTP Login

Target: non-Gmail users (Yahoo, Hotmail, QQ, corporate, etc.).

Flow:
1. User enters email, selects "Login via Email Code".
2. System generates 6-digit OTP, reads `OTP_Valid_Hours` (default 24) from Config.
3. Writes row to `Auth-OTP`: Email, OTPCode, CreatedAt, ExpiresAt, Used=FALSE.
4. Sends OTP via `MailApp.sendEmail`.
5. User enters OTP on site.
6. System verifies: matching Email+OTPCode, not expired, not Used.
7. If valid: mark Used=TRUE, proceed to same profile lookup as Google OAuth.
8. Cleanup: scheduled script deletes OTP rows older than `OTP_Cleanup_Days` (default 7).

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
