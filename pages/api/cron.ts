import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { CURRENT_SEASON } from '@/lib/constants'

/**
 * Unified cron handler — runs every hour and dispatches tasks dynamically
 * based on the upcoming week's first kickoff time.
 *
 * - Reminders: noon & 7 PM ET on each of the 3 days before lock
 * - Lock warning: the last hourly run before the first kickoff
 * - Spreadsheet email: the first hourly run after lock
 * - Score updates: Fri/Mon/Tue at midnight ET (fixed)
 */

function getETTime(): { day: number; hour: number } {
  const now = new Date()
  const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false })
  const [, timePart] = etStr.split(', ')
  const hour = parseInt(timePart.split(':')[0])
  const etDayStr = now.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short' })
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const day = dayMap[etDayStr] ?? now.getUTCDay()
  return { day, hour }
}

async function getFirstKickoff(): Promise<Date | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  // Find the next upcoming week's earliest kickoff
  const { data } = await supabase
    .from('games')
    .select('kickoff_time')
    .eq('season', CURRENT_SEASON)
    .gt('kickoff_time', new Date().toISOString())
    .order('kickoff_time', { ascending: true })
    .limit(1)

  if (!data || data.length === 0) return null
  return new Date(data[0].kickoff_time)
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

  const now = new Date()
  const { day, hour } = getETTime()
  const tasks: string[] = []
  const results: Record<string, any> = {}

  // --- Dynamic tasks based on upcoming kickoff ---
  const kickoff = await getFirstKickoff()

  if (kickoff) {
    const msUntilKickoff = kickoff.getTime() - now.getTime()
    const hoursUntilKickoff = msUntilKickoff / (1000 * 60 * 60)

    // Lock warning: last hourly run before kickoff (0-1 hours away)
    if (hoursUntilKickoff > 0 && hoursUntilKickoff <= 1) {
      tasks.push('lock_warning')
      results.lock_warning = await callInternal(req, '/api/send-reminder-email?type=lock_warning')
    }

    // Reminders: noon (12) and 7 PM (19) ET, within 3 days before lock
    if (hoursUntilKickoff > 1 && hoursUntilKickoff <= 72 && [12, 19].includes(hour)) {
      tasks.push('reminder')
      results.reminder = await callInternal(req, '/api/send-reminder-email?type=reminder')
    }

    // Spreadsheet email: first run after lock (kickoff was 0-1 hours ago)
    if (hoursUntilKickoff <= 0 && hoursUntilKickoff > -1) {
      tasks.push('spreadsheet')
      results.spreadsheet = await callInternal(req, '/api/send-weekly-email')
    }
  }

  // --- Fixed schedule: score updates ---
  // Fri(5), Mon(1), Tue(2) at midnight(0) ET
  if ([1, 2, 5].includes(day) && hour === 0) {
    tasks.push('scores')
    results.scores = await callInternal(req, '/api/update-scores')
  }

  if (tasks.length === 0) {
    return res.status(200).json({
      message: 'No tasks scheduled for this time.',
      day,
      hour,
      tz: 'America/New_York',
      nextKickoff: kickoff?.toISOString() ?? null,
    })
  }

  return res.status(200).json({
    tasks,
    results,
    day,
    hour,
    tz: 'America/New_York',
    nextKickoff: kickoff?.toISOString() ?? null,
  })
}
