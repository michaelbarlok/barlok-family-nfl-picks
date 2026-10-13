import { computeRecords, recordSort, assignRanks, isPerfectWeek, type UserRecord } from '@/lib/computeStandings'
import { MAX_BEST_PICKS } from '@/lib/constants'
import { WEEKS_IN_SEASON } from '@/lib/season'

export interface DigestGame {
  id: string
  week: number
  away_team: string
  home_team: string
  winning_team: string | null
}

export interface DigestPick { user_id: string; game_id: string; picked_team: string; week: number }
export interface DigestThreeBest { user_id: string; week: number; pick_1: string | null; pick_2: string | null; pick_3: string | null }
export interface DigestUser { id: string; name: string }

interface Tally { wins: number; losses: number; ties: number }

export interface DigestPlayer {
  id: string
  name: string
  week: Tally
  best3: Tally
  season: Tally
  seasonBest3: Tally
  rank: number
  isTied: boolean
  /** Places gained since before this week. Negative is a drop; null in week 1. */
  rankChange: number | null
  perfect: boolean
  /**
   * Sent picks this week. A player who didn't is scored by the no-show rule
   * (one win below the week's lowest card), so their week record is a penalty,
   * not a result, and the recap says so rather than passing it off as one.
   */
  played: boolean
}

/** Who's on top of the season after this week, and by how much. */
export interface SeasonLead {
  /** Everyone in first place — more than one only when level on every tiebreaker. */
  leaders: DigestPlayer[]
  /** Second place, when there's a single leader. */
  nextUp: DigestPlayer[]
  /**
   * What separates first from second: more wins, or (on equal wins) fewer
   * losses, or the Best 3 tiebreaker. null when the lead is shared.
   */
  by: { kind: 'wins' | 'losses' | 'best3'; margin: number } | null
}

export interface Digest {
  week: number
  season: number
  /** Every game of the week has a result. A digest for an unfinished week is a lie. */
  complete: boolean
  gamesInWeek: number
  gamesDecided: number
  weeksRemaining: number
  /** Everyone level on the best week record — the plural is the point. Empty when they all had a perfect week (that highlight covers it). */
  leaders: DigestPlayer[]
  perfect: DigestPlayer[]
  bestThreeSweeps: DigestPlayer[]
  /** Everyone level on the biggest climb up the table — only when it's a climb worth naming. */
  climbers: DigestPlayer[]
  /** The result the fewest people saw coming, and who did. */
  upset: { away: string; home: string; winner: string; calledBy: string[]; outOf: number } | null
  /** Ranked, and complete — the whole league, every week. */
  players: DigestPlayer[]
  seasonLead: SeasonLead | null
}

const tally = (r: { wins: number; losses: number; ties: number }): Tally =>
  ({ wins: r.wins, losses: r.losses, ties: r.ties })

const emptyTally = (): Tally => ({ wins: 0, losses: 0, ties: 0 })

/** Higher is better: wins first, then fewest losses. */
function weekSort(a: DigestPlayer, b: DigestPlayer): number {
  if (b.week.wins !== a.week.wins) return b.week.wins - a.week.wins
  if (a.week.losses !== b.week.losses) return a.week.losses - b.week.losses
  if (b.best3.wins !== a.best3.wins) return b.best3.wins - a.best3.wins
  return a.name.localeCompare(b.name)
}

/**
 * Everything the weekly recap says, worked out from the same scoring the
 * standings use — so the email and the table can never disagree about who won
 * the week.
 *
 * Best 3 is the standings tiebreaker (see recordSort) — it doesn't add to
 * anyone's record, so nothing here should describe it as worth more.
 *
 * The brief was "highlight the best pickers without leaving out anyone who did
 * well", and that shapes what's here. Every highlight is a list rather than a
 * winner: ties are named in full, not broken arbitrarily. Alongside the top
 * record there are three other ways to have had a good week — a perfect card, a
 * Best 3 sweep, a climb up the table — because the same person wins the week
 * more often than is interesting. And the upset section names whoever called
 * the result nobody else did, which is the one highlight most likely to land on
 * someone near the bottom. Then the full table, so nobody is merely absent.
 */
