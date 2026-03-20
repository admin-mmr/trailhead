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

// ─── Photos ───────────────────────────────────────────────────────────────────

export interface PhotoEvent {
  eventId:        string          // e.g. "20260315-nyc-half"
  nameEn:         string
  nameZh?:        string
  eventDate?:     string          // ISO date
  syncStatus:     'pending' | 'syncing' | 'done' | 'error'
  photosTotal:    number
  photosAnalyzed: number
  nyrrEventCode?: string
}

export interface FaceBbox {
  x: number; y: number; w: number; h: number
}

export interface PhotoDetection {
  id:               number
  personIndex:      number
  bibNormalized?:   string
  bibConfidence?:   number
  faceBbox?:        FaceBbox
  headYaw?:         number
  headPitch?:       number
  hasGlasses?:      boolean
  hasHat?:          boolean
  faceOccluded?:    number
  matchedMemberId?: string
  matchedName?:     string        // joined from members table
  matchScore?:      number
  matchMethod?:     'auto' | 'manual' | 'bib_only' | 'face_only' | 'user_confirmed'
  isWrong:          boolean
}

export interface Photo {
  photoId:        string
  eventId:        string
  eventNameEn?:   string
  blobThumbUrl?:  string
  photographer?:  string
  takenAt?:       string
  widthPx?:       number
  heightPx?:      number
  qualityScore?:  number
  peopleCount?:   number
  detections:     PhotoDetection[]
  // viewer-specific (joined per request)
  isFavorite?:    boolean
  myFeedback?:    PhotoFeedback
}

export interface PhotoFeedback {
  rating?:  number              // 1–5
  story?:   string
}

export interface MemberReferencePhoto {
  id:             number
  photoId?:       string        // null for direct_upload
  blobUrl?:       string
  source:         'event_crop' | 'direct_upload'
  photoTakenAt?:  string        // when the photo was taken (EXIF or user input)
  addedAt:        string
  isActive:       boolean
  isFresh:        boolean       // false if photoTakenAt > REF_FRESHNESS_WARN_DAYS old
}

export interface BibAssignment {
  id:           number
  eventId:      string
  eventNameEn?: string
  bibNumber:    string
  source:       'nyrr_auto' | 'member_self' | 'admin_import'
  adminReviewed: boolean
  createdAt:    string
}

export interface DetectionCorrection {
  detectionId:        number
  correctionType:     'wrong_person' | 'correct_person' | 'missing_person'
  suggestedMemberId?: string
  note?:              string
}

// ─── API Responses ────────────────────────────────────────────────────────────
export interface ApiOk<T = void>  { ok: true;  data: T }
export interface ApiErr           { ok: false; error: string }
export type ApiRes<T = void> = ApiOk<T> | ApiErr
