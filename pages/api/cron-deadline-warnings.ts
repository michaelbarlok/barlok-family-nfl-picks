import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { CURRENT_SEASON } from '@/lib/constants'
import { detectUpcomingWeek } from '@/lib/lockTime'

/**
 * Cron handler — runs every 15 minutes.
 * Sends personalized deadline warning emails:
 *   - 1 hour before lock time (to everyone)
 *   - 15 minutes before lock time (to everyone)
 * Uses cron_log table to prevent duplicate sends.
 */

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function callInternal(req: NextApiRequest, path: string): Promise<{ status: number; body: any }> {
  const protocol = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000'
  const baseUrl = `${protocol}://${host}`

  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: req.headers.authorization ?? '',
      'Content-Type': 'application/json',
    },
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

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

  // Check cron_log for duplicate prevention
  const { data: existing } = await supabase
    .from('cron_log')
    .select('id')
    .eq('week', week)
    .eq('season', CURRENT_SEASON)
    .eq('warning_type', warningType)
    .limit(1)

  if (existing && existing.length > 0) {
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

    if (result.status < 400) {
      // Log successful send to prevent duplicates
      await supabase.from('cron_log').insert({
        week,
        season: CURRENT_SEASON,
        warning_type: warningType,
      })
    }

    return res.status(200).json({
      task: warningType,
      week,
      minutesUntilLock: Math.round(minutesUntilLock),
      result: result.body,
    })
  } catch (err) {
    console.error(`cron-deadline-warnings (${warningType}) error:`, err)
    return res.status(200).json({
      task: warningType,
      error: err instanceof Error ? err.message : 'Internal call failed',
    })
  }
}
