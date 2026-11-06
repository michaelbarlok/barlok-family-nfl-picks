import type { NextApiRequest, NextApiResponse } from 'next'
import { isValidEmail, isValidOrigin } from '@/lib/validation'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { bowlCaller, isMissingBowlTables, MIGRATION_HINT, originOf } from '@/lib/bowls/server'
import { addOrInvitePlayer } from '@/lib/bowls/invite'

/**
 * Bowl admin: add someone to this season's Bowl Pick'em by name and email.
 * New people get a bowl-only account (no NFL access); NFL players are added
 * to the bowl side with the login they already have. See addOrInvitePlayer.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!isValidOrigin(req)) return res.status(403).json({ error: 'Invalid origin' })
  const caller = await bowlCaller(req)
  if (!caller?.isAdmin) return res.status(403).json({ error: 'Bowl admin access required' })

  const { name, email } = req.body ?? {}
  if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Player name is required' })
  if (!isValidEmail(email)) return res.status(400).json({ error: 'A valid email address is required' })

  const supabase = getAdminClient()
  const { data: current, error: seasonErr } = await supabase
    .from('bowl_seasons').select('season, status').eq('is_current', true).maybeSingle()
  if (isMissingBowlTables(seasonErr)) return res.status(500).json({ error: MIGRATION_HINT })
  if (!current) return res.status(400).json({ error: 'There is no current bowl season.' })
  if (current.status === 'complete') return res.status(400).json({ error: 'This bowl season is over.' })

  try {
    const result = await addOrInvitePlayer({ origin: originOf(req), season: current.season, name, email })
    return res.status(200).json({ success: true, ...result })
  } catch (err) {
    console.error('bowls/invite error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to invite the player' })
  }
}
