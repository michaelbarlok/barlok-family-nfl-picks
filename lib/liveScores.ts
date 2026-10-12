import { normalizeTeam } from '@/lib/nflTeams'

/*
 * Live game state from ESPN's public scoreboard — the same feed update-scores
 * and sync-schedule already read for finals and kickoffs.
 *
 * Display only. Nothing here is written to the database: official results still
 * come from the results sync (now also on a cron), so a glitchy live feed can
 * never change anyone's record. If the feed is down or changes shape, the live
 * layer just isn't there.
 */

export type LiveState = 'pre' | 'in' | 'post'

export interface LiveGame {
  /** Our team abbreviations — the key for matching to a `games` row. */
  away: string
  home: string
  state: LiveState
  awayScore: number | null
  homeScore: number | null
  /** "Q3 4:12", "Halftime", "End Q1", "OT 2:05", "Final", "Final/OT", "Delayed"; null before kickoff. */
  label: string | null
  /** Team with the ball, while in progress. */
  possession: string | null
  redZone: boolean
  /** "3rd & 4 at KC 35", while in progress. */
  downDistance: string | null
}

export interface LiveScoreboard {
  week: number
  season: number
  games: LiveGame[]
  /** When the feed was read, server time (ISO). */
  fetchedAt: string
}

/** Key for matching a live game to one of our games. */
export const liveKey = (away: string, home: string) => `${away}@${home}`

const ordinalPeriod = (period: number) => (period > 4 ? (period === 5 ? 'OT' : `${period - 4}OT`) : `Q${period}`)

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ESPN scoreboard JSON → our live games. Defensive throughout: any event that
 * doesn't have the expected shape is skipped rather than throwing, so one odd
 * entry (a postponed game, a neutral-site oddity) can't blank the whole week.
 */
export function parseScoreboard(json: any): LiveGame[] {
  const events: any[] = Array.isArray(json?.events) ? json.events : []
  const out: LiveGame[] = []

  for (const event of events) {
    const comp = event?.competitions?.[0]
    if (!comp) continue
    const competitors: any[] = Array.isArray(comp.competitors) ? comp.competitors : []
    const awayC = competitors.find(c => c?.homeAway === 'away')
    const homeC = competitors.find(c => c?.homeAway === 'home')
    const awayAbbr = awayC?.team?.abbreviation
    const homeAbbr = homeC?.team?.abbreviation
    if (typeof awayAbbr !== 'string' || typeof homeAbbr !== 'string') continue

    const status = comp.status ?? event.status ?? {}
    const type = status.type ?? {}
    const rawState = type.state
    const state: LiveState = rawState === 'in' || rawState === 'post' ? rawState : 'pre'
    const period = Number(status.period) || 0
    const clock = typeof status.displayClock === 'string' ? status.displayClock : ''
    const name = String(type.name ?? '')

    let label: string | null = null
    if (state === 'post') {
      label = period > 4 ? 'Final/OT' : 'Final'
    } else if (state === 'in') {
      if (name.includes('HALFTIME')) label = 'Halftime'
      else if (name.includes('END_PERIOD')) label = `End ${ordinalPeriod(period)}`
      else if (name.includes('DELAY')) label = 'Delayed'
      else label = period > 0 ? `${ordinalPeriod(period)} ${clock}`.trim() : (type.shortDetail ?? 'In progress')
    } else if (name.includes('POSTPONED') || name.includes('CANCELED')) {
      label = name.includes('POSTPONED') ? 'Postponed' : 'Canceled'
    }

    const score = (c: any) => {
      if (state === 'pre') return null
      const n = parseInt(c?.score, 10)
      return Number.isFinite(n) ? n : null
    }

    const situation = state === 'in' ? comp.situation ?? null : null
    let possession: string | null = null
    if (situation?.possession) {
      const holder = competitors.find(c => String(c?.team?.id ?? c?.id) === String(situation.possession))
      if (holder?.team?.abbreviation) possession = normalizeTeam(holder.team.abbreviation)
    }

    out.push({
      away: normalizeTeam(awayAbbr),
      home: normalizeTeam(homeAbbr),
      state,
      awayScore: score(awayC),
      homeScore: score(homeC),
      label,
      possession,
      redZone: situation?.isRedZone === true,
      downDistance: typeof situation?.downDistanceText === 'string' ? situation.downDistanceText : null,
    })
  }
  return out
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Who is ahead right now: a team, 'TIE' when level, null before kickoff or without scores. */
export function leaderOf(g: LiveGame): string | null {
  if (g.state === 'pre' || g.awayScore === null || g.homeScore === null) return null
  if (g.awayScore === g.homeScore) return 'TIE'
  return g.awayScore > g.homeScore ? g.away : g.home
}

/**
 * How a pick is doing. `winning_team` (the recorded result) wins over the live
 * feed whenever it's set; until then a live 'post' counts as final for display.
 */
export type PickStanding = 'won' | 'lost' | 'tie' | 'winning' | 'losing' | 'level' | 'upcoming'

export function pickStanding(
  pick: string | null | undefined,
  game: { away_team: string; home_team: string; winning_team?: string | null },
  live: LiveGame | undefined,
): PickStanding {
  if (game.winning_team) {
    if (game.winning_team === 'TIE') return 'tie'
    return pick === game.winning_team ? 'won' : 'lost'
  }
  if (!live || live.state === 'pre') return 'upcoming'
  const leader = leaderOf(live)
  if (live.state === 'post') {
    if (leader === 'TIE') return 'tie'
    return pick && pick === leader ? 'won' : 'lost'
  }
  if (leader === null || leader === 'TIE') return 'level'
  return pick && pick === leader ? 'winning' : 'losing'
}
