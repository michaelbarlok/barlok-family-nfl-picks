import { fetchBowlSeason, type EspnGame, type Fetcher } from '@/lib/bowls/espn'
import { gameRowFitter, loadGames } from '@/lib/bowls/season'
import { SAMPLE_PREFIX, isSampleTeam, sortGames, teamToRow, type BowlGame, type BowlTeam } from '@/lib/bowls/sheet'

/*
 * "Preview with real teams" — before the matchups are known, fill every empty
 * team slot with last season's bowl teams from ESPN (names, logos, ranks and
 * records), so the admin can see how the pick'em will look. Each bowl gets
 * the teams it had last year where it can; anything left over takes the next
 * unused matchup (playoff teams show up in each round they reached, as they
 * did last year).
 *
 * Only empty slots are filled, never a real team, and never a playoff slot
 * linked to the game its winner comes from (that one shows the pick). Every
 * sample team's id starts with SAMPLE_PREFIX, which is how they're removed
 * and how opening picks knows they're still there.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

const sample = (t: BowlTeam): BowlTeam => ({ ...t, id: `${SAMPLE_PREFIX}${t.id}` })
const byKickoff = <T extends { kickoff_time: string | null }>(a: T, b: T) => (a.kickoff_time ?? '').localeCompare(b.kickoff_time ?? '')

export async function fillSampleTeams(supabase: Db, season: number, fetcher: Fetcher): Promise<{ games: number; teams: number; from: number }> {
  const games = (await loadGames(supabase, season)).filter(g => !g.removed)
  const lastYear = (await fetchBowlSeason(season - 1, fetcher)).filter(g => g.away && g.home).sort(byKickoff)
  if (!lastYear.length) throw new Error(`ESPN has no ${season - 1} bowl games to borrow teams from.`)

  // Same-named games pair up in kickoff order (the four "CFP First Round" games).
  const byName = new Map<string, EspnGame[]>()
  for (const g of lastYear) byName.set(g.name, [...(byName.get(g.name) ?? []), g])
  const used = new Set<string>()
  let reuse = 0
  const take = (g: BowlGame): EspnGame => {
    const same = (byName.get(g.name) ?? []).find(x => !used.has(x.espn_id))
    // More games this year than last: start over on last year's list.
    const pick = same ?? lastYear.find(x => !used.has(x.espn_id)) ?? lastYear[reuse++ % lastYear.length]
    used.add(pick.espn_id)
    return pick
  }

  // Named matches first, so a leftover game can't take a bowl's own teams.
  const ordered = sortGames(games)
  const named = ordered.filter(g => byName.has(g.name))
  const rest = ordered.filter(g => !byName.has(g.name))

  const fit = await gameRowFitter(supabase)
  let touched = 0, teams = 0
  for (const g of [...named, ...rest]) {
    const open = (['away', 'home'] as const).filter(side => !g[side] && !(side === 'away' ? g.away_from : g.home_from))
    if (!open.length) continue
    const src = take(g)
    let update: Record<string, unknown> = {}
    for (const side of open) update = { ...update, ...teamToRow(side, sample(src[side]!)) }
    const { error } = await supabase.from('bowl_games').update(fit(update)).eq('id', g.id)
    if (error) throw new Error(error.message)
    touched++
    teams += open.length
  }
  return { games: touched, teams, from: season - 1 }
}

/** Take every sample team off, leaving those slots TBD again. */
export async function clearSampleTeams(supabase: Db, season: number): Promise<{ games: number; teams: number }> {
  const games = await loadGames(supabase, season)
  const fit = await gameRowFitter(supabase)
  let touched = 0, teams = 0
  for (const g of games) {
    const sides = (['away', 'home'] as const).filter(side => isSampleTeam(g[side]?.id))
    if (!sides.length) continue
    let update: Record<string, unknown> = {}
    for (const side of sides) update = { ...update, ...teamToRow(side, null) }
    const { error } = await supabase.from('bowl_games').update(fit(update)).eq('id', g.id)
    if (error) throw new Error(error.message)
    touched++
    teams += sides.length
  }
  return { games: touched, teams }
}
