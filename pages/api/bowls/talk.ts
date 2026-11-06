import type { NextApiRequest, NextApiResponse } from 'next'
import { isValidOrigin } from '@/lib/validation'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { bowlCaller, currentBowlSeason } from '@/lib/bowls/server'
import { devicesFor, isMissingTalkTables, pushTo, TALK_MIGRATION_HINT } from '@/lib/bowls/notify'
import { attachmentLabel, isAllowedTalkImage, isGifUrl } from '@/lib/gifs'

const MAX_BODY = 4000
const PAGE = 50
const QUOTE = 140

/**
 * Bowl Talk — the Bowl Pick'em's own thread, separate from NFL Talk.
 *
 *   GET [?before=ISO]   a page of messages, newest first
 *   GET ?unread=1       how many messages you haven't seen
 *   POST { body, imageUrl?, replyToId?, mentionIds?, mentionAll? }
 *   DELETE { messageId }   your own (the bowl admin can remove any)
 *
 * Posting goes through here so the message, its @mentions and the push to
 * everyone who turned Talk notifications on happen together.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && !isValidOrigin(req)) return res.status(403).json({ error: 'Invalid origin' })
  const caller = await bowlCaller(req)
  if (!caller) return res.status(401).json({ error: 'Sign in first' })
  const supabase = getAdminClient()

  try {
    const { data: me } = await supabase.from('bowl_players').select('id, name').eq('id', caller.user.id).maybeSingle()
    if (!me && !caller.isAdmin) return res.status(403).json({ error: "This account isn't in the Bowl Pick'em." })

    if (req.method === 'GET') {
      if (req.query.unread) {
        if (!me) return res.status(200).json({ unread: 0 })
        const { data: read } = await supabase.from('bowl_talk_reads').select('last_read_at').eq('player_id', me.id).maybeSingle()
        let q = supabase.from('bowl_talk_messages').select('id').is('deleted_at', null).neq('player_id', me.id)
        if (read?.last_read_at) q = q.gt('created_at', read.last_read_at)
        const { data, error } = await q.limit(100)
        if (error) throw new Error(error.message)
        return res.status(200).json({ unread: (data ?? []).length })
      }

      let q = supabase.from('bowl_talk_messages').select('*').order('created_at', { ascending: false }).limit(PAGE)
      if (typeof req.query.before === 'string') q = q.lt('created_at', req.query.before)
      const { data: rows, error } = await q
      if (error) throw new Error(error.message)
      const messages = (rows ?? []) as Row[]
      const ids = messages.map(m => m.id)
      const parentIds = Array.from(new Set(messages.map(m => m.reply_to_id).filter(Boolean))) as string[]
      const [{ data: players }, { data: mentions }, { data: reactions }, { data: parents }] = await Promise.all([
        supabase.from('bowl_players').select('id, name, avatar_url'),
        ids.length ? supabase.from('bowl_talk_mentions').select('message_id, player_id').in('message_id', ids) : Promise.resolve({ data: [] }),
        ids.length ? supabase.from('bowl_talk_reactions').select('message_id, player_id, reaction, created_at').in('message_id', ids).order('created_at') : Promise.resolve({ data: [] }),
        parentIds.length ? supabase.from('bowl_talk_messages').select('id, author_name, body, image_url, deleted_at').in('id', parentIds) : Promise.resolve({ data: [] }),
      ])
      const pl = new Map(((players ?? []) as { id: string; name: string; avatar_url: string | null }[]).map(p => [p.id, p]))
      const mentionMap = new Map<string, string[]>()
      for (const m of (mentions ?? []) as { message_id: string; player_id: string }[]) mentionMap.set(m.message_id, [...(mentionMap.get(m.message_id) ?? []), m.player_id])
      const reactMap = new Map<string, Map<string, { id: string; name: string }[]>>()
      for (const r of (reactions ?? []) as { message_id: string; player_id: string; reaction: string }[]) {
        const byKind = reactMap.get(r.message_id) ?? new Map()
        byKind.set(r.reaction, [...(byKind.get(r.reaction) ?? []), { id: r.player_id, name: pl.get(r.player_id)?.name ?? 'Someone' }])
        reactMap.set(r.message_id, byKind)
      }
      const quotes = new Map(((parents ?? []) as Row[]).map(p => [p.id, {
        id: p.id, author_name: p.author_name, deleted: !!p.deleted_at,
        excerpt: p.deleted_at ? null : excerpt(p.body, p.image_url),
      }]))
      return res.status(200).json({
        me: me ? { id: me.id, name: me.name } : null,
        isAdmin: caller.isAdmin,
        players: Array.from(pl.values()).sort((a, b) => a.name.localeCompare(b.name)),
        hasMore: messages.length === PAGE,
        messages: messages.map(m => ({
          id: m.id, player_id: m.player_id, author_name: m.author_name, created_at: m.created_at,
          deleted: !!m.deleted_at,
          body: m.deleted_at ? null : m.body,
          image_url: m.deleted_at ? null : m.image_url,
          avatar_url: m.player_id ? pl.get(m.player_id)?.avatar_url ?? null : null,
          mentions: mentionMap.get(m.id) ?? [],
          reactions: Array.from((reactMap.get(m.id) ?? new Map()).entries()).map(([reaction, users]) => ({
            reaction, count: users.length, users, mine: users.some((u: { id: string }) => u.id === caller.user.id),
          })),
          reply_to: m.reply_to_id ? quotes.get(m.reply_to_id) ?? null : null,
        })),
      })
    }

    if (req.method === 'DELETE') {
      const id = String(req.body?.messageId ?? '')
      const { data: msg } = await supabase.from('bowl_talk_messages').select('player_id').eq('id', id).maybeSingle()
      if (!msg) return res.status(404).json({ error: 'Message not found' })
      if (msg.player_id !== caller.user.id && !caller.isAdmin) return res.status(403).json({ error: 'You can only delete your own messages' })
      const { error } = await supabase.from('bowl_talk_messages').update({ deleted_at: new Date().toISOString(), body: null, image_url: null }).eq('id', id)
      if (error) throw new Error(error.message)
      return res.status(200).json({ success: true })
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    if (!me) return res.status(403).json({ error: "Join the Bowl Pick'em to post in Bowl Talk." })
    const { body, imageUrl, replyToId, mentionIds, mentionAll } = req.body ?? {}
    const text = typeof body === 'string' ? body.trim() : ''
    if (!text && !imageUrl) return res.status(400).json({ error: 'Write something or attach a photo' })
    if (imageUrl && !isAllowedTalkImage(imageUrl)) return res.status(400).json({ error: 'That image can’t be posted — attach a photo or pick a GIF' })
    if (text.length > MAX_BODY) return res.status(400).json({ error: `Messages are limited to ${MAX_BODY} characters` })

    let parent: { player_id: string | null } | null = null
    if (replyToId) {
      const { data } = await supabase.from('bowl_talk_messages').select('player_id').eq('id', String(replyToId)).maybeSingle()
      if (!data) return res.status(400).json({ error: 'That message no longer exists' })
      parent = data
    }

    const { data: msg, error } = await supabase.from('bowl_talk_messages').insert({
      player_id: me.id, author_name: me.name, body: text || null, image_url: imageUrl || null, reply_to_id: replyToId || null,
    }).select('id, created_at').single()
    if (error) throw new Error(error.message)

    // @mentions: real bowl players only. @all is this season's players.
    let mentioned: string[] = []
    if (mentionAll === true) {
      const season = await currentBowlSeason(supabase)
      const { data } = season ? await supabase.from('bowl_entries').select('player_id').eq('season', season.season) : { data: [] }
      mentioned = ((data ?? []) as { player_id: string }[]).map(e => e.player_id).filter(id => id !== me.id)
    } else if (Array.isArray(mentionIds) && mentionIds.length) {
      const { data } = await supabase.from('bowl_players').select('id').in('id', mentionIds.slice(0, 30).map(String))
      mentioned = ((data ?? []) as { id: string }[]).map(p => p.id).filter(id => id !== me.id)
    }
    if (mentioned.length) {
      await supabase.from('bowl_talk_mentions').insert(mentioned.map(id => ({ message_id: msg.id, player_id: id })))
    }

    // Push to everyone with Bowl Talk notifications on, except the author.
    const devices = (await devicesFor(supabase, 'talk')).filter(d => d.player_id !== me.id)
    const tagged = new Set(mentioned)
    const repliedTo = parent?.player_id && parent.player_id !== me.id && !tagged.has(parent.player_id) ? parent.player_id : null
    const preview = text ? text.slice(0, 140) : isGifUrl(imageUrl) ? 'Sent a GIF' : 'Sent a photo'
    const base = { body: preview, url: '/bowls/talk', tag: 'bowl-talk' }
    const sent = (await Promise.all([
      pushTo(supabase, devices.filter(d => tagged.has(d.player_id)), { ...base, title: mentionAll === true ? `🏆 ${me.name} tagged everyone` : `🏆 ${me.name} tagged you` }),
      pushTo(supabase, devices.filter(d => d.player_id === repliedTo), { ...base, title: `🏆 ${me.name} replied to you` }),
      pushTo(supabase, devices.filter(d => !tagged.has(d.player_id) && d.player_id !== repliedTo), { ...base, title: `🏆 Bowl Talk — ${me.name}` }),
    ])).reduce((a, b) => a + b, 0)

    return res.status(201).json({ id: msg.id, created_at: msg.created_at, pushed: sent })
  } catch (err) {
    if (isMissingTalkTables(err as Error)) return res.status(500).json({ error: TALK_MIGRATION_HINT })
    console.error('bowls/talk error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Something went wrong' })
  }
}

interface Row {
  id: string; player_id: string | null; author_name: string; body: string | null; image_url: string | null
  reply_to_id: string | null; created_at: string; deleted_at: string | null
}

function excerpt(body: string | null, imageUrl: string | null): string {
  const t = (body ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return imageUrl ? attachmentLabel(imageUrl) : ''
  return t.length > QUOTE ? `${t.slice(0, QUOTE)}…` : t
}
