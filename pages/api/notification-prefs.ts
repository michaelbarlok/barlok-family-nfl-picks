import type { NextApiRequest, NextApiResponse } from 'next'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getAuthUser } from '@/lib/apiAuth'
import { isValidOrigin } from '@/lib/validation'

/**
 * A player's own notification settings.
 *
 * This runs on the service role rather than letting the browser write `users`
 * directly, and that is the whole point: RLS cannot restrict which columns an
 * UPDATE touches, so an UPDATE policy loose enough to allow notify_picks_email
 * would also allow is_admin. The whitelist below is the column restriction.
 *
 * Device-level settings are not here — 💩 Talk lives on push_subscriptions
 * because it is answered per browser (see /api/push-subscribe).
 */
const EDITABLE = ['notify_picks_email', 'notify_picks_push', 'email_recipient'] as const
type Editable = (typeof EDITABLE)[number]

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (req.method === 'POST' && !isValidOrigin(req)) {
    return res.status(403).json({ error: 'Invalid origin' })
  }

  const authUser = await getAuthUser(req)
  if (!authUser) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = getAdminClient()

  const read = async () => {
    const { data, error } = await supabase
      .from('users')
      .select('notify_picks_email, notify_picks_push, email_recipient')
      .eq('id', authUser.id)
      .maybeSingle()
    if (error) throw error
    return data
  }

  try {
    if (req.method === 'GET') {
      const prefs = await read()
      if (!prefs) return res.status(404).json({ error: 'No player profile found for this account' })
      return res.status(200).json({ prefs })
    }

    // Only the whitelisted columns, and only booleans — anything else is dropped
    // rather than rejected, so a future field can be added client-side without
    // this having to fail closed on old deployments.
    const patch: Partial<Record<Editable, boolean>> = {}
    for (const key of EDITABLE) {
      const value = (req.body ?? {})[key]
      if (typeof value === 'boolean') patch[key] = value
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'No settings to change' })
    }

    const { error } = await supabase.from('users').update(patch).eq('id', authUser.id)
    if (error) throw error

    return res.status(200).json({ success: true, prefs: await read() })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (message.includes('notify_picks')) {
      return res.status(500).json({
        error: 'Notification settings are not set up yet. Run supabase/migrations/14_notification_prefs.sql.',
      })
    }
    console.error('notification-prefs error:', err)
    return res.status(500).json({ error: 'Failed to load your notification settings' })
  }
}
