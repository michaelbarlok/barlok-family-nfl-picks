import { cleanBest5, cleanPicks, indexGames, optionsFor, type PickMap } from '@/lib/bowls/bracket'
import { sampleBracket, onSheet, type BowlGame, type BowlTeam } from '@/lib/bowls/sheet'
import type { Entry } from '@/lib/bowls/scoring'

/*
 * A made-up board for the admin, while sample teams are on: about twenty
 * players with picks, Best 5s and title totals, and results for the first
 * half or so of the games — so Standings and All Picks can be seen full
 * before the real thing. It's built fresh on every request from the sample
 * games and never saved anywhere. The same every time (a fixed seed), so
 * the view doesn't reshuffle on each reload.
 *
 * The playoff plays out like a real one: last year's bracket (sampleBracket),
 * first-round winners moving on, later rounds TBD until their games are
 * decided.
 */

export const DEMO_PLAYERS = [
  'Amy R.', 'Ben T.', 'Carla M.', 'Dave K.', 'Erin S.', 'Frank B.', 'Gina P.', 'Hank W.', 'Ivy L.', 'Jake D.',
  'Kim H.', 'Leo F.', 'Mia C.', 'Nate G.', 'Olivia J.', 'Pete V.', 'Quinn A.', 'Rosa N.', 'Sam E.', 'Tina O.', 'Vic Z.',
]

/** A small seeded random number generator (mulberry32). */
function seeded(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const byKickoff = (a: BowlGame, b: BowlGame) => (a.kickoff_time ?? '').localeCompare(b.kickoff_time ?? '')

export function demoBoard(
  sampleGames: BowlGame[],
  you: { id: string; name: string; avatar_url: string | null },
  share = 0.55,
): { games: BowlGame[]; entries: Entry[] } {
  const rnd = seeded(20261212)
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]
  const games = sampleBracket(sampleGames).map(g => ({ ...g }))
  const byId = indexGames(games)
  const sheet = games.filter(onSheet).sort(byKickoff)

  // Results, in kickoff order: the first `share` of the games are final.
  // A playoff game's teams are whoever won their way there (TBD until then).
  const results: PickMap = {}
  const cutoff = Math.round(sheet.length * share)
  sheet.forEach((g, i) => {
    const [a, h] = optionsFor(g, byId, results)
    if (g.away_from) g.away = a
    if (g.home_from) g.home = h
    if (i < cutoff && g.away && g.home) {
      const winner = rnd() < 0.5 ? g.away : g.home
      const win = 17 + Math.floor(rnd() * 32)
      const lose = Math.max(0, win - 1 - Math.floor(rnd() * 24))
      g.status = 'final'
      g.status_detail = 'Final'
      g.winner_team_id = winner.id
      g.away_score = winner.id === g.away.id ? win : lose
      g.home_score = winner.id === g.home.id ? win : lose
      results[g.id] = winner.id
    }
  })

  const people = [
    you,
    ...DEMO_PLAYERS.map((name, i) => ({ id: `demo-${i + 1}`, name, avatar_url: null as string | null })),
  ]
  const entries: Entry[] = people.map((p, n) => {
    // Each player gets a knack: how often they called the decided games right.
    const knack = 0.42 + rnd() * 0.3
    const picks: PickMap = {}
    for (const g of sheet) {
      const options = optionsFor(g, byId, picks).filter((t): t is BowlTeam => !!t)
      if (!options.length) continue
      const right = results[g.id] && options.find(t => t.id === results[g.id])
      picks[g.id] = right && rnd() < knack ? right.id : pick(options).id
    }
    // One player didn't quite finish.
    if (n === 7) for (const g of sheet.slice(-3)) delete picks[g.id]
    const picked = Object.keys(picks)
    const best5: string[] = []
    while (best5.length < Math.min(5, picked.length)) {
      const id = pick(picked)
      if (!best5.includes(id)) best5.push(id)
    }
    return {
      id: p.id, name: p.name, avatar_url: p.avatar_url,
      picks: cleanPicks(games, picks).picks,
      best5: cleanBest5(games, best5),
      titleTotal: 38 + Math.floor(rnd() * 40),
    }
  })
  return { games, entries }
}
