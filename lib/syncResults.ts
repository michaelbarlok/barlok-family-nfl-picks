import { normalizeTeam } from '@/lib/nflTeams'

/*
 * Record final results for one week from ESPN's scoreboard: each finished
 * game's winner and score, plus a right/wrong row per player in `scores`.
 *
 * Shared by the admin "Sync Results" button (/api/update-scores) and the
 * automatic cron (/api/cron-sync-results). The cron used to reach this by
 * making a second HTTP request to the site itself; calling it directly
 * removes that hop, which could be turned away (by Vercel's deployment
 * protection on the address it was built from) without anything noticing.
 *
 * pendingOnly: only games without a result yet — the cron uses this so it
 * can never overwrite a result an admin set by hand.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = any

interface GameRow { id: string; away_team: string; home_team: string; winning_team: string | null }
interface PickRow { user_id: string; game_id: string; picked_team: string }

export interface SyncResult {
  week: number
  season: number
  updated: { game: string; winner: string; updated: number }[]
  skipped: string[]
}

export async function syncWeekResults(
  supabase: Supabase,
  week: number,
  season: number,
  { pendingOnly = false }: { pendingOnly?: boolean } = {},
): Promise<SyncResult> {
  // Fetch ESPN scores
  const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`
  const espnRes = await fetch(espnUrl)
  if (!espnRes.ok) throw new Error(`ESPN API error: ${espnRes.status}`)
  const espnData = await espnRes.json()

  // Fetch our games for this week
  const { data: ourGames }: { data: GameRow[] | null } = await supabase
    .from('games')
    .select('*')
    .eq('week', week)
    .eq('season', season)

  if (!ourGames) throw new Error('Failed to fetch games from DB')

  // Fetch all picks for this week
  const { data: allPicks }: { data: PickRow[] | null } = await supabase
    .from('picks')
    .select('*')
    .eq('week', week)
    .eq('season', season)

  const events = espnData?.events ?? []
  const results: { game: string; winner: string; updated: number }[] = []
  const skipped: string[] = []

  for (const event of events) {
    const competition = event.competitions?.[0]
    if (!competition) continue

    // Only process completed games
    const isCompleted = competition.status?.type?.completed === true
    if (!isCompleted) {
      skipped.push(event.name)
      continue
    }

    const competitors: { homeAway: string; team: { abbreviation: string }; winner: boolean; score: string }[] =
      competition.competitors ?? []

    const awayComp = competitors.find((c: { homeAway: string }) => c.homeAway === 'away')
    const homeComp = competitors.find((c: { homeAway: string }) => c.homeAway === 'home')
    if (!awayComp || !homeComp) continue

    const espnAway = normalizeTeam(awayComp.team.abbreviation)
    const espnHome = normalizeTeam(homeComp.team.abbreviation)
    const awayScore = parseInt(awayComp.score) || 0
    const homeScore = parseInt(homeComp.score) || 0

    // Determine the winner. A missing `winner` flag is NOT on its own proof of
    // a tie — ESPN occasionally omits it on a game that has just gone final,
    // and writing 'TIE' would hand every player a tie for that game. Worse, it
    // would stick: once winning_team is set nothing re-checks the game. So we
    // only accept a tie when the scores actually agree, and skip anything
    // ambiguous so the next sync run can pick it up.
    // 0-0 is excluded deliberately: an unparsed or missing score also reads as
    // 0-0, and a real 0-0 NFL game hasn't happened since 1943. If one ever
    // does, set it by hand from the admin page.
    const winnerComp = competitors.find((c) => c.winner === true)
    const scoresAgree = awayScore === homeScore && !(awayScore === 0 && homeScore === 0)
    const isTie = !winnerComp && scoresAgree

    if (!winnerComp && !isTie) {
      skipped.push(`${espnAway} @ ${espnHome} (no winner flag, score ${awayScore}-${homeScore} — left undecided, will retry next sync)`)
      continue
    }

    const ourWinner = isTie ? 'TIE' : normalizeTeam(winnerComp!.team.abbreviation)

    // Find matching game in our DB
    const ourGame = ourGames.find(
      (g) => g.away_team === espnAway && g.home_team === espnHome
    )
    if (!ourGame) {
      skipped.push(`${espnAway} @ ${espnHome} (not found in DB)`)
      continue
    }
    if (pendingOnly && ourGame.winning_team) continue

    // Update games.winning_team and scores. Errors are checked: a result that
    // silently fails to save looks exactly like one that was never synced.
    const { error: gameErr } = await supabase
      .from('games')
      .update({ winning_team: ourWinner, away_score: awayScore, home_score: homeScore })
      .eq('id', ourGame.id)
    if (gameErr) throw new Error(`Saving ${espnAway} @ ${espnHome} failed: ${gameErr.message}`)

    // Batch upsert scores for all users
    const gamePicks = (allPicks ?? []).filter((p) => p.game_id === ourGame.id)
    const usersWithPicks = new Set((allPicks ?? []).map(p => p.user_id))
    const usersWhoPicked = new Set(gamePicks.map(p => p.user_id))

    const scoreRows = gamePicks.map(pick => ({
      user_id: pick.user_id,
      game_id: ourGame.id,
      is_correct: isTie ? null : pick.picked_team === ourWinner,
      week,
      season,
    }))

    // Add loss rows for users who have ANY picks this week but skipped this game
    for (const userId of usersWithPicks) {
      if (!usersWhoPicked.has(userId)) {
        scoreRows.push({
          user_id: userId,
          game_id: ourGame.id,
          is_correct: isTie ? null : false,
          week,
          season,
        })
      }
    }

    if (scoreRows.length > 0) {
      const { error: scoreErr } = await supabase.from('scores').upsert(scoreRows, { onConflict: 'user_id,game_id' })
      if (scoreErr) throw new Error(`Saving scores for ${espnAway} @ ${espnHome} failed: ${scoreErr.message}`)
    }

    results.push({ game: `${espnAway} @ ${espnHome}`, winner: ourWinner, updated: scoreRows.length })
  }

  return { week, season, updated: results, skipped }
}
