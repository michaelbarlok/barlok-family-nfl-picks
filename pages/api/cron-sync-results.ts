import type { NextApiRequest, NextApiResponse } from 'next'

import { getAdminClient } from '@/lib/supabaseAdmin'
import { getCurrentSeason } from '@/lib/season'
import { callInternal } from '@/lib/callInternal'

/**
 * Cron — every 15 minutes. Records results for finished games automatically,
 * so the app doesn't wait on someone pressing Sync Results.
 *
 * Cheap when there's nothing to do: one query for games that kicked off more
 * than ~2.5 hours ago and still have no result. Only if there are any does it
 * call ESPN, through the same update-scores endpoint the admin button uses,
 * with pending=1 so a result an admin set by hand is never overwritten. A game
 * ESPN hasn't marked final yet is left for the next run.
 */

const MIN_GAME_MS = 2.5 * 60 * 60_000
const LOOKBACK_MS = 7 * 24 * 60 * 60_000 // a forgotten week shouldn't be retried forever

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = req.headers.authorization ?? ''
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(403).json({ error: 'Unauthorized' })
  }

  const supabase = getAdminClient()
  const season = await getCurrentSeason(supabase)
  const now = Date.now()

  const { data: pending, error } = await supabase
    .from('games')
    .select('week')
    .eq('season', season)
    .is('winning_team', null)
    .lt('kickoff_time', new Date(now - MIN_GAME_MS).toISOString())
    .gt('kickoff_time', new Date(now - LOOKBACK_MS).toISOString())
  if (error) return res.status(500).json({ error: error.message })

  const weeks = [...new Set((pending ?? []).map(g => g.week as number))].sort((a, b) => a - b)
  if (weeks.length === 0) return res.status(200).json({ message: 'No finished games waiting on a result.' })

  const results = []
  for (const week of weeks) {
    const { status, body } = await callInternal(req, `/api/update-scores?week=${week}&season=${season}&pending=1`)
    results.push({ week, status, message: body?.message ?? body?.error ?? null })
  }
  return res.status(200).json({ season, results })
}
