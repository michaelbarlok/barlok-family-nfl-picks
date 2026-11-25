import { onSheet, type BowlGame, type BowlTeam, type PlayoffRound } from '@/lib/bowls/sheet'
import type { PickMap } from '@/lib/bowls/bracket'
import { eliminated, pickState, teamDirectory } from '@/lib/bowls/scoring'

/*
 * The playoff as a bracket: rounds in order, each round's games lined up with
 * the games they feed (so a quarterfinal sits beside its first-round game and
 * a semifinal between its two quarterfinals), and how everyone's champion pick
 * is doing.
 */

export interface BracketRound { key: PlayoffRound; label: string; games: BowlGame[] }

const LABEL: Record<PlayoffRound, string> = { first: 'First round', quarter: 'Quarterfinals', semi: 'Semifinals', title: 'Championship' }
const byKick = (a: BowlGame, b: BowlGame) => (a.kickoff_time ?? '').localeCompare(b.kickoff_time ?? '') || a.id.localeCompare(b.id)

export function bracketRounds(games: BowlGame[]): BracketRound[] {
  const playoff = games.filter(g => onSheet(g) && g.playoff_round)
  const of = (r: PlayoffRound) => playoff.filter(g => g.playoff_round === r).sort(byKick)
  const byId = new Map(playoff.map(g => [g.id, g]))
  // Work back from the title game, following the links, so each round lines up
  // with the one after it; anything unlinked goes at the end, by kickoff.
  const feeders = (later: BowlGame[], round: PlayoffRound): BowlGame[] => {
    const out: BowlGame[] = []
    for (const g of later) for (const from of [g.away_from, g.home_from]) {
      const f = from ? byId.get(from) : undefined
      if (f && f.playoff_round === round && !out.includes(f)) out.push(f)
    }
    return [...out, ...of(round).filter(g => !out.includes(g))]
  }
  const title = of('title')
  const semis = feeders(title, 'semi')
  const quarters = feeders(semis, 'quarter')
  const firsts = feeders(quarters, 'first')
  return ([['first', firsts], ['quarter', quarters], ['semi', semis], ['title', title]] as [PlayoffRound, BowlGame[]][])
    .filter(([, list]) => list.length)
    .map(([key, list]) => ({ key, label: LABEL[key], games: list }))
}

export interface ChampionPick { team: BowlTeam; players: string[]; state: 'alive' | 'won' | 'out' }

export interface PlayoffSummary {
  /** Players with a champion pick. */
  total: number
  /** Their champion can still win it (or has). */
  alive: number
  /** The title game is decided. */
  decided: boolean
  /** How many called the champion (once decided). */
  called: number
  /** Brackets with every playoff pick right so far (none lost, none out). */
  perfect: number
  champions: ChampionPick[]
}

export function playoffSummary(games: BowlGame[], picks: Record<string, PickMap>, playerIds: string[]): PlayoffSummary {
  const title = games.find(g => onSheet(g) && g.playoff_round === 'title')
  const playoff = games.filter(g => onSheet(g) && g.playoff_round)
  const out = eliminated(games)
  const teams = teamDirectory(games)
  const tally = new Map<string, ChampionPick>()
  let total = 0, alive = 0, called = 0, perfect = 0
  for (const id of playerIds) {
    const mine = picks[id] ?? {}
    const states = playoff.filter(g => mine[g.id]).map(g => pickState(g, mine[g.id], out))
    if (states.length && states.every(s => s === 'won' || s === 'pending')) perfect++
    const t = title ? mine[title.id] : undefined
    const team = t ? teams.get(t) : undefined
    if (!title || !t || !team) continue
    total++
    const st = pickState(title, t, out)
    const state = st === 'won' ? 'won' : st === 'pending' ? 'alive' : 'out'
    if (state !== 'out') alive++
    if (state === 'won') called++
    const row = tally.get(t) ?? { team, players: [], state }
    row.players.push(id)
    tally.set(t, row)
  }
  const rank = { won: 0, alive: 1, out: 2 } as const
  return {
    total,
    alive,
    decided: !!title && title.status === 'final' && !!title.winner_team_id,
    called,
    perfect,
    champions: Array.from(tally.values()).sort((a, b) => rank[a.state] - rank[b.state] || b.players.length - a.players.length || a.team.name.localeCompare(b.team.name)),
  }
}