export function buildDigest(input: {
  week: number
  season: number
  users: DigestUser[]
  games: DigestGame[]
  picks: DigestPick[]
  threeBests: DigestThreeBest[]
}): Digest {
  const { week, season, users, games, picks, threeBests } = input
  const userIds = users.map(u => u.id)
  const nameById = new Map(users.map(u => [u.id, u.name]))

  const weekGames = games.filter(g => g.week === week)
  const gamesDecided = weekGames.filter(g => g.winning_team).length
  const complete = weekGames.length > 0 && gamesDecided === weekGames.length

  // Through this week, and through the one before it — the difference is the
  // movement each player made.
  const through = computeRecords({ userIds, games: games.filter(g => g.week <= week), picks, threeBests })
  const prior = computeRecords({ userIds, games: games.filter(g => g.week < week), picks, threeBests })

  const rankOf = (records: Map<string, UserRecord>) => {
    const sorted = [...records.entries()].sort((a, b) => recordSort(a[1], b[1]))
    const ranks = assignRanks(sorted, entry => entry[1])
    return new Map(sorted.map(([id], i) => [id, ranks[i]]))
  }
  const nowRanks = rankOf(through)
  const priorRanks = rankOf(prior)
  // Week 1 has no "before", so there is no movement to report rather than a
  // fabricated climb from nowhere.
  const hasPrior = games.some(g => g.week < week && g.winning_team)
  const playedThisWeek = new Set(picks.filter(p => p.week === week).map(p => p.user_id))

  const players: DigestPlayer[] = users.map(u => {
    const rec = through.get(u.id)!
    const wr = rec.weekRecords.get(week)
    const placing = nowRanks.get(u.id)!
    const before = priorRanks.get(u.id)
    return {
      id: u.id,
      name: u.name,
      week: wr ? tally(wr) : emptyTally(),
      best3: wr ? { wins: wr.bestWins, losses: wr.bestLosses, ties: wr.bestTies } : emptyTally(),
      season: tally(rec),
      seasonBest3: { wins: rec.bestWins, losses: rec.bestLosses, ties: rec.bestTies },
      rank: placing.rank,
      isTied: placing.isTied,
      rankChange: hasPrior && before ? before.rank - placing.rank : null,
      perfect: !!wr && isPerfectWeek(wr),
      played: playedThisWeek.has(u.id),
    }
  })

  const ranked = [...players].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
  const byWeek = [...players].sort(weekSort)

  // Everyone level with the best week — never just the first one alphabetically.
  const best = byWeek[0]
  const leaders = best && best.week.wins > 0
    ? byWeek.filter(p => p.week.wins === best.week.wins && p.week.losses === best.week.losses)
    : []

  // A one-place move happens to half the table most weeks — a highlight that
  // names eight people for it isn't highlighting anyone.
  const climbs = players.map(p => p.rankChange ?? 0)
  const topClimb = Math.max(0, ...climbs)
  const climbers = topClimb >= MIN_CLIMB ? players.filter(p => (p.rankChange ?? 0) === topClimb) : []

  // Every highlight list is alphabetical. These are people who tied, and
  // ordering them by some secondary stat would quietly crown one of them in an
  // email that is meant to say they were level.
  const byName = (list: DigestPlayer[]) => [...list].sort((a, b) => a.name.localeCompare(b.name))

  // A perfect week already says "best record" and "swept Best 3", so the
  // people who had one aren't listed again under those — otherwise the same
  // names fill three highlights in a row.
  const perfect = byWeek.filter(p => p.perfect)
  const allLeadersPerfect = leaders.length > 0 && leaders.every(p => p.perfect)

  return {
    week,
    season,
    complete,
    gamesInWeek: weekGames.length,
    gamesDecided,
    weeksRemaining: Math.max(0, WEEKS_IN_SEASON - week),
    leaders: allLeadersPerfect ? [] : byName(leaders),
    perfect: byName(perfect),
    bestThreeSweeps: byName(byWeek.filter(p => !p.perfect && p.best3.wins === MAX_BEST_PICKS && p.best3.losses === 0)),
    climbers: byName(climbers),
    upset: findUpset(weekGames, picks, week, nameById),
    players: ranked,
    seasonLead: seasonLeadOf(ranked, through),
  }
}

const MIN_CLIMB = 2

/**
 * First place, and what it's held by. Ranks come from recordSort, so this
 * reads the same order the standings page shows.
 */
