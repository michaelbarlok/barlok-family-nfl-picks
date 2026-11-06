import type { NextApiRequest, NextApiResponse } from 'next'
import { isValidOrigin } from '@/lib/validation'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { bowlCaller, isMissingBowlTables, MIGRATION_HINT, originOf } from '@/lib/bowls/server'
import { addOrInvitePlayer } from '@/lib/bowls/invite'

/**
 * Bowl admin: this season's players.
 *
 *   GET                              → who's in, and whether each has signed in yet
 *   POST { action: 'remove', playerId } → take them out of this season
 *   POST { action: 'resend', playerId } → a fresh setup link (or a "you're in" note)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST' && !isValidOrigin(req)) return res.status(403).json({ error: 'Invalid origin' })
  const caller = await bowlCaller(req)
  if (!caller?.isAdmin) return res.status(403).json({ error: 'Bowl admin access required' })

  const supabase = getAdminClient()
  const { data: current, error: seasonErr } = await supabase
    .from('bowl_seasons').select('season, status').eq('is_current', true).maybeSingle()
  if (isMissingBowlTables(seasonErr)) return res.status(500).json({ error: MIGRATION_HINT })
  if (!current) return res.status(400).json({ error: 'There is no current bowl season.' })

  try {
    if (req.method === 'GET') {
      const { data: entries } = await supabase
        .from('bowl_entries').select('player_id, joined_at').eq('season', current.season)
      const ids = (entries ?? []).map((e: { player_id: string }) => e.player_id)
      const { data: players } = ids.length
        ? await supabase.from('bowl_players').select('id, name, email, avatar_url, is_admin').in('id', ids)
        : { data: [] }
      // Signed in yet? Only the auth admin API knows.
      const lastSignIn = new Map<string, string | null>()
      const { data: auth } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
      for (const u of auth?.users ?? []) lastSignIn.set(u.id, u.last_sign_in_at ?? null)
      const joined = new Map((entries ?? []).map((e: { player_id: string; joined_at: string }) => [e.player_id, e.joined_at]))
      const list = (players ?? []).map((p: { id: string; name: string; email: string | null; avatar_url: string | null; is_admin: boolean }) => ({
        ...p,
        joined_at: joined.get(p.id) ?? null,
        signed_in: !!lastSignIn.get(p.id),
      })).sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))
      return res.status(200).json({ season: current.season, status: current.status, players: list })
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const { action, playerId } = req.body ?? {}
    if (typeof playerId !== 'string' || !playerId) return res.status(400).json({ error: 'playerId is required' })

    if (action === 'remove') {
      const { error } = await supabase.from('bowl_entries').delete().eq('season', current.season).eq('player_id', playerId)
      if (error) throw error
      return res.status(200).json({ success: true, message: 'Removed from this season.' })
    }

    if (action === 'resend') {
      const { data: player } = await supabase.from('bowl_players').select('name, email').eq('id', playerId).maybeSingle()
      if (!player?.email) return res.status(404).json({ error: 'No email on file for that player' })
      const result = await addOrInvitePlayer({ origin: originOf(req), season: current.season, name: player.name, email: player.email })
      return res.status(200).json({ success: true, ...result })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (err) {
    console.error('bowls/players error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Something went wrong' })
  }
}
