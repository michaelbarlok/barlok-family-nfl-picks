import type { BowlGame } from '@/lib/bowls/sheet'

/*
 * Live bowl games, straight from ESPN's public college football scoreboard:
 * the score, the clock, who has the ball and where, and the last play.
 *
 * Display only — nothing here is written anywhere. Official results come from
 * the results job (/api/bowls/cron-results), the same "Pull from ESPN" the
 * admin can tap, so a glitchy live feed can never change anyone's record. If
 * the feed is down or changes shape, the live layer just isn't there.
 *
 * Bowl-only: the NFL side has its own (lib/liveScores.ts).
 */

export type LiveState = 'pre' | 'in' | 'post'
export type Side = 'away' | 'home'

export interface BowlLive {
  espnId: string
  state: LiveState
  /** ESPN's team ids, to line the score up with our game's teams. */
  awayTeamId: string | null
  homeTeamId: string | null
  awayScore: number | null
  homeScore: number | null
  /** "Q3 4:12", "Halftime", "End Q1", "OT", "2OT", "Delayed", "Final", "Final/OT"; null before kickoff. */
  label: string | null
  /** Who has the ball, while in progress. */
  possession: Side | null
  redZone: boolean
  /** "3rd & 4 at OSU 35". */
  downDistance: string | null
  /** Where the ball is: yards from the AWAY goal line (0) to the HOME goal line (100). */
  ballOn: number | null
  lastPlay: string | null
  /** "Pass Reception", "Interception Return Touchdown"… */
  lastPlayType: string | null
  /** Changes with every new play. */
  lastPlayId: string | null
  /** Team colors, as hex without '#'. */
  awayColor: string | null
  homeColor: string | null
}

export interface BowlLiveBoard {
  /** Live state by our game id; only games on now (or about to be). */
  games: Record<string, BowlLive>
  /** When ESPN was read (ISO). */
  fetchedAt: string
}

/* ── the live window ─────────────────────────────────────────────── */

export const LIVE_BEFORE_MS = 15 * 60_000       // from a little before kickoff
export const LIVE_AFTER_MS = 8 * 60 * 60_000    // no game runs longer than this

/** Could this game be on right now? Not once its result is in. */
export function inLiveWindow(g: Pick<BowlGame, 'kickoff_time' | 'status' | 'removed'>, now = Date.now()): boolean {
  if (!g.kickoff_time || g.removed) return false
  if (g.status === 'final' || g.status === 'canceled' || g.status === 'postponed') return false
  const k = Date.parse(g.kickoff_time)
  return now >= k - LIVE_BEFORE_MS && now <= k + LIVE_AFTER_MS
}

/* ── ESPN → live ─────────────────────────────────────────────────── */

const periodName = (p: number) => (p > 4 ? (p === 5 ? 'OT' : `${p - 4}OT`) : `Q${p}`)

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * One ESPN event → its live state, or null if it isn't shaped as expected.
 * Defensive throughout: one odd event can't blank the rest.
 */
