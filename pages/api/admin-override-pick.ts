import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { ADMIN_EMAIL } from '@/lib/constants'
import { validateThreeBest, isValidOrigin } from '@/lib/validation'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function isAdmin(req: NextApiRequest): Promise<boolean> {
  const token = (req.headers.authorization ?? '').replace('Bearer ', '')
  if (!token) return false
  try {
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data: { user } } = await anon.auth.getUser(token)
    return user?.email === ADMIN_EMAIL
  } catch {
    return false
  }
}

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
        // Upsert the pick
        const { error } = await supabase.from('picks').upsert({
          user_id: userId,
          game_id: gameId,
          picked_team: pickedTeam,
          week,
          season,
        }, { onConflict: 'user_id,game_id' })
        if (error) throw error

        // If this game already has a result, update the score row too
        const { data: game } = await supabase
          .from('games')
          .select('winning_team')
          .eq('id', gameId)
          .single()

        if (game?.winning_team) {
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
