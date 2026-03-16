import type { NextApiRequest, NextApiResponse } from 'next'
import { CURRENT_SEASON } from '@/lib/constants'
import { normalizeTeam } from '@/lib/nflTeams'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isAuthorized } from '@/lib/apiAuth'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!(await isAuthorized(req))) {
    return res.status(403).json({ error: 'Unauthorized' })
  }

  const week = req.query.week ? parseInt(req.query.week as string) : null
  const season = req.query.season ? parseInt(req.query.season as string) : CURRENT_SEASON

  if (!week || week < 1 || week > 18) {
    return res.status(400).json({ error: 'Valid week (1-18) is required' })
  }

  try {
    // Fetch schedule from ESPN
    const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`
    const espnRes = await fetch(espnUrl)
    if (!espnRes.ok) throw new Error(`ESPN API error: ${espnRes.status}`)
    const espnData = await espnRes.json()

    const events = espnData?.events ?? []
    if (events.length === 0) {
      return res.status(200).json({ message: `No games found for Week ${week} ${season}. The schedule may not be released yet.`, added: 0 })
    }

    const supabase = getAdminClient()
    const games: { away_team: string; home_team: string; week: number; season: number; kickoff_time: string }[] = []

    for (const event of events) {
      const competition = event.competitions?.[0]
      if (!competition) continue

      const competitors: { homeAway: string; team: { abbreviation: string } }[] =
        competition.competitors ?? []

      const awayComp = competitors.find(c => c.homeAway === 'away')
      const homeComp = competitors.find(c => c.homeAway === 'home')
      if (!awayComp || !homeComp) continue

      const awayTeam = normalizeTeam(awayComp.team.abbreviation)
      const homeTeam = normalizeTeam(homeComp.team.abbreviation)
      const kickoffTime = competition.date // ISO 8601 from ESPN

      games.push({
        away_team: awayTeam,
        home_team: homeTeam,
        week,
        season,
        kickoff_time: kickoffTime,
      })
    }

    // Upsert games — uses the UNIQUE(week, away_team, home_team, season) constraint
    // This means re-syncing is safe and will update kickoff times if they changed
    const { error } = await supabase
      .from('games')
      .upsert(games, { onConflict: 'week,away_team,home_team,season' })

    if (error) throw new Error(`Database error: ${error.message}`)

    return res.status(200).json({
      success: true,
      week,
      season,
      added: games.length,
      message: `Synced ${games.length} games for Week ${week} ${season}.`,
    })
  } catch (err) {
    console.error('sync-schedule error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
  }
}
