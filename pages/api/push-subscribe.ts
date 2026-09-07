import type { NextApiRequest, NextApiResponse } from 'next'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getAuthUser } from '@/lib/apiAuth'
import { isValidOrigin } from '@/lib/validation'

/**
 * Register this device for push, and set whether it wants 💩 Talk notifications.
 *
 * One row per browser, keyed on endpoint, so a player with the app on a phone
 * and a laptop can choose differently on each. Browsers hand back the same
 * endpoint on every load, so this runs often and has to be idempotent —
 * talk_enabled is only written when the caller explicitly passes it, otherwise
 * a routine re-registration would silently reset the preference.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!isValidOrigin(req)) return res.status(403).json({ error: 'Invalid origin' })

  const authUser = await getAuthUser(req)
  if (!authUser) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = getAdminClient()

  if (req.method === 'DELETE') {
    const { endpoint } = req.body ?? {}
    if (!endpoint) return res.status(400).json({ error: 'endpoint is required' })
    await supabase.from('push_subscriptions')
      .delete().eq('endpoint', endpoint).eq('user_id', authUser.id)
    return res.status(200).json({ success: true })
  }

  const { endpoint, keys, talkEnabled } = req.body ?? {}
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'A complete push subscription is required' })
  }

  try {
    const row: Record<string, unknown> = {
      user_id: authUser.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: (req.headers['user-agent'] ?? '').slice(0, 255),
      last_used_at: new Date().toISOString(),
    }
    if (typeof talkEnabled === 'boolean') row.talk_enabled = talkEnabled

    const { error } = await supabase.from('push_subscriptions')
      .upsert(row, { onConflict: 'endpoint' })

    if (error) {
      if (error.message?.includes('push_subscriptions')) {
        return res.status(500).json({
          error: 'The push_subscriptions table does not exist yet. Run supabase/migrations/13_talk.sql.',
        })
      }
      throw error
    }

    const { data } = await supabase.from('push_subscriptions')
      .select('talk_enabled').eq('endpoint', endpoint).maybeSingle()
    return res.status(200).json({ success: true, talkEnabled: data?.talk_enabled ?? false })
  } catch (err) {
    console.error('push-subscribe error:', err)
    return res.status(500).json({ error: 'Failed to save the notification setting' })
  }
}
