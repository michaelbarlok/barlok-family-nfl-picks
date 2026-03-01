import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const ADMIN_EMAIL = 'barlokmichael@gmail.com'
const CURRENT_SEASON = 2025

// ESPN uses slightly different abbreviations for a few teams
const ESPN_TO_OUR: Record<string, string> = {
  JAX: 'JAC',
  WSH: 'WAS',
}
function normalizeTeam(espnAbbr: string): string {
  return ESPN_TO_OUR[espnAbbr] ?? espnAbbr
}

// Service-role client — bypasses RLS for admin writes
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, serviceKey)
}

// Regular client — used to validate user tokens
function getAnonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, anonKey)
}

async function isAuthorized(req: NextApiRequest): Promise<boolean> {
  const authHeader = req.headers.authorization ?? ''

  // Vercel cron jobs send the CRON_SECRET automatically
  if (process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`) {
    return true
  }

  // Admin UI sends the user's Supabase access token
  const token = authHeader.replace('Bearer ', '')
  if (!token) return false

  try {
    const { data: { user } } = await getAnonClient().auth.getUser(token)
    return user?.email === ADMIN_EMAIL
  } catch {
    return false
  }
}

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

      const competitors: { homeAway: string; team: { abbreviation: string }; winner: boolean }[] =
        competition.competitors ?? []

      const winnerComp = competitors.find((c) => c.winner === true)
      if (!winnerComp) continue

      const espnWinner = winnerComp.team.abbreviation
      const ourWinner = normalizeTeam(espnWinner)

      const awayComp = competitors.find((c) => c.homeAway === 'away')
      const homeComp = competitors.find((c) => c.homeAway === 'home')
      if (!awayComp || !homeComp) continue

      const espnAway = normalizeTeam(awayComp.team.abbreviation)
      const espnHome = normalizeTeam(homeComp.team.abbreviation)

      // Find matching game in our DB
      const ourGame = ourGames.find(
        (g) => g.away_team === espnAway && g.home_team === espnHome
      )
      if (!ourGame) {
        skipped.push(`${espnAway} @ ${espnHome} (not found in DB)`)
        continue
      }

      // Update games.winning_team
      await supabase
        .from('games')
        .update({ winning_team: ourWinner })
        .eq('id', ourGame.id)

      // Upsert scores for every user who picked this game
      const gamePicks = (allPicks ?? []).filter((p) => p.game_id === ourGame.id)
      let updated = 0
      for (const pick of gamePicks) {
        await supabase.from('scores').upsert({
          user_id: pick.user_id,
          game_id: ourGame.id,
          is_correct: pick.picked_team === ourWinner,
          week,
          season,
        })
        updated++
      }

      results.push({ game: `${espnAway} @ ${espnHome}`, winner: ourWinner, updated })
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
