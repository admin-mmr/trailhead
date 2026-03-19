// ─── Member ──────────────────────────────────────────────────────────────────
export type MemberStatus = 'active' | 'inactive' | 'pending'
export type MembershipType = 'individual' | 'family'

export interface Member {
  id: number
  memberId: string          // MMR-2024-0042
  email: string
  chineseName?: string
  englishName?: string
  phone?: string
  wechatId?: string
  nyrrId?: string
  membershipType: MembershipType
  status: MemberStatus
  expiresAt?: string        // ISO date
  familyId?: number
  createdAt: string
}

export interface SessionUser {
  memberId: string
  email: string
  englishName?: string
  chineseName?: string
  status: MemberStatus
}

// ─── OTP ─────────────────────────────────────────────────────────────────────
export interface OtpRequest { email: string }
export interface OtpVerify  { email: string; code: string }

// ─── Payment ─────────────────────────────────────────────────────────────────
export type PaymentStatus = 'pending' | 'paid' | 'refunded'

export interface PaymentRecord {
  id: number
  memberId: string
  amount: number
  currency: string
  stripeSessionId: string
  membershipType: MembershipType
  status: PaymentStatus
  paidAt: string
}

// ─── NYRR ────────────────────────────────────────────────────────────────────
export interface NyrrEvent {
  id: number
  nyrrEventCode: string
  name: string
  date: string
  distance?: string
  status: 'upcoming' | 'completed' | 'pending'
}

export interface NyrrResult {
  id: number
  memberId: string
  nyrrEventCode: string
  eventName: string
  eventDate: string
  finishTime?: string        // HH:MM:SS
  pace?: string
  overallPlace?: number
  genderPlace?: number
  ageGroupPlace?: number
  distance?: string
}

// ─── Events (Club) ────────────────────────────────────────────────────────────
export interface ClubEvent {
  id: number
  titleEn: string
  titleZh?: string
  date: string
  location?: string
  descriptionEn?: string
  descriptionZh?: string
  imageUrl?: string
  registrationUrl?: string
  isPublished: boolean
}

// ─── Blog ─────────────────────────────────────────────────────────────────────
export type BlockType =
  | 'text' | 'heading' | 'image' | 'divider'
  | 'event-card' | 'race-results' | 'nyrr-embed'

export interface ContentBlock {
  id: string
  type: BlockType
  dataEn: string
  dataZh?: string
  meta?: Record<string, unknown>
}

export interface BlogPost {
  id: number
  slug: string
  titleEn: string
  titleZh?: string
  authorId?: string
  blocks: ContentBlock[]
  coverImageUrl?: string
  tags?: string[]
  isPublished: boolean
  publishedAt?: string
  createdAt: string
}

// ─── API Responses ────────────────────────────────────────────────────────────
export interface ApiOk<T = void>  { ok: true;  data: T }
export interface ApiErr           { ok: false; error: string }
export type ApiRes<T = void> = ApiOk<T> | ApiErr
