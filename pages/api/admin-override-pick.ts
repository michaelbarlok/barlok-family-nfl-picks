import type { NextApiRequest, NextApiResponse } from 'next'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isAdmin } from '@/lib/apiAuth'
import { validateThreeBest, isValidOrigin } from '@/lib/validation'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!isValidOrigin(req)) return res.status(403).json({ error: 'Invalid origin' })
  if (!(await isAdmin(req))) return res.status(403).json({ error: 'Unauthorized' })

  const { userId, week, season, gameId, pickedTeam, threeBest } = req.body

  if (!userId || !week || !season) {
    return res.status(400).json({ error: 'Missing required fields: userId, week, season' })
  }

  const supabase = getAdminClient()

  try {
    // Override a single game pick
    if (gameId && pickedTeam !== undefined) {
      if (pickedTeam === null) {
        // Delete the pick (clear it)
        await supabase
          .from('picks')
          .delete()
          .eq('user_id', userId)
          .eq('game_id', gameId)
        // Also remove the score row so standings stay consistent
        await supabase
          .from('scores')
          .delete()
          .eq('user_id', userId)
          .eq('game_id', gameId)
      } else {
        // Verify the game exists and its week/season match the request
        const { data: game } = await supabase
          .from('games')
          .select('winning_team, week, season, away_team, home_team')
          .eq('id', gameId)
          .single()
        if (!game) return res.status(404).json({ error: 'Game not found' })
        if (game.week !== week || game.season !== season) {
          return res.status(400).json({ error: 'week/season do not match the game' })
        }
        if (pickedTeam !== game.away_team && pickedTeam !== game.home_team) {
          return res.status(400).json({ error: 'pickedTeam must be one of the game teams' })
        }

        const { error } = await supabase.from('picks').upsert({
          user_id: userId,
          game_id: gameId,
          picked_team: pickedTeam,
          week,
          season,
        }, { onConflict: 'user_id,game_id' })
        if (error) throw error

        // If this game already has a result, update the score row too
        if (game.winning_team) {
          await supabase.from('scores').upsert({
            user_id: userId,
            game_id: gameId,
            is_correct: game.winning_team === 'TIE' ? null : pickedTeam === game.winning_team,
            week,
            season,
          }, { onConflict: 'user_id,game_id' })
        }
      }
      return res.status(200).json({ success: true, type: 'pick', userId, gameId, pickedTeam })
    }

    // Override three best picks
    if (threeBest) {
      const validationError = validateThreeBest(threeBest)
      if (validationError) return res.status(400).json({ error: validationError })
      const { pick_1, pick_2, pick_3 } = threeBest
      const { error } = await supabase.from('three_best').upsert({
        user_id: userId,
        week,
        season,
        pick_1: pick_1 ?? '',
        pick_2: pick_2 ?? '',
        pick_3: pick_3 ?? '',
      }, { onConflict: 'user_id,week,season' })
      if (error) throw error
      return res.status(200).json({ success: true, type: 'three_best', userId, threeBest })
    }

    return res.status(400).json({ error: 'Provide either gameId+pickedTeam or threeBest' })
  } catch (err) {
    console.error('admin-override-pick error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
  }
}
