/**
 * Shared standings computation.
 *
 * Three places need to compute records the same way:
 *   - lib/spreadsheet.ts (Excel export)
 *   - pages/index.tsx (dashboard)
 *   - pages/standings.tsx (full standings)
 *   - pages/all-picks.tsx (per-week records)
 *
 * Rules (matching the existing behavior):
 *   1. A user "participated" in a week if they submitted at least one pick.
 *   2. For each decided game in a participated week:
 *        - Tie → counts as a tie for everyone.
 *        - Otherwise: pick matches winner → win; missing pick or wrong pick → loss.
 *   3. Non-participant penalty: a user who has played at least one week
 *      but didn't submit picks for a given decided week gets a week-record
 *      one worse than the worst participant that week (wins = worstWins - 1,
 *      losses = totalGamesInWeek - wins). Users who have never played at all
 *      are excluded.
 *   4. Best 3: for each of the user's three_best picks in a week, look up
 *      the game in that week containing that team. Apply the same scoring,
 *      EXCEPT missing picks always count as losses (not tied with ties).
 */

export interface ComputeInput {
  userIds: string[]
  games: Array<{
    id: string
    week: number
    away_team: string
    home_team: string
    winning_team: string | null
  }>
  picks: Array<{
    user_id: string
    game_id: string
    picked_team: string
    week: number
  }>
  threeBests: Array<{
    user_id: string
    week: number
    pick_1: string | null
    pick_2: string | null
    pick_3: string | null
  }>
}

export interface UserRecord {
  wins: number
  losses: number
  ties: number
  bestWins: number
  bestLosses: number
  bestTies: number
  weekRecords: Map<number, WeekRecord>
}

export interface WeekRecord {
  wins: number
  losses: number
  ties: number
  bestWins: number
  bestLosses: number
  bestTies: number
}

function emptyWeekRecord(): WeekRecord {
  return { wins: 0, losses: 0, ties: 0, bestWins: 0, bestLosses: 0, bestTies: 0 }
}

function emptyUserRecord(): UserRecord {
  return { wins: 0, losses: 0, ties: 0, bestWins: 0, bestLosses: 0, bestTies: 0, weekRecords: new Map() }
}

function ensureWeek(rec: UserRecord, week: number): WeekRecord {
  let wr = rec.weekRecords.get(week)
  if (!wr) {
    wr = emptyWeekRecord()
    rec.weekRecords.set(week, wr)
  }
  return wr
}

/**
 * Compute per-user records and week records.
 * Returns a Map keyed by user_id.
 */
export function computeRecords(input: ComputeInput): Map<string, UserRecord> {
  const { userIds, games, picks, threeBests } = input

  // Picks lookup: "userId-gameId" -> pick row
  const picksMap = new Map(picks.map(p => [`${p.user_id}-${p.game_id}`, p]))

  // Which weeks did each user submit any picks?
  const userWeeks = new Map<string, Set<number>>()
  for (const p of picks) {
    let set = userWeeks.get(p.user_id)
    if (!set) {
      set = new Set()
      userWeeks.set(p.user_id, set)
    }
    set.add(p.week)
  }

  const decidedGames = games.filter(g => g.winning_team)
  const records = new Map<string, UserRecord>()
  for (const uid of userIds) records.set(uid, emptyUserRecord())

  // Phase 1: participant scoring
  for (const game of decidedGames) {
    const isTie = game.winning_team === 'TIE'
    for (const uid of userIds) {
      const weeks = userWeeks.get(uid)
      if (!weeks || !weeks.has(game.week)) continue
      const rec = records.get(uid)!
      const wr = ensureWeek(rec, game.week)
      const pick = picksMap.get(`${uid}-${game.id}`)

      if (isTie) {
        rec.ties++
        wr.ties++
      } else if (!pick) {
        rec.losses++
        wr.losses++
      } else if (pick.picked_team === game.winning_team) {
        rec.wins++
        wr.wins++
      } else {
        rec.losses++
        wr.losses++
      }
    }
  }

  // Phase 2: non-participant penalty
  const allDecidedWeeks = [...new Set(decidedGames.map(g => g.week))].sort((a, b) => a - b)
  for (const wk of allDecidedWeeks) {
    const wkGames = decidedGames.filter(g => g.week === wk)
    const totalGamesInWeek = wkGames.length
    if (totalGamesInWeek === 0) continue

    // Worst participant wins for this week (among users who participated)
    let worstWins = Infinity
    let anyParticipant = false
    for (const uid of userIds) {
      if (!(userWeeks.get(uid)?.has(wk))) continue
      anyParticipant = true
      const wr = records.get(uid)!.weekRecords.get(wk)
      worstWins = Math.min(worstWins, wr?.wins ?? 0)
    }
    if (!anyParticipant) continue

    const penaltyWins = Math.max(0, worstWins - 1)
    const penaltyLosses = totalGamesInWeek - penaltyWins

    for (const uid of userIds) {
      if (userWeeks.get(uid)?.has(wk)) continue // already counted
      if (!userWeeks.get(uid) || userWeeks.get(uid)!.size === 0) continue // never played at all
      const rec = records.get(uid)!
      const wr = ensureWeek(rec, wk)
      rec.wins += penaltyWins
      rec.losses += penaltyLosses
      wr.wins += penaltyWins
      wr.losses += penaltyLosses
    }
  }

  // Phase 3: Best 3 scoring
  for (const tb of threeBests) {
    const rec = records.get(tb.user_id)
    if (!rec) continue
    const bestTeams = [tb.pick_1, tb.pick_2, tb.pick_3].filter((t): t is string => !!t)
    for (const team of bestTeams) {
      const game = decidedGames.find(g => g.week === tb.week && (g.away_team === team || g.home_team === team))
      if (!game) continue
      const isTie = game.winning_team === 'TIE'
      const pick = picksMap.get(`${tb.user_id}-${game.id}`)
      const wr = ensureWeek(rec, tb.week)

      if (!pick) {
        // Missing best-3 pick → always a loss (different from regular scoring on ties)
        rec.bestLosses++
        wr.bestLosses++
      } else if (isTie) {
        rec.bestTies++
        wr.bestTies++
      } else if (pick.picked_team === game.winning_team) {
        rec.bestWins++
        wr.bestWins++
      } else {
        rec.bestLosses++
        wr.bestLosses++
      }
    }
  }

  return records
}

/**
 * Standard sort comparator for ranking users by overall record,
 * with Best 3 as tiebreaker.
 */
export function recordSort(a: UserRecord, b: UserRecord): number {
  if (b.wins !== a.wins) return b.wins - a.wins
  if (a.losses !== b.losses) return a.losses - b.losses
  if (b.bestWins !== a.bestWins) return b.bestWins - a.bestWins
  return a.bestLosses - b.bestLosses
}
