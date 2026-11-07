import type { NextApiRequest, NextApiResponse } from 'next'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isMissingSheetTables, loadSeason } from '@/lib/bowls/season'
import { isMissingBowlTables } from '@/lib/bowls/server'
import { onSheet } from '@/lib/bowls/sheet'
import { espnFetch } from '@/lib/bowls/espn'
import { pullFromEspn } from '@/lib/bowls/sync'

/**
 * Cron — every 10 minutes. Keeps bowl results up to date while games are
 * being played: the same "Pull from ESPN" the admin can tap (scores, finals,
 * winners, the playoff teams as they advance, a canceled bowl coming off).
 *
 * It only reaches ESPN when a game in the pick'em has kicked off and its
 * result isn't in yet — so between game days, and before picks lock, it does
 * nothing. Bowl tables only; the NFL's results job is separate.
 */

const LOOKBACK_MS = 2 * 24 * 60 * 60_000 // a game stuck unfinished longer than this is left to the admin

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = req.headers.authorization ?? ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(403).json({ error: 'Unauthorized' })
  }
  const supabase = getAdminClient()
  try {
    const loaded = await loadSeason(supabase)
    if (!loaded) return res.status(200).json({ message: 'No bowl season.' })
    const { state, games } = loaded
    if (state.status !== 'locked') return res.status(200).json({ message: `Bowl picks are ${state.status}; no games to follow.` })

    const now = Date.now()
    const waiting = games.filter(g => onSheet(g) && !g.removed && g.kickoff_time
      && Date.parse(g.kickoff_time) <= now && Date.parse(g.kickoff_time) >= now - LOOKBACK_MS
      && g.status !== 'final' && g.status !== 'canceled' && g.status !== 'postponed')
    if (!waiting.length) return res.status(200).json({ message: 'No game under way or waiting on a result.' })

    const result = await pullFromEspn(supabase, state.season, espnFetch)
    return res.status(200).json({ following: waiting.map(g => g.name), ...result })
  } catch (err) {
    const e = err as Error
    if (isMissingBowlTables(e) || isMissingSheetTables(e)) return res.status(200).json({ message: 'Bowl tables not set up.' })
    console.error('bowls/cron-results error:', err)
    return res.status(500).json({ error: e.message ?? 'Something went wrong' })
  }
}
