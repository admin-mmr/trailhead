# Payment Event Matching Fix — Option A (Direct Approval)

## Issue
When you manually link a pending event to a transaction using the **Manual Event Matching Modal**, the event status changes to 'matched'. However, clicking "Approve Selected" afterward still shows the modal with *different* unmatched events instead of approving the linked pair directly.

## Root Cause
Line 1073 in `mmr-admin/static/payments.js` was configured to *always* open the manual match modal when "Approve Selected" was clicked:
```javascript
onClick: () => setShowManualMatch(true)  // ❌ Always opens modal
```

This meant the button was used for both:
- Linking pending events (manual matching)
- Approving matched events

These are two different workflows and shouldn't share the same button.

## Solution (Option A)
Changed the button to call `handleApproveSelected()` directly, which:
1. Approves the matched event immediately without a modal
2. Updates the database status to 'approved'
3. Reloads the event list

**Before:**
```javascript
singleSelectedId && e('button', { className: 'btn btn-green', onClick: () => setShowManualMatch(true), ... }, '✓ Approve Selected')
```

**After:**
```javascript
singleSelectedId && e('button', { className: 'btn btn-green', onClick: handleApproveSelected, disabled: loading || selectedMatchedCount === 0, ... }, '✓ Approve Selected')
```

## Workflow Now
1. **Manual Match (pending → matched):** Click event → click gmail transaction → click "Manual Match" or "Approve Pending (Batch)" → select pair in modal → "Approve & Link"
2. **Quick Approve (matched → approved):** Select a matched event → click "Approve Selected" → **direct approval, no modal**
3. **Bulk Approve (all matched):** Click "Approve All Matched" → approve all at once

## Files Changed
- `mmr-admin/static/payments.js` (line 1073)

## Testing
1. Manually link a pending event to a transaction (modal flow)
2. The event status should change to 'matched'
3. Select the matched event
4. Click "Approve Selected"
5. ✅ Should approve directly without showing the modal
