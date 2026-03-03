// ============================================================
// Core domain types
// ============================================================

interface Member {
  memberID: string;          // Axxxx
  status: 'active' | 'not active' | 'expired';
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

/// ADD this type
type PaymentIntent = 'Individual Renewal' | 'Family Renewal' | 'Family Upgrade';

// UPDATE WebAppEvent — replace membershipType with paymentIntent
interface WebAppEvent {
  eventID: string;
  eventType: string;
  timestamp: string;
  memberID: string;
  email: string;
  paymentIntent: PaymentIntent;   // ← was membershipType: string
  amount: number;
  paymentMethod: string;
  payerName: string;
  memoField: string;
  last4Digits: string;
  familyMemberEmails: string;
  status: 'Pending' | 'Matched' | 'Approved' | 'Rejected' | 'Error';
  matchedMessageId: string;
  matchedTransactionNumber: string;
  adminApprover: string;
  approvalDate: string;
  notes: string;
}

// UPDATE PaymentHistoryItem — replace membershipType with paymentIntent
interface PaymentHistoryItem {
  paymentID: string;
  eventID: string;
  paymentDate: string;
  amount: number;
  paymentIntent: PaymentIntent;   // ← was membershipType
  paymentMethod: string;
  payerName: string;
  periodStart: string;
  periodEnd: string;
  source: string;
  notes: string;
}

// ADD RenewalSubmitPayload — replace old payload interface
interface RenewalSubmitPayload {
  memberId: string;
  email: string;
  paymentIntent: PaymentIntent;   // ← was membershipType
  amount: number;
  paymentMethod: string;
  payerName: string;
  memoField: string;
  last4Digits?: string;
  familyMemberEmails?: string;
  sessionID: string;
}


interface PaymentRecord {
  paymentID: string;
  eventID: string;
  memberID: string;
  paymentDate: string;
  amount: number;
  paymentIntent: string;
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

// Payload for the pre-OTP email lookup
interface LookupEmailPayload {
  email: string;
  sessionID: string;
}

// Response for lookupEmail
interface LookupEmailResponse {
  found: boolean;
  firstName?: string;   // only present if found
  memberID?: string;    // only present if found
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

interface PaymentProof {
  eventID: string;
  timestamp: string;
  memberID: string;
  email: string;
  eventName: string;
  amount: number;
  paymentDate: string;
  payerName: string;
  last4Digits: string;
  notes: string;
  screenshotFileId: string;
  status: 'Pending Review' | 'Approved' | 'Rejected';
}

interface WebAppEventSummary {
  eventID:             string;
  eventType:           string;
  timestamp:           string;
  paymentIntent:       string;
  amount:              number;
  paymentMethod:       string;
  status:              'Pending' | 'Matched' | 'Approved' | 'Rejected' | 'Error';
  notes:               string;
}
