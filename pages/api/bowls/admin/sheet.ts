import type { NextApiRequest, NextApiResponse } from 'next'
import { isValidOrigin } from '@/lib/validation'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { bowlCaller } from '@/lib/bowls/server'
import { isMissingSheetTables, loadSeason, SHEET_MIGRATION_HINT } from '@/lib/bowls/season'
import { pullFromEspn, newGameRow } from '@/lib/bowls/sync'
import { espnFetch, fetchDate } from '@/lib/bowls/espn'
import { guessBracket, sheetIssues } from '@/lib/bowls/bracket'
import { PICKABLE_PHASES, onSheet, sortGames, type BowlGame, type Phase } from '@/lib/bowls/sheet'

/**
 * Bowl admin: building the pick sheet.
 *
 *   GET → every game ESPN has for the bowl season (on the sheet or not), the
 *         bracket, what's still missing, and when picks lock
 *   POST { action, ... }:
 *     pull                         → pull games, times and results from ESPN
 *     search { date }              → ESPN's games on a date (YYYY-MM-DD), to add one
 *     add { espnId, date, phase }  → put a game from that date on the sheet
 *     update { gameId, phase?, name?, removed? }
 *     link { gameId, side, from }  → bracket: this side is the winner of `from` (null to unlink)
 *     guess                        → fill unset bracket links from the rankings
 *     delete { gameId }            → drop a game added by date
 *     open                         → open picks (the sheet must be complete)
 *     setup                        → back to setting up (before the lock only)
 *
 * Results only ever come in through `pull` — there's no schedule.
 */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST' && !isValidOrigin(req)) return res.status(403).json({ error: 'Invalid origin' })
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const caller = await bowlCaller(req)
  if (!caller?.isAdmin) return res.status(403).json({ error: 'Bowl admin access required' })

  const supabase = getAdminClient()
  try {
    let loaded = await loadSeason(supabase)
    if (!loaded) return res.status(400).json({ error: 'There is no current bowl season.' })

    if (req.method === 'POST') {
      const body = req.body ?? {}
      const { state, games } = loaded
      const locked = state.status === 'locked' || state.status === 'complete'
      const byId = new Map(games.map(g => [g.id, g]))
      const fail = (msg: string, code = 400) => res.status(code).json({ error: msg })
      let note: unknown = null

      switch (body.action) {
        case 'pull': {
          note = await pullFromEspn(supabase, state.season, espnFetch)
          break
        }

        case 'search': {
          const date = String(body.date ?? '')
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('Pick a date.')
          const found = await fetchDate(date.replace(/-/g, ''), espnFetch)
          const inPool = new Map(games.map(g => [g.espn_id, g]))
          return res.status(200).json({
            games: found.map(g => ({
              espn_id: g.espn_id, name: g.name, kickoff_time: g.kickoff_time, time_tbd: g.time_tbd, tv: g.tv,
              away: g.away, home: g.home, status: g.status,
              phase: inPool.get(g.espn_id)?.phase ?? null,
              removed: inPool.get(g.espn_id)?.removed ?? false,
              inPool: inPool.has(g.espn_id),
            })),
          })
        }

        case 'add': {
          if (locked) return fail('Picks are locked — the games can’t change now.')
          const phase = body.phase as Phase
          if (!PICKABLE_PHASES.includes(phase)) return fail('Choose a phase for the game.')
          const date = String(body.date ?? '')
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('Pick a date.')
          const found = (await fetchDate(date.replace(/-/g, ''), espnFetch)).find(g => g.espn_id === String(body.espnId))
          if (!found) return fail("ESPN doesn't have that game on that date.", 404)
          const already = games.find(g => g.espn_id === found.espn_id)
          if (already) {
            if (already.playoff_round) return fail('Playoff games are already on the sheet.')
            const { error } = await supabase.from('bowl_games').update({ phase, removed: false }).eq('id', already.id)
            if (error) throw new Error(error.message)
          } else {
            const { error } = await supabase.from('bowl_games')
              .insert(newGameRow(state.season, found, new Date().toISOString(), { manual: true, phase }))
            if (error) throw new Error(error.message)
          }
          break
        }

        case 'update': {
          const g = byId.get(String(body.gameId))
          if (!g) return fail('Game not found', 404)
          const patch: Record<string, unknown> = {}
          if ('name' in body) {
            const name = String(body.name ?? '').trim().slice(0, 80)
            if (!name) return fail('Give the game a name.')
            patch.name = name
          }
          if ('removed' in body) patch.removed = !!body.removed
          if ('phase' in body) {
            if (locked) return fail('Picks are locked — phases can’t change now.')
            if (g.playoff_round) return fail('Playoff games keep their place on the sheet.')
            const phase = body.phase === null ? null : body.phase as Phase
            if (phase !== null && !PICKABLE_PHASES.includes(phase)) return fail('Unknown phase')
            patch.phase = phase
          }
          if (!Object.keys(patch).length) return fail('Nothing to change')
          const { error } = await supabase.from('bowl_games').update(patch).eq('id', g.id)
          if (error) throw new Error(error.message)
          break
        }

        case 'link': {
          if (locked) return fail('Picks are locked — the bracket can’t change now.')
          const g = byId.get(String(body.gameId))
          const side = body.side === 'away' || body.side === 'home' ? body.side : null
          if (!g || !side) return fail('Game not found', 404)
          if (!g.playoff_round) return fail('Only playoff games link up.')
          const from = body.from == null ? null : byId.get(String(body.from))
          if (body.from != null && (!from || !from.playoff_round || from.id === g.id)) return fail('Choose a playoff game.')
          // A game's winner goes to one place: moving it unhooks it elsewhere.
          if (from) {
            for (const other of games) {
              for (const s of ['away', 'home'] as const) {
                if ((s === 'away' ? other.away_from : other.home_from) === from.id && !(other.id === g.id && s === side)) {
                  const { error } = await supabase.from('bowl_games').update({ [`${s}_from`]: null }).eq('id', other.id)
                  if (error) throw new Error(error.message)
                }
              }
            }
          }
          const { error } = await supabase.from('bowl_games').update({ [`${side}_from`]: from?.id ?? null }).eq('id', g.id)
          if (error) throw new Error(error.message)
          break
        }

        case 'guess': {
          if (locked) return fail('Picks are locked — the bracket can’t change now.')
          for (const u of guessBracket(games)) {
            const { error } = await supabase.from('bowl_games').update({ [`${u.side}_from`]: u.from }).eq('id', u.gameId)
            if (error) throw new Error(error.message)
          }
          break
        }

        case 'delete': {
          const g = byId.get(String(body.gameId))
          if (!g) return fail('Game not found', 404)
          if (!g.manual) return fail('Games from the bowl schedule stay in the list — take it off the sheet instead.')
          if (state.status !== 'setup') return fail('Take it off the sheet instead — picks are already open.')
          const { error } = await supabase.from('bowl_games').delete().eq('id', g.id)
          if (error) throw new Error(error.message)
          break
        }

        case 'open': {
          if (state.status !== 'setup') return fail(state.status === 'open' ? 'Picks are already open.' : 'Picks are locked.')
          const issues = sheetIssues(games)
          if (issues.length) return fail(`Picks can't open — the games aren't ready: ${issues[0]}`)
          if (!state.lockAt || Date.parse(state.lockAt) <= Date.now()) return fail('The first game has already kicked off.')
          const { error } = await supabase.from('bowl_seasons').update({ status: 'open' }).eq('season', state.season)
          if (error) throw new Error(error.message)
          break
        }

        case 'setup': {
          if (state.status !== 'open') return fail(state.status === 'setup' ? 'Already setting up.' : 'Picks are locked.')
          const { error } = await supabase.from('bowl_seasons').update({ status: 'setup' }).eq('season', state.season)
          if (error) throw new Error(error.message)
          break
        }

        default:
          return fail('Unknown action')
      }

      loaded = (await loadSeason(supabase))!
      return res.status(200).json({ ...(await adminView(supabase, loaded)), result: note })
    }

    return res.status(200).json(await adminView(supabase, loaded))
  } catch (err) {
    if (isMissingSheetTables(err as Error)) return res.status(500).json({ error: SHEET_MIGRATION_HINT })
    console.error('bowls/admin/sheet error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Something went wrong' })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function adminView(supabase: any, loaded: NonNullable<Awaited<ReturnType<typeof loadSeason>>>) {
  const { state, games } = loaded
  const counts: Record<string, number> = {}
  for (const g of games.filter(onSheet)) counts[g.phase!] = (counts[g.phase!] ?? 0) + 1
  // How many players have started — so the admin knows changes now touch real picks.
  const { data: started } = await supabase.from('bowl_picks').select('player_id').eq('season', state.season)
  const playersWithPicks = new Set(((started ?? []) as { player_id: string }[]).map(r => r.player_id)).size
  return {
    ...state,
    games: sortGames(games) as BowlGame[],
    issues: sheetIssues(games),
    counts,
    playersWithPicks,
  }
}
