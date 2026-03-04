import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { ADMIN_EMAIL } from '@/lib/constants'

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
  if (!(await isAdmin(req))) return res.status(403).json({ error: 'Unauthorized' })

  const { gameId, winningTeam, week, season } = req.body
  if (!gameId || !winningTeam || !week || !season) {
    return res.status(400).json({ error: 'Missing required fields: gameId, winningTeam, week, season' })
  }

  const supabase = getAdminClient()

  try {
    // Set the winning team on the game record
    const { error: gameError } = await supabase
      .from('games')
      .update({ winning_team: winningTeam })
      .eq('id', gameId)

    if (gameError) throw gameError

    // Fetch all picks for this game
    const { data: picks, error: picksError } = await supabase
      .from('picks')
      .select('*')
      .eq('game_id', gameId)

    if (picksError) throw picksError

    // Upsert a score row for every user who picked this game
    let updated = 0
    for (const pick of picks ?? []) {
      await supabase.from('scores').upsert({
        user_id: pick.user_id,
        game_id: gameId,
        is_correct: pick.picked_team === winningTeam,
        week,
        season,
      })
      updated++
    }

    return res.status(200).json({ success: true, winningTeam, updated })
  } catch (err) {
    console.error('set-result error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
  }
}
