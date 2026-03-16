import type { NextApiRequest, NextApiResponse } from 'next'
import { CURRENT_SEASON } from '@/lib/constants'
import { normalizeTeam } from '@/lib/nflTeams'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isAuthorized } from '@/lib/apiAuth'

// Auto-detect which week to update: the most recent week with any game already kicked off
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function detectCurrentWeek(supabase: any): Promise<number | null> {
  const { data } = await supabase
    .from('games')
    .select('week')
    .eq('season', CURRENT_SEASON)
    .lt('kickoff_time', new Date().toISOString())
    .order('week', { ascending: false })
    .limit(1)
  const row = (data as { week: number }[] | null)?.[0]
  return row?.week ?? null
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!(await isAuthorized(req))) {
    return res.status(403).json({ error: 'Unauthorized' })
  }

  const supabase = getAdminClient()

  // Determine week — explicit param or auto-detect
  let week: number
  if (req.query.week) {
    week = parseInt(req.query.week as string)
  } else {
    const detected = await detectCurrentWeek(supabase)
    if (!detected) return res.status(200).json({ message: 'No games have started yet — nothing to update.' })
    week = detected
  }

  const season = req.query.season ? parseInt(req.query.season as string) : CURRENT_SEASON

  try {
    // Fetch ESPN scores
    const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`
    const espnRes = await fetch(espnUrl)
    if (!espnRes.ok) throw new Error(`ESPN API error: ${espnRes.status}`)
    const espnData = await espnRes.json()

    // Fetch our games for this week
    const { data: ourGames } = await supabase
      .from('games')
      .select('*')
      .eq('week', week)
      .eq('season', season)

    if (!ourGames) throw new Error('Failed to fetch games from DB')

    // Fetch all picks for this week
    const { data: allPicks } = await supabase
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

      // Detect tie: completed game where no competitor has winner === true
      const winnerComp = competitors.find((c) => c.winner === true)
      const isTie = !winnerComp
      const ourWinner = isTie ? 'TIE' : normalizeTeam(winnerComp.team.abbreviation)

      // Find matching game in our DB
      const ourGame = ourGames.find(
        (g) => g.away_team === espnAway && g.home_team === espnHome
      )
      if (!ourGame) {
        skipped.push(`${espnAway} @ ${espnHome} (not found in DB)`)
        continue
      }

      // Update games.winning_team and scores
      await supabase
        .from('games')
        .update({ winning_team: ourWinner, away_score: awayScore, home_score: homeScore })
        .eq('id', ourGame.id)

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
        await supabase.from('scores').upsert(scoreRows, { onConflict: 'user_id,game_id' })
      }

      results.push({ game: `${espnAway} @ ${espnHome}`, winner: ourWinner, updated: scoreRows.length })
    }

    return res.status(200).json({
      week,
      season,
      updated: results,
      skipped,
      message: `Synced ${results.length} completed games for Week ${week}.`,
    })
  } catch (err) {
    console.error('update-scores error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
  }
}
