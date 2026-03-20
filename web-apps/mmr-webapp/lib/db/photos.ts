/**
 * photos.ts — Photo pipeline DB helpers
 * All queries against the v2 migration tables.
 */

import pool from './connection'
import type {
  Photo, PhotoEvent, PhotoDetection,
  MemberReferencePhoto, BibAssignment,
} from '@/types'

// Maximum number of ACTIVE reference photos per member.
// When exceeded, the oldest active ref is auto-deactivated (still stored, not used).
export const MAX_ACTIVE_REFS = 20

// Freshness threshold: refs older than this get a UI warning (in days)
export const REF_FRESHNESS_WARN_DAYS = 3 * 365  // 3 years

// ─────────────────────────────────────────────────────────────
// Photo Events (albums)
// ─────────────────────────────────────────────────────────────

export async function getAllPhotoEvents(): Promise<PhotoEvent[]> {
  const [rows] = await pool.query<any[]>(
    `SELECT event_id, name_en, name_zh, event_date, sync_status,
            photos_total, photos_analyzed, nyrr_event_code
     FROM photo_events
     WHERE sync_status = 'done'
     ORDER BY event_date DESC`
  )
  return rows.map(rowToPhotoEvent)
}

export async function getPhotoEvent(eventId: string): Promise<PhotoEvent | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT * FROM photo_events WHERE event_id = ?`, [eventId]
  )
  return rows[0] ? rowToPhotoEvent(rows[0]) : null
}

function rowToPhotoEvent(r: any): PhotoEvent {
  return {
    eventId:        r.event_id,
    nameEn:         r.name_en  ?? r.event_id,
    nameZh:         r.name_zh  ?? undefined,
    eventDate:      r.event_date ? String(r.event_date).slice(0,10) : undefined,
    syncStatus:     r.sync_status,
    photosTotal:    r.photos_total,
    photosAnalyzed: r.photos_analyzed,
    nyrrEventCode:  r.nyrr_event_code ?? undefined,
  }
}

// ─────────────────────────────────────────────────────────────
// Photos
// ─────────────────────────────────────────────────────────────

// Allowed sort values → SQL ORDER BY clause
// Aggregate sorts (stars, comments) use subqueries so the main list stays efficient
export type PhotoSortKey = 'date_asc' | 'date_desc' | 'rating' | 'stars' | 'comments'

const SORT_SQL: Record<PhotoSortKey, string> = {
  date_asc:  'p.taken_at ASC,  p.photo_id ASC',
  date_desc: 'p.taken_at DESC, p.photo_id DESC',
  rating:    '(SELECT AVG(rating) FROM photo_feedback WHERE photo_id = p.photo_id) DESC, p.taken_at DESC',
  stars:     '(SELECT COUNT(*)   FROM photo_favorites  WHERE photo_id = p.photo_id) DESC, p.taken_at DESC',
  comments:  '(SELECT COUNT(*)   FROM photo_feedback   WHERE photo_id = p.photo_id AND story IS NOT NULL AND story != "") DESC, p.taken_at DESC',
}

function sortClause(sort?: string): string {
  return SORT_SQL[(sort as PhotoSortKey) ?? ''] ?? SORT_SQL.date_desc
}

/** Photos in an album, with detections + viewer-specific state */
export async function getPhotosByEvent(
  eventId: string,
  viewerMemberId: string,
  page = 1,
  pageSize = 40,
  sort?: string
): Promise<Photo[]> {
  const offset = (page - 1) * pageSize
  const [rows] = await pool.query<any[]>(
    `SELECT p.*,
            pe.name_en AS event_name_en,
            (f.photo_id IS NOT NULL) AS is_favorite
     FROM photos p
     JOIN photo_events pe ON pe.event_id = p.event_id
     LEFT JOIN photo_favorites f
            ON f.photo_id = p.photo_id AND f.member_id = ?
     WHERE p.event_id = ?
     ORDER BY ${sortClause(sort)}
     LIMIT ? OFFSET ?`,
    [viewerMemberId, eventId, pageSize, offset]
  )
  return attachDetectionsAndFeedback(rows, viewerMemberId)
}

/** Photos matched to a specific member (My Photos tab / friend lookup) */
export async function getPhotosByMember(
  targetMemberId: string,
  viewerMemberId: string,
  page = 1,
  pageSize = 40,
  sort?: string
): Promise<Photo[]> {
  const offset = (page - 1) * pageSize
  const [rows] = await pool.query<any[]>(
    `SELECT DISTINCT p.*,
            pe.name_en AS event_name_en,
            (f.photo_id IS NOT NULL) AS is_favorite
     FROM photos p
     JOIN photo_events pe ON pe.event_id = p.event_id
     JOIN photo_detections d ON d.photo_id = p.photo_id
     LEFT JOIN photo_favorites f
            ON f.photo_id = p.photo_id AND f.member_id = ?
     WHERE d.matched_member_id = ? AND d.is_wrong = FALSE
     ORDER BY ${sortClause(sort)}
     LIMIT ? OFFSET ?`,
    [viewerMemberId, targetMemberId, pageSize, offset]
  )
  return attachDetectionsAndFeedback(rows, viewerMemberId)
}

/** Photos the viewer has favorited */
export async function getFavoritePhotos(
  memberId: string,
  page = 1,
  pageSize = 40,
  sort?: string
): Promise<Photo[]> {
  const offset = (page - 1) * pageSize
  // For favorites, default sort is when they were starred — override only for explicit sort
  const orderBy = sort ? sortClause(sort) : 'fv.created_at DESC'
  const [rows] = await pool.query<any[]>(
    `SELECT p.*, pe.name_en AS event_name_en, TRUE AS is_favorite
     FROM photo_favorites fv
     JOIN photos p ON p.photo_id = fv.photo_id
     JOIN photo_events pe ON pe.event_id = p.event_id
     WHERE fv.member_id = ?
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`,
    [memberId, pageSize, offset]
  )
  return attachDetectionsAndFeedback(rows, memberId)
}

async function attachDetectionsAndFeedback(
  photoRows: any[],
  viewerMemberId: string
): Promise<Photo[]> {
  if (!photoRows.length) return []
  const photoIds = photoRows.map(r => r.photo_id)
  const placeholders = photoIds.map(() => '?').join(',')

  const [detRows] = await pool.query<any[]>(
    `SELECT d.*,
            CONCAT(m.FirstName, ' ', m.LastName) AS matched_name
     FROM photo_detections d
     LEFT JOIN members m ON m.MemberID = d.matched_member_id
     WHERE d.photo_id IN (${placeholders})
     ORDER BY d.photo_id, d.person_index`,
    photoIds
  )

  const [fbRows] = await pool.query<any[]>(
    `SELECT photo_id, rating, story
     FROM photo_feedback
     WHERE member_id = ? AND photo_id IN (${placeholders})`,
    [viewerMemberId, ...photoIds]
  )

  const detsByPhoto = groupBy(detRows, 'photo_id')
  const fbByPhoto   = Object.fromEntries(fbRows.map(r => [r.photo_id, r]))

  return photoRows.map(r => ({
    photoId:      r.photo_id,
    eventId:      r.event_id,
    eventNameEn:  r.event_name_en,
    blobThumbUrl: r.blob_thumb_url,
    photographer: r.photographer,
    takenAt:      r.taken_at ? String(r.taken_at) : undefined,
    widthPx:      r.width_px,
    heightPx:     r.height_px,
    qualityScore: r.quality_score,
    peopleCount:  r.people_count,
    detections:   (detsByPhoto[r.photo_id] ?? []).map(rowToDetection),
    isFavorite:   Boolean(r.is_favorite),
    myFeedback:   fbByPhoto[r.photo_id]
      ? { rating: fbByPhoto[r.photo_id].rating, story: fbByPhoto[r.photo_id].story }
      : undefined,
  }))
}

function rowToDetection(r: any): PhotoDetection {
  return {
    id:               r.id,
    personIndex:      r.person_index,
    bibNormalized:    r.bib_normalized ?? undefined,
    bibConfidence:    r.bib_confidence ?? undefined,
    faceBbox:         r.face_bbox  ? JSON.parse(r.face_bbox)  : undefined,
    headYaw:          r.head_yaw   ?? undefined,
    headPitch:        r.head_pitch ?? undefined,
    hasGlasses:       r.has_glasses ?? undefined,
    hasHat:           r.has_hat    ?? undefined,
    faceOccluded:     r.face_occluded ?? undefined,
    matchedMemberId:  r.matched_member_id ?? undefined,
    matchedName:      r.matched_name ?? undefined,
    matchScore:       r.match_score ?? undefined,
    matchMethod:      r.match_method ?? undefined,
    isWrong:          Boolean(r.is_wrong),
  }
}

// ─────────────────────────────────────────────────────────────
// Favorites
// ─────────────────────────────────────────────────────────────

export async function toggleFavorite(memberId: string, photoId: string): Promise<boolean> {
  const [existing] = await pool.query<any[]>(
    `SELECT 1 FROM photo_favorites WHERE member_id = ? AND photo_id = ?`,
    [memberId, photoId]
  )
  if (existing.length) {
    await pool.query(
      `DELETE FROM photo_favorites WHERE member_id = ? AND photo_id = ?`,
      [memberId, photoId]
    )
    return false // now un-favorited
  } else {
    await pool.query(
      `INSERT INTO photo_favorites (member_id, photo_id) VALUES (?, ?)`,
      [memberId, photoId]
    )
    return true  // now favorited
  }
}

// ─────────────────────────────────────────────────────────────
// Feedback (rating + story)
// ─────────────────────────────────────────────────────────────

export async function upsertFeedback(
  memberId: string,
  photoId: string,
  rating?: number,
  story?: string
): Promise<void> {
  await pool.query(
    `INSERT INTO photo_feedback (photo_id, member_id, rating, story)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       rating = COALESCE(VALUES(rating), rating),
       story  = COALESCE(VALUES(story),  story),
       updated_at = NOW()`,
    [photoId, memberId, rating ?? null, story ?? null]
  )
}

// ─────────────────────────────────────────────────────────────
// Detection corrections
// ─────────────────────────────────────────────────────────────

export async function submitCorrection(
  detectionId: number,
  reportedBy: string,
  correctionType: 'wrong_person' | 'correct_person' | 'missing_person',
  suggestedMemberId?: string,
  note?: string
): Promise<void> {
  // Mark detection as wrong immediately (optimistic)
  if (correctionType === 'wrong_person') {
    await pool.query(
      `UPDATE photo_detections
       SET is_wrong = TRUE, wrong_reported_by = ?, wrong_reported_at = NOW()
       WHERE id = ?`,
      [reportedBy, detectionId]
    )
  }
  await pool.query(
    `INSERT INTO photo_detection_corrections
       (detection_id, reported_by, correction_type, suggested_member_id, note)
     VALUES (?, ?, ?, ?, ?)`,
    [detectionId, reportedBy, correctionType, suggestedMemberId ?? null, note ?? null]
  )
}

// ─────────────────────────────────────────────────────────────
// Reference photos
// ─────────────────────────────────────────────────────────────

export async function addReferencePhoto(
  memberId: string,
  blobUrl: string,
  opts: {
    photoId?:      string
    detectionId?:  number
    photoTakenAt?: string    // ISO datetime or date string
    source?:       'event_crop' | 'direct_upload'
    originalFilename?: string
  } = {}
): Promise<number> {
  const { photoId, detectionId, photoTakenAt, source = 'event_crop', originalFilename } = opts

  // Auto-deactivate oldest active ref(s) if at limit
  const [activeRows] = await pool.query<any[]>(
    `SELECT id FROM member_reference_photos
     WHERE member_id = ? AND is_active = TRUE
     ORDER BY added_at ASC`,
    [memberId]
  )
  if (activeRows.length >= MAX_ACTIVE_REFS) {
    const toDeactivate = activeRows.slice(0, activeRows.length - MAX_ACTIVE_REFS + 1)
    const ids = toDeactivate.map((r: any) => r.id)
    await pool.query(
      `UPDATE member_reference_photos
       SET is_active = FALSE, deactivated_at = NOW(), deactivated_reason = 'auto_aged_out'
       WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids
    )
  }

  const [result] = await pool.query<any>(
    `INSERT INTO member_reference_photos
       (member_id, photo_id, detection_id, blob_url, source, photo_taken_at, original_filename)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [memberId, photoId ?? null, detectionId ?? null, blobUrl, source,
     photoTakenAt ?? null, originalFilename ?? null]
  )
  return result.insertId
}

export async function getMemberReferencePhotos(memberId: string): Promise<MemberReferencePhoto[]> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, photo_id, blob_url, source, photo_taken_at, added_at, is_active
     FROM member_reference_photos
     WHERE member_id = ? AND is_active = TRUE
     ORDER BY added_at DESC`,
    [memberId]
  )
  const warnMs = REF_FRESHNESS_WARN_DAYS * 24 * 60 * 60 * 1000
  const now    = Date.now()
  return rows.map(r => {
    const takenAt = r.photo_taken_at ? new Date(r.photo_taken_at).getTime() : null
    const isFresh = takenAt === null ? true : (now - takenAt) < warnMs
    return {
      id:            r.id,
      photoId:       r.photo_id ?? undefined,
      blobUrl:       r.blob_url ?? undefined,
      source:        r.source as 'event_crop' | 'direct_upload',
      photoTakenAt:  r.photo_taken_at ? String(r.photo_taken_at) : undefined,
      addedAt:       String(r.added_at),
      isActive:      Boolean(r.is_active),
      isFresh,
    }
  })
}

