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
    if (!email) {
      return jsonError(req.requestId, 'AUTH_FAILED', 'Could not retrieve your Google account. Please make sure you are signed in.');
    }
    auditLog('LOGIN_START', { sessionID: payload.sessionID, email });
    const result = getOrCreateMemberByEmail(email);
    updateMemberRow(result.rowIndex, { LAST_LOGIN_DATE: new Date().toISOString() });
    auditLog('LOGIN_SUCCESS', { sessionID: payload.sessionID, email, memberID: result.member.memberID });
    return jsonOk(req.requestId, { member: result.member });
  } catch (e: any) {
    auditLog('ERROR', { sessionID: payload.sessionID, email: payload.email, errorMessage: String(e) });
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

function requestEmailOtp(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<OtpRequestPayload>;
  const { payload } = req;
  try {
    const email = payload.email.trim().toLowerCase();
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

    auditLog('OTP_REQUESTED', { sessionID: payload.sessionID, email });
    return jsonOk(req.requestId, { message: 'Code sent. Please check your email.' });
  } catch (e: any) {
    auditLog('ERROR', { sessionID: payload.sessionID, email: payload.email, errorMessage: String(e) });
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

function verifyEmailOtp(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<OtpVerifyPayload>;
  const { payload } = req;
  try {
    const email = payload.email.trim().toLowerCase();
    const match = findValidOtp(email, payload.otpCode.trim());
    if (!match) {
      auditLog('OTP_VERIFY_FAIL', { sessionID: payload.sessionID, email });
      return jsonError(req.requestId, 'INVALID_OTP', 'Invalid or expired code. Please try again.');
    }
    markOtpUsed(match.rowIndex);
    const result = getOrCreateMemberByEmail(email);
    updateMemberRow(result.rowIndex, { LAST_LOGIN_DATE: new Date().toISOString() });
    auditLog('OTP_VERIFY_SUCCESS', { sessionID: payload.sessionID, email, memberID: result.member.memberID });
    return jsonOk(req.requestId, { member: result.member });
  } catch (e: any) {
    auditLog('ERROR', { sessionID: payload.sessionID, email: payload.email, errorMessage: String(e) });
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
