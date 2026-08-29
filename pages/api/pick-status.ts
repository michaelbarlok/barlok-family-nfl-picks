import type { NextApiRequest, NextApiResponse } from 'next'
import { MAX_BEST_PICKS } from '@/lib/constants'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getCurrentSeason } from '@/lib/season'
import { getAuthUser } from '@/lib/apiAuth'

/**
 * How far along everyone is this week — counts only, never picks.
 *
 * This has to run on the service-role client, because the RLS rule on `picks`
 * is "your own rows, or everyone's once the week locks". Read through the
 * browser client before lock and you get back only your own rows, so a status
 * board built that way reports 0 for every other player. That is what the
 * /all-picks board was doing.
 *
 * Using the service role means the response is the security boundary, so be
 * precise about what crosses it:
 *   - picks is selected as user_id ONLY. picked_team is never read, so who
 *     picked whom cannot leak from here under any response shape.
 *   - three_best has to select pick_1..3 to count the filled slots, and those
 *     columns do hold team abbreviations. They are reduced to a count on this
 *     side and never placed on the response.
 * If you extend this handler, keep both of those true — the whole point is that
 * progress is public while picks stay hidden until the week locks.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const authUser = await getAuthUser(req)
  if (!authUser) return res.status(401).json({ error: 'Unauthorized' })

  const week = parseInt(req.query.week as string)
  if (!week || isNaN(week)) return res.status(400).json({ error: 'A valid week is required' })

  const supabase = getAdminClient()
  const season = req.query.season ? parseInt(req.query.season as string) : await getCurrentSeason(supabase)

  try {
    const [{ data: users }, { data: games }, { data: picks }, { data: threeBest }] = await Promise.all([
      supabase.from('users').select('id, name').order('name'),
      supabase.from('games').select('id').eq('week', week).eq('season', season),
      // user_id only — enough to count by, and carries nothing about the pick.
      supabase.from('picks').select('user_id').eq('week', week).eq('season', season),
      supabase.from('three_best').select('user_id, pick_1, pick_2, pick_3')
        .eq('week', week).eq('season', season),
    ])

    const totalGames = games?.length ?? 0

    const pickCounts = new Map<string, number>()
    for (const p of picks ?? []) {
      pickCounts.set(p.user_id, (pickCounts.get(p.user_id) ?? 0) + 1)
    }

    // A three_best row appears on the first star, so count filled slots rather
    // than treating the row's existence as done.
    const bestCounts = new Map<string, number>()
    for (const tb of threeBest ?? []) {
      bestCounts.set(tb.user_id, [tb.pick_1, tb.pick_2, tb.pick_3].filter(Boolean).length)
    }

    const players = (users ?? []).map(u => {
      const pickCount = pickCounts.get(u.id) ?? 0
      const bestCount = bestCounts.get(u.id) ?? 0
      return {
        id: u.id,
        name: u.name,
        pickCount,
        bestCount,
        complete: pickCount >= totalGames && bestCount >= MAX_BEST_PICKS,
      }
    })

    return res.status(200).json({ week, season, totalGames, players })
  } catch (err) {
    console.error('pick-status error:', err)
    return res.status(500).json({ error: 'Failed to load pick status' })
  }
}
