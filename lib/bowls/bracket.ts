import { onSheet, sortGames, type BowlGame, type BowlTeam } from '@/lib/bowls/sheet'

/*
 * The playoff is each player's own bracket: a quarterfinal is the bye team
 * against whoever *you* picked to win the first-round game that feeds it, and
 * so on up to the champion. These work that out from the sheet and a player's
 * picks, on the server and the picks page alike.
 */

/** gameId → the ESPN id of the team picked. */
export type PickMap = Record<string, string>

const MAX_DEPTH = 8

export function indexGames(games: BowlGame[]): Map<string, BowlGame> {
  return new Map(games.map(g => [g.id, g]))
}

/**
 * The two teams this player chooses between, [away, home]. A side is null
 * when it isn't known yet: TBD on ESPN, or the winner of a game the player
 * hasn't picked.
 */
export function optionsFor(game: BowlGame, byId: Map<string, BowlGame>, picks: PickMap, depth = 0): [BowlTeam | null, BowlTeam | null] {
  if (depth > MAX_DEPTH) return [null, null]
  const side = (fixed: BowlTeam | null, from: string | null): BowlTeam | null => {
    if (!from) return fixed
    const feeder = byId.get(from)
    const picked = feeder && picks[feeder.id]
    if (!feeder || !picked) return null
    const [a, h] = optionsFor(feeder, byId, picks, depth + 1)
    return a?.id === picked ? a : h?.id === picked ? h : null
  }
  return [side(game.away, game.away_from), side(game.home, game.home_from)]
}

/** How many games deep in the bracket: 0 for a game with no feeders. */
export function depthOf(game: BowlGame, byId: Map<string, BowlGame>, depth = 0): number {
  if (depth > MAX_DEPTH) return depth
  let d = 0
  for (const from of [game.away_from, game.home_from]) {
    const f = from ? byId.get(from) : null
    if (f) d = Math.max(d, 1 + depthOf(f, byId, depth + 1))
  }
  return d
}

/**
 * The picks that stand on today's sheet: on-sheet games only, and each
 * bracket pick still one of the two teams the player has in that game.
 * `cleared` lists on-sheet games whose pick fell away — what happens to the
 * later rounds when someone changes a first-round pick.
 */
export function cleanPicks(games: BowlGame[], picks: PickMap): { picks: PickMap; cleared: string[] } {
  const byId = indexGames(games)
  const out: PickMap = {}
  const cleared: string[] = []
  const ordered = games
    .filter(g => onSheet(g) && picks[g.id])
    .sort((a, b) => depthOf(a, byId) - depthOf(b, byId))
  for (const g of ordered) {
    const [a, h] = optionsFor(g, byId, out)
    const t = picks[g.id]
    if (a?.id === t || h?.id === t) out[g.id] = t
    else cleared.push(g.id)
  }
  return { picks: out, cleared }
}

/** Best 5: on-sheet games, no repeats, at most five. */
export function cleanBest5(games: BowlGame[], best5: string[] | null | undefined): string[] {
  const ok = new Set(games.filter(onSheet).map(g => g.id))
  return Array.from(new Set((best5 ?? []).filter(id => ok.has(id)))).slice(0, 5)
}

export interface Progress {
  total: number
  picked: number
  best5: number
  best5Needed: number
  needsTotal: boolean
  hasTotal: boolean
  complete: boolean
}

/** How far along a player's sheet is. Counts only — never which teams. */
export function progress(games: BowlGame[], picks: PickMap, best5: string[] | null | undefined, titleTotal: number | null | undefined): Progress {
  const sheet = games.filter(onSheet)
  const valid = cleanPicks(games, picks).picks
  const picked = sheet.filter(g => valid[g.id]).length
  const b5 = cleanBest5(games, best5).length
  const best5Needed = Math.min(5, sheet.length)
  const needsTotal = sheet.some(g => g.phase === 'title')
  const hasTotal = titleTotal !== null && titleTotal !== undefined
  return {
    total: sheet.length,
    picked,
    best5: b5,
    best5Needed,
    needsTotal,
    hasTotal,
    complete: sheet.length > 0 && picked === sheet.length && b5 === best5Needed && (!needsTotal || hasTotal),
  }
}

