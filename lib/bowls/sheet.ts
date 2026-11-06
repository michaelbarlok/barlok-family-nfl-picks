/*
 * The pick sheet: games, phases and their points, and when it locks.
 * Shared by the bowl API routes and pages.
 */

export type Phase = 'little' | 'between' | 'big' | 'playoff' | 'semi' | 'title'
export type PlayoffRound = 'first' | 'quarter' | 'semi' | 'title'
export type GameStatus = 'scheduled' | 'in_progress' | 'final' | 'canceled' | 'postponed'

export interface BowlTeam {
  id: string
  /** The school, as ESPN shortens it: "Tennessee", "SC State". */
  name: string
  /** "Volunteers" — null when ESPN has none. */
  nickname?: string | null
  abbr: string | null
  logo: string | null
  rank: number | null
  record: string | null
  color: string | null
}

export interface BowlGame {
  id: string
  season: number
  espn_id: string
  espn_name: string
  name: string
  kickoff_time: string | null
  time_tbd: boolean
  tv: string | null
  venue: string | null
  playoff_round: PlayoffRound | null
  phase: Phase | null
  away: BowlTeam | null
  home: BowlTeam | null
  away_from: string | null
  home_from: string | null
  status: GameStatus
  status_detail: string | null
  away_score: number | null
  home_score: number | null
  winner_team_id: string | null
  removed: boolean
  manual: boolean
}

/** The sheet's phases, in the order they appear, with points per correct pick. */
export const PHASES: { key: Phase; tag: string; label: string; points: number }[] = [
  { key: 'little', tag: 'Phase 1', label: 'The Little Ones', points: 1 },
  { key: 'between', tag: 'Phase 2', label: 'In Betweeners', points: 1.5 },
  { key: 'big', tag: 'Phase 3', label: 'The Big Ones', points: 2 },
  { key: 'playoff', tag: 'Phase 4', label: 'The Playoff', points: 3 },
  { key: 'semi', tag: 'Semifinals', label: 'Semifinals', points: 3 },
  { key: 'title', tag: 'Champion', label: 'National Champion', points: 3 },
]
export const PHASE_BY_KEY = Object.fromEntries(PHASES.map(p => [p.key, p])) as Record<Phase, (typeof PHASES)[number]>

/** Phases the admin chooses for a game. The playoff's phases follow its round. */
export const PICKABLE_PHASES: Phase[] = ['little', 'between', 'big']

export function phaseForRound(round: PlayoffRound | null): Phase | null {
  if (round === 'first' || round === 'quarter') return 'playoff'
  if (round === 'semi') return 'semi'
  if (round === 'title') return 'title'
  return null
}

const ROUND_ORDER: Record<PlayoffRound, number> = { first: 0, quarter: 1, semi: 2, title: 3 }
const PHASE_ORDER = Object.fromEntries(PHASES.map((p, i) => [p.key, i])) as Record<Phase, number>

/** Is this game on the pick'em? On the sheet and not canceled or postponed. */
export function onSheet(g: Pick<BowlGame, 'phase' | 'removed'>): boolean {
  return !!g.phase && !g.removed
}

const time = (g: BowlGame) => (g.kickoff_time ? Date.parse(g.kickoff_time) : Number.MAX_SAFE_INTEGER)

/** Sheet order: by phase, the playoff by round, then by kickoff. */
export function sortGames(games: BowlGame[]): BowlGame[] {
  return [...games].sort((a, b) =>
    (a.phase ? PHASE_ORDER[a.phase] : 99) - (b.phase ? PHASE_ORDER[b.phase] : 99)
    || (a.playoff_round ? ROUND_ORDER[a.playoff_round] : -1) - (b.playoff_round ? ROUND_ORDER[b.playoff_round] : -1)
    || time(a) - time(b)
    || a.name.localeCompare(b.name))
}

export function sheetGames(games: BowlGame[]): BowlGame[] {
  return sortGames(games.filter(onSheet))
}

/** Picks lock at the first kickoff on the sheet. */
export function lockTime(games: BowlGame[]): string | null {
  let first: number | null = null
  for (const g of games) {
    if (!onSheet(g) || !g.kickoff_time) continue
    const t = Date.parse(g.kickoff_time)
    if (first === null || t < first) first = t
  }
  return first === null ? null : new Date(first).toISOString()
}

/* ── database rows ─────────────────────────────────────────────────── */

type Side = 'away' | 'home'
const TEAM_COLS = ['team_id', 'name', 'nickname', 'abbr', 'logo', 'rank', 'record', 'color'] as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GameRow = Record<string, any>

