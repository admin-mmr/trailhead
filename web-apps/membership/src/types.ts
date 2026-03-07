// ============================================================
// Core domain types
// ============================================================

interface Member {
  memberID: string;          // Axxxx
  status: 'active' | 'inactive' | 'pending_upgrade';
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
  paymentCheck: string;
  info: string;
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

// PaymentIntent describes the financial transaction type
type PaymentIntent = 'Individual Membership' | 'Family Membership' | 'Family Upgrade';

// EventType aligns with the action that triggered the event
type EventType =
  | 'dues_payment'          // Regular dues submission (Individual or Family)
  | 'family_switch'         // Individual switching to Family (full dues, triggered by initiateSwitch)
  | 'family_upgrade'        // Individual upgrading to Family mid-cycle (delta, triggered by initiateUpgrade)
  | 'membership_application'// New member application
  | 'admin_request';        // Admin-initiated event

interface WebAppEvent {
  eventID: string;
  eventType: EventType | string;
  timestamp: string;
  expiresAt: string;         // Timestamp + PaymentProofReviewDays; after this, event auto-expires
  memberID: string;
  email: string;
  paymentIntent: PaymentIntent;
  amount: number;
  paymentMethod: string;
  payerName: string;
  memoField: string;
  last4Digits: string;
  familyMemberEmails: string;
  status: 'Pending' | 'Matched' | 'Approved' | 'Rejected' | 'Expired' | 'Error';
  matchedMessageId: string;
  matchedTransactionNumber: string;
  adminApprover: string;
  approvalDate: string;
  notes: string;
  // Payment-proof fields (populated when user attaches a proof to this event)
  paymentDate?: string;
  screenshotFileId?: string;
  gdriveFilePath?: string;
  ocrText?: string;
  ocrTimestamp?: string;
}

interface PaymentHistoryItem {
  paymentID: string;
  eventID: string;
  paymentDate: string;
  amount: number;
  paymentIntent: PaymentIntent;
  paymentMethod: string;
  payerName: string;
  periodStart: string;
  periodEnd: string;
  source: string;
  notes: string;
  memoField: string;
}

// Payload for submitting dues (Pay Dues flow — no pre-existing event)
interface DuesSubmitPayload {
  memberId: string;
  email: string;
  paymentIntent: PaymentIntent;
  amount: number;
  paymentMethod: string;
  payerName: string;
  memoField: string;
  last4Digits?: string;
  familyMemberEmails?: string;
  sessionID: string;
}

// Keep old name as alias for backward compat with any callers
type RenewalSubmitPayload = DuesSubmitPayload;

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

interface Otp {
  email: string;
  otpCode: string;
  createdAt: string;
  expiresAt: string;
  used: boolean;
  ipAddress: string;
}

interface OtpMatch {
  rowIndex: number;
  otp: Otp;
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

interface LookupEmailPayload {
  email: string;
  sessionID: string;
}

interface LookupEmailResponse {
  found: boolean;
  firstName?: string;
  memberID?: string;
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
  // NOTE: Type is intentionally excluded — type changes go through upgrade.ts only
}

interface ApproveDuesPayload {
  eventID: string;
  adminEmail: string;
  notes?: string;
}

// Keep old name as alias
type ApproveRenewalPayload = ApproveDuesPayload;

interface RejectDuesPayload {
  eventID: string;
  adminEmail: string;
  notes: string;
}

// Keep old name as alias
type RejectRenewalPayload = RejectDuesPayload;

// Payload for initiating Switch to Family (full dues)
interface InitiateSwitchPayload {
  memberID: string;
  email: string;
  sessionID: string;
}

// Payload for initiating Upgrade to Family (delta payment, mid-cycle)
interface InitiateUpgradePayload {
  memberID: string;
  email: string;
  sessionID: string;
}

// Payload for cancelling a pending upgrade
interface CancelUpgradePayload {
  memberID: string;
  email: string;
  sessionID: string;
}

// Payload for family member management
interface FamilyMemberPayload {
  memberID: string;       // Acting member (must be Family type)
  targetEmail: string;    // Email of member to add/remove
  sessionID: string;
}

interface WebAppEventSummary {
  eventID:             string;
  eventType:           string;
  timestamp:           string;
  paymentIntent:       string;
  amount:              number;
  paymentMethod:       string;
  status:              'Pending' | 'Matched' | 'Approved' | 'Rejected' | 'Expired' | 'Error';
  notes:               string;
  memoField:           string;
  // Payment-proof fields
  paymentDate:         string;
  screenshotFileId:    string;
  gdriveFilePath:      string;
  ocrText:             string;
  ocrTimestamp:        string;
}
