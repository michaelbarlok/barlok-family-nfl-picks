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

  const { playerId, week, season, picks, bestPicks, gameId, pickedTeam, threeBest } = req.body

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

  // Enforce lock time: picks lock at the earliest kickoff of the week
  const { data: games } = await supabase
    .from('games')
    .select('kickoff_time')
    .eq('week', week)
    .eq('season', season)
    .order('kickoff_time', { ascending: true })
    .limit(1)

  if (games && games.length > 0) {
    const earliest = new Date(games[0].kickoff_time)
    if (new Date() >= earliest) {
      return res.status(400).json({ error: 'Picks are locked for this week' })
    }
  }

  try {
    // Single pick save (auto-save mode)
    if (gameId && pickedTeam !== undefined) {
      const { error: pickError } = await supabase.from('picks').upsert({
        user_id: playerId,
        game_id: gameId,
        picked_team: pickedTeam,
        week,
        season,
      }, { onConflict: 'user_id,game_id' })
      if (pickError) throw pickError
      return res.status(200).json({ success: true, type: 'pick' })
    }

    // Single three-best save (auto-save mode)
    if (threeBest) {
      const { error: bestError } = await supabase.from('three_best').upsert({
        user_id: playerId,
        week,
        season,
        pick_1: threeBest.pick_1 ?? '',
        pick_2: threeBest.pick_2 ?? '',
        pick_3: threeBest.pick_3 ?? '',
      }, { onConflict: 'user_id,week,season' })
      if (bestError) throw bestError
      return res.status(200).json({ success: true, type: 'three_best' })
    }

    // Bulk save picks (legacy)
    if (picks && typeof picks === 'object') {
      const picksArray = Object.entries(picks).map(([gid, pt]) => ({
        user_id: playerId,
        game_id: gid,
        picked_team: pt as string,
        week,
        season,
      }))

      if (picksArray.length > 0) {
        const { error: picksError } = await supabase.from('picks').upsert(picksArray)
        if (picksError) throw picksError
      }
    }

    // Bulk save best picks (legacy)
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
