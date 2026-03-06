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
  const payload = req.payload;
  try {
    const email = payload.email.trim().toLowerCase();

    // 1. Resolve member
    const found = findMemberByEmail(email);
    if (!found) return jsonError(req.requestId, 'MEMBER_NOT_FOUND', 'Member not found.');
    const member = found.member;
    const memberID = member.memberID;

    // 2. Expand to family scope: self + anyone sharing the same FamilyID
    let allMemberIDs: string[] = [memberID];
    if (member.familyID) {
      const familyMembers = getMembersByFamilyID(member.familyID);
      const familyIDs = familyMembers
        .map(m => m.memberID)
        .filter(id => id !== memberID);
      allMemberIDs = [memberID, ...familyIDs];
    }

    // 3. Gather data across entire family scope
    const payments = allMemberIDs.flatMap(id => getPaymentHistoryByMemberID(id));
    const events   = allMemberIDs.flatMap(id => getWebAppEventsByMemberID(id));

    auditLog('PAYMENTHISTORY_VIEW', { sessionID: payload.sessionID, memberID });

    // Return memberID so frontend knows who "self" is (to label family entries)
    return jsonOk(req.requestId, { memberID, payments, events });
  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

(globalThis as any).getOrCreateMemberProfile  = getOrCreateMemberProfile;
(globalThis as any).updateMemberProfile       = updateMemberProfile;
(globalThis as any).getMemberPaymentHistory   = getMemberPaymentHistory;
(globalThis as any).createNewMember            = createNewMember;            // ← 