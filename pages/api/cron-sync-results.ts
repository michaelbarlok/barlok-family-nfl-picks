import type { NextApiRequest, NextApiResponse } from 'next'

import { getAdminClient } from '@/lib/supabaseAdmin'
import { getCurrentSeason } from '@/lib/season'
import { syncWeekResults } from '@/lib/syncResults'

/**
 * Cron — every 15 minutes. Records results for finished games automatically,
 * so the app doesn't wait on someone pressing Sync Results.
 *
 * Cheap when there's nothing to do: one query for games that kicked off more
 * than ~2.5 hours ago and still have no result. Only if there are any does it
 * call ESPN, through the same sync the admin button uses — called directly,
 * not over HTTP — with pendingOnly so a result an admin set by hand is never
 * overwritten. A game ESPN hasn't marked final yet is left for the next run.
 *
 * Every run logs one line, so Vercel's cron logs show what happened.
 */

const MIN_GAME_MS = 2.5 * 60 * 60_000
const LOOKBACK_MS = 7 * 24 * 60 * 60_000 // a forgotten week shouldn't be retried forever

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = req.headers.authorization ?? ''
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // Said plainly in the logs: without CRON_SECRET set on the project, Vercel
    // calls this with no credentials and every run is turned away here.
    console.warn(process.env.CRON_SECRET
      ? 'cron-sync-results: rejected a call without the right CRON_SECRET'
      : 'cron-sync-results: CRON_SECRET is not set on this project — the automatic results sync cannot run')
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
  if (error) {
    console.error('cron-sync-results: games query failed:', error.message)
    return res.status(500).json({ error: error.message })
  }

  const weeks = [...new Set((pending ?? []).map(g => g.week as number))].sort((a, b) => a - b)
  if (weeks.length === 0) {
    console.log(`cron-sync-results: season ${season}, nothing waiting on a result`)
    return res.status(200).json({ message: 'No finished games waiting on a result.' })
  }

  const results = []
  let failed = false
  for (const week of weeks) {
    try {
      const { updated, skipped } = await syncWeekResults(supabase, week, season, { pendingOnly: true })
      console.log(
        `cron-sync-results: season ${season} week ${week} — recorded ${updated.length}` +
        (updated.length ? ` (${updated.map(u => `${u.game} → ${u.winner}`).join(', ')})` : '') +
        `; still waiting: ${skipped.length}`,
      )
      results.push({ week, recorded: updated, skipped })
    } catch (err) {
      failed = true
      const message = err instanceof Error ? err.message : String(err)
      console.error(`cron-sync-results: season ${season} week ${week} failed: ${message}`)
      results.push({ week, error: message })
    }
  }
  return res.status(failed ? 500 : 200).json({ season, results })
}
