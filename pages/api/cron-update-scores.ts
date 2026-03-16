import type { NextApiRequest, NextApiResponse } from 'next'
import { CURRENT_SEASON } from '@/lib/constants'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { callInternal } from '@/lib/callInternal'

/**
 * Cron handler — runs every hour.
 * Checks for games that kicked off 3-8 hours ago with no result yet,
 * then calls /api/update-scores for each affected week.
 */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = req.headers.authorization ?? ''
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(403).json({ error: 'Unauthorized' })
  }

  const supabase = getAdminClient()

  const now = new Date()
  const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000)
  const eightHoursAgo = new Date(now.getTime() - 8 * 60 * 60 * 1000)

  // Find games that kicked off 3-8 hours ago and don't have results yet
  const { data: pendingGames } = await supabase
    .from('games')
    .select('week')
    .eq('season', CURRENT_SEASON)
    .lt('kickoff_time', threeHoursAgo.toISOString())
    .gt('kickoff_time', eightHoursAgo.toISOString())
    .is('winning_team', null)

  if (!pendingGames || pendingGames.length === 0) {
    return res.status(200).json({ message: 'No games in scoring window.' })
  }

  // Get distinct weeks
  const weeks = [...new Set(pendingGames.map((g: any) => g.week))].sort()

  const results: { week: number; result: any }[] = []
  for (const week of weeks) {
    try {
      const result = await callInternal(req, `/api/update-scores?week=${week}`)
      results.push({ week, result: result.body })
    } catch (err) {
      console.error(`cron-update-scores error for week ${week}:`, err)
      results.push({ week, result: { error: err instanceof Error ? err.message : 'Failed' } })
    }
  }

  return res.status(200).json({
    task: 'update_scores',
    weeksChecked: weeks,
    results,
  })
}
