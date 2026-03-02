// ============================================================
// Core domain types
// ============================================================

interface Member {
  memberID: string;          // Axxxx
  status: 'active' | 'not active';
  created: string;
  expiration: string;
  email: string;
  firstName: string;
  lastName: string;
  type: 'Individual' | 'Family';
  familyID: string;          // Bxxx or blank
  gender: string;
  wechatID: string;
  district: string;
  webApp: string;
  paymentCheckInfo: string;
  lastUpdated: string;
  membershipFeePaid: string;
  paymentDate: string;
  paymentTransaction: string;
  // New columns
  joinYear: string;
  phoneNumber: string;
  lastLoginDate: string;
  profileLastUpdated: string;
  notes: string;
}

interface WebAppEvent {
  eventID: string;
  eventType: 'MembershipRenewal' | 'MembershipSignup';
  timestamp: string;
  memberID: string;
  email: string;
  membershipType: 'Individual' | 'Family';
  amount: number;
  paymentMethod: 'Zelle' | 'Venmo' | 'PayPal';
  payerName: string;
  memoField: string;
  last4Digits: string;
  familyMemberEmails: string;  // comma-separated
  status: 'Pending' | 'Matched' | 'Approved' | 'Rejected' | 'Error';
  matchedMessageId: string;
  matchedTransactionNumber: string;
  adminApprover: string;
  approvalDate: string;
  notes: string;
}

interface PaymentRecord {
  paymentID: string;
  eventID: string;
  memberID: string;
  paymentDate: string;
  amount: number;
  membershipType: string;
  paymentMethod: string;
  payerName: string;
  memoField: string;
  last4Digits: string;
  transactionReference: string;
  periodStart: string;
  periodEnd: string;
  processedBy: string;
  processedDate: string;
  source: string;
  notes: string;
}

interface OtpRecord {
  email: string;
  otpCode: string;
  createdAt: string;
  expiresAt: string;
  used: boolean;
  ipAddress: string;
}

interface ActivityLogEntry {
  logID: string;
  timestamp: string;
  sessionID: string;
  memberID: string;
  email: string;
  eventID: string;
  action: string;
  state: string;
  errorCode: string;
  errorMessage: string;
}

interface ConfigMap {
  [key: string]: string;
}

interface FetchGmailRow {
  timestamp: string;
  sender: string;
  amount: number;
  memo: string;
  transactionDate: string;
  transactionNumber: string;
  messageId: string;
  subject: string;
  originalMemo: string;
  notes: string;
  processed: boolean;
  source: string;
  webAppEventID: string;
  rowIndex: number;
}

// ============================================================
// API envelope types
// ============================================================

interface ApiRequest<TPayload> {
  requestId: string;
  actorEmail?: string;
  payload: TPayload;
}

interface ApiResponseSuccess<TPayload> {
  ok: true;
  requestId: string;
  payload: TPayload;
}

interface ApiResponseError {
  ok: false;
  requestId: string;
  errorCode: string;
  errorMessage: string;
}

// ============================================================
// Payload types
// ============================================================

interface LoginPayload {
  email: string;
  sessionID: string;
}

interface OtpRequestPayload {
  email: string;
  sessionID: string;
}

interface OtpVerifyPayload {
  email: string;
  otpCode: string;
  sessionID: string;
}

interface UpdateProfilePayload {
  memberID: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  wechatID?: string;
  district?: string;
  joinYear?: string;
}

interface RenewalSubmitPayload {
  memberId: string;
  email: string;
  membershipType: 'Individual' | 'Family';
  amount: number;
  paymentMethod: 'Zelle' | 'Venmo' | 'PayPal';
  payerName: string;
  memoField: string;
  last4Digits?: string;
  familyMemberEmails?: string[];
  sessionID: string;
}

interface ApproveRenewalPayload {
  eventID: string;
  adminEmail: string;
  notes?: string;
}

interface RejectRenewalPayload {
  eventID: string;
  adminEmail: string;
  notes: string;
}
