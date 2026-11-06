import type { NextApiRequest, NextApiResponse } from 'next'
import { isValidOrigin } from '@/lib/validation'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { pushConfigured } from '@/lib/push'
import { bowlCaller } from '@/lib/bowls/server'
import { isMissingTalkTables, TALK_MIGRATION_HINT } from '@/lib/bowls/notify'

/**
 * A bowl player's notification settings.
 *
 *   GET [?endpoint=]   { emailReminders, device: { talk, reminders } | null, pushReady }
 *   POST {
 *     emailReminders?: boolean,                       // per person
 *     endpoint?, keys?: { p256dh, auth },             // this device…
 *     talkEnabled?: boolean, remindersEnabled?: boolean,
 *     refreshOnly?: true, previous?: string,          // …or just keep its row current
 *   }
 *
 * Email is a per-person switch; push is per device, in the bowl's own table,
 * so it never touches the NFL's notification settings.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (req.method === 'POST' && !isValidOrigin(req)) return res.status(403).json({ error: 'Invalid origin' })
  const caller = await bowlCaller(req)
  if (!caller) return res.status(401).json({ error: 'Sign in first' })
  const supabase = getAdminClient()

  try {
    const { data: me, error: meErr } = await supabase.from('bowl_players').select('id, email_reminders').eq('id', caller.user.id).maybeSingle()
    if (meErr) throw new Error(meErr.message)
    if (!me) return res.status(403).json({ error: "This account isn't in the Bowl Pick'em." })

    const deviceOf = async (endpoint: unknown) => {
      if (typeof endpoint !== 'string' || !endpoint) return null
      const { data, error } = await supabase.from('bowl_push_subscriptions')
        .select('player_id, talk_enabled, reminders_enabled').eq('endpoint', endpoint).maybeSingle()
      if (error) throw new Error(error.message)
      // A device another bowl player last used counts as off for you.
      if (!data || data.player_id !== me.id) return null
      return { talk: !!data.talk_enabled, reminders: !!data.reminders_enabled }
    }
    const reply = async (emailReminders: boolean, endpoint: unknown) => res.status(200).json({
      emailReminders, device: await deviceOf(endpoint), pushReady: pushConfigured(),
    })

    if (req.method === 'GET') return reply(me.email_reminders !== false, req.query.endpoint)

    const { emailReminders, endpoint, keys, talkEnabled, remindersEnabled, refreshOnly, previous } = req.body ?? {}
    let email = me.email_reminders !== false
    if (typeof emailReminders === 'boolean') {
      const { error } = await supabase.from('bowl_players').update({ email_reminders: emailReminders }).eq('id', me.id)
      if (error) throw new Error(error.message)
      email = emailReminders
    }

    if (endpoint !== undefined) {
      if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 2000
        || typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string') {
        return res.status(400).json({ error: 'A complete push subscription is required' })
      }
      const now = new Date().toISOString()
      const fresh = { p256dh: keys.p256dh, auth: keys.auth, last_used_at: now }

      if (refreshOnly === true) {
        // Only a device that already has bowl notifications; never sign one up.
        const { data: row } = await supabase.from('bowl_push_subscriptions').select('player_id').eq('endpoint', endpoint).maybeSingle()
        if (row) {
          if (row.player_id === me.id) await supabase.from('bowl_push_subscriptions').update(fresh).eq('endpoint', endpoint)
        } else if (typeof previous === 'string' && previous && previous !== endpoint) {
          // The browser handed out a new registration: carry this device's choices over.
          await supabase.from('bowl_push_subscriptions').update({ ...fresh, endpoint }).eq('endpoint', previous).eq('player_id', me.id)
        }
        return reply(email, endpoint)
      }

      const row: Record<string, unknown> = {
        ...fresh, endpoint, player_id: me.id,
        user_agent: String(req.headers['user-agent'] ?? '').slice(0, 255),
      }
      if (typeof talkEnabled === 'boolean') row.talk_enabled = talkEnabled
      if (typeof remindersEnabled === 'boolean') row.reminders_enabled = remindersEnabled
      // A brand-new device gets only what was switched on: turning on Talk
      // alone shouldn't also sign it up for pick reminders.
      const { data: had } = await supabase.from('bowl_push_subscriptions').select('player_id').eq('endpoint', endpoint).maybeSingle()
      if (!had || had.player_id !== me.id) {
        row.talk_enabled = talkEnabled === true
        row.reminders_enabled = remindersEnabled === true
      }
      const { error } = await supabase.from('bowl_push_subscriptions').upsert(row, { onConflict: 'endpoint' })
      if (error) throw new Error(error.message)
    }
    return reply(email, endpoint)
  } catch (err) {
    if (isMissingTalkTables(err as Error)) return res.status(500).json({ error: TALK_MIGRATION_HINT })
    console.error('bowls/notifications error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Something went wrong' })
  }
}
