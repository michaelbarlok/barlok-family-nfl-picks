import { PHASE_BY_KEY, PHASES, onSheet, sortGames, type BowlGame, type BowlTeam, type Phase } from '@/lib/bowls/sheet'
import { cleanBest5, cleanPicks, indexGames, optionsFor, type PickMap } from '@/lib/bowls/bracket'
import type { Elimination } from '@/lib/bowls/elimination'

/*
 * Bowl Pick'em scoring, from the family rules:
 *
 *   Phase 1 · 1 point a win · Phase 2 · 1.5 · Phase 3 · 2 · The Playoff · 3
 *   Semifinals · 3 each · Champion · 3 (no penalty for a wrong pick)
 *
 * Standings: total points, then Best 5 record, then semifinal record, then
 * the closest guess at the title game's total points — on an equal miss, the
 * guess under wins.
 *
 * Records work like the NFL side's: a decided game you didn't pick is a loss.
 * Best 5 follows Best 3 — a starred game counts its result (a win only if you
 * picked the winner), and once the games are under way every Best 5 spot left
 * empty is a loss, so starring nothing never beats starring badly. A record
 * compares on wins, then on fewer losses.
 *
 * Results are whatever the last "Pull from ESPN" brought in. Canceled or
 * postponed games are off the pick'em and count for nobody.
 */

export interface Entry {
  id: string
  name: string
  avatar_url: string | null
  picks: PickMap
  best5: string[]
  titleTotal: number | null
}

/** How one pick stands. `dead`: not played yet, but the team can't win it any more. */
export type PickState = 'won' | 'lost' | 'pending' | 'dead'
export type Tiebreak = 'best5' | 'semis' | 'total'

export interface Standing {
  id: string
  name: string
  avatar_url: string | null
  rank: number
  /** Level with someone after every tiebreaker. */
  tied: boolean
  /** Level on points with the next player down, and ahead of them on this. */
  aheadOn: Tiebreak | null
  points: number
  maxPoints: number
  wins: number
  losses: number
  pending: number
  picked: number
  best5: string[]
  best5Wins: number
  best5Losses: number
  semiWins: number
  semiLosses: number
  champion: BowlTeam | null
  championState: PickState | null
  titleTotal: number | null
  /** How far off the title-game total was, once it's final. */
  titleMiss: number | null
  titleUnder: boolean | null
  byPhase: Record<Phase, number>
  /** Mathematically eliminated, and why (see lib/bowls/elimination). Set by the board. */
  out?: Elimination | null
}

export interface Scoreboard {
  standings: Standing[]
  decided: number
  total: number
  titleActual: number | null
}

/** Every team on the board, by ESPN id — for showing a pick's team anywhere. */
export function teamDirectory(games: BowlGame[]): Map<string, BowlTeam> {
  const out = new Map<string, BowlTeam>()
  for (const g of games) for (const t of [g.away, g.home]) if (t && !out.has(t.id)) out.set(t.id, t)
  return out
}

/** Playoff teams that are out: they've lost a playoff game. */
export function eliminated(games: BowlGame[]): Set<string> {
  const out = new Set<string>()
  for (const g of games) {
    if (!g.playoff_round || g.removed || g.status !== 'final' || !g.winner_team_id) continue
    for (const t of [g.away, g.home]) if (t && t.id !== g.winner_team_id) out.add(t.id)
  }
  return out
}

export const isDecided = (g: BowlGame) => g.status === 'final' && !!g.winner_team_id

export function pickState(g: BowlGame, teamId: string, out: Set<string>): PickState {
  if (isDecided(g)) return teamId === g.winner_team_id ? 'won' : 'lost'
  if (g.playoff_round) {
    if (out.has(teamId)) return 'dead'
    if (g.away && g.home && teamId !== g.away.id && teamId !== g.home.id) return 'dead'
  }
  return 'pending'
}

const emptyByPhase = () => Object.fromEntries(PHASES.map(p => [p.key, 0])) as Record<Phase, number>

