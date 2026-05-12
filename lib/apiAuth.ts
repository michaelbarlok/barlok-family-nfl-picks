import type { NextApiRequest } from 'next'
import type { User } from '@supabase/supabase-js'
import { getAdminClient, getAnonClient } from '@/lib/supabaseAdmin'
import { ADMIN_EMAIL } from '@/lib/constants'

/**
 * Extract and validate the authenticated user from the request.
 * Returns the Supabase User object, or null if not authenticated.
 */
export async function getAuthUser(req: NextApiRequest): Promise<User | null> {
  const token = (req.headers.authorization ?? '').replace('Bearer ', '')
  if (!token) return null
  try {
    const { data: { user } } = await getAnonClient().auth.getUser(token)
    return user
  } catch {
    return null
  }
}

/**
 * Check if the request is from an admin user.
 * Matches the owner email or any user with is_admin=true.
 */
export async function isAdmin(req: NextApiRequest): Promise<boolean> {
  const user = await getAuthUser(req)
  if (!user) return false
  if (user.email === ADMIN_EMAIL) return true
  const { data } = await getAdminClient().from('users').select('is_admin').eq('id', user.id).single()
  return data?.is_admin === true
}

/**
 * Check if the request is authorized (admin user OR cron secret).
 * Also checks the is_admin flag in the DB for non-ADMIN_EMAIL users.
 */
export async function isAuthorized(req: NextApiRequest): Promise<boolean> {
  const authHeader = req.headers.authorization ?? ''

  // Vercel cron jobs send the CRON_SECRET automatically
  if (process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`) {
    return true
  }

  // Admin user token
  const user = await getAuthUser(req)
  if (!user) return false
  if (user.email === ADMIN_EMAIL) return true

  // Check is_admin flag in DB
  const { data } = await getAdminClient().from('users').select('is_admin').eq('id', user.id).single()
  return data?.is_admin === true
}
