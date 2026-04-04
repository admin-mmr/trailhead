# Payments Tab UI Layout — Visual Guide

## Overall Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MMR Admin Portal                                   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─ Payments Tab ──────────────────────────────────────────────────────────────┐
│                                                                              │
│  [📊 Dashboard Stats]                                                        │
│  ┌─────────────────┬──────────────┬──────────┬─────────────┬─────┬────────┐ │
│  │ Pending    │ Matched │ Unmatched  │ Approved │ ...         │      │
│  │ Events: 3  │ Gmail:5 │ Gmail:2    │ (30d):42 │ ...         │      │
│  └─────────────────┴──────────────┴──────────┴─────────────┴─────┴────────┘ │
│                                                                              │
│  ┌──────────────────────────────┬────────────────────────────────────────┐  │
│  │    SUBMISSIONS PANEL         │       GMAIL TRANSACTIONS PANEL          │  │
│  │    (420px fixed)             │       (flex: 1, grows)                 │  │
│  ├──────────────────────────────┼────────────────────────────────────────┤  │
│  │ Submissions (3)              │ [◀ Hide] Gmail (8)                     │  │
│  ├──────────────────────────────┼────────────────────────────────────────┤  │
│  │ [✓] A0123 Membership   $30   │ Radio │ Sender  │ Amount │ Memo │ Date│  │
│  │     John Smith pending  1h   │  ◉    │ john@   │ $30    │ Pay  │Apr1 │  │
│  │                              │       │ ...     │        │ ...  │     │  │
│  │ [✓] A0456 Family       $50   │  ○    │ jane@   │ $50    │ A045 │Apr2 │  │
│  │     Jane Doe    matched 2h   │       │ ...     │        │ 6    │     │  │
│  │                              │       │         │        │      │     │  │
│  │ [✓] A0789 Membership   $30   │  ○    │ bob@    │ $30    │ Pay  │Apr3 │  │
│  │     Bob Johnson pending 3d   │       │ ...     │        │ment  │     │  │
│  │                              │       │         │        │      │     │  │
│  └──────────────────────────────┴────────────────────────────────────────┘  │
│                                                                              │
│  Left column shows:                Right column shows:                       │
│  • Selection checkboxes            • Radio buttons (single select)           │
│  • MemberID (hoverable → tooltip)  • Match context badge (when focused)     │
│  • Member name                     • Sender (resizable column)              │
│  • Payment intent                  • Amount                                 │
│  • Amount                          • Memo + MemberID chip (resizable)       │
│  • Status badge                    • Transaction date                       │
│  • Submission date                 • Transaction number                     │
│                                    • Action button (⚡ Quick or + Create)   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Interactive Features

### 1. MemberID Hover (Tooltip)

```
User hovers over "A0123" in submissions table or Gmail memo
                    ↓
         ┌─────────────────────┐
         │  John Smith (A0123) │
         │                     │
         │ Expires: Mar 15 2025│
         │ Type: Individual    │
         │ Email: john@...     │
         │ WeChat: john_wx     │
         │ Gender: M           │
         │ District: Queens    │
         └─────────────────────┘
```

**Technical:**
- Tooltip appears at cursor location, adjusts to viewport
- Data cached after first fetch (no redundant API calls)
- `_memberCache` module-level object persists across re-renders
- API endpoint: `GET /api/payments/member-quick/{memberID}`

---

### 2. Submission Focus (Filter Gmail)

```
User clicks submission row "A0123 Membership $30"
                    ↓
Row highlights with yellow left border
                    ↓
Gmail table header changes:
  FROM: "Gmail (8)"
  TO:   "🔍 Candidates for A0123 | $30 · Membership | [✕ Clear]"
                    ↓
Gmail table shows only candidates for this submission
(unmatched + related transactions)
                    ↓
Each row tagged with match context:
  ✓ LINKED      (already matched to this member)
  ⚠ PROCESSED   (processed but not for this member)
  ~ CANDIDATE   (potential match)
```

**Technical:**
- API endpoint: `GET /api/payments/gmail-candidates/{submissionID}`
- Returns unmatched + related Gmail transactions filtered by member name/ID
- Click row again (or [✕ Clear] button) to deselect and show all Gmail

---

### 3. Quick-Approve Popover

```
User clicks "⚡ Quick" button on Gmail row with MemberID in memo
                    ↓
Popover appears:
  ┌───────────────────────────────────────────┐
  │ ⚡ Quick Approve Payment          [✕]     │
  ├───────────────────────────────────────────┤
  │ Sender: john@gmail.com                    │
  │ Amount: $30 · Date: Apr 1                 │
  │ Memo: A0123 renewal payment               │
  ├───────────────────────────────────────────┤
  │ Find Member                               │
  │ [Search by name, email, WeChat, A####... ] │
  │  → Jane Doe (A0456) · Individual · Mar 2025│
  │  → John Smith (A0123) · Individual · Mar 15│
  ├───────────────────────────────────────────┤
  │ Member ID                                 │
  │ [Dropdown: A0123, ─── Enter manually ──] │
  │ OR                                        │
  │ [Input: A0123_____________]               │
  │                                           │
  │ ✅ John Smith (A0123)                     │
  │ Expires: Mar 15 2025                      │
  │ WeChat: john_wx                           │
  ├───────────────────────────────────────────┤
  │ Payment Type                              │
  │ [Dropdown: Individual Membership v]       │
  ├───────────────────────────────────────────┤
  │ [✓ Approve as Individual Membership]      │
  └───────────────────────────────────────────┘
```

