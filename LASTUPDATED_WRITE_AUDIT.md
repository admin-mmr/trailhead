# LastUpdated Write Audit — GAS Code

All 8 locations where GAS writes the `LAST_UPDATED` column to Sheets. These are write points that need Unix timestamp counterparts.

---

## 📍 Location 1: `members.ts:51-54` — updateMemberProfile()
**Function:** `updateMemberProfile()` — user updates profile info (name, phone, WeChat, district, year)

```typescript
const now = new Date().toISOString();
const updates: Record<string, any> = {
  LAST_UPDATED: now,
  PROFILE_LAST_UPDATED: now,
};
// ... apply other field updates
updateMemberRow(result.rowIndex, updates);
```

**Pattern:** Sets via `updateMemberRow()` which uses `sheet.getRange(rowIndex, colIndex).setValue()`

**Needs:** `LAST_UPDATED_UNIX` column, set to `toUnixTimestamp(now)` (or pass unix directly to updateMemberRow)

---

## 📍 Location 2: `members.ts:102-117` — createNewMember()
**Function:** `createNewMember()` — new member registration

```typescript
const now = new Date().toISOString();
const newRow: any[] = new Array(23).fill('');
newRow[MM_COL.MEMBER_ID] = memberID;
newRow[MM_COL.STATUS] = 'inactive';
newRow[MM_COL.CREATED] = now;
// ...
newRow[MM_COL.LAST_UPDATED] = now;
newRow[MM_COL.LAST_LOGIN_DATE] = now;
sheet.appendRow(newRow);
```

**Pattern:** Builds array, sets via `sheet.appendRow()`

**Needs:** Add `MM_COL.LAST_UPDATED_UNIX` to newRow array

---

## 📍 Location 3: `family.ts:101` — createFamily()
**Function:** `createFamily()` — user creates family membership and adds member

```typescript
const updates = {
  FAMILY_ID: familyId,
  TYPE: 'Family',
  STATUS: 'pending_upgrade',
  LAST_UPDATED: now,
};
updateMemberRow(headMemberIndex, updates);
```

**Pattern:** Via `updateMemberRow()`

**Needs:** Add `LAST_UPDATED_UNIX` to updates object

---

## 📍 Location 4: `family.ts:169` — addMemberToFamily()
**Function:** `addMemberToFamily()` — adding a new member to existing family

```typescript
const updates = {
  FAMILY_ID: familyId,
  TYPE: 'Family',
  LAST_UPDATED: now,
};
updateMemberRow(memberIndex, updates);
```

**Pattern:** Via `updateMemberRow()`

**Needs:** Add `LAST_UPDATED_UNIX` to updates object

---

## 📍 Location 5: `dues.ts:186` — markMembershipPaid()
**Function:** `markMembershipPaid()` — membership fee payment received (dashboard "Paid" button)

```typescript
const now = new Date().toISOString();
const updates = {
  MEMBERSHIP_FEE_PAID: amount,
  PAYMENT_DATE: paymentDateISO,
  LAST_UPDATED: now,
};
updateMemberRow(memberIndex, updates);
```

**Pattern:** Via `updateMemberRow()`

**Needs:** Add `LAST_UPDATED_UNIX` to updates object

---

## 📍 Location 6: `dues.ts:287` — approvePendingMembership()
**Function:** `approvePendingMembership()` — admin approval of membership upgrade (mmr-admin webhook)

```typescript
const now = new Date().toISOString();
const newExpiration = newExpirationDate ? dateToISOString(newExpirationDate) : expirationDate;

const updates = {
  STATUS: 'active',
  TYPE: membershipType,
  EXPIRATION: newExpiration,
  MEMBERSHIP_FEE_PAID: amountFormatted,
  PAYMENT_DATE: now,
  LAST_UPDATED: now,
};
updateMemberRow(memberIndex, updates);
```

**Pattern:** Via `updateMemberRow()`

**Needs:** Add `LAST_UPDATED_UNIX` to updates object

---

## 📍 Location 7: `jobs.ts:265` — markMembershipsExpired()
**Function:** `markMembershipsExpired()` — scheduled job that marks expired memberships as inactive

```typescript
const now = new Date().toISOString();
// Inside loop over members:
sheet.getRange(i + 1, MM_COL.STATUS + 1).setValue('inactive');
sheet.getRange(i + 1, MM_COL.LAST_UPDATED + 1).setValue(now);
```

**Pattern:** Direct `sheet.getRange().setValue()`

**Needs:** Add `sheet.getRange(i + 1, MM_COL.LAST_UPDATED_UNIX + 1).setValue(toUnixTimestamp(now))`

---

## 📍 Location 8: `jobs.ts:734` — normalizeExpirationDateFormats()
**Function:** `normalizeExpirationDateFormats()` — scheduled job that reformats malformed dates

