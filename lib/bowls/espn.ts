import type { BowlTeam, GameStatus, PlayoffRound } from '@/lib/bowls/sheet'

/*
 * Reading college football games from ESPN for the Bowl Pick'em.
 *
 * Only ever called when the bowl admin taps "Pull from ESPN" (or looks up a
 * date to add a game) — nothing here runs on a schedule.
 */

const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard'

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export interface EspnGame {
  espn_id: string
  espn_name: string
  name: string
  kickoff_time: string | null
  time_tbd: boolean
  tv: string | null
  venue: string | null
  playoff_round: PlayoffRound | null
  away: BowlTeam | null
  home: BowlTeam | null
  status: GameStatus
  status_detail: string | null
  away_score: number | null
  home_score: number | null
  winner_team_id: string | null
}

/* ── names ─────────────────────────────────────────────────────────── */

// The bowl name without the sponsor — what the family sheet calls each game.
// Matched on the end of ESPN's title ("Cricket Celebration Bowl").
const KNOWN_BOWLS: [string, string][] = [
  ['Celebration Bowl', 'Celebration Bowl'],
  ['Salute to Veterans Bowl', 'Veterans Bowl'],
  ['Frisco Football Classic', 'Frisco Football Classic'],
  ['San Juan Bowl', 'San Juan Bowl'],
  ['Puerto Rico Bowl', 'Puerto Rico Bowl'],
  ['Boca Raton Bowl', 'Boca Raton Bowl'],
  ['Gasparilla Bowl', 'Gasparilla Bowl'],
  ['Myrtle Beach Bowl', 'Myrtle Beach Bowl'],
  ['Famous Idaho Potato Bowl', 'Famous Idaho Potato Bowl'],
  ['Cure Bowl', 'Cure Bowl'],
  ['Independence Bowl', 'Independence Bowl'],
  ['New Orleans Bowl', 'New Orleans Bowl'],
  ['Armed Forces Bowl', 'Armed Forces Bowl'],
  ['Poinsettia Bowl', 'Poinsettia Bowl'],
  ['Frisco Bowl', 'Frisco Bowl'],
  ['New Mexico Bowl', 'New Mexico Bowl'],
  ['Hawaiʻi Bowl', 'Hawaiʻi Bowl'],
  ["Hawai'i Bowl", "Hawai'i Bowl"],
  ['Hawaii Bowl', 'Hawaii Bowl'],
  ['Pinstripe Bowl', 'Pinstripe Bowl'],
  ['Fenway Bowl', 'Fenway Bowl'],
  ["Duke's Mayo Bowl", "Duke's Mayo Bowl"],
  ['68 Ventures Bowl', '68 Ventures Bowl'],
  ['Cactus Bowl', 'Cactus Bowl'],
  ['Military Bowl', 'Military Bowl'],
  ['Holiday Bowl', 'Holiday Bowl'],
  ['Birmingham Bowl', 'Birmingham Bowl'],
  ['Pop-Tarts Bowl', 'Pop-Tarts Bowl'],
  ['Alamo Bowl', 'Alamo Bowl'],
  ['Gator Bowl', 'Gator Bowl'],
  ['Music City Bowl', 'Music City Bowl'],
  ['ReliaQuest Bowl', 'ReliaQuest Bowl'],
  ['Sun Bowl', 'Sun Bowl'],
  ['Las Vegas Bowl', 'Las Vegas Bowl'],
  ['Texas Bowl', 'Texas Bowl'],
  ['Citrus Bowl', 'Citrus Bowl'],
  ['First Responder Bowl', 'First Responder Bowl'],
  ['Arizona Bowl', 'Arizona Bowl'],
  ['Liberty Bowl', 'Liberty Bowl'],
  ['LA Bowl', 'LA Bowl'],
  ['Xbox Bowl', 'Xbox Bowl'],
  ['GameAbove Sports Bowl', 'GameAbove Sports Bowl'],
  ['Rate Bowl', 'Rate Bowl'],
  ['Camellia Bowl', 'Camellia Bowl'],
  ['Bahamas Bowl', 'Bahamas Bowl'],
  ['Quick Lane Bowl', 'Quick Lane Bowl'],
  ['Fiesta Bowl', 'Fiesta Bowl'],
  ['Cotton Bowl Classic', 'Cotton Bowl'],
  ['Cotton Bowl', 'Cotton Bowl'],
  ['Rose Bowl', 'Rose Bowl'],
  ['Peach Bowl', 'Peach Bowl'],
  ['Orange Bowl', 'Orange Bowl'],
  ['Sugar Bowl', 'Sugar Bowl'],
]

