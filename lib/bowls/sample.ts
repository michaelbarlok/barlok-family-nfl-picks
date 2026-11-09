import { fetchBowlSeason, type EspnGame, type Fetcher } from '@/lib/bowls/espn'
import { gameRowFitter, loadGames } from '@/lib/bowls/season'
import { SAMPLE_PREFIX, isSampleTeam, sortGames, teamToRow, type BowlGame, type BowlTeam } from '@/lib/bowls/sheet'

/*
 * "Preview with real teams" — before the matchups are known, fill every empty
 * team slot with last season's bowl teams from ESPN (names, logos, ranks and
 * records), so the admin can see how the pick'em will look. Each bowl gets
 * the teams it had last year where it can; anything left over takes the next
 * unused matchup. The playoff goes round by round instead — last year's first
 * round into this year's first round, quarterfinals into quarterfinals, and so
 * on, whichever bowls host them (they rotate) — so the preview is last year's
 * bracket, and My Picks plays it out from your picks (see sampleBracket).
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

  // Bowls pair up by name; playoff games by round. Either way in kickoff order.
  const byName = new Map<string, EspnGame[]>()
  const byRound = new Map<string, EspnGame[]>()
  for (const g of lastYear) {
    if (g.playoff_round) byRound.set(g.playoff_round, [...(byRound.get(g.playoff_round) ?? []), g])
    else byName.set(g.name, [...(byName.get(g.name) ?? []), g])
  }
  const matches = (g: BowlGame) => (g.playoff_round ? byRound.get(g.playoff_round) : byName.get(g.name)) ?? []
  const sameName = (g: BowlGame) => matches(g).filter(x => x.name === g.name)
  const used = new Set<string>()
  let reuse = 0
  const take = (g: BowlGame): EspnGame => {
    // A bowl keeps its own teams if it was in the same round last year (the Rose Bowl's quarterfinal).
    const same = sameName(g).find(x => !used.has(x.espn_id)) ?? matches(g).find(x => !used.has(x.espn_id))
    // Anything left over takes an unused bowl matchup (a playoff one only if
    // that's all there is); more games this year than last: start over.
    const pick = same ?? lastYear.find(x => !used.has(x.espn_id) && !x.playoff_round)
      ?? lastYear.find(x => !used.has(x.espn_id)) ?? lastYear[reuse++ % lastYear.length]
    used.add(pick.espn_id)
    return pick
  }

  // Matches first, so a leftover game can't take a bowl's own teams — and
  // same-named ones first of all, so the rest of a round can't either.
  const ordered = sortGames(games)
  const named = ordered.filter(g => matches(g).length).sort((a, b) => Number(!sameName(a).length) - Number(!sameName(b).length))
  const rest = ordered.filter(g => !matches(g).length)

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