```typescript
const now = new Date().toISOString();
// Inside loop over members:
sheet.getRange(i + 1, MM_COL.EXPIRATION + 1).setValue(isoDate);
sheet.getRange(i + 1, MM_COL.LAST_UPDATED + 1).setValue(now);
```

**Pattern:** Direct `sheet.getRange().setValue()`

**Needs:** Add `sheet.getRange(i + 1, MM_COL.LAST_UPDATED_UNIX + 1).setValue(toUnixTimestamp(now))`

---

## 📍 Location 9: `upgrade.ts:53` — initiateUpgrade()
**Function:** `initiateUpgrade()` — user initiates membership upgrade from Individual → Family

```typescript
const now = new Date().toISOString();
const updates = {
  FAMILY_ID: newFamilyId,
  TYPE: 'Family',
  STATUS: 'pending_upgrade',
  LAST_UPDATED: now,
};
updateMemberRow(memberIndex, updates);
```

**Pattern:** Via `updateMemberRow()`

**Needs:** Add `LAST_UPDATED_UNIX` to updates object

---

## 📍 Location 10: `upgrade.ts:161` — addHouseholdMember()
**Function:** `addHouseholdMember()` — add new household member during upgrade

```typescript
const now = new Date().toISOString();
const updates = {
  FAMILY_ID: familyId,
  TYPE: 'Family',
  LAST_UPDATED: now,
};
updateMemberRow(memberIndex, updates);
```

**Pattern:** Via `updateMemberRow()`

**Needs:** Add `LAST_UPDATED_UNIX` to updates object

---

## 📍 Location 11: `upgrade.ts:254` — approveUpgrade()
**Function:** `approveUpgrade()` — admin approval of family upgrade

```typescript
const now = new Date().toISOString();
const updates = {
  STATUS: 'active',
  EXPIRATION: newExpiration,
  MEMBERSHIP_FEE_PAID: amountStr,
  PAYMENT_DATE: now,
  LAST_UPDATED: now,
};
updateMemberRow(memberIndex, updates);
```

**Pattern:** Via `updateMemberRow()`

**Needs:** Add `LAST_UPDATED_UNIX` to updates object

---

## 📍 Location 12: `webhook.ts:739` — handlePaymentApproved()
**Function:** `handlePaymentApproved()` — legacy webhook action, syncs from mmr-admin

```typescript
const updates = {
  [MM_COL.EXPIRATION]:          payload.newExpiration || '',
  [MM_COL.TYPE]:                payload.membershipType || '',
  [MM_COL.STATUS]:              'active',
  [MM_COL.MEMBERSHIP_FEE_PAID]: payload.amount || '',
  [MM_COL.PAYMENT_DATE]:        new Date().toISOString(),
  [MM_COL.PAYMENT_TRANSACTION]: payload.transactionRef || '',
  [MM_COL.LAST_UPDATED]:        new Date().toISOString(),
};
updateMemberWithLog(mid, updates);
```

**Pattern:** Via `updateMemberWithLog()`

**Needs:** Add `MM_COL.LAST_UPDATED_UNIX` to updates object

---

## Summary

| File | Count | Pattern | Affected Functions |
|------|-------|---------|-------------------|
| `members.ts` | 2 | Via `updateMemberRow()` and `appendRow()` | updateMemberProfile(), createNewMember() |
| `family.ts` | 2 | Via `updateMemberRow()` | createFamily(), addMemberToFamily() |
| `dues.ts` | 2 | Via `updateMemberRow()` | markMembershipPaid(), approvePendingMembership() |
| `jobs.ts` | 2 | Direct `sheet.getRange().setValue()` | markMembershipsExpired(), normalizeExpirationDateFormats() |
| `upgrade.ts` | 3 | Via `updateMemberRow()` | initiateUpgrade(), addHouseholdMember(), approveUpgrade() |
| `webhook.ts` | 1 | Via `updateMemberWithLog()` | handlePaymentApproved() |

**Total: 12 write locations**

---

## Implementation Strategy

### Option A: Add Unix column to Sheets + Update all 12 locations
1. Add `LAST_UPDATED_UNIX` as MM_COL.26 (or append column)
2. Update each of 12 locations to also set Unix timestamp
3. Minimal change per location (1 line per write pattern)

### Option B: Centralize in updateMemberRow()
1. Modify `updateMemberRow()` to auto-calculate and set Unix timestamp
2. Any caller using `updates: { LAST_UPDATED: now }` auto-gets Unix version
3. Only need to update direct `sheet.getRange()` calls (jobs.ts × 2)
4. **Cleaner but requires careful refactoring**

### Option C: Hybrid
1. Use B for `updateMemberRow()` calls (covers 10 locations)
2. Manually update direct calls in `jobs.ts` (2 locations)
3. **Best balance of safety and cleanliness**
