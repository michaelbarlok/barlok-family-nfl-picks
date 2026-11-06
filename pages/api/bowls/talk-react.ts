import type { NextApiRequest, NextApiResponse } from 'next'
import { isValidOrigin } from '@/lib/validation'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getAuthUser } from '@/lib/apiAuth'
import { REACTIONS } from '@/lib/reactions'
import { isMissingTalkTables, TALK_MIGRATION_HINT } from '@/lib/bowls/notify'

/** POST { messageId, reaction } — add your reaction, or take it back if it's there. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!isValidOrigin(req)) return res.status(403).json({ error: 'Invalid origin' })
  const user = await getAuthUser(req)
  if (!user) return res.status(401).json({ error: 'Sign in first' })
  const { messageId, reaction } = req.body ?? {}
  if (!REACTIONS.some(r => r.code === reaction)) return res.status(400).json({ error: 'Unknown reaction' })
  const supabase = getAdminClient()
  try {
    const { data: me } = await supabase.from('bowl_players').select('id').eq('id', user.id).maybeSingle()
    if (!me) return res.status(403).json({ error: "Join the Bowl Pick'em to react." })
    const { data: msg } = await supabase.from('bowl_talk_messages').select('id, deleted_at').eq('id', String(messageId)).maybeSingle()
    if (!msg || msg.deleted_at) return res.status(404).json({ error: 'Message not found' })
    const key = { message_id: msg.id, player_id: me.id, reaction }
    const { data: had } = await supabase.from('bowl_talk_reactions').select('reaction').eq('message_id', msg.id).eq('player_id', me.id).eq('reaction', reaction).maybeSingle()
    const { error } = had
      ? await supabase.from('bowl_talk_reactions').delete().eq('message_id', msg.id).eq('player_id', me.id).eq('reaction', reaction)
      : await supabase.from('bowl_talk_reactions').insert(key)
    if (error) throw new Error(error.message)
    return res.status(200).json({ reacted: !had })
  } catch (err) {
    if (isMissingTalkTables(err as Error)) return res.status(500).json({ error: TALK_MIGRATION_HINT })
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Something went wrong' })
  }
}
