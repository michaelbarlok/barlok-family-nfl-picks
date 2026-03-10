import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { ADMIN_EMAIL } from '@/lib/constants'
import { isValidOrigin } from '@/lib/validation'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4mb',
    },
  },
}

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function getAuthUser(req: NextApiRequest) {
  const token = (req.headers.authorization ?? '').replace('Bearer ', '')
  if (!token) return null
  try {
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data: { user } } = await anon.auth.getUser(token)
    return user
  } catch {
    return null
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isValidOrigin(req)) return res.status(403).json({ error: 'Invalid origin' })

  const authUser = await getAuthUser(req)
  if (!authUser) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = getServiceClient()

  // POST: Upload avatar (base64 image in body)
  if (req.method === 'POST') {
    const { userId, imageData, contentType } = req.body

    if (!imageData || !contentType) {
      return res.status(400).json({ error: 'imageData and contentType are required' })
    }

    // Validate content type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!allowedTypes.includes(contentType)) {
      return res.status(400).json({ error: 'Only JPEG, PNG, WebP, and GIF images are allowed' })
    }

    // Determine target user: self or admin uploading for another user
    const targetUserId = userId || authUser.id
    if (targetUserId !== authUser.id) {
      // Check if caller is admin
      const isAdmin = authUser.email === ADMIN_EMAIL
      if (!isAdmin) {
        const { data: callerRow } = await supabase
          .from('users')
          .select('is_admin')
          .eq('id', authUser.id)
          .single()
        if (!callerRow?.is_admin) {
          return res.status(403).json({ error: 'Only admins can update other users\' avatars' })
        }
      }
    }

    try {
      // Decode base64
      const buffer = Buffer.from(imageData, 'base64')

      // Validate size (max 2MB after decode)
      if (buffer.length > 2 * 1024 * 1024) {
        return res.status(400).json({ error: 'Image must be under 2MB' })
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

    if (targetUserId !== authUser.id) {
      const isAdmin = authUser.email === ADMIN_EMAIL
      if (!isAdmin) {
        const { data: callerRow } = await supabase
          .from('users')
          .select('is_admin')
          .eq('id', authUser.id)
          .single()
        if (!callerRow?.is_admin) {
          return res.status(403).json({ error: 'Only admins can remove other users\' avatars' })
        }
      }
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
