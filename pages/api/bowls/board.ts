import type { NextApiRequest, NextApiResponse } from 'next'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { bowlCaller } from '@/lib/bowls/server'
import { isMissingSheetTables, loadSeason, SHEET_MIGRATION_HINT } from '@/lib/bowls/season'
import { cleanBest5, cleanPicks } from '@/lib/bowls/bracket'
import { score, type Entry } from '@/lib/bowls/scoring'
import { eliminations } from '@/lib/bowls/elimination'
import { samplePreview, sheetGames } from '@/lib/bowls/sheet'
import { demoBoard } from '@/lib/bowls/demo'

/**
 * GET /api/bowls/board — everyone's picks and the standings.
 *
 * Only once picks lock at the first kickoff. Before that it says so and
 * nothing more — no picks, Best 5 or totals for anyone, the admin included.
 * Results are as of the last pull from ESPN — the results job's, every 10
 * minutes while games are on, or the admin's "Update results".
 *
 * Each row of the standings says whether that player is mathematically
 * eliminated, and why — worked out fresh from the latest results.
 *
 * While sample teams are on, the admin gets a made-up board instead (`demo`):
 * made-up players, picks and results on the sample games, to see Standings
 * and All Picks full. Built on the fly, never saved, and only for the admin.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const caller = await bowlCaller(req)
  if (!caller) return res.status(401).json({ error: 'Sign in first' })

  const supabase = getAdminClient()
  try {
    if (!caller.isAdmin) {
      const { data: me } = await supabase.from('bowl_players').select('id').eq('id', caller.user.id).maybeSingle()
      if (!me) return res.status(403).json({ error: "This account isn't in the Bowl Pick'em." })
    }
    const loaded = await loadSeason(supabase)
    if (!loaded) return res.status(400).json({ error: 'There is no current bowl season.' })
    const { state, games } = loaded
    const base = { season: state.season, status: state.status, lockAt: state.lockAt, pulledAt: state.pulledAt }
    if (state.status === 'setup' && caller.isAdmin && samplePreview(state.status, games)) {
      const { data: me } = await supabase.from('bowl_players').select('name, avatar_url').eq('id', caller.user.id).maybeSingle()
      const you = { id: caller.user.id, name: (me as { name?: string } | null)?.name ?? 'You', avatar_url: (me as { avatar_url?: string | null } | null)?.avatar_url ?? null }
      const demo = demoBoard(games, you)
      const board = withEliminations(demo.games, demo.entries)
      return res.status(200).json({
        ...base,
        hidden: false,
        demo: true,
        games: sheetGames(demo.games),
        players: board.standings.map(s => ({ id: s.id, name: s.name, avatar_url: s.avatar_url })),
        picks: Object.fromEntries(demo.entries.map(e => [e.id, e.picks])),
        best5: Object.fromEntries(demo.entries.map(e => [e.id, e.best5])),
        titleTotals: Object.fromEntries(demo.entries.map(e => [e.id, e.titleTotal])),
        ...board,
      })
    }
    if (state.status === 'setup' || state.status === 'open') {
      return res.status(200).json({ ...base, hidden: true })
    }

    const { data: entryRows } = await supabase.from('bowl_entries').select('player_id').eq('season', state.season)
    const ids = ((entryRows ?? []) as { player_id: string }[]).map(e => e.player_id)
    const [{ data: players }, { data: pickRows, error: pErr }, { data: extraRows, error: xErr }] = await Promise.all([
      ids.length ? supabase.from('bowl_players').select('id, name, avatar_url').in('id', ids) : Promise.resolve({ data: [] }),
      supabase.from('bowl_picks').select('player_id, game_id, team_id').eq('season', state.season),
      supabase.from('bowl_extras').select('player_id, best5, title_total').eq('season', state.season),
    ])
    if (pErr) throw new Error(pErr.message)
    if (xErr) throw new Error(xErr.message)

    const raw = new Map<string, Record<string, string>>()
    for (const p of (pickRows ?? []) as { player_id: string; game_id: string; team_id: string }[]) {
      raw.set(p.player_id, { ...(raw.get(p.player_id) ?? {}), [p.game_id]: p.team_id })
    }
    const extras = new Map(((extraRows ?? []) as { player_id: string; best5: string[]; title_total: number | null }[]).map(x => [x.player_id, x]))
    const entries: Entry[] = ((players ?? []) as { id: string; name: string; avatar_url: string | null }[])
      .filter(p => ids.includes(p.id))
      .map(p => ({
        id: p.id, name: p.name, avatar_url: p.avatar_url,
        picks: cleanPicks(games, raw.get(p.id) ?? {}).picks,
        best5: cleanBest5(games, extras.get(p.id)?.best5),
        titleTotal: extras.get(p.id)?.title_total ?? null,
      }))
    const board = withEliminations(games, entries)

    return res.status(200).json({
      ...base,
      hidden: false,
      games: sheetGames(games),
      players: board.standings.map(s => ({ id: s.id, name: s.name, avatar_url: s.avatar_url })),
      picks: Object.fromEntries(entries.map(e => [e.id, e.picks])),
      best5: Object.fromEntries(entries.map(e => [e.id, e.best5])),
      titleTotals: Object.fromEntries(entries.map(e => [e.id, e.titleTotal])),
      ...board,
    })
  } catch (err) {
    if (isMissingSheetTables(err as Error)) return res.status(500).json({ error: SHEET_MIGRATION_HINT })
    console.error('bowls/board error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Something went wrong' })
  }
}

function withEliminations(games: Parameters<typeof score>[0], entries: Entry[]) {
  const board = score(games, entries)
  const { out, unsure } = eliminations(games, entries, board)
  for (const s of board.standings) s.out = out[s.id] ?? null
  if (unsure.length) console.warn(`bowls/board: elimination search ran out of time for ${unsure.length} player(s)`)
  return board
}
