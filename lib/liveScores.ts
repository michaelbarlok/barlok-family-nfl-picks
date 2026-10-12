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
  /** "3rd & 4 at KC 35", while in progress — absent during stoppages. */
  downDistance: string | null
  /** Where the ball is: yards from the AWAY goal line (0) to the HOME goal line (100). */
  ballOn: number | null
  down: number | null
  /** Yards to go for a first down. */
  distance: number | null
  goalToGo: boolean
  /** "Kickoff", "Pass Reception", "Official Timeout"… */
  lastPlayType: string | null
  /** ESPN's description of the last play. */
  lastPlay: string | null
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
    const away = normalizeTeam(awayAbbr)
    const home = normalizeTeam(homeAbbr)
    const teamById = (id: unknown): string | null => {
      if (id == null) return null
      const c = competitors.find(x => String(x?.team?.id ?? x?.id) === String(id))
      return c?.team?.abbreviation ? normalizeTeam(c.team.abbreviation) : null
    }

    // Who has the ball. The scoreboard feed has no possession field (checked
    // against a live game), so it's read from the last play: `end.team` is the
    // side in possession once that play is over — the receiving team after a
    // kickoff or punt, the scoring team lining up for the extra point. A
    // `possession` id is still honoured if ESPN ever adds one.
    const lastPlay = situation?.lastPlay ?? null
    const possession = teamById(situation?.possession) ?? teamById(lastPlay?.end?.team?.id) ?? teamById(lastPlay?.team?.id)

    // Where the ball is, as yards from the away goal line. The text ("BAL 20",
    // or "… at BAL 20") is unambiguous, so it wins; between plays ESPN drops
    // the text and only `yardLine` is left, which counts from the HOME goal
    // line (checked: BAL ball at its own 20 came through as 80).
    const ballOn = (() => {
      const text: string | undefined = situation?.possessionText
        ?? (typeof situation?.downDistanceText === 'string' ? situation.downDistanceText.split(' at ').pop() : undefined)
      const m = typeof text === 'string' ? text.trim().match(/^(?:([A-Z]{2,4})\s+)?(\d{1,2})$/) : null
      if (m) {
        const yd = parseInt(m[2], 10)
        if (yd === 50) return 50
        if (m[1]) {
          // Play-by-play text uses its own codes for a few teams (BLT for
          // BAL); the situation fields seen so far use the normal ones.
          const side = normalizeTeam(m[1] === 'BLT' ? 'BAL' : m[1])
          if (side === away) return yd
          if (side === home) return 100 - yd
        }
      }
      const yl = Number(situation?.yardLine)
      return Number.isFinite(yl) && yl >= 0 && yl <= 100 ? 100 - yl : null
    })()

    const down = Number(situation?.down)
    const distance = Number(situation?.distance)
    const ddText = typeof situation?.downDistanceText === 'string' ? situation.downDistanceText : null

    out.push({
      away,
      home,
      state,
      awayScore: score(awayC),
      homeScore: score(homeC),
      label,
      possession,
      redZone: situation?.isRedZone === true,
      downDistance: ddText,
      ballOn,
      // down is -1 between plays (timeouts, extra points, kickoffs)
      down: down >= 1 && down <= 4 ? down : null,
      distance: down >= 1 && down <= 4 && Number.isFinite(distance) && distance > 0 ? distance : null,
      goalToGo: !!ddText && /goal/i.test(ddText),
      lastPlayType: typeof lastPlay?.type?.text === 'string' ? lastPlay.type.text : null,
      lastPlay: typeof lastPlay?.text === 'string' ? lastPlay.text.split('\n')[0].trim() : null,
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
