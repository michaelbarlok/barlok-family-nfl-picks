import type { NextApiRequest, NextApiResponse } from 'next'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { loadSeason, isMissingSheetTables } from '@/lib/bowls/season'
import { isMissingBowlTables } from '@/lib/bowls/server'
import { isMissingTalkTables } from '@/lib/bowls/notify'
import { dueReminder, sendReminders, siteOrigin } from '@/lib/bowls/reminders'

/**
 * Cron — every 15 minutes. The Bowl Pick'em's reminders (see
 * lib/bowls/reminders.ts): picks are open, then 72 hours, 24 hours, 1 hour and
 * 15 minutes before the first kickoff to whoever hasn't finished.
 *
 * Separate from the NFL's reminder crons and their log; it does nothing at all
 * until the admin opens bowl picks.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = req.headers.authorization ?? ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(403).json({ error: 'Unauthorized' })
  }
  const supabase = getAdminClient()

  try {
    const loaded = await loadSeason(supabase)
    if (!loaded) return res.status(200).json({ message: 'No bowl season.' })
    const { state } = loaded
    if (state.status !== 'open' || !state.lockAt) return res.status(200).json({ message: `Bowl picks are ${state.status}; nothing to send.` })

    const { data: log, error: logErr } = await supabase.from('bowl_reminder_log').select('kind, sent_at').eq('season', state.season)
    if (logErr) throw new Error(logErr.message)
    const { send, skip } = dueReminder(Date.now(), state.lockAt, state.status, log ?? [])

    // Ones that came due together with a later one are marked done unsent.
    if (skip.length) {
      await supabase.from('bowl_reminder_log')
        .upsert(skip.map(kind => ({ season: state.season, kind, recipients: 0 })), { onConflict: 'season,kind', ignoreDuplicates: true })
    }
    if (!send) return res.status(200).json({ message: 'No reminder due.', skipped: skip })

    // Claim it first: if another run got there, it's sending.
    const { error: claim } = await supabase.from('bowl_reminder_log').insert({ season: state.season, kind: send, recipients: 0 })
    if (claim) {
      if (claim.code === '23505' || /duplicate|unique/i.test(claim.message ?? '')) {
        return res.status(200).json({ message: `${send} already sent.` })
      }
      throw new Error(claim.message)
    }

    const result = await sendReminders(supabase, send, siteOrigin())
    await supabase.from('bowl_reminder_log').update({ recipients: result.players }).eq('season', state.season).eq('kind', send)
    return res.status(200).json({ ...result, skipped: skip })
  } catch (err) {
    const e = err as Error
    if (isMissingBowlTables(e) || isMissingSheetTables(e) || isMissingTalkTables(e)) {
      return res.status(200).json({ message: 'Bowl tables not set up; nothing to send.' })
    }
    console.error('bowls/cron-reminders error:', err)
    return res.status(500).json({ error: e.message ?? 'Something went wrong' })
  }
}
