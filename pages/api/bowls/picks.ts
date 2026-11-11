import type { NextApiRequest, NextApiResponse } from 'next'
import { isValidOrigin } from '@/lib/validation'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isMissingSheetTables, loadSeason, SHEET_MIGRATION_HINT } from '@/lib/bowls/season'
import { inSeason, OVERRIDE_BEFORE_LOCK, overrideAllowed, pickTarget, storedPicks } from '@/lib/bowls/entry'
import { cleanBest5, cleanPicks } from '@/lib/bowls/bracket'
import { onSheet } from '@/lib/bowls/sheet'

/**
 * POST /api/bowls/picks
 *   { for?, picks?: { [gameId]: teamId | null }, best5?: gameId[], titleTotal?: number | null }
 *
 * Saves picks while the sheet is open — your own, or a managed player's you
 * pick for. All picks are due at the first kickoff; after that only the bowl
 * admin can change them, for someone who sent theirs in on time (like the NFL
 * override). The admin can't touch anyone else's picks before then: the
 * override opens at the lock, the same moment everyone's picks come out.
 *
 * The playoff is the player's own bracket: a later-round pick must be a team
 * they picked to get there. Changing an earlier pick clears the later picks it
 * knocks out — they come back in `cleared`.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!isValidOrigin(req)) return res.status(403).json({ error: 'Invalid origin' })
  const body = req.body ?? {}
  const target = await pickTarget(req, body.for)
  if ('error' in target) return res.status(target.code).json({ error: target.error })

  const supabase = getAdminClient()
  try {
    const loaded = await loadSeason(supabase)
    if (!loaded) return res.status(400).json({ error: 'There is no current bowl season.' })
    const { state, games } = loaded
    if (!overrideAllowed(target, state.status)) return res.status(403).json({ error: OVERRIDE_BEFORE_LOCK })
    if (state.status === 'setup') return res.status(400).json({ error: "Picks aren't open yet." })
    if (state.status === 'complete') return res.status(400).json({ error: 'This bowl season is over.' })
    if (state.status === 'locked' && !target.override) {
      return res.status(400).json({ error: 'Picks are locked — they were due at the first kickoff.' })
    }
    if (!(await inSeason(supabase, state.season, target.playerId))) {
      return res.status(403).json({ error: "Not in this season's pick'em." })
    }

    const sheetIds = new Set(games.filter(onSheet).map(g => g.id))
    const stored = await storedPicks(supabase, state.season, target.playerId)
    const enteredBy = target.proxy ? target.callerId : null
    const now = new Date().toISOString()

    // ── picks ──
    const next: Record<string, string> = { ...stored.picks }
    const requested: string[] = []
    const rejected: string[] = []
    if (body.picks !== undefined) {
      if (typeof body.picks !== 'object' || body.picks === null || Array.isArray(body.picks)) {
        return res.status(400).json({ error: 'picks must be an object' })
      }
      for (const [gameId, teamId] of Object.entries(body.picks as Record<string, unknown>)) {
        if (!sheetIds.has(gameId)) { rejected.push(gameId); continue }
        if (teamId === null) delete next[gameId]
        else if (typeof teamId === 'string' && teamId) { next[gameId] = teamId; requested.push(gameId) }
        else rejected.push(gameId)
      }
    }
    const { picks: valid, cleared: knocked } = cleanPicks(games, next)
    for (const id of requested) if (!valid[id]) rejected.push(id)
    const cleared = knocked.filter(id => !requested.includes(id))

    const upserts = Array.from(sheetIds)
      .filter(id => valid[id] && valid[id] !== stored.picks[id])
      .map(id => ({ season: state.season, player_id: target.playerId, game_id: id, team_id: valid[id], entered_by: enteredBy, updated_at: now }))
    const deletes = Array.from(sheetIds).filter(id => stored.picks[id] && !valid[id])
    if (upserts.length) {
      const { error } = await supabase.from('bowl_picks').upsert(upserts, { onConflict: 'player_id,game_id' })
      if (error) throw new Error(error.message)
    }
    if (deletes.length) {
      const { error } = await supabase.from('bowl_picks').delete().eq('player_id', target.playerId).in('game_id', deletes)
      if (error) throw new Error(error.message)
    }

    // ── Best 5 and the title-game total ──
    // Like Best 3 on the NFL side, a star goes only on a game you've picked:
    // one asked for on an unpicked game is dropped, and a star comes off when
    // its game's pick does (a changed playoff pick can clear later ones).
    const starred = (ids: string[]) => cleanBest5(games, ids).filter(id => valid[id])
    const storedBest5 = cleanBest5(games, stored.best5)
    let best5 = starred(storedBest5)
    let titleTotal = stored.titleTotal
    if (body.best5 !== undefined || body.titleTotal !== undefined || best5.length !== storedBest5.length) {
      if (body.best5 !== undefined) {
        if (!Array.isArray(body.best5) || body.best5.some((x: unknown) => typeof x !== 'string')) {
          return res.status(400).json({ error: 'best5 must be a list of games' })
        }
        if (new Set(body.best5).size > 5) return res.status(400).json({ error: 'Best 5 is five games.' })
        best5 = starred(body.best5)
      }
      if (body.titleTotal !== undefined) {
        const t = body.titleTotal
        if (t !== null && !(Number.isInteger(t) && t >= 0 && t <= 250)) {
          return res.status(400).json({ error: 'Total points should be a whole number from 0 to 250.' })
        }
        titleTotal = t
      }
      const { error } = await supabase.from('bowl_extras').upsert({
        season: state.season, player_id: target.playerId, best5, title_total: titleTotal, entered_by: enteredBy, updated_at: now,
      }, { onConflict: 'season,player_id' })
      if (error) throw new Error(error.message)
    }

    return res.status(200).json({ picks: valid, best5, titleTotal, cleared, rejected })
  } catch (err) {
    if (isMissingSheetTables(err as Error)) return res.status(500).json({ error: SHEET_MIGRATION_HINT })
    console.error('bowls/picks error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Could not save' })
  }
}