function teamFromRow(row: GameRow, side: Side): BowlTeam | null {
  const id = row[`${side}_team_id`]
  if (!id) return null
  return {
    id: String(id),
    name: row[`${side}_name`] ?? 'TBD',
    nickname: row[`${side}_nickname`] ?? null,
    abbr: row[`${side}_abbr`] ?? null,
    logo: row[`${side}_logo`] ?? null,
    rank: row[`${side}_rank`] ?? null,
    record: row[`${side}_record`] ?? null,
    color: row[`${side}_color`] ?? null,
  }
}

/**
 * Sample teams — the admin's "preview with real teams" fills empty slots with
 * last season's matchups. Their ids carry this prefix so they can always be
 * told apart from real ones: removed in one tap, replaced by a pull, and picks
 * can't open while any are left.
 */
export const SAMPLE_PREFIX = 'sample-'
export const isSampleTeam = (id: string | null | undefined): boolean => !!id && id.startsWith(SAMPLE_PREFIX)
export const hasSampleTeam = (g: BowlGame): boolean => isSampleTeam(g.away?.id) || isSampleTeam(g.home?.id)

/** Team columns for one side of a bowl_games row (all null for TBD). */
export function teamToRow(side: Side, t: BowlTeam | null): GameRow {
  const out: GameRow = {}
  for (const c of TEAM_COLS) out[`${side}_${c}`] = null
  if (t) {
    out[`${side}_team_id`] = t.id
    out[`${side}_name`] = t.name
    out[`${side}_nickname`] = t.nickname ?? null
    out[`${side}_abbr`] = t.abbr
    out[`${side}_logo`] = t.logo
    out[`${side}_rank`] = t.rank
    out[`${side}_record`] = t.record
    out[`${side}_color`] = t.color
  }
  return out
}

export function gameFromRow(row: GameRow): BowlGame {
  return {
    id: row.id,
    season: row.season,
    espn_id: row.espn_id,
    espn_name: row.espn_name ?? '',
    name: row.name,
    kickoff_time: row.kickoff_time ?? null,
    time_tbd: !!row.time_tbd,
    tv: row.tv ?? null,
    venue: row.venue ?? null,
    playoff_round: row.playoff_round ?? null,
    phase: row.phase ?? null,
    away: teamFromRow(row, 'away'),
    home: teamFromRow(row, 'home'),
    away_from: row.away_from ?? null,
    home_from: row.home_from ?? null,
    status: row.status ?? 'scheduled',
    status_detail: row.status_detail ?? null,
    away_score: row.away_score ?? null,
    home_score: row.home_score ?? null,
    winner_team_id: row.winner_team_id ?? null,
    removed: !!row.removed,
    manual: !!row.manual,
  }
}

/* ── how picks are laid out ─────────────────────────────────────────── */

export type SectionKey = 'little' | 'between' | 'big' | 'playoff'

export interface PickRound { key: string; label: string; points: string; games: BowlGame[] }
export interface PickSection {
  key: SectionKey
  title: string
  short: string
  points: string
  games: BowlGame[]
  /** The playoff, round by round: first round, quarterfinals, semifinals, champion. */
  rounds: PickRound[]
}

const SECTION_META: { key: SectionKey; title: string; short: string; points: string }[] = [
  { key: 'little', title: 'Phase 1 · The Little Ones', short: 'Phase 1', points: '1 point per win' },
  { key: 'between', title: 'Phase 2 · In Betweeners', short: 'Phase 2', points: '1.5 points per win' },
  { key: 'big', title: 'Phase 3 · The Big Ones', short: 'Phase 3', points: '2 points per win' },
  { key: 'playoff', title: 'Phase 4 · The Playoff', short: 'Playoff', points: '3 points per win' },
]

/**
 * A player's picks in order: Phase 1, 2 and 3, then the whole playoff last —
 * first round, quarterfinals, semifinals, then the champion. Empty phases are
 * left out.
 */
export function pickSections(games: BowlGame[]): PickSection[] {
  const sorted = sortGames(games.filter(onSheet))
  return SECTION_META.map(m => {
    if (m.key !== 'playoff') {
      const list = sorted.filter(g => g.phase === m.key)
      return { ...m, games: list, rounds: [{ key: m.key, label: '', points: '', games: list }] }
    }
    const rounds: PickRound[] = [
      { key: 'first', label: 'First round', points: '3 points each', games: sorted.filter(g => g.phase === 'playoff' && g.playoff_round === 'first') },
      { key: 'quarter', label: 'Quarterfinals', points: '3 points each', games: sorted.filter(g => g.phase === 'playoff' && g.playoff_round !== 'first') },
      { key: 'semi', label: 'Semifinals', points: '3 points each', games: sorted.filter(g => g.phase === 'semi') },
      { key: 'title', label: 'National Champion', points: '3 points', games: sorted.filter(g => g.phase === 'title') },
    ].filter(r => r.games.length)
    return { ...m, games: rounds.flatMap(r => r.games), rounds }
  }).filter(s => s.games.length)
}
