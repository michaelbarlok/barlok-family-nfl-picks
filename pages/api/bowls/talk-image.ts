import type { NextApiRequest, NextApiResponse } from 'next'
import { isValidOrigin } from '@/lib/validation'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getAuthUser } from '@/lib/apiAuth'

export const config = { api: { bodyParser: { sizeLimit: '8mb' } } }
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

/**
 * POST { imageData (base64), contentType } — upload a photo for a Bowl Talk
 * message; returns its URL. Stored in the site's Talk photo bucket under a
 * bowls/ folder of its own. The page shrinks and converts photos first.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!isValidOrigin(req)) return res.status(403).json({ error: 'Invalid origin' })
  const user = await getAuthUser(req)
  if (!user) return res.status(401).json({ error: 'Sign in first' })
  const { imageData, contentType } = req.body ?? {}
  if (!imageData || !ALLOWED.includes(contentType)) return res.status(400).json({ error: 'Only JPEG, PNG, WebP and GIF images are allowed' })
  const supabase = getAdminClient()
  const { data: me } = await supabase.from('bowl_players').select('id').eq('id', user.id).maybeSingle()
  if (!me) return res.status(403).json({ error: "Join the Bowl Pick'em to post photos." })
  const buffer = Buffer.from(String(imageData), 'base64')
  if (buffer.length > 6 * 1024 * 1024) return res.status(400).json({ error: 'That photo is too large — try a smaller one' })
  const ext = contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1]
  const path = `bowls/${me.id}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`
  const { error } = await supabase.storage.from('talk-images').upload(path, buffer, { contentType, upsert: false })
  if (error) { console.error('bowls/talk-image error:', error); return res.status(500).json({ error: 'Failed to upload the photo' }) }
  return res.status(200).json({ url: supabase.storage.from('talk-images').getPublicUrl(path).data.publicUrl })
}
