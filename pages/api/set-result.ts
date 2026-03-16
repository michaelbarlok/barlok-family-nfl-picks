import type { NextApiRequest, NextApiResponse } from 'next'
import { isValidOrigin } from '@/lib/validation'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isAdmin } from '@/lib/apiAuth'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!isValidOrigin(req)) return res.status(403).json({ error: 'Invalid origin' })
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

    // Batch upsert scores for all users
    const isTie = winningTeam === 'TIE'
    const scoreRows = (picks ?? []).map(pick => ({
      user_id: pick.user_id,
      game_id: gameId,
      is_correct: isTie ? null : pick.picked_team === winningTeam,
      week,
      season,
    }))

    // Add loss rows for users who have ANY picks this week but skipped this game
    const { data: weekPicks } = await supabase.from('picks').select('user_id').eq('week', week).eq('season', season)
    const usersWithPicks = new Set((weekPicks ?? []).map(p => p.user_id))
    const usersWhoPicked = new Set((picks ?? []).map(p => p.user_id))
    for (const userId of usersWithPicks) {
      if (!usersWhoPicked.has(userId)) {
        scoreRows.push({
          user_id: userId,
          game_id: gameId,
          is_correct: isTie ? null : false,
          week,
          season,
        })
      }
    }

    if (scoreRows.length > 0) {
      await supabase.from('scores').upsert(scoreRows, { onConflict: 'user_id,game_id' })
    }

    return res.status(200).json({ success: true, winningTeam, updated: scoreRows.length })
  } catch (err) {
    console.error('set-result error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
  }
}