**Features:**
- Auto-extract MemberID from Gmail memo (regex: `\bA\d{4}\b`)
- Fuzzy search: name, email, WeChat ID, MemberID all searchable
- Member preview card updates on selection
- Payment intent selector (Individual Membership, Family, etc.)

**Technical:**
- API endpoints:
  - `GET /api/payments/member-quick/all` → All members (for search)
  - `GET /api/payments/member-quick/{memberID}` → Member details
  - `POST /api/payments/admin-create` → Create payment
- Fuzzy match logic: case-insensitive, space-separated AND logic

---

### 4. Full-Width Toggle

```
Normal mode (Side-by-side):
┌──────────────┬────────────────────────────┐
│  Submissions │ Gmail [◀ Hide]             │
│ (420px)      │ (flex: 1)                  │
└──────────────┴────────────────────────────┘

User clicks [◀ Hide]
                ↓

Expanded mode (Gmail full-width):
┌────────────────────────────────────────┐
│ Gmail [▶ Show]                         │
│ (full width, max 1400px?)              │
└────────────────────────────────────────┘

User clicks [▶ Show]
                ↓

Back to side-by-side
```

**Technical:**
- State: `showSubmissions` (true/false)
- CSS: `flex: 0 0 420px` when visible, `display: none` when hidden
- Right panel grows with `flex: 1`

---

### 5. Column Resizing (Gmail Table)

```
User sees column headers with resize handles:

│ Sender             │  Amount  │  Memo                    │  Date  │
        ⬅ drag ➡️                    ⬅ drag ➡️

Cursor changes to col-resize cursor (↔)
User drags right edge of "Sender" column
                ↓
Column width updates smoothly
Other columns shift/reflow
Width persists in component state (until page reload)
```

**Technical:**
- Implementation: `useEffect` listener on `mousemove` while resizing
- Min width: 80px per column
- State: `colWidths = {sender: 120, memo: 200}` (pixels)
- DOM: Div with `cursor: col-resize` at column edge

---

## Status Badges (Color Coding)

```
[pending]  — Yellow    (awaiting action)
[matched]  — Accent    (found a match)
[approved] — Green     (approved & completed)
[rejected] — Red       (rejected by admin)
[error]    — Red       (processing error)
```

Each badge is a styled `<span>` with:
- Background: `color + '22'` (22% opacity)
- Border: `color + '44'` (33% opacity)
- Text: Full color

---

## Data Flow

### Loading Data on Mount
```
useEffect(() => {
  loadAll()
})

loadAll():
  GET /api/payments/dashboard          → setStats
  GET /api/payments/pending-submissions → setPendingSubmissions
  GET /api/payments/unmatched-gmail    → setUnmatchedGmail
```

### On Submission Focus
```
handleSubmissionFocus(submissionId):
  if (already focused) { clear focus; return }

  SET focusedSubmissionId = submissionId
  SET gmailCandidates = null
  SET candidatesLoading = true

  GET /api/payments/gmail-candidates/{submissionId}
  → SET gmailCandidates = response
  → SET candidatesLoading = false
```

### On Quick-Approve
```
handleApprove():
  Validate memberId matches /^A\d{4}$/

  POST /api/payments/admin-create
  {
    memberId: "A0123",
    messageId: "gmail_message_id",
    paymentIntent: "Individual Membership",
    notes: "Quick-approved from unmatched Gmail..."
  }

  On success:
    → closePopover()
    → loadAll() (reload dashboard + tables)
    → showToast("✓ Approved...")
```

---

## Component Hierarchy

```
PaymentsPanel (main)
├─ MemberTooltip (fixed position, rendered at root level)
├─ StatsCards (dashboard stats)
├─ [Left side]
│  └─ PendingSubmissionsTable
│     ├─ MemberIdChip (hoverable)
│     └─ Badge (status)
└─ [Right side]
   └─ GmailTable
      ├─ MatchCtxBadge (candidate filter mode)
      ├─ MemberIdChip (hoverable memo field)
      ├─ GmailQuickApprovePopover (opens on button click)
      │  ├─ Fuzzy search input
      │  ├─ Search results list
      │  ├─ MemberID selector
      │  └─ Member preview card
      └─ Action buttons (⚡ Quick or + Create)
```

---

## Key Keyboard Shortcuts

(Currently none implemented, but could be added:)
- `Escape` — Close popover / clear focus
- `Ctrl+Shift+A` — Quick-approve selected
- `Ctrl+F` — Focus search (for member name)

---

## Accessibility Features

- [x] Checkbox selection (submit bulk actions)
- [x] Radio buttons (single Gmail row selection)
- [x] Semantic HTML (table, thead, tbody, tr, td)
- [x] Title attributes (on hover reveals full values)
- [x] Color + icons (not color-only status indication)
- [ ] ARIA labels (would be nice to add)
- [ ] Keyboard navigation (currently mouse-only)

---

## Notes

- **No localStorage:** Column widths reset on page reload
- **No scroll sync:** Left/right panels scroll independently
- **Small tooltips:** Max 320px width, smart positioning (above/below)
- **Popover anchors:** Relative to button, stays within viewport
- **Performance:** Member cache prevents redundant API calls, fuzzy search limited to 10 results

