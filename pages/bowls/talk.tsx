import Link from 'next/link'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { useBowlAuth } from '@/lib/bowls/auth'
import { supabase } from '@/lib/supabase'
import { REACTIONS, reactionEmoji, sortReactions } from '@/lib/reactions'
import { isGifUrl } from '@/lib/gifs'
import { processImageFile, TALK_MAX_DIMENSION } from '@/lib/avatarUtils'
import GifPicker from '@/components/GifPicker'
import { useToast } from '@/components/Toast'
import BowlHeader, { BowlAvatar } from '@/components/bowls/BowlHeader'

interface Player { id: string; name: string; avatar_url: string | null }
interface Reaction { reaction: string; count: number; users: { id: string; name: string }[]; mine: boolean }
interface Message {
  id: string
  player_id: string | null
  author_name: string
  created_at: string
  deleted: boolean
  body: string | null
  image_url: string | null
  avatar_url: string | null
  mentions: string[]
  reactions: Reaction[]
  reply_to: { id: string; author_name: string; excerpt: string | null; deleted: boolean } | null
}

const GROUP_MS = 5 * 60 * 1000
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
function dayLabel(iso: string) {
  const d = new Date(iso), today = new Date()
  const y = new Date(); y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}
const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** What you type after @ for each player: first name, or the full name (no spaces) when first names clash. */
function handles(players: Player[]): Map<string, string> {
  const first = (p: Player) => p.name.split(' ')[0]
  const counts = new Map<string, number>()
  for (const p of players) counts.set(first(p).toLowerCase(), (counts.get(first(p).toLowerCase()) ?? 0) + 1)
  return new Map(players.map(p => [p.id, (counts.get(first(p).toLowerCase())! > 1 ? p.name : first(p)).replace(/\s+/g, '')]))
}

/**
 * Bowl Talk — the Bowl Pick'em's own thread, separate from NFL Talk.
 * Photos, GIFs, replies, reactions and @mentions (or @all). New messages show
 * up live; anyone who turns on Bowl Talk notifications gets a push.
 */