export async function removeReferencePhoto(memberId: string, refId: number): Promise<void> {
  await pool.query(
    `UPDATE member_reference_photos
     SET is_active = FALSE, deactivated_at = NOW(), deactivated_reason = 'user_removed'
     WHERE id = ? AND member_id = ?`,
    [refId, memberId]
  )
}

// ─────────────────────────────────────────────────────────────
// Bib assignments
// ─────────────────────────────────────────────────────────────

export async function getMemberBibAssignments(memberId: string): Promise<BibAssignment[]> {
  const [rows] = await pool.query<any[]>(
    `SELECT b.*, pe.name_en AS event_name_en
     FROM member_bib_assignments b
     JOIN photo_events pe ON pe.event_id = b.event_id
     WHERE b.member_id = ?
     ORDER BY pe.event_date DESC`,
    [memberId]
  )
  return rows.map(r => ({
    id:            r.id,
    eventId:       r.event_id,
    eventNameEn:   r.event_name_en,
    bibNumber:     r.bib_number,
    source:        r.source,
    adminReviewed: Boolean(r.admin_reviewed),
    createdAt:     String(r.created_at),
  }))
}

export async function upsertBibAssignment(
  memberId: string,
  eventId: string,
  bibNumber: string,
  source: 'member_self' | 'nyrr_auto' | 'admin_import' = 'member_self'
): Promise<void> {
  await pool.query(
    `INSERT INTO member_bib_assignments (member_id, event_id, bib_number, source)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE member_id = VALUES(member_id), source = VALUES(source)`,
    [memberId, eventId, bibNumber, source]
  )
}

