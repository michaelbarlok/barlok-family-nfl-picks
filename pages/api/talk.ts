import type { NextApiRequest, NextApiResponse } from 'next'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getAuthUser, isAdmin } from '@/lib/apiAuth'
import { isValidOrigin } from '@/lib/validation'
import { sendPush, pushConfigured } from '@/lib/push'

const MAX_BODY_LENGTH = 4000
const PAGE_SIZE = 50

/**
 * The 💩 Talk thread.
 *
 * Posting runs through here rather than straight to the table so that the
 * message, its mentions and the notification fan-out happen in one place — a
 * client-side insert would have no way to resolve @names or notify anyone.
 *
 * GET    — a page of messages, newest first, with mentions attached
 * POST   — post a message
 * DELETE — soft-delete your own (admins can remove any)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && !isValidOrigin(req)) {
    return res.status(403).json({ error: 'Invalid origin' })
  }

  const authUser = await getAuthUser(req)
  if (!authUser) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = getAdminClient()

  // ── Read the thread ───────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const before = req.query.before as string | undefined
    let query = supabase
      .from('talk_messages')
      .select('id, user_id, author_name, body, image_url, created_at, deleted_at')
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
    if (before) query = query.lt('created_at', before)

    const { data: messages, error } = await query
    if (error) {
      if (error.message?.includes('talk_messages')) {
        return res.status(500).json({
          error: 'The talk tables do not exist yet. Run supabase/migrations/13_talk.sql.',
        })
      }
      return res.status(500).json({ error: 'Failed to load the thread' })
    }

    const ids = (messages ?? []).map(m => m.id)
    const [{ data: mentions }, { data: authors }, { data: reactions }] = await Promise.all([
      ids.length
        ? supabase.from('talk_mentions').select('message_id, user_id').in('message_id', ids)
        : Promise.resolve({ data: [] as { message_id: string; user_id: string }[] }),
      supabase.from('users').select('id, name, avatar_url'),
      // Reactions are written straight from the browser under RLS, but they are
      // read here so a message and its reactions arrive together — a separate
      // client query would render the thread once without them and again with.
      ids.length
        ? supabase.from('talk_reactions').select('message_id, user_id, reaction').in('message_id', ids)
        : Promise.resolve({ data: [] as { message_id: string; user_id: string; reaction: string }[] }),
    ])

    const avatarById = new Map((authors ?? []).map(u => [u.id, u.avatar_url]))
    const nameById = new Map((authors ?? []).map(u => [u.id, u.name]))
    const mentionsByMessage = new Map<string, string[]>()
    for (const m of mentions ?? []) {
      mentionsByMessage.set(m.message_id, [...(mentionsByMessage.get(m.message_id) ?? []), m.user_id])
    }

    // Collapsed to one entry per emoji per message, with the names behind it
    // and whether the caller is one of them — the client never has to hold the
    // raw rows or know who else exists.
    const reactionsByMessage = new Map<string, Map<string, { names: string[]; mine: boolean }>>()
    for (const r of reactions ?? []) {
      if (!reactionsByMessage.has(r.message_id)) reactionsByMessage.set(r.message_id, new Map())
      const forMessage = reactionsByMessage.get(r.message_id)!
      const entry = forMessage.get(r.reaction) ?? { names: [], mine: false }
      entry.names.push(nameById.get(r.user_id) ?? 'Someone')
      if (r.user_id === authUser.id) entry.mine = true
      forMessage.set(r.reaction, entry)
    }

    return res.status(200).json({
      messages: (messages ?? []).map(m => ({
        ...m,
        // Keep deleted rows in place so the thread doesn't renumber, but never
        // ship their contents.
        body: m.deleted_at ? null : m.body,
        image_url: m.deleted_at ? null : m.image_url,
        avatar_url: avatarById.get(m.user_id ?? '') ?? null,
        mentions: mentionsByMessage.get(m.id) ?? [],
        reactions: [...(reactionsByMessage.get(m.id) ?? new Map()).entries()].map(
          ([reaction, e]) => ({ reaction, count: e.names.length, names: e.names.sort(), mine: e.mine }),
        ),
      })),
      hasMore: (messages ?? []).length === PAGE_SIZE,
    })
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { messageId } = req.body ?? {}
    if (!messageId) return res.status(400).json({ error: 'messageId is required' })

    const { data: message } = await supabase
      .from('talk_messages').select('user_id').eq('id', messageId).maybeSingle()
    if (!message) return res.status(404).json({ error: 'Message not found' })

    if (message.user_id !== authUser.id && !(await isAdmin(req))) {
      return res.status(403).json({ error: 'You can only delete your own messages' })
    }

    await supabase.from('talk_messages')
      .update({ deleted_at: new Date().toISOString(), body: null, image_url: null })
      .eq('id', messageId)
    return res.status(200).json({ success: true })
  }

  // ── Post ──────────────────────────────────────────────────────────────────
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { body, imageUrl, mentionIds } = req.body ?? {}
  const text = typeof body === 'string' ? body.trim() : ''

  if (!text && !imageUrl) {
    return res.status(400).json({ error: 'Write something or attach a photo' })
  }
  if (text.length > MAX_BODY_LENGTH) {
    return res.status(400).json({ error: `Messages are limited to ${MAX_BODY_LENGTH} characters` })
  }

  const { data: author } = await supabase
    .from('users').select('name').eq('id', authUser.id).maybeSingle()
  if (!author) return res.status(403).json({ error: 'No player profile found for this account' })

  try {
    const { data: message, error } = await supabase.from('talk_messages').insert({
      user_id: authUser.id,
      author_name: author.name,
      body: text || null,
      image_url: imageUrl || null,
    }).select('id, created_at').single()

    if (error) {
      if (error.message?.includes('talk_messages')) {
        return res.status(500).json({
          error: 'The talk tables do not exist yet. Run supabase/migrations/13_talk.sql.',
        })
      }
      throw error
    }

    // Record mentions, ignoring anything that isn't a real player.
    let mentioned: string[] = []
    if (Array.isArray(mentionIds) && mentionIds.length > 0) {
      const { data: valid } = await supabase
        .from('users').select('id').in('id', mentionIds.slice(0, 20))
      mentioned = (valid ?? []).map(u => u.id)
      if (mentioned.length > 0) {
        await supabase.from('talk_mentions').insert(
          mentioned.map(uid => ({ message_id: message.id, user_id: uid })),
        )
      }
    }

    // Notify everyone who opted in, except the author — nobody needs a push
    // for their own message.
    let push: unknown = null
    if (pushConfigured()) {
      const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth, user_id')
        .eq('talk_enabled', true)
        .neq('user_id', authUser.id)

      if (subs && subs.length > 0) {
        const mentionedSet = new Set(mentioned)
        // One send per device so a tagged player gets the louder wording.
        const results = await Promise.all([
          sendPush(subs.filter(s => mentionedSet.has(s.user_id)), {
            title: `💩 ${author.name} tagged you`,
            body: text ? text.slice(0, 140) : 'Sent a photo',
            url: '/talk', tag: 'talk',
          }),
          sendPush(subs.filter(s => !mentionedSet.has(s.user_id)), {
            title: `💩 Talk — ${author.name}`,
            body: text ? text.slice(0, 140) : 'Sent a photo',
            url: '/talk', tag: 'talk',
          }),
        ])
        const expired = results.flatMap(r => r.expired)
        if (expired.length > 0) {
          await supabase.from('push_subscriptions').delete().in('endpoint', expired)
        }
        push = { sent: results.reduce((n, r) => n + r.sent, 0), devices: subs.length }
      }
    }

    return res.status(201).json({ id: message.id, created_at: message.created_at, push })
  } catch (err) {
    console.error('talk POST error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to post' })
  }
}
