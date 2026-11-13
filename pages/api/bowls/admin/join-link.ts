import type { NextApiRequest, NextApiResponse } from 'next'
import { isValidOrigin } from '@/lib/validation'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { bowlCaller, isMissingBowlTables, MIGRATION_HINT, originOf } from '@/lib/bowls/server'
import { currentSeasonNow, isMissingJoinLinks, JOIN_MIGRATION_HINT, joinCodeFor, joinOpen, joinUrl } from '@/lib/bowls/joinLink'

/**
 * The bowl admin's share link for joining this season (Admin › Players).
 *
 *   GET                       → { url, season, status, open } — made the first time
 *   POST { action: 'reset' }  → a new link; the old one stops working
 *
 * Bowl admin only.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (req.method === 'POST' && !isValidOrigin(req)) return res.status(403).json({ error: 'Invalid origin' })
  const caller = await bowlCaller(req)
  if (!caller?.isAdmin) return res.status(403).json({ error: 'Bowl admin access required' })

  const supabase = getAdminClient()
  try {
    const current = await currentSeasonNow(supabase)
    if (!current) return res.status(400).json({ error: 'There is no current bowl season.' })
    const reset = req.method === 'POST' && req.body?.action === 'reset'
    if (req.method === 'POST' && !reset) return res.status(400).json({ error: 'Unknown action' })
    const code = await joinCodeFor(supabase, current.season, reset)
    return res.status(200).json({
      url: joinUrl(originOf(req), code),
      season: current.season,
      status: current.status,
      open: joinOpen(current.status),
      ...(reset ? { message: 'New link made — the old one no longer works.' } : {}),
    })
  } catch (err) {
    const e = err as Error
    if (isMissingJoinLinks(e)) return res.status(500).json({ error: JOIN_MIGRATION_HINT, migration: 25 })
    if (isMissingBowlTables(e)) return res.status(500).json({ error: MIGRATION_HINT })
    console.error('bowls/admin/join-link error:', err)
    return res.status(500).json({ error: e.message || 'Something went wrong' })
  }
}