export function score(games: BowlGame[], entries: Entry[]): Scoreboard {
  const sheet = sortGames(games.filter(onSheet))
  const byId = indexGames(games)
  const out = eliminated(games)
  const teams = teamDirectory(games)
  const title = sheet.find(g => g.phase === 'title') ?? null
  const titleActual = title && isDecided(title) && title.away_score !== null && title.home_score !== null
    ? title.away_score + title.home_score : null

  const anyDecided = sheet.some(isDecided)
  const rows: Standing[] = entries.map(e => {
    const picks = cleanPicks(games, e.picks).picks
    const best5 = cleanBest5(games, e.best5)
    const r: Standing = {
      id: e.id, name: e.name, avatar_url: e.avatar_url,
      rank: 0, tied: false, aheadOn: null,
      points: 0, maxPoints: 0, wins: 0, losses: 0, pending: 0, picked: 0,
      best5, best5Wins: 0, best5Losses: 0, semiWins: 0, semiLosses: 0,
      champion: null, championState: null,
      titleTotal: e.titleTotal, titleMiss: null, titleUnder: null,
      byPhase: emptyByPhase(),
    }
    let possible = 0
    for (const g of sheet) {
      const t = picks[g.id]
      // No pick: nothing to win, and a loss once the game is decided.
      const st: PickState | null = t ? pickState(g, t, out) : isDecided(g) ? 'lost' : null
      if (t) r.picked++
      if (!st) continue
      const pts = PHASE_BY_KEY[g.phase!].points
      if (st === 'won') { r.points += pts; r.wins++; r.byPhase[g.phase!] += pts }
      else if (st === 'lost') r.losses++
      else if (st === 'pending') { possible += pts; r.pending++ }
      if (g.phase === 'semi') { if (st === 'won') r.semiWins++; else if (st === 'lost') r.semiLosses++ }
      if (best5.includes(g.id)) { if (st === 'won') r.best5Wins++; else if (st === 'lost') r.best5Losses++ }
    }
    // Best 5 spots never filled: a loss each, once games have results.
    if (anyDecided) r.best5Losses += Math.max(0, 5 - best5.length)
    if (title && picks[title.id]) {
      const [a, h] = optionsFor(title, byId, picks)
      r.champion = [a, h].find(t => t?.id === picks[title.id]) ?? teams.get(picks[title.id]) ?? null
      r.championState = pickState(title, picks[title.id], out)
    }
    if (titleActual !== null && e.titleTotal !== null) {
      r.titleMiss = Math.abs(e.titleTotal - titleActual)
      r.titleUnder = e.titleTotal <= titleActual
    }
    r.maxPoints = r.points + possible
    return r
  })

  rows.sort((a, b) => compare(a, b, titleActual)[0] || a.name.localeCompare(b.name))
  rows.forEach((r, i) => {
    if (i === 0) { r.rank = 1; return }
    const above = rows[i - 1]
    const [c, why] = compare(above, r, titleActual)
    if (c === 0) { r.rank = above.rank; r.tied = above.tied = true }
    else {
      r.rank = i + 1
      if (above.points === r.points) above.aheadOn = why
    }
  })

  return { standings: rows, decided: sheet.filter(isDecided).length, total: sheet.length, titleActual }
}

/** Negative when `a` ranks ahead of `b`, and which tiebreaker decided it. */
export function compare(a: Standing, b: Standing, titleActual: number | null): [number, Tiebreak | null] {
  if (a.points !== b.points) return [b.points - a.points, null]
  if (a.best5Wins !== b.best5Wins) return [b.best5Wins - a.best5Wins, 'best5']
  if (a.best5Losses !== b.best5Losses) return [a.best5Losses - b.best5Losses, 'best5']
  if (a.semiWins !== b.semiWins) return [b.semiWins - a.semiWins, 'semis']
  if (a.semiLosses !== b.semiLosses) return [a.semiLosses - b.semiLosses, 'semis']
  if (titleActual !== null) {
    const am = a.titleMiss, bm = b.titleMiss
    if (am !== null || bm !== null) {
      if (am === null) return [1, 'total']
      if (bm === null) return [-1, 'total']
      if (am !== bm) return [am - bm, 'total']
      if (a.titleUnder !== b.titleUnder) return [a.titleUnder ? -1 : 1, 'total']
    }
  }
  return [0, null]
}

export const TIEBREAK_LABEL: Record<Tiebreak, string> = {
  best5: 'Best 5',
  semis: 'semifinal picks',
  total: 'title-game total',
}
