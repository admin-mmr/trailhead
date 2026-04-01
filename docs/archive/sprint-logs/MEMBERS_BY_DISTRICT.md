# Members by District Feature

## Overview

A new admin portal tab for group leaders to view, filter, and export members by district. Built to help inform runners about membership payment status.

## What's Included

### Backend

**File:** `mmr-admin/api_district_members.py`

Three Flask API endpoints:

1. **GET `/api/district/list`**
   - Filters members by district and status
   - Returns: MemberID, Name, Email, WeChat ID, Phone, District, Status, Last Login, Last Modified, Expiration
   - Query params: `district`, `status`, `limit`

2. **GET `/api/district/districts`**
   - Returns list of unique districts for dropdown
   - Useful for populating filter UI

3. **POST `/api/district/export-csv`**
   - Exports selected or all members in a district as CSV
   - Request body: `{ memberIds, includeAll, district }`
   - CSV columns: Member ID, Name, Email, WeChat ID, Phone, District, Status, Last Login, Last Modified, Expiration

### Frontend

**File:** `mmr-admin/templates/DistrictMembersPanel.js` (also copied to `static/`)

React component with:

- **District selector** — dropdown with all available districts
- **Status filter** — optional filter by Active/Not Active/Pending
- **Member table** with:
  - Checkbox selection (select all / individual)
  - 10 columns: Member ID, Name, WeChat ID, Email, Phone, District, Status (color-coded badge), Last Login, Modified, Expiration
  - Formatted dates (e.g., "Mar 29, 2026 14:22")
  - Hover highlighting for selected rows

- **Export buttons**:
  - "Export Selected" — downloads only checked members as CSV
  - "Export All in District" — downloads entire district regardless of selection

### Integration

**File changes:**
- `mmr-admin/app.py` — registered the new blueprint
- `mmr-admin/templates/index.html` — added script import + new "Members by District" tab in navigation

## How to Use

1. Click the **"Members by District"** tab in the admin portal
2. Select a **district** from the dropdown
3. (Optional) Filter by **Membership Status**
4. Members appear in table below
5. Check boxes to select members
6. Click **"Export Selected"** or **"Export All in District"** to download CSV

## Key Fields

- **Member ID** — unique identifier
- **Name** — full name (concatenated FirstName + LastName)
- **WeChat ID** — for group leader contact
- **Email** — for direct communication
- **Phone** — additional contact info
- **Status** — membership status (active/inactive/pending) with color coding
- **Last Login** — when member last accessed the app (helps identify active users)
- **Last Modified** — admin/member update timestamp
- **Expiration** — membership expiration date

## Database Queries

The feature uses existing `members` table columns:
- MemberID, FirstName, LastName, Email, WeChatID, PhoneNumber
- District, Status, LastLoginDate, LastUpdated, Expiration

No schema changes required.

## Testing Checklist

- [ ] Start admin portal: `nyrr` (or `python3 mmr-admin/app.py`)
- [ ] Navigate to "Members by District" tab
- [ ] Select a district → verify members appear
- [ ] Try status filters → verify filtering works
- [ ] Select multiple members → click "Export Selected" → verify CSV downloads
- [ ] Click "Export All in District" → verify entire district exports
- [ ] Open CSV in Excel/Sheets → verify formatting and all columns present

## Notes

- CSV files are named with timestamp: `members_YYYYMMDD_HHMMSS.csv`
- "Never" appears if Last Login is null
- Dates use ISO format (YYYY-MM-DD HH:MM)
- Component requires login (uses existing `@login_required` decorator)
- No special permissions required yet (can extend with role checks if needed)

---

**Last updated:** 2026-03-29
