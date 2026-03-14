import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { CURRENT_SEASON } from '@/lib/constants'
import { detectUpcomingWeek, getCurrentET } from '@/lib/lockTime'

/**
 * Cron handler — runs at 5am and 6am UTC on Tuesdays
 * (covers both EDT and EST for 1am ET).
 * Syncs the next week's schedule from ESPN and re-syncs
 * the current upcoming week to catch flex scheduling changes.
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

  // DST guard: only execute if it's actually 1am ET
  const et = getCurrentET()
  if (et.hour !== 1) {
    return res.status(200).json({ skipped: true, reason: `Not 1am ET (current ET hour: ${et.hour})` })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const results: { action: string; week: number; result: any }[] = []

  // 1. Re-sync current upcoming week (flex scheduling changes)
  const upcoming = await detectUpcomingWeek(supabase)
  if (upcoming) {
    try {
      const result = await callInternal(req, `/api/sync-schedule?week=${upcoming.week}`)
      results.push({ action: 'resync_current', week: upcoming.week, result: result.body })
    } catch (err) {
      console.error(`cron-sync-schedule resync week ${upcoming.week} error:`, err)
      results.push({ action: 'resync_current', week: upcoming.week, result: { error: err instanceof Error ? err.message : 'Failed' } })
    }
  }

  // 2. Sync next week's schedule
  const { data: maxWeekRow } = await supabase
    .from('games')
    .select('week')
    .eq('season', CURRENT_SEASON)
    .order('week', { ascending: false })
    .limit(1)

  const maxWeek = maxWeekRow?.[0]?.week ?? 0
  const nextWeek = maxWeek + 1

  if (nextWeek > 18) {
    return res.status(200).json({
      message: 'All 18 weeks already synced — season complete.',
      results,
    })
  }

  try {
    const result = await callInternal(req, `/api/sync-schedule?week=${nextWeek}`)
    results.push({ action: 'sync_next', week: nextWeek, result: result.body })
  } catch (err) {
    console.error(`cron-sync-schedule next week ${nextWeek} error:`, err)
    results.push({ action: 'sync_next', week: nextWeek, result: { error: err instanceof Error ? err.message : 'Failed' } })
  }

  return res.status(200).json({
    task: 'sync_schedule',
    results,
  })
}