function bowlName(title: string): string {
  const t = title.replace(/\s+presented by\b.*$/i, '').trim()
  const lower = t.toLowerCase()
  // Longest match first, so "Frisco Football Classic" isn't read as something shorter.
  const hit = [...KNOWN_BOWLS].sort((a, b) => b[0].length - a[0].length).find(([m]) => lower.endsWith(m.toLowerCase()))
  return hit ? hit[1] : t
}

export function playoffRound(title: string): PlayoffRound | null {
  if (!/college football playoff/i.test(title)) return null
  if (/first round/i.test(title)) return 'first'
  if (/quarterfinal/i.test(title)) return 'quarter'
  if (/semifinal/i.test(title)) return 'semi'
  if (/national championship/i.test(title)) return 'title'
  return null
}

/**
 * What the sheet calls a game. Bowls lose the sponsor ("Cricket Celebration
 * Bowl" → "Celebration Bowl"); playoff games say their round and bowl; a game
 * that isn't a bowl is named for its teams. The admin can rename any of them.
 */
export function sheetName(title: string, away: BowlTeam | null, home: BowlTeam | null): string {
  const t = (title ?? '').trim()
  if (!t) {
    const names = [away?.name, home?.name]
    if (names.includes('Army') && names.includes('Navy')) return 'Army–Navy Game'
    return `${away?.name ?? 'TBD'} vs ${home?.name ?? 'TBD'}`
  }
  const round = playoffRound(t)
  if (round) {
    const at = t.match(/\bat the\s+(.+)$/i)?.[1]
    const bowl = at ? bowlName(at) : null
    if (round === 'first') return 'CFP First Round'
    if (round === 'quarter') return bowl ? `CFP Quarterfinal · ${bowl}` : 'CFP Quarterfinal'
    if (round === 'semi') return bowl ? `CFP Semifinal · ${bowl}` : 'CFP Semifinal'
    return 'CFP National Championship'
  }
  return bowlName(t)
}

/* ── events ────────────────────────────────────────────────────────── */

/* eslint-disable @typescript-eslint/no-explicit-any */
function team(c: any): BowlTeam | null {
  const t = c?.team
  if (!t || String(t.id ?? c.id) === '-1' || t.abbreviation === 'TBD') return null
  const rank = Number(c.curatedRank?.current)
  const overall = (c.records ?? []).find((r: any) => r.name === 'overall' || r.type === 'total') ?? c.records?.[0]
  return {
    id: String(t.id),
    name: t.shortDisplayName || t.location || t.displayName || t.abbreviation,
    abbr: t.abbreviation ?? null,
    logo: t.logo ?? null,
    rank: Number.isFinite(rank) && rank > 0 && rank < 99 ? rank : null,
    record: overall?.summary ?? null,
    color: t.color ?? null,
  }
}

function status(e: any): GameStatus {
  const type = e?.status?.type ?? e?.competitions?.[0]?.status?.type ?? {}
  const name = String(type.name ?? '')
  if (/CANCEL/.test(name)) return 'canceled'
  if (/POSTPONED/.test(name)) return 'postponed'
  if (type.completed || type.state === 'post') return 'final'
  if (type.state === 'in') return 'in_progress'
  return 'scheduled'
}

