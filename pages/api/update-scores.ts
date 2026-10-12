import type { NextApiRequest, NextApiResponse } from 'next'

import { syncWeekResults } from '@/lib/syncResults'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getCurrentSeason } from '@/lib/season'
import { isAuthorized } from '@/lib/apiAuth'

// Auto-detect which week to update: the most recent week with any game already kicked off
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function detectCurrentWeek(supabase: any, season: number): Promise<number | null> {
  const { data } = await supabase
    .from('games')
    .select('week')
    .eq('season', season)
    .lt('kickoff_time', new Date().toISOString())
    .order('week', { ascending: false })
    .limit(1)
  const row = (data as { week: number }[] | null)?.[0]
  return row?.week ?? null
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!(await isAuthorized(req))) {
    return res.status(403).json({ error: 'Unauthorized' })
  }

  const supabase = getAdminClient()

  const season = req.query.season ? parseInt(req.query.season as string) : await getCurrentSeason(supabase)

  // Determine week — explicit param or auto-detect within that season
  let week: number
  if (req.query.week) {
    week = parseInt(req.query.week as string)
  } else {
    const detected = await detectCurrentWeek(supabase, season)
    if (!detected) return res.status(200).json({ message: 'No games have started yet — nothing to update.' })
    week = detected
  }

  // pending=1: only games that don't have a result yet. The automatic sync
  // uses this, so it can never overwrite a result an admin set by hand.
  const pendingOnly = req.query.pending === '1'

  try {
    const { updated, skipped } = await syncWeekResults(supabase, week, season, { pendingOnly })

    return res.status(200).json({
      week,
      season,
      updated,
      skipped,
      message: `Synced ${updated.length} completed games for Week ${week}.`,
    })
  } catch (err) {
    console.error('update-scores error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
  }
}
