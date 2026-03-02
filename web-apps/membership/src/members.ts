// ============================================================
// Member profile management
// Depends on: config.ts, sheets.ts, logger.ts
// Exposed GAS functions: getOrCreateMemberProfile, updateMemberProfile
// Internal: getOrCreateMemberByEmail (used by auth.ts)
// ============================================================

function getOrCreateMemberProfile(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<LoginPayload>;
  const { payload } = req;
  try {
    const email = payload.email.trim().toLowerCase();
    const result = getOrCreateMemberByEmail(email);
    // Optionally load family members for display
    let familyMembers: Member[] = [];
    if (result.member.familyID) {
      familyMembers = findMembersByFamilyID(result.member.familyID).map(r => r.member);
    }
    return jsonOk(req.requestId, { member: result.member, familyMembers });
  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

function updateMemberProfile(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<UpdateProfilePayload>;
  const { payload } = req;
  try {
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

    updateMemberRow(result.rowIndex, updates);
    auditLog('PROFILE_UPDATE', { memberID: payload.memberID, state: payload });

    const updated = findMemberByID(payload.memberID);
    return jsonOk(req.requestId, { member: updated?.member });
  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

// Internal: find or create a member record by email.
// Called by auth.ts after successful authentication.
function getOrCreateMemberByEmail(email: string): { member: Member; rowIndex: number } {
  const existing = findMemberByEmail(email);
  if (existing) return existing;

  // Create new inactive member
  const memberID = generateMemberID();
  const now = new Date().toISOString();
  const currentYear = String(new Date().getFullYear());

  const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
  const newRow: any[] = new Array(23).fill('');
  newRow[MM_COL.MEMBER_ID] = memberID;
  newRow[MM_COL.STATUS] = 'not active';
  newRow[MM_COL.CREATED] = now;
  newRow[MM_COL.EMAIL] = email;
  newRow[MM_COL.TYPE] = 'Individual';
  newRow[MM_COL.LAST_UPDATED] = now;
  newRow[MM_COL.JOIN_YEAR] = currentYear;
  newRow[MM_COL.LAST_LOGIN_DATE] = now;
  sheet.appendRow(newRow);

  auditLog('MEMBER_CREATED', { memberID, email });

  const created = findMemberByEmail(email);
  if (!created) throw new Error('Failed to create member record.');
  return created;
}
