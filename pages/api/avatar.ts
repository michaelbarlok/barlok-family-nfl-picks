import type { NextApiRequest, NextApiResponse } from 'next'
import { ADMIN_EMAIL } from '@/lib/constants'
import { isValidOrigin } from '@/lib/validation'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getAuthUser } from '@/lib/apiAuth'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4mb',
    },
  },
}

/**
 * Who may change whose photo.
 *
 * Yourself, always. An admin, anyone. And a manager may set the photo of a
 * managed player they pick for — that player has no account, so if their
 * manager can't do it, only an admin can, and the person who actually knows
 * them is locked out.
 */
async function canEditAvatar(
  supabase: ReturnType<typeof getAdminClient>,
  caller: { id: string; email?: string },
  targetUserId: string,
): Promise<boolean> {
  if (targetUserId === caller.id) return true
  if (caller.email === ADMIN_EMAIL) return true

  const { data: callerRow } = await supabase
    .from('users').select('is_admin, is_manager').eq('id', caller.id).maybeSingle()
  if (callerRow?.is_admin === true) return true
  if (callerRow?.is_manager !== true) return false

  const { data: target } = await supabase
    .from('users').select('is_managed').eq('id', targetUserId).maybeSingle()
  if (target?.is_managed !== true) return false

  const { data: link } = await supabase
    .from('player_managers').select('player_id')
    .eq('manager_id', caller.id).eq('player_id', targetUserId).maybeSingle()
  return !!link
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isValidOrigin(req)) return res.status(403).json({ error: 'Invalid origin' })

  const authUser = await getAuthUser(req)
  if (!authUser) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = getAdminClient()

  // POST: Upload avatar (base64 image in body)
  if (req.method === 'POST') {
    const { userId, imageData, contentType } = req.body

    if (!imageData || !contentType) {
      return res.status(400).json({ error: 'imageData and contentType are required' })
    }

    // Validate content type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
    if (!allowedTypes.includes(contentType)) {
      return res.status(400).json({ error: 'Only JPEG, PNG, WebP, GIF, and HEIC images are allowed' })
    }

    // Self, an admin, or the manager of the managed player being changed.
    const targetUserId = userId || authUser.id
    if (!(await canEditAvatar(supabase, authUser, targetUserId))) {
      return res.status(403).json({ error: 'You can only change your own photo, or one for a player you manage' })
    }

    try {
      // Decode base64
      const buffer = Buffer.from(imageData, 'base64')

      // Safety limit (5MB) — client compresses to ~512px JPEG so this is generous
      if (buffer.length > 5 * 1024 * 1024) {
        return res.status(400).json({ error: 'Image too large' })
      }

      const ext = contentType.split('/')[1] === 'jpeg' ? 'jpg' : contentType.split('/')[1]
      const filePath = `${targetUserId}/avatar.${ext}`

      // Delete any existing avatar files for this user
      const { data: existingFiles } = await supabase.storage
        .from('avatars')
        .list(targetUserId)
      if (existingFiles && existingFiles.length > 0) {
        await supabase.storage
          .from('avatars')
          .remove(existingFiles.map(f => `${targetUserId}/${f.name}`))
      }

      // Upload new avatar
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, buffer, {
          contentType,
          upsert: true,
        })

      if (uploadError) throw uploadError

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath)

      // Add cache-busting timestamp
      const avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`

      // Update user record
      const { error: updateError } = await supabase
        .from('users')
        .update({ avatar_url: avatarUrl })
        .eq('id', targetUserId)

      if (updateError) throw updateError

      return res.status(200).json({ avatar_url: avatarUrl })
    } catch (err) {
      console.error('Avatar upload error:', err)
      return res.status(500).json({ error: 'Failed to upload avatar' })
    }
  }

  // DELETE: Remove avatar
  if (req.method === 'DELETE') {
    const { userId } = req.body
    const targetUserId = userId || authUser.id
    if (!(await canEditAvatar(supabase, authUser, targetUserId))) {
      return res.status(403).json({ error: 'You can only change your own photo, or one for a player you manage' })
    }

    try {
      // Delete all files in user's avatar folder
      const { data: existingFiles } = await supabase.storage
        .from('avatars')
        .list(targetUserId)
      if (existingFiles && existingFiles.length > 0) {
        await supabase.storage
          .from('avatars')
          .remove(existingFiles.map(f => `${targetUserId}/${f.name}`))
      }

      // Clear avatar_url in user record
      const { error: updateError } = await supabase
        .from('users')
        .update({ avatar_url: null })
        .eq('id', targetUserId)

      if (updateError) throw updateError

      return res.status(200).json({ success: true })
    } catch (err) {
      console.error('Avatar delete error:', err)
      return res.status(500).json({ error: 'Failed to delete avatar' })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
