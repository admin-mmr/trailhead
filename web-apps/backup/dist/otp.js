"use strict";
function findValidOtp(email, otpCode) {
    const sheet = getSheet('OTP');
    const otps = sheet.getDataRange().getValues();
    const now = new Date();
    // Iterate backwards to find the most recent OTP
    for (let i = otps.length - 1; i > 0; i--) {
        const row = otps[i];
        const record = {
            email: row[0],
            otpCode: String(row[1]),
            createdAt: row[2],
            expiresAt: row[3],
            used: row[4],
            ipAddress: row[5],
        };
        if (record.email.toLowerCase() === email.toLowerCase() &&
            record.otpCode === otpCode &&
            !record.used &&
            new Date(record.expiresAt) > now) {
            return {
                rowIndex: i + 1,
                otp: record,
            };
        }
    }
    return null;
}
function findValidOtpByEmail(email) {
    const sheet = getSheet('OTP');
    const otps = sheet.getDataRange().getValues();
    const now = new Date();
    // Iterate backwards to find the most recent OTP
    for (let i = otps.length - 1; i > 0; i--) {
        const row = otps[i];
        const record = {
            email: row[0],
            otpCode: String(row[1]),
            createdAt: row[2],
            expiresAt: row[3],
            used: row[4],
            ipAddress: row[5],
        };
        if (record.email.toLowerCase() === email.toLowerCase() &&
            !record.used &&
            new Date(record.expiresAt) > now) {
            return {
                rowIndex: i + 1,
                otp: record,
            };
        }
    }
    return null;
}
function appendOtpRecord(otp) {
    const sheet = getSheet('OTP');
    sheet.appendRow([
        otp.email,
        otp.otpCode,
        otp.createdAt,
        otp.expiresAt,
        otp.used,
        otp.ipAddress,
    ]);
}
function markOtpUsed(rowIndex) {
    const sheet = getSheet('OTP');
    sheet.getRange(rowIndex, 5).setValue(true);
}