// ─────────────────────────────────────────────────────────────
// Member search (for friend lookup + tag suggestions)
// ─────────────────────────────────────────────────────────────

export async function searchMembers(query: string, limit = 10) {
  const q = `%${query}%`
  const [rows] = await pool.query<any[]>(
    `SELECT MemberID, FirstName, LastName, Status
     FROM members
     WHERE (MemberID LIKE ? OR FirstName LIKE ? OR LastName LIKE ?)
       AND Status = 'active'
     LIMIT ?`,
    [query, q, q, limit]  // exact MemberID match first via LIKE fallback
  )
  return rows.map(r => ({
    memberId:  r.MemberID,
    firstName: r.FirstName,
    lastName:  r.LastName,
    status:    r.Status,
  }))
}

// ─────────────────────────────────────────────────────────────
// Invite
// ─────────────────────────────────────────────────────────────

export async function createTagInvite(
  detectionId: number,
  requestedBy: string,
  inviteEmail: string,
  note?: string
): Promise<void> {
  await pool.query(
    `INSERT INTO photo_tag_invites (detection_id, requested_by, invite_email, note)
     VALUES (?, ?, ?, ?)`,
    [detectionId, requestedBy, inviteEmail, note ?? null]
  )
}

// ─────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────

function groupBy<T>(arr: T[], key: keyof T): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const k = String(item[key])
    if (!acc[k]) acc[k] = []
    acc[k].push(item)
    return acc
  }, {} as Record<string, T[]>)
}
