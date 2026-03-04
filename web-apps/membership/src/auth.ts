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

(globalThis as any).lookupEmail      = lookupEmail;
(globalThis as any).requestEmailOtp  = requestEmailOtp;
(globalThis as any).verifyEmailOtp   = verifyEmailOtp;
(globalThis as any).handleGoogleLogin = handleGoogleLogin;