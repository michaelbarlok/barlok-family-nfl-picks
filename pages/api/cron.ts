import type { NextApiRequest, NextApiResponse } from 'next'

/**
 * Unified cron handler — runs every hour and dispatches to the right
 * task based on the current day/time in Eastern Time.
 *
 * Schedule (all times ET):
 *   Tue/Wed/Thu 12:00 PM, 7:00 PM  → Pick reminder emails (incomplete only)
 *   Thu 8:00 PM                     → Lock warning email (all recipients)
 *   Fri 10:00 PM                    → Weekly spreadsheet email
 *   Fri/Mon/Tue 12:00 AM           → Update scores
 *
 * Vercel cron calls this every hour. The handler checks the current
 * ET hour and day-of-week to decide what to run.
 */

function getETTime(): { day: number; hour: number } {
  const now = new Date()
  const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false })
  // Parse "M/D/YYYY, HH:MM:SS"
  const [, timePart] = etStr.split(', ')
  const hour = parseInt(timePart.split(':')[0])
  // Get day-of-week in ET
  const etDayStr = now.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short' })
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const day = dayMap[etDayStr] ?? now.getUTCDay()
  return { day, hour }
}

async function callInternal(req: NextApiRequest, path: string): Promise<{ status: number; body: any }> {
  // Build the internal URL
  const protocol = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000'
  const baseUrl = `${protocol}://${host}`

  const authHeader = req.headers.authorization ?? ''
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow cron secret
  const authHeader = req.headers.authorization ?? ''
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(403).json({ error: 'Unauthorized' })
  }

  const { day, hour } = getETTime()
  const tasks: string[] = []
  const results: Record<string, any> = {}

  // Pick reminder emails: Tue(2), Wed(3), Thu(4) at noon(12) and 7PM(19)
  if ([2, 3, 4].includes(day) && [12, 19].includes(hour)) {
    tasks.push('reminder')
    results.reminder = await callInternal(req, '/api/send-reminder-email?type=reminder')
  }

  // Lock warning: Thu(4) at 8PM(20) — 15 min before typical 8:15 lock
  if (day === 4 && hour === 20) {
    tasks.push('lock_warning')
    results.lock_warning = await callInternal(req, '/api/send-reminder-email?type=lock_warning')
  }

  // Weekly spreadsheet email: Fri(5) at 10PM(22)
  // (After lock, gives time for all picks to be visible)
  if (day === 5 && hour === 22) {
    tasks.push('spreadsheet')
    results.spreadsheet = await callInternal(req, '/api/send-weekly-email')
  }

  // Update scores: Fri(5), Mon(1), Tue(2) at midnight(0)
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
    })
  }

  return res.status(200).json({
    tasks,
    results,
    day,
    hour,
    tz: 'America/New_York',
  })
}
