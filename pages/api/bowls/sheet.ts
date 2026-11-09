import type { NextApiRequest, NextApiResponse } from 'next'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isMissingSheetTables, loadSeason, SHEET_MIGRATION_HINT } from '@/lib/bowls/season'
import { inSeason, pickTarget, storedPicks } from '@/lib/bowls/entry'
import { cleanBest5, cleanPicks } from '@/lib/bowls/bracket'
import { sampleBracket, samplePreview, sheetGames } from '@/lib/bowls/sheet'
import { managedBy } from '@/lib/bowls/managed'

/**
 * GET /api/bowls/sheet[?for=playerId]
 *
 * The pick sheet and your own picks, Best 5 and title-game total — or those
 * of the player named in `for`: a managed player you pick for, or (for the
 * bowl admin) anyone. Never anyone else's: until the sheet locks, other
 * players are counts only (/api/bowls/status).
 *
 * `managing` lists the managed players you pick for, for My Picks' tabs.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const target = await pickTarget(req, req.query.for)
  if ('error' in target) return res.status(target.code).json({ error: target.error })

  const supabase = getAdminClient()
  try {
    const loaded = await loadSeason(supabase)
    if (!loaded) return res.status(400).json({ error: 'There is no current bowl season.' })
    const { state, games } = loaded
    const managing = await managedBy(supabase, target.callerId, state.season)
    const base = { season: state.season, status: state.status, lockAt: state.lockAt, managing }

    const entry = await inSeason(supabase, state.season, target.playerId)
    if (!entry) {
      if (target.proxy) return res.status(404).json({ error: "That player isn't in this season's pick'em." })
      return res.status(200).json({ ...base, inSeason: false, games: [] })
    }

    // The sheet comes out when the admin opens picks. Before that the admin can
    // preview it — and so can everyone, while sample teams are on.
    const sample = samplePreview(state.status, games)
    const showSheet = state.status !== 'setup' || target.isAdmin || sample
    const stored = await storedPicks(supabase, state.season, target.playerId)
    const canEdit = state.status === 'open' || (state.status === 'locked' && target.override)
    return res.status(200).json({
      ...base,
      inSeason: true,
      player: { id: target.playerId, name: entry.name },
      proxy: target.proxy,
      sample,
      managed: target.manager,
      override: target.override,
      canEdit,
      // The preview's playoff follows last year's bracket (see sampleBracket).
      games: showSheet ? sheetGames(sample ? sampleBracket(games) : games) : [],
      picks: cleanPicks(games, stored.picks).picks,
      best5: cleanBest5(games, stored.best5),
      titleTotal: stored.titleTotal,
      enteredByAdmin: stored.enteredByAdmin,
    })
  } catch (err) {
    if (isMissingSheetTables(err as Error)) return res.status(500).json({ error: SHEET_MIGRATION_HINT })
    console.error('bowls/sheet error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Something went wrong' })
  }
}
