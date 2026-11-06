import type { NextApiRequest, NextApiResponse } from 'next'
import { isValidOrigin } from '@/lib/validation'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { bowlCaller } from '@/lib/bowls/server'
import { loadSeason } from '@/lib/bowls/season'
import { isMissingTalkTables, TALK_MIGRATION_HINT } from '@/lib/bowls/notify'
import { sendReminders, siteOrigin } from '@/lib/bowls/reminders'

/**
 * POST — the bowl admin's "Send a reminder now": email and push to every
 * player whose picks aren't finished. Logged, so the automatic 72- and
 * 24-hour reminders hold off for a while after it rather than doubling up.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!isValidOrigin(req)) return res.status(403).json({ error: 'Invalid origin' })
  const caller = await bowlCaller(req)
  if (!caller?.isAdmin) return res.status(403).json({ error: 'Bowl admin access required' })
  const supabase = getAdminClient()

  try {
    const loaded = await loadSeason(supabase)
    if (!loaded) return res.status(400).json({ error: 'There is no bowl season yet.' })
    if (loaded.state.status !== 'open') {
      return res.status(400).json({ error: loaded.state.status === 'setup' ? 'Open picks first — there’s nothing to remind people about yet.' : 'Picks are locked.' })
    }
    const result = await sendReminders(supabase, 'nudge', siteOrigin(req))
    const { error } = await supabase.from('bowl_reminder_log')
      .upsert({ season: loaded.state.season, kind: 'nudge', sent_at: new Date(Date.now()).toISOString(), recipients: result.players }, { onConflict: 'season,kind' })
    if (error) throw new Error(error.message)
    return res.status(200).json(result)
  } catch (err) {
    if (isMissingTalkTables(err as Error)) return res.status(500).json({ error: TALK_MIGRATION_HINT })
    console.error('bowls/admin/remind error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Something went wrong' })
  }
}
