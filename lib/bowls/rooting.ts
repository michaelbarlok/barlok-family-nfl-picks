import { optionsFor, indexGames, type PickMap } from '@/lib/bowls/bracket'
import { onSheet, PHASE_BY_KEY, sortGames, type BowlGame, type BowlTeam } from '@/lib/bowls/sheet'
import { eliminated, isDecided, pickState, teamDirectory, type Standing } from '@/lib/bowls/scoring'

/*
 * The rooting guide: for one player, the games still to play where their
 * pick differs from the people that matter to them — so they know who to
 * cheer for, and how much each game is worth.
 *
 *   chasing   compared with the top 3 (the leader and the next two)
 *   leading   compared with everyone within 2 points of them
 *   out       eliminated: no guide, just why
 *
 * Only picks still alive count: a pick on a team that's already out of the
 * playoff can't win anything, so it's no pick at all here.
 */

export type RootMode = 'leading' | 'chasing' | 'out' | 'none'

export interface Rival { id: string; name: string; points: number; rank: number; tied: boolean }

export interface RootRow {
  game: BowlGame
  points: number
  /** Your pick, if it can still win. */
  mine: BowlTeam | null
  myStar: boolean
  /** Who to cheer for: your pick, or — with none — whoever beats the rivals' pick. */
  rootFor: BowlTeam | null
  /** With no live pick of your own: the team your rivals need. */
  rootAgainst: BowlTeam | null
  /** The rivals who picked differently, by what they have (team null: no live pick). */
  others: { team: BowlTeam | null; rivals: Rival[] }[]
}

export interface RootingGuide {
  mode: RootMode
  rivals: Rival[]
  rows: RootRow[]
  reason?: string
}

export const LEAD_MARGIN = 2

interface BoardLike {
  games?: BowlGame[]
  picks?: Record<string, PickMap>
  best5?: Record<string, string[]>
  standings?: (Standing & { out?: { text: string } | null })[]
}

export function rootingGuide(board: BoardLike, meId: string | undefined): RootingGuide {
  const none: RootingGuide = { mode: 'none', rivals: [], rows: [] }
  const standings = board.standings ?? []
  const me = standings.find(s => s.id === meId)
  const games = board.games ?? []
  if (!me) return none
  const left = sortGames(games.filter(g => onSheet(g) && !isDecided(g)))
    .sort((a, b) => (a.kickoff_time ?? '').localeCompare(b.kickoff_time ?? ''))
  if (!left.length) return none
  if (me.out) return { mode: 'out', rivals: [], rows: [], reason: me.out.text }

  const asRival = (s: Standing): Rival => ({ id: s.id, name: s.name, points: s.points, rank: s.rank, tied: s.tied })
  const leading = me.rank === 1
  const rivals = (leading
    ? standings.filter(s => s.id !== me.id && !s.out && me.points - s.points <= LEAD_MARGIN)
    : standings.filter(s => s.id !== me.id).slice(0, 3)
  ).map(asRival)
  const mode: RootMode = leading ? 'leading' : 'chasing'
  if (!rivals.length) return { mode, rivals, rows: [] }

  const byId = indexGames(games)
  const out = eliminated(games)
  const teams = teamDirectory(games)
  const picksOf = (id: string) => board.picks?.[id] ?? {}
  // A pick that can still win this game, as a team; null for no pick or one that's out.
  const live = (id: string, g: BowlGame): BowlTeam | null => {
    const t = picksOf(id)[g.id]
    if (!t || pickState(g, t, out) !== 'pending') return null
    return optionsFor(g, byId, picksOf(id)).find(x => x?.id === t) ?? teams.get(t) ?? null
  }

  const rows: RootRow[] = []
  for (const g of left) {
    const mine = live(me.id, g)
    const differ = rivals.map(r => ({ r, team: live(r.id, g) })).filter(x => (x.team?.id ?? null) !== (mine?.id ?? null))
    if (!differ.length) continue
    const groups = new Map<string, { team: BowlTeam | null; rivals: Rival[] }>()
    for (const { r, team } of differ) {
      const k = team?.id ?? ''
      groups.set(k, { team, rivals: [...(groups.get(k)?.rivals ?? []), r] })
    }
    const others = Array.from(groups.values()).sort((a, b) => (a.team ? 0 : 1) - (b.team ? 0 : 1))
    // No live pick of your own: cheer against the rivals' pick, when they're all on one team.
    const theirs = others.filter(o => o.team)
    const against = !mine && theirs.length === 1 ? theirs[0].team : null
    const other = against ? [g.away, g.home].find(t => t && t.id !== against.id) ?? null : null
    // Nothing to cheer for: you and they both have nothing alive here.
    if (!mine && !against) continue
    rows.push({
      game: g,
      points: g.phase ? PHASE_BY_KEY[g.phase].points : 0,
      mine,
      myStar: (board.best5?.[me.id] ?? []).includes(g.id),
      rootFor: mine ?? other,
      rootAgainst: mine ? null : against,
      others,
    })
  }
  return { mode, rivals, rows }
}
