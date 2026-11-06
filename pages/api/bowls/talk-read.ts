import type { NextApiRequest, NextApiResponse } from 'next'
import { isValidOrigin } from '@/lib/validation'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getAuthUser } from '@/lib/apiAuth'

/** POST — you've seen Bowl Talk up to now (clears the unread count). */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!isValidOrigin(req)) return res.status(403).json({ error: 'Invalid origin' })
  const user = await getAuthUser(req)
  if (!user) return res.status(401).json({ error: 'Sign in first' })
  const supabase = getAdminClient()
  const { data: me } = await supabase.from('bowl_players').select('id').eq('id', user.id).maybeSingle()
  if (!me) return res.status(200).json({ ok: false })
  await supabase.from('bowl_talk_reads').upsert({ player_id: me.id, last_read_at: new Date().toISOString() }, { onConflict: 'player_id' })
  return res.status(200).json({ ok: true })
}