/** A name that tells games apart — the four first-round games share one. */
export function gameLabel(g: BowlGame): string {
  if (g.playoff_round === 'first' || !g.name) return `${g.name || 'Game'}: ${g.away?.name ?? 'TBD'} vs ${g.home?.name ?? 'TBD'}`
  return g.name
}

/** What's still missing before picks can open. Empty when the sheet is ready. */
export function sheetIssues(games: BowlGame[]): string[] {
  const byId = indexGames(games)
  const sheet = sortGames(games.filter(onSheet))
  if (!sheet.length) return ['No games are on the sheet yet.']
  const issues: string[] = []
  const fed = new Set<string>()
  for (const g of sheet) {
    if (!g.kickoff_time) issues.push(`${gameLabel(g)}: no kickoff date yet.`)
    if (depthOf(g, byId) > MAX_DEPTH) { issues.push(`${gameLabel(g)}: the bracket loops back on itself.`); continue }
    for (const side of ['away', 'home'] as const) {
      const from = side === 'away' ? g.away_from : g.home_from
      if (from) {
        const f = byId.get(from)
        if (!f || !onSheet(f)) issues.push(`${gameLabel(g)}: the game feeding it isn't on the sheet.`)
        else if (fed.has(from)) issues.push(`${gameLabel(f)} feeds two games.`)
        else fed.add(from)
      } else if (!(side === 'away' ? g.away : g.home)) {
        issues.push(g.playoff_round
          ? `${gameLabel(g)}: a team is still TBD — link it to the game its winner comes from.`
          : `${gameLabel(g)}: a team is still TBD.`)
      }
    }
  }
  return Array.from(new Set(issues))
}

export interface LinkUpdate { gameId: string; side: 'away' | 'home'; from: string }

/**
 * A first guess at the playoff bracket from ESPN's rankings, for any links not
 * set yet. In the 12-team format the bye teams are seeds 1–4 and the
 * first-round hosts are seeds 5–8: seed 1 gets the winner of 8 v 9, seed 2
 * gets 7 v 10, and so on. The semifinals pair 1/4 and 2/3, but which bowl
 * hosts which comes from the official bracket — the admin checks these.
 */
export function guessBracket(games: BowlGame[]): LinkUpdate[] {
  const sheet = games.filter(onSheet)
  const rank = (t: BowlTeam | null) => t?.rank ?? 99
  const byTime = (a: BowlGame, b: BowlGame) => (a.kickoff_time ?? '').localeCompare(b.kickoff_time ?? '')
  const firsts = sheet.filter(g => g.playoff_round === 'first').sort((a, b) => rank(a.home) - rank(b.home) || byTime(a, b))
  const quarters = sheet
    .filter(g => g.playoff_round === 'quarter')
    .map(q => ({ q, bye: q.home && !q.away ? q.home : q.away && !q.home ? q.away : null }))
    .filter(x => x.bye)
    .sort((a, b) => rank(a.bye) - rank(b.bye) || byTime(a.q, b.q))
  const semis = sheet.filter(g => g.playoff_round === 'semi').sort(byTime)
  const titles = sheet.filter(g => g.playoff_round === 'title')
  const used = new Set(sheet.flatMap(g => [g.away_from, g.home_from]).filter(Boolean) as string[])
  const out: LinkUpdate[] = []
  const link = (g: BowlGame, side: 'away' | 'home', from: BowlGame | undefined) => {
    if (!from || used.has(from.id)) return
    if ((side === 'away' ? g.away_from : g.home_from) || (side === 'away' ? g.away : g.home)) return
    used.add(from.id)
    out.push({ gameId: g.id, side, from: from.id })
  }

  if (quarters.length && quarters.length === firsts.length) {
    quarters.forEach(({ q }, i) => link(q, q.away ? 'home' : 'away', firsts[firsts.length - 1 - i]))
  }
  const qOrder = quarters.map(x => x.q)
  if (semis.length === 2 && qOrder.length === 4) {
    link(semis[0], 'away', qOrder[0]); link(semis[0], 'home', qOrder[3])
    link(semis[1], 'away', qOrder[1]); link(semis[1], 'home', qOrder[2])
  }
  if (titles.length === 1 && semis.length === 2) {
    link(titles[0], 'away', semis[0]); link(titles[0], 'home', semis[1])
  }
  return out
}
