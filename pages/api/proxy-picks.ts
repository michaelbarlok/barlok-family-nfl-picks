import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { CURRENT_SEASON } from '@/lib/constants'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function getAuthUser(req: NextApiRequest) {
  const token = (req.headers.authorization ?? '').replace('Bearer ', '')
  if (!token) return null
  try {
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data: { user } } = await anon.auth.getUser(token)
    return user
  } catch {
    return null
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authUser = await getAuthUser(req)
  if (!authUser) return res.status(401).json({ error: 'Unauthorized' })

  const { playerId, week, season, picks, bestPicks } = req.body

  if (!playerId || !week || !season) {
    return res.status(400).json({ error: 'Missing required fields: playerId, week, season' })
  }

  const supabase = getServiceClient()

  // Verify caller is a manager of this player
  const { data: link } = await supabase
    .from('player_managers')
    .select('id')
    .eq('manager_id', authUser.id)
    .eq('player_id', playerId)
    .single()

  if (!link) {
    return res.status(403).json({ error: 'You are not a manager for this player' })
  }

  // Enforce lock time: find the earliest kickoff for this week, lock at Thursday 8:15 PM ET
  const { data: games } = await supabase
    .from('games')
    .select('kickoff_time')
    .eq('week', week)
    .eq('season', season)
    .order('kickoff_time', { ascending: true })
    .limit(1)

  if (games && games.length > 0) {
    const earliest = new Date(games[0].kickoff_time)
    const thursday = new Date(earliest)
    const dow = thursday.getUTCDay()
    const daysBack = dow >= 4 ? dow - 4 : dow + 3
    thursday.setUTCDate(thursday.getUTCDate() - daysBack)
    const month = thursday.getUTCMonth()
    const utcOffset = month >= 10 ? 5 : 4
    thursday.setUTCHours(20 + utcOffset, 15, 0, 0)

    if (new Date() >= thursday) {
      return res.status(400).json({ error: 'Picks are locked for this week' })
    }
  }

  try {
    // Save picks
    if (picks && typeof picks === 'object') {
      const picksArray = Object.entries(picks).map(([gameId, pickedTeam]) => ({
        user_id: playerId,
        game_id: gameId,
        picked_team: pickedTeam as string,
        week,
        season,
      }))

      if (picksArray.length > 0) {
        const { error: picksError } = await supabase.from('picks').upsert(picksArray)
        if (picksError) throw picksError
      }
    }

    // Save best picks
    if (bestPicks && Array.isArray(bestPicks) && bestPicks.length === 3) {
      const { error: bestError } = await supabase.from('three_best').upsert({
        user_id: playerId,
        week,
        season,
        pick_1: bestPicks[0] ?? '',
        pick_2: bestPicks[1] ?? '',
        pick_3: bestPicks[2] ?? '',
      }, { onConflict: 'user_id,week,season' })
      if (bestError) throw bestError
    }

    return res.status(200).json({ success: true })
  } catch (err) {
    console.error('proxy-picks error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save picks' })
  }
}
