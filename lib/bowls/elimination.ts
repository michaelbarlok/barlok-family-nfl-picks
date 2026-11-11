import { onSheet, PHASE_BY_KEY, type BowlGame } from '@/lib/bowls/sheet'
import { cleanBest5, cleanPicks, depthOf, indexGames, type PickMap } from '@/lib/bowls/bracket'
import { isDecided, type Entry, type Scoreboard, type Standing } from '@/lib/bowls/scoring'

/*
 * Who's mathematically eliminated.
 *
 * A player is still alive while some way the games left could go puts them
 * first — alone, or tied with others on points, Best 5 and semifinal picks so
 * it comes down to the title-game total. Anyone with no such way is out.
 *
 * It's an exact search over how the games left could go, in bracket order so
 * the playoff's later rounds are between teams that won their way there.
 * Each player's search tries their own picks winning first, and cuts any
 * branch where some rival is sure to finish ahead — the most the player could
 * still gain on that rival, game by game, isn't enough. Within a time budget a
 * search that can't finish leaves the player in: never out unless proven.
 *
 * Finishing order compares points, then Best 5 wins, then semifinal wins —
 * once every game is decided, Best 5 and semifinal records always add up to
 * the same number of games for everyone, so wins alone settle them. The
 * three fold into one whole number (points in half-points), so comparing two
 * players is comparing two numbers.
 */

export type EliminationWhy = 'max' | 'behind' | 'tiebreak' | 'combo'

export interface Elimination {
  why: EliminationWhy
  /** The player(s) who keep them from the top. */
  by: string[]
  /** One line, for the standings: "Max 58 pts — Amy R. already has 61". */
  text: string
}

export interface Eliminations {
  out: Record<string, Elimination>
  /** Players the search ran out of time on — left in, not proven either way. */
  unsure: string[]
}

const NONE = ''
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

interface Options {
  /** Time to find who's out, for the whole board, in ms. */
  budgetMs?: number
  /** Then time to work out why. */
  reasonMs?: number
}