export function parseEvent(e: any): EspnGame {
  const comp = e.competitions?.[0] ?? {}
  const notes = (comp.notes ?? []) as any[]
  const title = String((notes.find(n => n.type === 'event') ?? notes[0])?.headline ?? '')
  const comps = (comp.competitors ?? []) as any[]
  const awayC = comps.find(c => c.homeAway === 'away') ?? comps[1]
  const homeC = comps.find(c => c.homeAway === 'home') ?? comps[0]
  const away = team(awayC)
  const home = team(homeC)
  const st = status(e)
  const played = st === 'in_progress' || st === 'final'
  const score = (c: any) => {
    const n = parseInt(c?.score, 10)
    return played && Number.isFinite(n) ? n : null
  }
  const away_score = score(awayC)
  const home_score = score(homeC)
  let winner: string | null = null
  if (st === 'final') {
    const w = comps.find(c => c.winner === true)
    if (w && team(w)) winner = team(w)!.id
    else if (away && home && away_score !== null && home_score !== null && away_score !== home_score) {
      winner = away_score > home_score ? away.id : home.id
    }
  }
  const tv = (comp.broadcasts ?? []).flatMap((b: any) => b.names ?? []).join('/') || comp.broadcast || null
  const v = comp.venue
  const venue = v?.fullName
    ? [v.fullName, [v.address?.city, v.address?.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')
    : null
  const when = e.date ?? comp.date
  return {
    espn_id: String(e.id),
    espn_name: title,
    name: sheetName(title, away, home),
    kickoff_time: when ? new Date(when).toISOString() : null,
    time_tbd: comp.timeValid === false,
    tv,
    venue,
    playoff_round: playoffRound(title),
    away,
    home,
    status: st,
    status_detail: (e.status?.type?.shortDetail ?? comp.status?.type?.shortDetail) || null,
    away_score,
    home_score,
    winner_team_id: winner,
  }
}

async function getJson(fetcher: Fetcher, url: string): Promise<any> {
  const res = await fetcher(url)
  if (!res.ok) throw new Error(`ESPN didn't answer (HTTP ${res.status}). Try again in a minute.`)
  return res.json()
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Not for the sheet: the FCS, Division II and III playoffs. */
function isOtherPlayoff(title: string): boolean {
  return /^(FCS Championship|NCAA Division I{2,3}|Division I{2,3}|NAIA)/i.test(title)
}

/** The whole bowl season on ESPN: every bowl, the Celebration Bowl and the playoff. */
export async function fetchBowlSeason(season: number, fetcher: Fetcher): Promise<EspnGame[]> {
  const data = await getJson(fetcher, `${SCOREBOARD}?seasontype=3&dates=${season}&limit=500`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data?.events ?? []) as any[]).map(parseEvent).filter(g => !isOtherPlayoff(g.espn_name))
}

/** Every FBS and FCS game ESPN has on a date (YYYYMMDD, Eastern). */
export async function fetchDate(yyyymmdd: string, fetcher: Fetcher): Promise<EspnGame[]> {
  const [fbs, fcs] = await Promise.all([80, 81].map(group =>
    getJson(fetcher, `${SCOREBOARD}?dates=${yyyymmdd}&groups=${group}&limit=300`)))
  const seen = new Map<string, EspnGame>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const e of [...(fbs?.events ?? []), ...(fcs?.events ?? [])] as any[]) {
    const g = parseEvent(e)
    if (!seen.has(g.espn_id)) seen.set(g.espn_id, g)
  }
  return Array.from(seen.values()).sort((a, b) => (a.kickoff_time ?? '').localeCompare(b.kickoff_time ?? ''))
}

/** The Eastern-time calendar date of a kickoff, as ESPN's dates parameter wants it. */
export function easternDate(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(iso))
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return `${get('year')}${get('month')}${get('day')}`
}

/** The default fetcher: ESPN with a timeout, so a slow ESPN can't hang a pull. */
export const espnFetch: Fetcher = (url: string) =>
  fetch(url, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } })
