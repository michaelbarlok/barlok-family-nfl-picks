import { easternDate, fetchBowlSeason, fetchDate, type EspnGame, type Fetcher } from '@/lib/bowls/espn'
import { phaseForRound, teamToRow, type GameRow } from '@/lib/bowls/sheet'

/*
 * "Pull from ESPN" — the only way bowl games, times and results come in.
 * Nothing calls this on a schedule; the bowl admin taps the button.
 *
 * ESPN owns the schedule, teams and results. The admin owns what the sheet
 * calls a game, its phase and the bracket links, and a pull never changes
 * those. A canceled or postponed game comes off the pick'em, and stays off
 * unless the admin puts it back.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface PullSummary {
  added: number
  updated: number
  finals: string[]
  removed: string[]
  notFound: string[]
  pulledAt: string
}

const started = (status: string | null | undefined) => status === 'in_progress' || status === 'final'

/** The ESPN-owned columns for a game, given what's stored now (if anything). */
export function espnColumns(g: EspnGame, existing: GameRow | null, now: string): GameRow {
  const out: GameRow = {
    espn_name: g.espn_name,
    kickoff_time: g.kickoff_time,
    time_tbd: g.time_tbd,
    tv: g.tv,
    venue: g.venue,
    status: g.status,
    status_detail: g.status_detail,
    away_score: g.away_score,
    home_score: g.home_score,
    winner_team_id: g.winner_team_id,
    synced_at: now,
  }
  // Teams, ranks and records: kept current until kickoff, then frozen, so a
  // finished bowl still shows the records people picked from. A TBD slot is
  // filled whenever ESPN has the team; a known team is never blanked.
  for (const side of ['away', 'home'] as const) {
    const t = g[side]
    if (!t) continue
    const known = existing?.[`${side}_team_id`]
    if (!known || (!started(existing?.status) && !started(g.status))) Object.assign(out, teamToRow(side, t))
  }
  if (g.status === 'canceled' || g.status === 'postponed') out.removed = true
  return out
}

export function newGameRow(season: number, g: EspnGame, now: string, opts: { manual?: boolean; phase?: string | null } = {}): GameRow {
  return {
    season,
    espn_id: g.espn_id,
    name: g.name,
    playoff_round: g.playoff_round,
    phase: opts.phase !== undefined ? opts.phase : phaseForRound(g.playoff_round),
    manual: !!opts.manual,
    removed: false,
    ...teamToRow('away', g.away),
    ...teamToRow('home', g.home),
    ...espnColumns(g, null, now),
  }
}

export async function pullFromEspn(supabase: Db, season: number, fetcher: Fetcher): Promise<PullSummary> {
  const now = new Date().toISOString()
  const espnGames = await fetchBowlSeason(season, fetcher)

  const { data: rows, error } = await supabase.from('bowl_games').select('*').eq('season', season)
  if (error) throw new Error(error.message)
  const existing = new Map<string, GameRow>(((rows ?? []) as GameRow[]).map(r => [r.espn_id, r]))

  const summary: PullSummary = { added: 0, updated: 0, finals: [], removed: [], notFound: [], pulledAt: now }

  const apply = async (g: EspnGame, row: GameRow) => {
    const cols = espnColumns(g, row, now)
    const { error: e } = await supabase.from('bowl_games').update(cols).eq('id', row.id)
    if (e) throw new Error(`Saving ${row.name} failed: ${e.message}`)
    summary.updated++
    if (g.status === 'final' && row.status !== 'final') summary.finals.push(row.name)
    if (cols.removed && !row.removed) summary.removed.push(row.name)
  }

  const fresh: GameRow[] = []
  for (const g of espnGames) {
    const row = existing.get(g.espn_id)
    if (row) await apply(g, row)
    else fresh.push(newGameRow(season, g, now))
  }
  if (fresh.length) {
    const { error: e } = await supabase.from('bowl_games').insert(fresh)
    if (e) throw new Error(`Adding games failed: ${e.message}`)
    summary.added = fresh.length
  }

  // Games added by date (Army–Navy) aren't in the bowl schedule: look them up
  // on their own day.
  const seen = new Set(espnGames.map(g => g.espn_id))
  const others = ((rows ?? []) as GameRow[]).filter(r => !seen.has(r.espn_id))
  const byDate = new Map<string, GameRow[]>()
  for (const r of others) {
    if (!r.kickoff_time) { summary.notFound.push(r.name); continue }
    const d = easternDate(r.kickoff_time)
    byDate.set(d, [...(byDate.get(d) ?? []), r])
  }
  for (const [date, list] of Array.from(byDate)) {
    const dayGames = await fetchDate(date, fetcher)
    for (const r of list) {
      const g = dayGames.find(x => x.espn_id === r.espn_id)
      if (g) await apply(g, r)
      else summary.notFound.push(r.name)
    }
  }

  await supabase.from('bowl_seasons').update({ espn_pulled_at: now }).eq('season', season)
  return summary
}
