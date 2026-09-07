import type { NextApiRequest, NextApiResponse } from 'next'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getAuthUser } from '@/lib/apiAuth'
import { isValidOrigin } from '@/lib/validation'

export const config = { api: { bodyParser: { sizeLimit: '8mb' } } }

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

/**
 * Upload one photo for a Talk message and return its public URL.
 *
 * Separate from posting so the image is already in storage by the time the
 * message is created — a failed upload then costs an empty message rather than
 * a message pointing at nothing. The browser compresses and converts HEIC
 * before this is called, so only web-safe types arrive.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!isValidOrigin(req)) return res.status(403).json({ error: 'Invalid origin' })

  const authUser = await getAuthUser(req)
  if (!authUser) return res.status(401).json({ error: 'Unauthorized' })

  const { imageData, contentType } = req.body ?? {}
  if (!imageData || !contentType) {
    return res.status(400).json({ error: 'imageData and contentType are required' })
  }
  if (!ALLOWED.includes(contentType)) {
    return res.status(400).json({ error: 'Only JPEG, PNG, WebP and GIF images are allowed' })
  }

  try {
    const buffer = Buffer.from(imageData, 'base64')
    if (buffer.length > 6 * 1024 * 1024) {
      return res.status(400).json({ error: 'That photo is too large — try a smaller one' })
    }

    const ext = contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1]
    // Foldered by author, random filename — messages are never edited to point
    // at a different image, so nothing is ever overwritten.
    const filePath = `${authUser.id}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`

    const supabase = getAdminClient()
    const { error: uploadError } = await supabase.storage
      .from('talk-images')
      .upload(filePath, buffer, { contentType, upsert: false })

    if (uploadError) {
      if (uploadError.message?.toLowerCase().includes('bucket')) {
        return res.status(500).json({
          error: 'The talk-images storage bucket does not exist yet. Run supabase/migrations/13_talk.sql.',
        })
      }
      throw uploadError
    }

    const { data } = supabase.storage.from('talk-images').getPublicUrl(filePath)
    return res.status(200).json({ url: data.publicUrl })
  } catch (err) {
    console.error('talk-image error:', err)
    return res.status(500).json({ error: 'Failed to upload the photo' })
  }
}
