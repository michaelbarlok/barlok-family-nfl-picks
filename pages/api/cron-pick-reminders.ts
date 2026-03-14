import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { detectUpcomingWeek, getCurrentET } from '@/lib/lockTime'

/**
 * Cron handler — runs at 10pm and 11pm UTC on Tue/Wed/Thu
 * (covers both EDT and EST for 6pm ET).
 * Sends pick reminders to users who haven't completed their picks.
 */

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

  // DST guard: only execute if it's actually 6pm ET
  const et = getCurrentET()
  if (et.hour !== 18) {
    return res.status(200).json({ skipped: true, reason: `Not 6pm ET (current ET hour: ${et.hour})` })
  }

  // Safety check: only Tue (2), Wed (3), Thu (4)
  if (![2, 3, 4].includes(et.dayOfWeek)) {
    return res.status(200).json({ skipped: true, reason: 'Not Tue/Wed/Thu' })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const upcoming = await detectUpcomingWeek(supabase)
  if (!upcoming) {
    return res.status(200).json({ message: 'No upcoming week found — nothing to remind.' })
  }

  // Only send if picks haven't locked yet
  if (new Date() >= upcoming.lockTime) {
    return res.status(200).json({ message: `Week ${upcoming.week} picks already locked.` })
  }

  try {
    const result = await callInternal(req, '/api/send-reminder-email?type=reminder')
    return res.status(200).json({
      task: 'pick_reminder',
      week: upcoming.week,
      result: result.body,
    })
  } catch (err) {
    console.error('cron-pick-reminders error:', err)
    return res.status(200).json({
      task: 'pick_reminder',
      error: err instanceof Error ? err.message : 'Internal call failed',
    })
  }
}
