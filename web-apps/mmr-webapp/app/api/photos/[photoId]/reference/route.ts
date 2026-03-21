import { NextRequest, NextResponse } from 'next/server'
import { requireActiveMember } from '@/lib/auth/session'
import { addReferencePhoto } from '@/lib/db/photos'
import pool from '@/lib/db/connection'

// POST /api/photos/[photoId]/reference
// Body: { detectionId: number }
// Crops the face bbox from the photo, uploads to Blob, stores in member_reference_photos.
export async function POST(
  req: NextRequest,
  { params }: { params: { photoId: string } }
) {
  const session = await requireActiveMember()
  const { detectionId } = await req.json()

  if (!detectionId)
    return NextResponse.json({ ok: false, error: 'detectionId required' }, { status: 400 })

  // Verify the detection belongs to this photo and is matched to this member
  const [rows] = await pool.query<any[]>(
    `SELECT d.id, d.face_bbox, p.blob_thumb_url
     FROM photo_detections d
     JOIN photos p ON p.photo_id = d.photo_id
     WHERE d.id = ? AND d.photo_id = ?
       AND (d.matched_member_id = ? OR d.matched_member_id IS NULL)
       AND d.is_wrong = FALSE`,
    [detectionId, params.photoId, session.memberId]
  )

  if (!rows.length)
    return NextResponse.json({ ok: false, error: 'Detection not found or not yours' }, { status: 404 })

  // Use the full thumbnail URL as the reference blob URL for now.
  // In production, the pipeline would crop just the face bbox from the image.
  // The nightly match.py will load this URL, crop the bbox, and re-encode the embedding.
  const blobUrl = rows[0].blob_thumb_url ?? ''

  const refId = await addReferencePhoto(session.memberId, blobUrl, {
    photoId:     params.photoId,
    detectionId: Number(detectionId),
    source:      'event_crop',
  })
  return NextResponse.json({ ok: true, data: { refId } })
}