export function eliminations(games: BowlGame[], entries: Entry[], board: Scoreboard, opts: Options = {}): Eliminations {
  const byId = indexGames(games)
  const sheet = games.filter(onSheet)
  const left = sheet
    .filter(g => !isDecided(g))
    .sort((a, b) => depthOf(a, byId) - depthOf(b, byId)
      || weight(b) - weight(a)
      || (a.kickoff_time ?? '').localeCompare(b.kickoff_time ?? '')
      || a.id.localeCompare(b.id))
  const rows = board.standings
  if (!left.length || rows.length < 2) return { out: {}, unsure: [] }

  const R = left.length
  const at = new Map(left.map((g, k) => [g.id, k]))
  const entryById = new Map(entries.map(e => [e.id, e]))
  const N = rows.length

  // The finishing key: points (half-points), Best 5 wins, semifinal wins, and
  // — only if the title game is already decided — the title-total tiebreak.
  const semis = sheet.filter(g => g.phase === 'semi').length
  const M2 = semis + 1
  const M1 = 6 * M2
  const tVal = (s: Standing) => (s.titleMiss === null ? Number.MAX_SAFE_INTEGER : s.titleMiss * 2 + (s.titleUnder ? 0 : 1))
  const tLevels = board.titleActual === null ? [0] : Array.from(new Set(rows.map(tVal))).sort((a, b) => a - b)
  const T = tLevels.length
  const tScore = (s: Standing) => (board.titleActual === null ? 0 : T - 1 - tLevels.indexOf(tVal(s)))
  const key = rows.map(s => (Math.round(s.points * 2) * M1 + s.best5Wins * M2 + s.semiWins) * T + tScore(s))

  // Each player's pick in each game left, and what it's worth if it wins.
  const pick: string[][] = []
  const star: boolean[][] = []
  const gain: number[][] = []
  for (const s of rows) {
    const e = entryById.get(s.id)
    const picks: PickMap = e ? cleanPicks(games, e.picks).picks : {}
    const b5 = new Set(e ? cleanBest5(games, e.best5) : [])
    pick.push(left.map(g => picks[g.id] ?? NONE))
    star.push(left.map(g => b5.has(g.id)))
    gain.push(left.map(g => (Math.round(weight(g) * 2) * M1 + (b5.has(g.id) ? M2 : 0) + (g.phase === 'semi' ? 1 : 0)) * T))
  }

  // Who could still win each game left, before any of them are played.
  const possibleMemo = new Map<string, Set<string>>()
  const possible = (g: BowlGame, depth = 0): Set<string> => {
    const hit = possibleMemo.get(g.id)
    if (hit) return hit
    const side = (fixed: BowlGame['away'], from: string | null): string[] => {
      if (fixed) return [fixed.id]
      const f = from ? byId.get(from) : undefined
      if (!f || !onSheet(f) || depth > 8) return [NONE]
      if (isDecided(f)) return [f.winner_team_id!]
      return Array.from(possible(f, depth + 1))
    }
    const out = new Set([...side(g.away, g.away_from), ...side(g.home, g.home_from)])
    possibleMemo.set(g.id, out)
    return out
  }
  const poss = left.map(g => Array.from(possible(g)))

  // The two teams actually in game k, given how the earlier games went.
  const won: string[] = new Array(R).fill(NONE)
  const teamsIn = (k: number): string[] => {
    const g = left[k]
    const side = (fixed: BowlGame['away'], from: string | null): string => {
      if (fixed) return fixed.id
      if (!from) return NONE
      const i = at.get(from)
      if (i !== undefined) return won[i]
      const f = byId.get(from)
      return f && isDecided(f) ? f.winner_team_id! : NONE
    }
    const a = side(g.away, g.away_from), h = side(g.home, g.home_from)
    return a === h ? [a] : [a, h]
  }

  const gainOf = (i: number, k: number, t: string) => (t !== NONE && pick[i][k] === t ? gain[i][k] : 0)

  // Games whose winner moves on to another game still to be played.
  const feeds = left.map(g => left.some(x => x.away_from === g.id || x.home_from === g.id))

  /**
   * Can `p` finish on top of every one of `rivals`? true / false, or null when
   * it ran out of time (`until`, a Date.now() time).
   */
  const canTop = (p: number, rivals: number[], until: number): boolean | null => {
    const Q = rivals.length
    if (!Q) return true
    const diff = rivals.map(q => key[p] - key[q])
    // The most (and least) p can still gain on each rival from game k on.
    const best: number[][] = rivals.map(() => new Array(R + 1).fill(0))
    const worst: number[][] = rivals.map(() => new Array(R + 1).fill(0))
    rivals.forEach((q, j) => {
      for (let k = R - 1; k >= 0; k--) {
        let hi = -Infinity, lo = Infinity
        for (const t of poss[k]) {
          const d = gainOf(p, k, t) - gainOf(q, k, t)
          if (d > hi) hi = d
          if (d < lo) lo = d
        }
        best[j][k] = best[j][k + 1] + hi
        worst[j][k] = worst[j][k + 1] + lo
      }
    })
    let nodes = 0
    let timedOut = false
    const delta = (j: number, k: number, t: string) => gainOf(p, k, t) - gainOf(rivals[j], k, t)
    // `active`: the rivals p isn't yet sure to finish ahead of, whatever happens.
    const go = (k: number, active: number[]): boolean => {
      if (++nodes % 1024 === 0 && Date.now() > until) { timedOut = true; return false }
      const still: number[] = []
      for (const j of active) {
        if (diff[j] + best[j][k] < 0) return false
        if (diff[j] + worst[j][k] < 0) still.push(j)
      }
      if (!still.length) return true
      let teams = teamsIn(k)
      if (teams.length > 1) {
        // A result that's at least as good for p against every rival left is
        // the only one worth trying — unless the winner plays on.
        if (!feeds[k]) {
          let firstOk = true, secondOk = true
          for (const j of still) {
            const d0 = delta(j, k, teams[0]), d1 = delta(j, k, teams[1])
            if (d0 < d1) firstOk = false
            if (d1 < d0) secondOk = false
          }
          if (firstOk) teams = [teams[0]]
          else if (secondOk) teams = [teams[1]]
        }
        // Try p's own pick first; otherwise whichever leaves the closest rival furthest back.
        if (teams.length > 1) {
          const mine = teams.indexOf(pick[p][k])
          if (mine > 0) teams.reverse()
          else if (mine < 0) {
            const margin = (t: string) => {
              let m = Infinity
              for (const j of still) m = Math.min(m, diff[j] + delta(j, k, t) + best[j][k + 1])
              return m
            }
            if (margin(teams[1]) > margin(teams[0])) teams.reverse()
          }
        }
      }
      for (const t of teams) {
        for (let j = 0; j < Q; j++) diff[j] += delta(j, k, t)
        won[k] = t
        const ok = go(k + 1, still)
        for (let j = 0; j < Q; j++) diff[j] -= delta(j, k, t)
        won[k] = NONE
        if (ok) return true
        if (timedOut) return false
      }
      return false
    }
    const ok = go(0, rivals.map((_, j) => j))
    return timedOut ? null : ok
  }

  // First who's out, then — with a little more time — why. Each player's
  // search gets a fair share of what's left of the time.
  const out: Record<string, Elimination> = {}
  const unsure: string[] = []
  const everyone = rows.map((_, i) => i)
  const outIdx: number[] = []
  let end = Date.now() + (opts.budgetMs ?? 2500)
  const share = (players: number) => Date.now() + Math.max(0, end - Date.now()) / players
  for (let p = 0; p < N; p++) {
    const verdict = canTop(p, everyone.filter(q => q !== p), share(N - p))
    if (verdict === null) unsure.push(rows[p].id)
    else if (!verdict) outIdx.push(p)
  }
  end = Date.now() + (opts.reasonMs ?? 1000)
  let until = 0
  const leader = rows.reduce((a, b, i) => (b.points > rows[a].points ? i : a), 0)
  outIdx.forEach((p, i) => {
    until = share(outIdx.length - i)
    out[rows[p].id] = reason(p, everyone.filter(q => q !== p))
  })
  return { out, unsure }

  /** Why p is out, in a line: the simplest true reason. */
  function reason(p: number, rivals: number[]): Elimination {
    const s = rows[p]
    const lead = rows[leader]
    if (leader !== p && s.maxPoints < lead.points) {
      return { why: 'max', by: [lead.id], text: `Max ${fmt(s.maxPoints)} pts — ${lead.name} already has ${fmt(lead.points)}` }
    }
    // A rival p can't catch on points even if every live pick of p's wins:
    // p only gains on them in games they picked differently.
    let worst: { q: number; margin: number; reach: number } | null = null
    for (const q of rivals) {
      let reach = 0
      for (let k = 0; k < R; k++) {
        const mine = pick[p][k]
        if (mine !== NONE && poss[k].includes(mine) && pick[q][k] !== mine) reach += weight(left[k])
      }
      const margin = s.points - rows[q].points + reach
      if (margin < 0 && (!worst || margin < worst.margin)) worst = { q, margin, reach }
    }
    if (worst) {
      const q = rows[worst.q]
      const tail = worst.reach ? `with only ${fmt(worst.reach)} pts of different picks to go` : 'with no different picks to go'
      return { why: 'behind', by: [q.id], text: `${fmt(q.points - s.points)} pts behind ${q.name} ${tail}` }
    }
    // A rival p can at best tie on points, who wins the tiebreaker.
    for (const q of rivals) {
      if (canTop(p, [q], until) !== false) continue
      const on = tiebreakOn(p, q)
      const o = rows[q]
      return on
        ? { why: 'tiebreak', by: [o.id], text: `At best tied with ${o.name} on points, and ${o.name} wins on ${on}` }
        : { why: 'combo', by: [o.id], text: `No mix of results gets past ${o.name}` }
    }
    // Several rivals together: whatever gets p past one keeps another ahead.
    // Narrow them down to a few that still shut p out between them.
    let block = [...rivals].sort((a, b) => rows[b].points - rows[a].points)
    for (const q of [...block].reverse()) {
      if (block.length <= 2) break
      const without = block.filter(x => x !== q)
      if (canTop(p, without, until) === false) block = without
    }
    const names = block.map(q => rows[q].name)
    const who = names.length === 2 ? `both ${names[0]} and ${names[1]}`
      : names.length <= 3 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} at once`
      : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more at once`
    return { why: 'combo', by: block.map(q => rows[q].id), text: `No mix of results gets past ${who}` }
  }

  /**
   * When p can at best tie q on points: the tiebreaker q wins, game by game
   * keeping only the results that hold p level. null when it isn't that simple.
   */
  function tiebreakOn(p: number, q: number): string | null {
    const hit = (i: number, k: number, t: string) => t !== NONE && pick[i][k] === t
    const levels: [string, number, (i: number, k: number, t: string) => number][] = [
      ['points', Math.round((rows[p].points - rows[q].points) * 2), (i, k, t) => (hit(i, k, t) ? Math.round(weight(left[k]) * 2) : 0)],
      ['Best 5', rows[p].best5Wins - rows[q].best5Wins, (i, k, t) => (hit(i, k, t) && star[i][k] ? 1 : 0)],
      ['semifinal picks', rows[p].semiWins - rows[q].semiWins, (i, k, t) => (hit(i, k, t) && left[k].phase === 'semi' ? 1 : 0)],
    ]
    let cands = poss
    for (const [label, start, f] of levels) {
      let sum = start
      cands = cands.map((ts, k) => {
        const ds = ts.map(t => f(p, k, t) - f(q, k, t))
        const m = Math.max(...ds)
        sum += m
        return ts.filter((_, n) => ds[n] === m)
      })
      if (sum < 0) return label === 'points' ? null : label
      if (sum > 0) return null
    }
    return board.titleActual !== null ? 'the title-game total' : null
  }
}

function weight(g: BowlGame): number {
  return g.phase ? PHASE_BY_KEY[g.phase].points : 0
}
