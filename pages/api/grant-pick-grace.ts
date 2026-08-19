import type { NextApiRequest, NextApiResponse } from 'next'
import { isValidOrigin } from '@/lib/validation'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getAuthUser, isAdmin } from '@/lib/apiAuth'
import { GRACE_PERIOD_MINUTES } from '@/lib/pickGrace'

/**
 * Reopen picks for one player, for one week, for GRACE_PERIOD_MINUTES.
 *
 * Scoped to (user, week, season) so it never reopens the week for anybody
 * else. The window is stored as an absolute expiry rather than a duration,
 * because the clock starts when the admin grants it — not at kickoff — and it
 * has to keep running down even if nobody has the page open.
 *
 * Granting again for the same player and week restarts the 20 minutes, which
 * is what you want when someone asks for "a couple more minutes" twice.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!isValidOrigin(req)) return res.status(403).json({ error: 'Invalid origin' })
  if (!(await isAdmin(req))) return res.status(403).json({ error: 'Unauthorized — admin access required' })

  const { userId, week, season, revoke } = req.body ?? {}

  if (!userId || !week || !season) {
    return res.status(400).json({ error: 'Missing required fields: userId, week, season' })
  }

  const supabase = getAdminClient()

  try {
    if (revoke) {
      const { error } = await supabase
        .from('pick_grace')
        .delete()
        .eq('user_id', userId).eq('week', week).eq('season', season)
      if (error) throw error
      return res.status(200).json({ success: true, revoked: true })
    }

    const { data: player } = await supabase
      .from('users').select('name').eq('id', userId).maybeSingle()
    if (!player) return res.status(404).json({ error: 'Player not found' })

    const grantedBy = (await getAuthUser(req))?.id ?? null
    const expiresAt = new Date(Date.now() + GRACE_PERIOD_MINUTES * 60_000)

    const { error } = await supabase.from('pick_grace').upsert({
      user_id: userId,
      week,
      season,
      // Stored the same way as games.kickoff_time: UTC wall time in a
      // timestamp column, which parseUTC reads back correctly.
      expires_at: expiresAt.toISOString(),
      granted_by: grantedBy,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,week,season' })

    if (error) {
      if (error.message?.includes('pick_grace')) {
        return res.status(500).json({
          error: 'The pick_grace table does not exist yet. Run supabase/migrations/09_pick_grace.sql in the Supabase SQL editor.',
        })
      }
      throw error
    }

    return res.status(200).json({
      success: true,
      expiresAt: expiresAt.toISOString(),
      minutes: GRACE_PERIOD_MINUTES,
      message: `${player.name} can submit Week ${week} picks for the next ${GRACE_PERIOD_MINUTES} minutes.`,
    })
  } catch (err) {
    console.error('grant-pick-grace error:', err)
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to update the grace period',
    })
  }
}