function seasonLeadOf(ranked: DigestPlayer[], records: Map<string, UserRecord>): SeasonLead | null {
  if (ranked.length === 0) return null
  const top = ranked[0]
  if (top.season.wins + top.season.losses + top.season.ties === 0) return null
  const leaders = ranked.filter(p => p.rank === top.rank)
  if (leaders.length > 1) return { leaders, nextUp: [], by: null }

  const second = ranked.find(p => p.rank > top.rank)
  if (!second) return { leaders, nextUp: [], by: null }
  const nextUp = ranked.filter(p => p.rank === second.rank)
  const a = records.get(top.id)!, b = records.get(second.id)!
  const by: SeasonLead['by'] = a.wins !== b.wins
    ? { kind: 'wins', margin: a.wins - b.wins }
    : a.losses !== b.losses
      ? { kind: 'losses', margin: b.losses - a.losses }
      : { kind: 'best3', margin: 0 }
  return { leaders, nextUp, by }
}

/**
 * The week's least-expected result.
 *
 * Counted among the people who actually played that week, so a no-show doesn't
 * inflate how contrarian a pick looks.
 *
 * The rarity threshold is what makes this a highlight rather than a statistic.
 * "Least popular correct call" is always satisfiable — in a week where every
 * game went to form it lands on a game ten of fourteen people called, which
 * reads as noise and spotlights nobody. It only prints when at most a third of
 * the field saw it coming.
 */
const UPSET_SHARE = 1 / 3

function findUpset(
  weekGames: DigestGame[],
  picks: DigestPick[],
  week: number,
  nameById: Map<string, string>,
): Digest['upset'] {
  const weekPicks = picks.filter(p => p.week === week)
  const participants = new Set(weekPicks.map(p => p.user_id))
  if (participants.size === 0) return null

  let found: Digest['upset'] = null
  for (const game of weekGames) {
    if (!game.winning_team || game.winning_team === 'TIE') continue
    const onGame = weekPicks.filter(p => p.game_id === game.id)
    if (onGame.length === 0) continue
    const calledBy = onGame
      .filter(p => p.picked_team === game.winning_team)
      .map(p => nameById.get(p.user_id) ?? 'Someone')
      .sort()
    // Ties on rarity go to the game more people had an opinion on.
    if (!found || calledBy.length < found.calledBy.length ||
        (calledBy.length === found.calledBy.length && onGame.length > found.outOf)) {
      found = { away: game.away_team, home: game.home_team, winner: game.winning_team, calledBy, outOf: onGame.length }
    }
  }
  if (!found) return null
  // Nobody calling it is always worth saying; otherwise it has to be rare.
  const rare = Math.max(1, Math.floor(found.outOf * UPSET_SHARE))
  return found.calledBy.length === 0 || found.calledBy.length <= rare ? found : null
}

// ── Wording shared by the email, the recap page and the admin preview ──────

const recordText = (t: Tally) => `${t.wins}-${t.losses}${t.ties > 0 ? `-${t.ties}` : ''}`

/** "Alex", "Alex and Amy", "Alex, Amy and Dani" */
export const nameList = (list: { name: string }[]) =>
  list.length <= 1
    ? list.map(p => p.name).join('')
    : `${list.slice(0, -1).map(p => p.name).join(', ')} and ${list[list.length - 1].name}`

export const BEST3_SWEEP_LINE = '3 for 3 on their Best 3 picks — the standings tiebreaker.'

export const NO_PICKS_NOTE = 'No picks — scored one win below the lowest card that week.'

export function weeksToGo(n: number): string {
  return n === 0 ? 'last week of the season' : `${n} week${n === 1 ? '' : 's'} to go`
}

/** The season-lead highlight: a title, a line under it, and a short form for the Talk card. */
export function seasonLeadText(lead: SeasonLead): { title: string; sub: string; short: string } {
  const rec = recordText(lead.leaders[0].season)
  if (lead.leaders.length > 1 || !lead.by) {
    const shared = lead.leaders.length > 1
    return {
      title: shared ? `${nameList(lead.leaders)} share the season lead` : `${lead.leaders[0].name} leads the season`,
      sub: shared
        ? `${lead.leaders.length === 2 ? 'Both' : 'All'} ${rec}, level on the Best 3 tiebreaker too.`
        : `${rec}.`,
      short: `👑 ${nameList(lead.leaders)} ${shared ? 'share the lead' : 'leads'} at ${rec}`,
    }
  }
  const who = lead.leaders[0].name
  const next = nameList(lead.nextUp)
  const { kind, margin } = lead.by
  const sub = kind === 'wins'
    ? `${rec} — ${margin} win${margin === 1 ? '' : 's'} clear of ${next}.`
    : kind === 'losses'
      ? `${rec} — level on wins with ${next}, with fewer losses.`
      : `${rec} — level with ${next}, ahead on the Best 3 tiebreaker.`
  return { title: `${who} leads the season`, sub, short: `👑 ${who} leads at ${rec}` }
}
