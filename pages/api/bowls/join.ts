import type { NextApiRequest, NextApiResponse } from 'next'
import { isValidOrigin } from '@/lib/validation'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getAuthUser } from '@/lib/apiAuth'
import { currentBowlSeason, isMissingBowlTables, MIGRATION_HINT } from '@/lib/bowls/server'
import { copyPhotoForBowls } from '@/lib/bowls/photo'
import { loadSeason } from '@/lib/bowls/season'
import { carryOverManagers } from '@/lib/bowls/managed'

/**
 * Join this year's Bowl Pick'em with one tap.
 *
 * For a signed-in NFL player: makes their bowl profile from their NFL name
 * and photo (read, never changed) and enters them in this season. For someone
 * who played a past bowl season: enters them again. Anyone else needs an
 * invite from the bowl admin. Someone who makes picks for an NFL managed
 * player who's in the Bowl Pick'em makes their bowl picks too.
 *
 * Closed once the season's picks lock.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!isValidOrigin(req)) return res.status(403).json({ error: 'Invalid origin' })
  const user = await getAuthUser(req)
  if (!user) return res.status(401).json({ error: 'Sign in first' })

  const supabase = getAdminClient()
  try {
    const { data: seasonRow, error: seasonErr } = await supabase
      .from('bowl_seasons').select('season, status').eq('is_current', true).maybeSingle()
    if (isMissingBowlTables(seasonErr)) return res.status(500).json({ error: MIGRATION_HINT })
    const current = (seasonRow as Awaited<ReturnType<typeof currentBowlSeason>>) ?? null
    if (!current) return res.status(400).json({ error: 'There is no bowl season open to join yet.' })
    // Locked by the clock at the first kickoff on the sheet.
    let status = current.status
    try {
      const loaded = await loadSeason(supabase)
      if (loaded) status = loaded.state.status
    } catch { /* sheet tables not set up yet: go by the stored status */ }
    if (status === 'locked' || status === 'complete') {
      return res.status(400).json({ error: "This year's picks are already locked, so joining is closed." })
    }

    const { data: existing } = await supabase.from('bowl_players').select('id').eq('id', user.id).maybeSingle()
    if (!existing) {
      const { data: nfl } = await supabase.from('users').select('name, avatar_url').eq('id', user.id).maybeSingle()
      if (!nfl) {
        return res.status(403).json({ error: "This account isn't in the Bowl Pick'em. Ask Michael for an invite." })
      }
      const avatarUrl = await copyPhotoForBowls(supabase, user.id, nfl.avatar_url)
      const { error: insErr } = await supabase.from('bowl_players').insert({
        id: user.id,
        name: nfl.name,
        email: (user.email ?? '').toLowerCase() || null,
        avatar_url: avatarUrl,
      })
      if (insErr) throw insErr
    }

    const { error: entryErr } = await supabase.from('bowl_entries')
      .upsert({ season: current.season, player_id: user.id }, { onConflict: 'season,player_id', ignoreDuplicates: true })
    if (entryErr) throw entryErr
    await carryOverManagers(supabase, user.id)

    return res.status(200).json({ success: true, season: current.season })
  } catch (err) {
    console.error('bowls/join error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Could not join' })
  }
}
