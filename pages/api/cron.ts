import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { CURRENT_SEASON } from '@/lib/constants'

/**
 * Cron handler — runs once per day (9 AM ET).
 * Sends a lock warning email on the morning of game day
 * (when the first kickoff of the week is within 12 hours).
 */

async function getFirstKickoff(): Promise<Date | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
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
  const kickoff = await getFirstKickoff()

  if (!kickoff) {
    return res.status(200).json({ message: 'No upcoming games found.' })
  }

  const hoursUntilKickoff = (kickoff.getTime() - now.getTime()) / (1000 * 60 * 60)

  // Send lock warning on game day morning (kickoff within 12 hours)
  if (hoursUntilKickoff > 0 && hoursUntilKickoff <= 12) {
    const result = await callInternal(req, '/api/send-reminder-email?type=lock_warning')
    return res.status(200).json({
      task: 'lock_warning',
      result,
      nextKickoff: kickoff.toISOString(),
    })
  }

  return res.status(200).json({
    message: 'No tasks scheduled for this run.',
    hoursUntilKickoff: Math.round(hoursUntilKickoff),
    nextKickoff: kickoff.toISOString(),
  })
}
