# Google Sheets Setup Checklist — NYRR Pipeline

_Complete these steps before running the pipeline for the first time._

---

## Architecture Decision: Two separate Sheets files

- **Membership file** (existing): `Membership-Master-Main-3` and all
  existing tabs. Leave this file as-is except for the two new columns
  added to the Master tab (Step 2 below).
- **NYRR data file** (new): Create a fresh Sheets file called
  `MMR-NYRR-Data`. It holds three tabs. The pipeline writes here;
  the membership portal reads from it via `SpreadsheetApp.openById()`.

**Why separate?** NYRR results will grow large (hundreds of rows per event
× many events). Keeping it separate protects the membership file's
performance and prevents pipeline bugs from touching member records.

---

## Step 1 — Create the new NYRR data Sheets file

- [ ] Open Google Sheets → New spreadsheet.
- [ ] Rename it: `MMR-NYRR-Data`.
- [ ] Copy the Spreadsheet ID from the URL
      (`https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`).
- [ ] Keep this ID handy — you'll paste it into the membership Config tab
      in Step 3.

---

## Step 2 — Add tabs to `MMR-NYRR-Data`

### Tab 1: `NYRR-Events`

- [ ] Rename the default "Sheet1" tab to `NYRR-Events`.
- [ ] In **Row 1**, add these headers (one per column, A through N):

| A | B | C | D | E | F | G | H | I | J | K | L | M | N |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| NYRREventID | EventCode | EventName | EventURL | Location | Distance | EventDate | EventYear | IsUpcoming | ProcessingStatus | ProcessedTimestamp | ProcessedBy | ResultCount | Notes |

- [ ] Freeze Row 1 (View → Freeze → 1 row).
- [ ] Format Column G (`EventDate`) as Plain Text to avoid auto-formatting.
- [ ] Format Column I (`IsUpcoming`) as Plain Text (will hold TRUE/FALSE strings).

### Tab 2: `NYRR-Results`

- [ ] Add a new tab named `NYRR-Results`.
- [ ] In **Row 1**, add these headers (A through R):

| A | B | C | D | E | F | G | H | I | J | K | L | M | N | O | P | Q | R |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ResultID | NYRREventID | EventName | EventDate | NYRRMemberID | RunnerName | Age | Gender | State | FinishTime | Pace | BibNumber | OverallPlace | GenderPlace | IsMMRClub | MMRMemberID | IsRegisteredOnly | ScanTimestamp |

- [ ] Freeze Row 1.
- [ ] Format Column D (`EventDate`) and Column R (`ScanTimestamp`) as Plain Text.
- [ ] Format Columns O and Q (`IsMMRClub`, `IsRegisteredOnly`) as Plain Text.

### Tab 3: `NYRR-ProcessingLog`

- [ ] Add a new tab named `NYRR-ProcessingLog`.
- [ ] In **Row 1**, add these headers (A through K):

| A | B | C | D | E | F | G | H | I | J | K |
|---|---|---|---|---|---|---|---|---|---|---|
| LogID | RunTimestamp | TriggeredBy | NYRREventID | EventName | RunStatus | RowsWritten | ErrorDetails | VerifiedBy | VerifiedTimestamp | Notes |

- [ ] Freeze Row 1.

---

## Step 3 — Update the Membership Config tab

Open the existing membership Sheets file → `Config` tab.

- [ ] Add a new row with:
  - **Key**: `NYRRDataSheetId`
  - **Value**: _(paste the Spreadsheet ID from Step 1)_
  - **Description**: `Spreadsheet ID of the MMR-NYRR-Data file`

- [ ] Add these rows (if not already present from PRDv5):

| Key | Default Value | Description |
|---|---|---|
| `NYRRClubName` | `Misty Mountain Runners` | Club name used in NYRR event search |
| `NYRRResultsBaseURL` | `https://results.nyrr.org` | Base URL for NYRR API calls |
| `NYRRBatchSize` | `10` | Events processed per scheduled run |
| `NYRRSleepMs` | `2000` | ms between API requests |

---

## Step 4 — Add NYRR columns to Membership-Master-Main-3

Open the existing membership Sheets file → `Membership-Master-Main-3` tab.

- [ ] Scroll to the last column (currently ends at `Notes`).
- [ ] Add **Column X** (or next available): header `NYRRMemberID`
      (plain text — the runner's NYRR member ID, self-reported).
- [ ] Add **Column Y** (next): header `NYRRMemberName`
      (plain text — their NYRR display name if different from MMR name).
- [ ] Update `MEMBER_COL` constants in `src/config.ts` to match the
      actual 0-based column indices of these new columns.

---

## Step 5 — Add corresponding columns to Membership-Master-Log

Open `Membership-Master-Log` tab.

- [ ] Add `NYRRMemberID` and `NYRRMemberName` columns at the same
      positions as in the Main tab. The log copies rows verbatim, so
      all columns must stay in sync.

---

## Step 6 — Set up the GAS project for the pipeline

- [ ] Go to [script.google.com](https://script.google.com) → New project.
- [ ] Name it: `MMR-NYRR-Pipeline`.
- [ ] In **Project Settings** → Script Properties, add:
  - Key: `MEMBERSHIP_SHEET_ID`
  - Value: _(Spreadsheet ID of the main membership file)_
- [ ] Push the TypeScript source via CLASP (`clasp push`).
- [ ] Open the script editor, run `setupTriggers()` once to register
      the weekly and daily time-based triggers.
- [ ] Verify triggers appear under **Triggers** (clock icon) in the GAS UI.

---

## Step 7 — Discover real NYRR API endpoints (REQUIRED before first run)

The `src/nyrrApi.ts` file has placeholder URLs marked with `// PLACEHOLDER`.
You must confirm the real endpoints before the pipeline can run.

- [ ] Open [results.nyrr.org](https://results.nyrr.org) in Chrome.
- [ ] Open DevTools → **Network** tab → filter by **Fetch/XHR**.
- [ ] Navigate to a past event's finishers page. Look for a JSON XHR
      request that returns a list of runners. Note:
      - Full URL (including query parameters for pagination/club filter)
      - Response JSON shape (field names for runnerId, finishTime, etc.)
- [ ] Navigate to a runner profile page. Find the XHR that returns their
      race history. Note the endpoint pattern.
- [ ] Navigate to an upcoming event page. Check if the registrant endpoint
      differs from the finishers endpoint.
- [ ] Navigate to **Club Standings** → search for Misty Mountain Runners
      to find the club search endpoint/parameter name.
- [ ] Update `src/nyrrApi.ts` with the confirmed URLs and response shapes.
- [ ] Update `src/types.ts` `NyrrApiFinisher` / `NyrrApiRunnerResult`
      field names to match actual JSON keys.

---

## Step 8 — First run: backfill historical data

- [ ] Run `manuallyProcessEvent(eventCode, adminEmail)` from the script
      editor for a few recent events to verify data flows end-to-end.
- [ ] Confirm rows appear in `NYRR-Events`, `NYRR-Results`, and
      `NYRR-ProcessingLog`.
- [ ] Run `matchNyrrResultsToMembers()` to back-fill `MMRMemberID` on
      any matched rows.
- [ ] Spot-check: find a known MMR member in `NYRR-Results` and confirm
      their `MMRMemberID` is correctly set.

---

## Step 9 — Sharing / permissions

- [ ] Share `MMR-NYRR-Data` with the same Google account that owns the
      GAS pipeline project (Editor access).
- [ ] If the membership portal GAS script is a different project, also
      share `MMR-NYRR-Data` with the membership portal's service account
      (Viewer access is sufficient for read-only history queries).