export default function BowlTalk() {
  const router = useRouter()
  const { loading, account, player, token } = useBowlAuth()
  const toast = useToast()
  const [messages, setMessages] = useState<Message[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [image, setImage] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [gifOpen, setGifOpen] = useState(false)
  const [gifsOn, setGifsOn] = useState(false)
  const listEnd = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const stickToBottom = useRef(true)

  useEffect(() => { if (!loading && !account) router.replace('/bowls/login') }, [loading, account, router])

  const authed = useCallback(async (init: RequestInit = {}) => ({
    ...init, headers: { ...(init.headers ?? {}), 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
  }), [token])

  const markRead = useCallback(async () => {
    if (document.visibilityState !== 'visible') return
    fetch('/api/bowls/talk-read', await authed({ method: 'POST' })).catch(() => {})
  }, [authed])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/bowls/talk', await authed())
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load Bowl Talk')
      const fresh = [...json.messages].reverse() as Message[]
      setMessages(prev => {
        // Keep older pages already loaded; replace the newest page.
        const oldest = fresh[0]?.created_at
        const older = oldest ? prev.filter(m => m.created_at < oldest) : prev
        return [...older, ...fresh]
      })
      setPlayers(json.players)
      setIsAdmin(json.isAdmin)
      setHasMore(prev => (loaded ? prev : json.hasMore))
      setLoaded(true)
      setError('')
      markRead()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Bowl Talk')
    }
  }, [authed, loaded, markRead])

  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    if (!account) return
    loadRef.current()
    // Live: the database tells us the moment something changes; a slow poll
    // and a refresh on coming back to the app cover a dropped connection.
    const channel = supabase
      .channel(`bowl-talk-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bowl_talk_messages' }, () => loadRef.current())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bowl_talk_reactions' }, () => loadRef.current())
      .subscribe()
    const onVisible = () => { if (document.visibilityState === 'visible') loadRef.current() }
    document.addEventListener('visibilitychange', onVisible)
    const poll = setInterval(() => { if (document.visibilityState === 'visible') loadRef.current() }, 20000)
    fetch('/api/gifs?status=1').then(r => (r.ok ? r.json() : null)).then(j => setGifsOn(!!j?.configured)).catch(() => {})
    return () => { supabase.removeChannel(channel); document.removeEventListener('visibilitychange', onVisible); clearInterval(poll) }
  }, [account])

  useEffect(() => {
    const onScroll = () => { stickToBottom.current = innerHeight + scrollY >= document.documentElement.scrollHeight - 160 }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  const lastId = messages[messages.length - 1]?.id
  useLayoutEffect(() => { if (stickToBottom.current) listEnd.current?.scrollIntoView({ block: 'end' }) }, [lastId, loaded])

  const loadOlder = async () => {
    const before = messages[0]?.created_at
    if (!before) return
    const res = await fetch(`/api/bowls/talk?before=${encodeURIComponent(before)}`, await authed())
    const json = await res.json()
    if (!res.ok) return toast.show(json.error ?? 'Could not load more', 'error')
    stickToBottom.current = false
    setMessages(prev => [...[...json.messages].reverse(), ...prev])
    setHasMore(json.hasMore)
  }

  const handleOf = useMemo(() => handles(players), [players])
  const suggestions = mentionQuery === null ? [] : [
    ...('all'.startsWith(mentionQuery) ? [{ id: 'all', label: 'all', name: 'Everyone in the pick’em' }] : []),
    ...players.filter(p => p.id !== player?.id && (handleOf.get(p.id) ?? '').toLowerCase().startsWith(mentionQuery))
      .map(p => ({ id: p.id, label: handleOf.get(p.id)!, name: p.name })),
  ].slice(0, 6)

  const onDraft = (v: string) => {
    setDraft(v)
    const el = textarea.current
    if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 140)}px` }
    const m = v.slice(0, el?.selectionStart ?? v.length).match(/@(\w*)$/)
    setMentionQuery(m ? m[1].toLowerCase() : null)
  }
  const insertMention = (label: string) => {
    const el = textarea.current
    const cursor = el?.selectionStart ?? draft.length
    const before = draft.slice(0, cursor).replace(/@(\w*)$/, `@${label} `)
    setDraft(before + draft.slice(cursor))
    setMentionQuery(null)
    el?.focus()
  }

  const pickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const { base64, contentType } = await processImageFile(file, TALK_MAX_DIMENSION)
      const res = await fetch('/api/bowls/talk-image', await authed({ method: 'POST', body: JSON.stringify({ imageData: base64, contentType }) }))
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Upload failed')
      setImage(json.url)
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Could not attach that photo', 'error')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const send = async () => {
    const text = draft.trim()
    if ((!text && !image) || sending) return
    setSending(true)
    const tagged = players.filter(p => new RegExp(`(^|\\s)@${escapeRe(handleOf.get(p.id) ?? '')}\\b`, 'i').test(text)).map(p => p.id)
    const all = /(^|\s)@(all|everyone)\b/i.test(text)
    try {
      const res = await fetch('/api/bowls/talk', await authed({
        method: 'POST',
        body: JSON.stringify({ body: text, imageUrl: image, replyToId: replyTo?.id ?? null, mentionIds: tagged, mentionAll: all }),
      }))
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not send')
      setDraft(''); setImage(null); setReplyTo(null); setMentionQuery(null)
      if (textarea.current) textarea.current.style.height = 'auto'
      stickToBottom.current = true
      await load()
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Could not send', 'error')
    } finally {
      setSending(false)
    }
  }

  const react = async (m: Message, code: string) => {
    setActive(null)
    // Show it now; the reload confirms.
    setMessages(prev => prev.map(x => x.id !== m.id ? x : {
      ...x,
      reactions: (() => {
        const has = x.reactions.find(r => r.reaction === code)
        if (has?.mine) return x.reactions.map(r => r.reaction === code ? { ...r, count: r.count - 1, mine: false } : r).filter(r => r.count > 0)
        if (has) return x.reactions.map(r => r.reaction === code ? { ...r, count: r.count + 1, mine: true } : r)
        return [...x.reactions, { reaction: code, count: 1, users: [], mine: true }]
      })(),
    }))
    const res = await fetch('/api/bowls/talk-react', await authed({ method: 'POST', body: JSON.stringify({ messageId: m.id, reaction: code }) }))
    if (!res.ok) toast.show((await res.json()).error ?? 'Could not react', 'error')
    load()
  }

  const remove = async (m: Message) => {
    setActive(null)
    if (!confirm('Delete this message?')) return
    const res = await fetch('/api/bowls/talk', await authed({ method: 'DELETE', body: JSON.stringify({ messageId: m.id }) }))
    if (!res.ok) return toast.show((await res.json()).error ?? 'Could not delete', 'error')
    load()
  }

  const jumpTo = (id: string) => {
    const el = document.getElementById(`msg-${id}`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.add('ring-2', 'ring-yellow-500/60')
    setTimeout(() => el.classList.remove('ring-2', 'ring-yellow-500/60'), 1400)
  }

  const renderBody = (text: string, mine: boolean) => {
    const labels = [...Array.from(handleOf.values()), 'all', 'everyone']
    const re = new RegExp(`(@(?:${labels.map(escapeRe).join('|')})\\b)`, 'gi')
    // split() with a capture group alternates text, mention, text, …
    return text.split(re).map((part, i) => i % 2 === 1
      ? <span key={i} className={`font-semibold ${mine ? 'text-zinc-950 underline decoration-zinc-950/40' : 'text-yellow-400'}`}>{part}</span>
      : <span key={i}>{part}</span>)
  }

  const inThread = !!player
  return (
    <div className="min-h-screen bg-zinc-950">
      <BowlHeader subtitle="Talk" />
      <main className="max-w-3xl mx-auto px-3 sm:px-4 pt-3 pb-40" onClick={() => setActive(null)}>
        {error ? <div className="glass-card rounded-2xl p-4 text-sm text-red-400">{error}</div>
          : !loaded ? <div className="space-y-3">{[0, 1, 2, 3].map(i => <div key={i} className={`skeleton h-14 rounded-2xl ${i % 2 ? 'ml-16' : 'mr-16'}`} />)}</div>
          : (
            <>
              <div className="flex items-center justify-between gap-2 mb-3 px-1">
                <p className="text-xs text-zinc-500">The Bowl Pick&apos;em&apos;s own thread — separate from NFL Talk.</p>
                <Link href="/bowls/settings" className="shrink-0 text-xs font-semibold text-yellow-500 hover:text-yellow-400">🔔 Notifications</Link>
              </div>
              {hasMore && (
                <button onClick={loadOlder} className="block mx-auto mb-3 text-xs font-semibold text-zinc-400 hover:text-white px-3 py-1.5 rounded-full bg-white/[0.04]">Load earlier messages</button>
              )}
              {!messages.length && (
                <div className="glass-card rounded-2xl p-6 text-center">
                  <p className="text-3xl mb-2">🏈</p>
                  <p className="text-white font-medium">No messages yet</p>
                  <p className="text-sm text-zinc-400 mt-1">Start the trash talk for bowl season.</p>
                </div>
              )}
              <ol className="space-y-0.5" aria-label="Messages">
                {messages.map((m, i) => {
                  const prev = messages[i - 1]
                  const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString()
                  const grouped = !newDay && prev && prev.player_id === m.player_id && !prev.deleted
                    && Date.parse(m.created_at) - Date.parse(prev.created_at) < GROUP_MS
                  const mine = !!player && m.player_id === player.id
                  const tagged = !!player && m.mentions.includes(player.id)
                  const gif = isGifUrl(m.image_url)
                  return (
                    <li key={m.id}>
                      {newDay && <p className="text-center text-[11px] font-semibold text-zinc-500 uppercase tracking-wider py-3">{dayLabel(m.created_at)}</p>}
                      <div className={`flex items-end gap-2 ${mine ? 'flex-row-reverse' : ''} ${grouped ? 'mt-0.5' : 'mt-2.5'}`}>
                        <div className="w-8 shrink-0">{!mine && !grouped && <BowlAvatar name={m.author_name} url={m.avatar_url} size={32} />}</div>
                        <div className={`min-w-0 max-w-[78%] flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                          {!grouped && !mine && <p className="text-[11px] font-semibold text-zinc-400 px-1 mb-0.5">{m.author_name}</p>}
                          <div id={`msg-${m.id}`} role="button" tabIndex={0} aria-label={`Message from ${m.author_name}`}
                            onClick={e => { e.stopPropagation(); if (!m.deleted) setActive(active === m.id ? null : m.id) }}
                            className={`rounded-2xl transition ${m.deleted ? 'px-3 py-2 italic text-zinc-500 bg-white/[0.03] border border-white/[0.05] text-sm'
                              : m.image_url && !m.body && !m.reply_to ? 'overflow-hidden'
                              : `px-3 py-2 text-[15px] leading-snug ${mine ? 'bg-gradient-to-b from-yellow-400 to-yellow-500 text-zinc-950' : tagged ? 'bg-zinc-800 text-white ring-1 ring-yellow-500/50' : 'bg-zinc-800 text-white'}`}`}>
                            {m.deleted ? 'Message deleted' : (
                              <>
                                {m.reply_to && (
                                  <button onClick={e => { e.stopPropagation(); jumpTo(m.reply_to!.id) }}
                                    className={`block w-full text-left mb-1.5 pl-2 border-l-2 text-xs ${mine ? 'border-zinc-950/40 text-zinc-800' : 'border-yellow-500/60 text-zinc-400'}`}>
                                    <span className="font-semibold">{m.reply_to.author_name}</span>
                                    <span className="block truncate">{m.reply_to.deleted ? 'Message deleted' : m.reply_to.excerpt}</span>
                                  </button>
                                )}
                                {m.image_url && (
                                  <img src={m.image_url} alt={gif ? 'GIF' : 'Photo'} loading="lazy"
                                    className={`block max-h-72 w-auto max-w-full ${m.body || m.reply_to ? 'rounded-xl mb-1.5' : 'rounded-2xl'}`} />
                                )}
                                {m.body && <p className="whitespace-pre-wrap break-words">{renderBody(m.body, mine)}</p>}
                              </>
                            )}
                          </div>
                          {m.reactions.length > 0 && (
                            <div className={`flex flex-wrap gap-1 mt-1 ${mine ? 'justify-end' : ''}`}>
                              {sortReactions(m.reactions).map(r => (
                                <button key={r.reaction} onClick={e => { e.stopPropagation(); if (inThread) react(m, r.reaction) }}
                                  title={r.users.map(u => u.name).join(', ')}
                                  aria-label={`${reactionEmoji(r.reaction)} ${r.count}`} aria-pressed={r.mine}
                                  className={`text-xs px-1.5 py-0.5 rounded-full border ${r.mine ? 'bg-yellow-500/15 border-yellow-500/40 text-yellow-200' : 'bg-white/[0.05] border-white/[0.08] text-zinc-300'}`}>
                                  {reactionEmoji(r.reaction)} {r.count}
                                </button>
                              ))}
                            </div>
                          )}
                          {active === m.id && (
                            <div onClick={e => e.stopPropagation()} role="toolbar" aria-label="Message actions"
                              className={`mt-1 flex items-center gap-1 rounded-full bg-zinc-900 border border-white/[0.1] px-1.5 py-1 shadow-lg animate-fade-in ${mine ? 'self-end' : ''}`}>
                              {inThread && REACTIONS.map(r => (
                                <button key={r.code} onClick={() => react(m, r.code)} aria-label={r.label} className="w-8 h-8 rounded-full hover:bg-white/[0.08] text-lg">{r.emoji}</button>
                              ))}
                              {inThread && <button onClick={() => { setReplyTo(m); setActive(null); textarea.current?.focus() }} className="px-2 h-8 rounded-full text-xs font-semibold text-zinc-200 hover:bg-white/[0.08]">Reply</button>}
                              {(mine || isAdmin) && <button onClick={() => remove(m)} className="px-2 h-8 rounded-full text-xs font-semibold text-red-300 hover:bg-white/[0.08]">Delete</button>}
                            </div>
                          )}
                          {(!messages[i + 1] || messages[i + 1].player_id !== m.player_id || Date.parse(messages[i + 1].created_at) - Date.parse(m.created_at) >= GROUP_MS) && (
                            <p className="text-[10px] text-zinc-600 px-1 mt-0.5">{clock(m.created_at)}</p>
                          )}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ol>
              <div ref={listEnd} />
            </>
          )}
      </main>

      {loaded && !error && (
        inThread ? (
          <div className="fixed inset-x-0 bottom-0 z-30 bg-zinc-950/95 backdrop-blur-xl border-t border-white/[0.08] safe-bottom">
            <div className="max-w-3xl mx-auto px-3 pt-2 pb-2">
              {suggestions.length > 0 && (
                <div className="mb-2 rounded-xl bg-zinc-900 border border-white/[0.1] overflow-hidden" role="listbox" aria-label="Mention someone">
                  {suggestions.map(s => (
                    <button key={s.id} role="option" aria-selected={false} onClick={() => insertMention(s.label)}
                      className="w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-white/[0.06] flex items-center gap-2">
                      <span className="font-semibold text-yellow-400">@{s.label}</span><span className="text-zinc-500 truncate">{s.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {replyTo && (
                <div className="mb-2 flex items-center gap-2 text-xs text-zinc-400 pl-2 border-l-2 border-yellow-500/60">
                  <span className="flex-1 min-w-0 truncate">Replying to <strong className="text-zinc-200">{replyTo.author_name}</strong>{replyTo.body ? ` — ${replyTo.body}` : ''}</span>
                  <button onClick={() => setReplyTo(null)} aria-label="Cancel reply" className="text-zinc-500 hover:text-white px-1">✕</button>
                </div>
              )}
              {image && (
                <div className="mb-2 relative inline-block">
                  <img src={image} alt="Attachment" className="h-20 rounded-xl" />
                  <button onClick={() => setImage(null)} aria-label="Remove attachment" className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-zinc-800 border border-white/[0.2] text-xs text-white">✕</button>
                </div>
              )}
              <div className="flex items-end gap-1.5">
                <input ref={fileRef} type="file" accept="image/*,.heic,.heif" className="hidden" onChange={pickPhoto} />
                <button onClick={() => fileRef.current?.click()} disabled={uploading} aria-label="Add a photo"
                  className="shrink-0 w-10 h-10 rounded-full bg-white/[0.06] text-zinc-300 hover:text-white disabled:opacity-50 flex items-center justify-center">{uploading ? '…' : '📷'}</button>
                {gifsOn && (
                  <button onClick={() => setGifOpen(true)} aria-label="Add a GIF"
                    className="shrink-0 h-10 px-2.5 rounded-full bg-white/[0.06] text-[11px] font-extrabold text-zinc-300 hover:text-white">GIF</button>
                )}
                <textarea ref={textarea} value={draft} onChange={e => onDraft(e.target.value)} rows={1} placeholder="Message Bowl Talk"
                  aria-label="Message" maxLength={4000}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); send() } }}
                  className="flex-1 min-w-0 resize-none px-3.5 py-2.5 rounded-2xl bg-white/[0.06] border border-white/[0.08] text-[15px] text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/40" />
                <button onClick={send} disabled={sending || (!draft.trim() && !image)} aria-label="Send"
                  className="shrink-0 h-10 px-4 rounded-full bg-gradient-to-b from-yellow-400 to-yellow-600 text-zinc-950 text-sm font-bold disabled:opacity-40">
                  {sending ? '…' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="fixed inset-x-0 bottom-0 z-30 bg-zinc-950/95 border-t border-white/[0.08] safe-bottom">
            <p className="max-w-3xl mx-auto px-4 py-3 text-sm text-zinc-400 text-center">Join the Bowl Pick&apos;em to post in Bowl Talk.</p>
          </div>
        )
      )}
      {gifOpen && <GifPicker onClose={() => setGifOpen(false)} onPick={g => { setImage(g.url); setGifOpen(false) }} />}
    </div>
  )
}
