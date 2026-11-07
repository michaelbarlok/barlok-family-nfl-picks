import type { NextApiRequest, NextApiResponse } from 'next'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getAuthUser } from '@/lib/apiAuth'
import { isMissingSheetTables, loadSeason, SHEET_MIGRATION_HINT } from '@/lib/bowls/season'
import { progress } from '@/lib/bowls/bracket'
import { onSheet, samplePreview } from '@/lib/bowls/sheet'

/**
 * GET /api/bowls/status — where the season stands and how far along each
 * player is: how many picks, Best 5 and the title total. Counts only — never
 * which teams anyone picked — so it's safe for everyone, before and after the
 * lock.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!(await getAuthUser(req))) return res.status(401).json({ error: 'Sign in first' })

  const supabase = getAdminClient()
  try {
    const loaded = await loadSeason(supabase)
    if (!loaded) return res.status(400).json({ error: 'There is no current bowl season.' })
    const { state, games } = loaded
    const sheetOut = state.status !== 'setup'

    const { data: entries } = await supabase.from('bowl_entries').select('player_id').eq('season', state.season)
    const ids = ((entries ?? []) as { player_id: string }[]).map(e => e.player_id)
    const [{ data: players }, { data: picks, error: pErr }, { data: extras, error: xErr }] = await Promise.all([
      ids.length ? supabase.from('bowl_players').select('id, name, avatar_url').in('id', ids) : Promise.resolve({ data: [] }),
      supabase.from('bowl_picks').select('player_id, game_id, team_id').eq('season', state.season),
      supabase.from('bowl_extras').select('player_id, best5, title_total').eq('season', state.season),
    ])
    if (pErr) throw new Error(pErr.message)
    if (xErr) throw new Error(xErr.message)

    const pickMaps = new Map<string, Record<string, string>>()
    for (const p of (picks ?? []) as { player_id: string; game_id: string; team_id: string }[]) {
      const m = pickMaps.get(p.player_id) ?? {}
      m[p.game_id] = p.team_id
      pickMaps.set(p.player_id, m)
    }
    const extraMap = new Map(((extras ?? []) as { player_id: string; best5: string[]; title_total: number | null }[]).map(x => [x.player_id, x]))

    const sheet = games.filter(onSheet)
    const list = ((players ?? []) as { id: string; name: string; avatar_url: string | null }[])
      .map(p => {
        const x = extraMap.get(p.id)
        const prog = progress(sheetOut ? games : [], pickMaps.get(p.id) ?? {}, x?.best5, x?.title_total)
        return { id: p.id, name: p.name, avatar_url: p.avatar_url, picked: prog.picked, best5: prog.best5, hasTotal: prog.hasTotal, complete: prog.complete }
      })
      .sort((a, b) => a.name.localeCompare(b.name))

    return res.status(200).json({
      season: state.season,
      status: state.status,
      lockAt: sheetOut ? state.lockAt : null,
      totalGames: sheetOut ? sheet.length : 0,
      best5Needed: sheetOut ? Math.min(5, sheet.length) : 0,
      needsTotal: sheetOut && sheet.some(g => g.phase === 'title'),
      // Sample teams are on: My Picks has a preview anyone can try.
      preview: samplePreview(state.status, games),
      players: list,
    })
  } catch (err) {
    if (isMissingSheetTables(err as Error)) return res.status(500).json({ error: SHEET_MIGRATION_HINT })
    console.error('bowls/status error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Something went wrong' })
  }
}