export function parseLiveEvent(event: any): BowlLive | null {
  const comp = event?.competitions?.[0]
  if (!comp || event?.id == null) return null
  const competitors: any[] = Array.isArray(comp.competitors) ? comp.competitors : []
  const awayC = competitors.find(c => c?.homeAway === 'away')
  const homeC = competitors.find(c => c?.homeAway === 'home')
  if (!awayC || !homeC) return null

  const status = comp.status ?? event.status ?? {}
  const type = status.type ?? {}
  const state: LiveState = type.state === 'in' || type.state === 'post' ? type.state : 'pre'
  const period = Number(status.period) || 0
  const clock = typeof status.displayClock === 'string' ? status.displayClock : ''
  const name = String(type.name ?? '')

  let label: string | null = null
  if (state === 'post') label = period > 4 ? 'Final/OT' : 'Final'
  else if (state === 'in') {
    if (name.includes('HALFTIME')) label = 'Halftime'
    else if (name.includes('END_PERIOD')) label = `End ${periodName(period)}`
    else if (name.includes('DELAY')) label = 'Delayed'
    else if (period > 4) label = periodName(period)          // college overtime has no clock
    else label = period > 0 ? `${periodName(period)} ${clock}`.trim() : (type.shortDetail ?? 'In progress')
  }

  const score = (c: any) => {
    if (state === 'pre') return null
    const n = parseInt(c?.score, 10)
    return Number.isFinite(n) ? n : null
  }
  const idOf = (c: any) => (c?.team?.id ?? c?.id) != null ? String(c.team?.id ?? c.id) : null
  const awayTeamId = idOf(awayC)
  const homeTeamId = idOf(homeC)
  const sideOfTeam = (id: unknown): Side | null => {
    if (id == null) return null
    if (String(id) === awayTeamId) return 'away'
    if (String(id) === homeTeamId) return 'home'
    return null
  }

  const situation = state === 'in' ? comp.situation ?? null : null
  const lastPlay = situation?.lastPlay ?? null
  // Who has the ball: ESPN's own field if it sends one, else from the last
  // play — the side in possession once it's over (as on the NFL side).
  const possession = sideOfTeam(situation?.possession) ?? sideOfTeam(lastPlay?.end?.team?.id) ?? sideOfTeam(lastPlay?.team?.id)

  // Where the ball is. "OSU 35" (or "… at OSU 35") names the side, so it
  // wins; between plays only yardLine is left, counted from the home goal line.
  const abbr = (c: any) => String(c?.team?.abbreviation ?? '').toUpperCase()
  const ballOn = (() => {
    const text: string | undefined = situation?.possessionText
      ?? (typeof situation?.downDistanceText === 'string' ? situation.downDistanceText.split(' at ').pop() : undefined)
    const m = typeof text === 'string' ? text.trim().match(/^(?:([A-Z&]{2,6})\s+)?(\d{1,2})$/i) : null
    if (m) {
      const yd = parseInt(m[2], 10)
      if (yd === 50) return 50
      const side = (m[1] ?? '').toUpperCase()
      if (side && side === abbr(awayC)) return yd
      if (side && side === abbr(homeC)) return 100 - yd
    }
    const yl = Number(situation?.yardLine)
    return situation && Number.isFinite(yl) && yl >= 0 && yl <= 100 ? 100 - yl : null
  })()

  const color = (c: any) => {
    const hex = String(c?.team?.color ?? '').replace('#', '')
    return /^[0-9a-f]{6}$/i.test(hex) ? hex : null
  }

  return {
    espnId: String(event.id),
    state,
    awayTeamId,
    homeTeamId,
    awayScore: score(awayC),
    homeScore: score(homeC),
    label,
    possession: state === 'in' ? possession : null,
    redZone: situation?.isRedZone === true,
    downDistance: typeof situation?.downDistanceText === 'string' && situation.downDistanceText ? situation.downDistanceText : null,
    ballOn,
    lastPlay: typeof lastPlay?.text === 'string' && lastPlay.text ? lastPlay.text : null,
    lastPlayType: typeof lastPlay?.type?.text === 'string' ? lastPlay.type.text : null,
    lastPlayId: lastPlay?.id != null ? String(lastPlay.id) : null,
    awayColor: color(awayC),
    homeColor: color(homeC),
  }
}

/** Every event in a scoreboard, by ESPN id. */
export function parseLiveScoreboard(json: any): Map<string, BowlLive> {
  const out = new Map<string, BowlLive>()
  for (const e of (Array.isArray(json?.events) ? json.events : [])) {
    const live = parseLiveEvent(e)
    if (live) out.set(live.espnId, live)
  }
  return out
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ── reading it on a game card ───────────────────────────────────── */

/**
 * The score to show for one of our games: the recorded final once there is
 * one, else the live feed's. Lined up by team id, since a playoff slot can
 * still say TBD on our side when ESPN already has the team.
 */
export function scoreOf(g: Pick<BowlGame, 'status' | 'away' | 'home' | 'away_score' | 'home_score'>, live: BowlLive | undefined): { away: number | null; home: number | null } {
  if (g.status === 'final' || !live || live.state === 'pre') return { away: g.away_score, home: g.home_score }
  const flipped = !!g.away && g.away.id === live.homeTeamId
  return flipped ? { away: live.homeScore, home: live.awayScore } : { away: live.awayScore, home: live.homeScore }
}

/** Which of our game's sides a live side is (they match unless ESPN lists the teams the other way). */
export function ourSide(g: Pick<BowlGame, 'away' | 'home'>, live: BowlLive, side: Side): Side {
  const flipped = !!g.away && g.away.id === live.homeTeamId
  return flipped ? (side === 'away' ? 'home' : 'away') : side
}
