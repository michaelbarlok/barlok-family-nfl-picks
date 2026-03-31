import type { NextApiRequest, NextApiResponse } from 'next'
import { CURRENT_SEASON } from '@/lib/constants'
import { detectUpcomingWeek } from '@/lib/lockTime'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { callInternal } from '@/lib/callInternal'

/**
 * Cron handler — runs every 15 minutes.
 * Sends personalized deadline warning emails:
 *   - 1 hour before lock time (to everyone)
 *   - 15 minutes before lock time (to everyone)
 * Uses cron_log table to prevent duplicate sends.
 */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = req.headers.authorization ?? ''
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(403).json({ error: 'Unauthorized' })
  }

  const supabase = getAdminClient()

  const upcoming = await detectUpcomingWeek(supabase)
  if (!upcoming) {
    return res.status(200).json({ message: 'No upcoming week — nothing to warn about.' })
  }

  const { week, lockTime } = upcoming
  const now = Date.now()
  const minutesUntilLock = (lockTime.getTime() - now) / (1000 * 60)

  // Determine which warning window we're in
  let warningType: string | null = null
  let minutes: number | null = null

  if (minutesUntilLock >= 45 && minutesUntilLock < 75) {
    warningType = 'one_hour_warning'
    minutes = 60
  } else if (minutesUntilLock >= 5 && minutesUntilLock < 20) {
    warningType = 'fifteen_min_warning'
    minutes = 15
  }

  if (!warningType || minutes === null) {
    return res.status(200).json({
      message: 'No deadline warning needed right now.',
      minutesUntilLock: Math.round(minutesUntilLock),
      week,
    })
  }

  // Claim the slot FIRST to prevent duplicate sends from concurrent cron runs.
  // The UNIQUE(week, season, warning_type) constraint acts as a lock —
  // only the first insert succeeds, all others get a conflict error.
  const { error: claimError } = await supabase.from('cron_log').insert({
    week,
    season: CURRENT_SEASON,
    warning_type: warningType,
  })

  if (claimError) {
    // UNIQUE constraint violation means another run already claimed this
    return res.status(200).json({
      message: `${warningType} already sent for Week ${week}.`,
      skipped: true,
    })
  }

  try {
    const result = await callInternal(
      req,
      `/api/send-reminder-email?type=deadline_warning&minutes=${minutes}`
    )

    if (result.status >= 400) {
      // Email failed — remove the log so it can be retried next run
      await supabase.from('cron_log').delete()
        .eq('week', week)
        .eq('season', CURRENT_SEASON)
        .eq('warning_type', warningType)

      return res.status(500).json({
        task: warningType,
        error: `Email send returned ${result.status}`,
        body: result.body,
      })
    }

    return res.status(200).json({
      task: warningType,
      week,
      minutesUntilLock: Math.round(minutesUntilLock),
      result: result.body,
    })
  } catch (err) {
    // Send failed — remove the log so it can be retried next run
    await supabase.from('cron_log').delete()
      .eq('week', week)
      .eq('season', CURRENT_SEASON)
      .eq('warning_type', warningType)

    console.error(`cron-deadline-warnings (${warningType}) error:`, err)
    return res.status(500).json({
      task: warningType,
      error: err instanceof Error ? err.message : 'Internal call failed',
    })
  }
}
