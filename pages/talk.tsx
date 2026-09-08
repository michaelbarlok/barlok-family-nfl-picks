import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { ADMIN_EMAIL } from '@/lib/constants'
import { processImageFile, TALK_MAX_DIMENSION } from '@/lib/avatarUtils'
import { REACTIONS, reactionEmoji, reactionLabel, sortReactions } from '@/lib/reactions'
import {
  getPushState, getTalkEnabled, setTalkEnabled, refreshSubscription, type PushState,
} from '@/lib/pushClient'
import Nav from '@/components/Nav'

interface Player { id: string; name: string; avatar_url?: string | null }

interface Reactor { id: string; name: string }

interface MessageReaction {
  reaction: string
  count: number
  /** In the order people reacted. */
  users: Reactor[]
  mine: boolean
}

interface QuotedMessage {
  id: string
  author_name: string
  /** null when the quoted message has since been deleted. */
  excerpt: string | null
  deleted: boolean
}

interface Message {
  id: string
  user_id: string | null
  author_name: string
  body: string | null
  image_url: string | null
  created_at: string
  deleted_at: string | null
  avatar_url: string | null
  mentions: string[]
  reactions: MessageReaction[]
  reply_to: QuotedMessage | null
}

/** Messages from the same person inside this window share one bubble group. */
const GROUP_WINDOW_MS = 5 * 60 * 1000
/** Hold this long to open a message's actions. Matches the platform feel. */
const LONG_PRESS_MS = 450
/** Moving further than this during the hold means you're scrolling, not pressing. */
const LONG_PRESS_SLOP_PX = 10
const HOLD_HINT_KEY = 'nfl-talk-hold-hint'

/** Renders @mentions as highlighted chips, leaving the rest as plain text. */
function MessageBody({ text, players, mine }: { text: string; players: Player[]; mine: boolean }) {
  const names = players.map(p => p.name).sort((a, b) => b.length - a.length)
  if (names.length === 0) return <>{text}</>

  // Longest name first, so "Joe Sr" wins over "Joe".
  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const parts = text.split(new RegExp(`(@(?:${escaped.join('|')}))`, 'g'))

  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('@') && names.includes(part.slice(1))
          // Blue-on-blue is unreadable inside my own bubble, so mentions there
          // lean on weight and a wash instead of hue.
          ? <span key={i} className={mine ? 'font-semibold bg-white/20 rounded px-1' : 'text-blue-400 font-semibold'}>{part}</span>
          : <span key={i}>{part}</span>,
      )}
    </>
  )
}

const dayKey = (iso: string) => new Date(iso).toDateString()

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  const sameYear = d.getFullYear() === today.getFullYear()
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }),
  })
}

function flashMessage(el: HTMLElement) {
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  el.classList.add('quote-flash')
  window.setTimeout(() => el.classList.remove('quote-flash'), 1200)
}

const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

export default function TalkPage() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const [draft, setDraft] = useState('')
  const [pendingImage, setPendingImage] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState('')

  const [showMentions, setShowMentions] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [pushState, setPushState] = useState<PushState | null>(null)
  const [notifyOn, setNotifyOn] = useState(false)
  const [notifyBusy, setNotifyBusy] = useState(false)

  // Which of my own bubbles is showing its Delete affordance. Tap-to-reveal,
  // because hover doesn't exist on the phones this is mostly read on.
  const [openActions, setOpenActions] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<QuotedMessage | null>(null)
  // Hold-to-act is invisible until someone tries it, and nobody tries a gesture
  // they haven't been told about. Shown once, retired the first time it's used.
  const [showHoldHint, setShowHoldHint] = useState(false)
  // Which message's reactor list is open. Held by id, not by object, so the
  // sheet follows the message through a realtime refresh instead of freezing
  // on a stale copy of it.
  const [reactorsFor, setReactorsFor] = useState<string | null>(null)
  // Long-press bookkeeping. A ref, not state — it changes on every pointer
  // move and must not re-render the thread while a finger is down.
  const pressRef = useRef<{ timer: number; x: number; y: number } | null>(null)
  // When the last long press fired. A timestamp rather than a flag: if the
  // browser doesn't follow a press with a click, a flag would stay set and
  // swallow the next outside tap instead.
  const pressFiredAtRef = useRef(0)
  // Set when a quoted message isn't loaded yet, so the jump can retry after
  // the older page arrives.
  const jumpRef = useRef<{ id: string; tries: number } | null>(null)

  const scrollerRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)               // is the view parked at the bottom?
  const restoreRef = useRef<number | null>(null) // scrollHeight to anchor to after loading older
  const prevLenRef = useRef(0)
  const [showJump, setShowJump] = useState(false)
  const [keyboardOpen, setKeyboardOpen] = useState(false)

  const isAdmin = user?.email === ADMIN_EMAIL || user?.is_admin === true

  useEffect(() => {
    if (!loading && !user) router.push('/login')
  }, [user, loading, router])

  const token = async () => (await supabase.auth.getSession()).data.session?.access_token ?? ''

  const load = useCallback(async (mode: 'initial' | 'older' | 'refresh', before?: string) => {
    try {
      const url = before ? `/api/talk?before=${encodeURIComponent(before)}` : '/api/talk'
      const res = await fetch(url, { headers: { Authorization: `Bearer ${await token()}` } })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load the thread')
      const incoming: Message[] = json.messages

      setMessages(prev => {
        if (mode === 'initial') return incoming
        // Merge rather than replace: a realtime refresh only fetches the newest
        // page, and replacing would throw away every older page already loaded.
        const byId = new Map(prev.map(m => [m.id, m]))
        for (const m of incoming) byId.set(m.id, m)
        return [...byId.values()].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )
      })
      // A refresh says nothing about how far back the thread goes.
      if (mode !== 'refresh') setHasMore(json.hasMore)
      setLoadError('')
    } catch (err) {
      // A failed page means the pending jump will never resolve, and leaving it
      // armed would make some later, unrelated message scroll and flash.
      jumpRef.current = null
      setLoadError(err instanceof Error ? err.message : 'Failed to load the thread')
    } finally {
      setDataLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    load('initial')
    supabase.from('users').select('id, name, avatar_url').order('name')
      .then(({ data }) => setPlayers(data ?? []))

    try {
      setShowHoldHint(!window.localStorage.getItem(HOLD_HINT_KEY))
    } catch { /* blocked storage just means the hint shows again */ }

    setPushState(getPushState())
    getTalkEnabled().then(setNotifyOn).catch(() => {})
    refreshSubscription().catch(() => {})

    // Mark the thread read so the unread badge clears.
    supabase.from('talk_reads')
      .upsert({ user_id: user.id, last_read_at: new Date().toISOString() }, { onConflict: 'user_id' })
      .then(() => {})
  }, [user, load])

  // Live updates — the same realtime pattern the standings page uses.
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel('talk-messages')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'talk_messages' }, () => load('refresh'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'talk_reactions' }, () => load('refresh'))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user, load])

  // The thread lives in a fixed-height column, so the height has to track the
  // visual viewport — 100dvh does not shrink when the keyboard opens, and
  // without this the composer would sit behind it.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const apply = () => {
      document.documentElement.style.setProperty('--app-h', `${vv.height}px`)
      setKeyboardOpen(window.innerHeight - vv.height > 120)
      // Nothing below us scrolls, so any page offset iOS introduced while
      // focusing the input is pure drift.
      if (window.scrollY !== 0) window.scrollTo(0, 0)
    }
    apply()
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
      document.documentElement.style.removeProperty('--app-h')
    }
  }, [])

  // Any click anywhere dismisses an open action row — on the header, the
  // composer, another message. Bound to the document rather than the thread
  // container, which only ever saw taps that landed inside the scroller.
  useEffect(() => {
    if (!openActions) return
    const dismiss = () => {
      // A long press is followed by a click on the same element; without this
      // the press would open the row and that click would shut it one frame
      // later. A timestamp, so a browser that emits no click can't wedge it.
      if (Date.now() - pressFiredAtRef.current < 500) return
      setOpenActions(null)
    }
    document.addEventListener('click', dismiss)
    return () => document.removeEventListener('click', dismiss)
  }, [openActions])

  // Removing the last reaction empties the sheet. Close it rather than leaving
  // it armed to reappear the moment someone else reacts.
  useEffect(() => {
    if (!reactorsFor) return
    const message = messages.find(m => m.id === reactorsFor)
    if (!message || message.reactions.length === 0) setReactorsFor(null)
  }, [reactorsFor, messages])

  const ordered = useMemo(
    () => [...messages].reverse(), // the API pages newest-first; a thread reads oldest-first
    [messages],
  )

  // Bottom-anchored scrolling: stay pinned to the newest message unless the
  // reader has deliberately scrolled up, and hold position when older messages
  // are prepended.
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    // A jump waiting on an older page wins over both anchoring rules — it is
    // the only one the reader explicitly asked for. Bounded, so a quote whose
    // original has been paged past can't loop forever.
    const pending = jumpRef.current
    if (pending) {
      const target = document.getElementById(`msg-${pending.id}`)
      if (target) {
        jumpRef.current = null
        prevLenRef.current = ordered.length
        flashMessage(target)
        return
      }
      if (pending.tries < 3 && hasMore) {
        jumpRef.current = { id: pending.id, tries: pending.tries + 1 }
        loadOlder()
      } else {
        jumpRef.current = null
        setPostError('That message is further back than the thread has loaded.')
      }
    }

    if (restoreRef.current !== null) {
      el.scrollTop += el.scrollHeight - restoreRef.current
      restoreRef.current = null
    } else if (stickRef.current) {
      el.scrollTop = el.scrollHeight
    } else if (ordered.length > prevLenRef.current) {
      setShowJump(true)
    }
    prevLenRef.current = ordered.length
  }, [ordered, dataLoading])

  const onScroll = () => {
    const el = scrollerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    stickRef.current = atBottom
    if (atBottom) setShowJump(false)
  }

  const jumpToBottom = () => {
    const el = scrollerRef.current
    if (!el) return
    stickRef.current = true
    setShowJump(false)
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  // Images arrive after layout, so a pinned view has to re-pin once they land.
  const onMediaLoad = () => {
    const el = scrollerRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }

  const loadOlder = () => {
    const el = scrollerRef.current
    if (!el || ordered.length === 0) return
    restoreRef.current = el.scrollHeight
    setLoadingMore(true)
    load('older', messages[messages.length - 1].created_at)
  }

  const autoGrow = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }

  const onDraftChange = (value: string) => {
    setDraft(value)
    autoGrow()
    // Open the picker on a trailing @word, so typing @Am filters to Amy.
    const upToCursor = value.slice(0, textareaRef.current?.selectionStart ?? value.length)
    const match = upToCursor.match(/@([\w]*)$/)
    setShowMentions(!!match)
    setMentionQuery(match?.[1]?.toLowerCase() ?? '')
  }

  const insertMention = (name: string) => {
    const el = textareaRef.current
    const cursor = el?.selectionStart ?? draft.length
    const before = draft.slice(0, cursor).replace(/@([\w]*)$/, `@${name} `)
    setDraft(before + draft.slice(cursor))
    setShowMentions(false)
    el?.focus()
  }

  const pickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setPostError('')
    try {
      const { base64, contentType } = await processImageFile(file, TALK_MAX_DIMENSION)
      const res = await fetch('/api/talk-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ imageData: base64, contentType }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Upload failed')
      setPendingImage(json.url)
    } catch (err) {
      setPostError(err instanceof Error ? err.message : 'Could not attach that photo')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const post = async () => {
    if ((!draft.trim() && !pendingImage) || posting) return
    setPosting(true)
    setPostError('')
    stickRef.current = true // sending always takes you to the bottom
    try {
      // Resolve @names back to ids so mentions survive a later rename.
      const mentionIds = players.filter(p => draft.includes(`@${p.name}`)).map(p => p.id)
      const res = await fetch('/api/talk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({
          body: draft.trim(), imageUrl: pendingImage, mentionIds, replyToId: replyTo?.id ?? null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not post')
      setDraft('')
      setPendingImage(null)
      setReplyTo(null)
      setShowMentions(false)
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      await load('refresh')
    } catch (err) {
      setPostError(err instanceof Error ? err.message : 'Could not post')
    } finally {
      setPosting(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return
    // Enter sends on a keyboard; on a touch keyboard Return stays Return and
    // the send button does the sending, which is what phones do everywhere else.
    if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) return
    e.preventDefault()
    post()
  }

  // ── Long press ────────────────────────────────────────────────────────
  // Signal's gesture: hold a message to get its actions, and a tap does
  // nothing. Pointer events cover finger and mouse in one path; a right-click
  // is the desktop equivalent and is wired separately.
  const dismissHoldHint = () => {
    setShowHoldHint(false)
    try { window.localStorage.setItem(HOLD_HINT_KEY, '1') } catch { /* fine */ }
  }

  const cancelPress = () => {
    if (pressRef.current) window.clearTimeout(pressRef.current.timer)
    pressRef.current = null
  }

  const startPress = (e: React.PointerEvent, messageId: string, deleted: boolean) => {
    if (deleted || e.button === 2) return
    const { clientX: x, clientY: y } = e
    const timer = window.setTimeout(() => {
      pressRef.current = null
      pressFiredAtRef.current = Date.now()
      setOpenActions(messageId)
      dismissHoldHint()
      // A short buzz makes the gesture legible on a phone; absent everywhere
      // else, which is fine.
      navigator.vibrate?.(15)
    }, LONG_PRESS_MS)
    pressRef.current = { timer, x, y }
  }

  const movePress = (e: React.PointerEvent) => {
    const press = pressRef.current
    if (!press) return
    if (Math.abs(e.clientX - press.x) > LONG_PRESS_SLOP_PX ||
        Math.abs(e.clientY - press.y) > LONG_PRESS_SLOP_PX) {
      cancelPress()
    }
  }

  /** Scroll a quoted message into view, loading older pages until it's there. */
  const jumpToMessage = (id: string) => {
    const el = document.getElementById(`msg-${id}`)
    if (el) return flashMessage(el)
    if (!hasMore) {
      setPostError('That message is further back than the thread has loaded.')
      return
    }
    jumpRef.current = { id, tries: 0 }
    loadOlder()
  }

  const toggleReaction = async (messageId: string, code: string) => {
    if (!user) return
    const message = messages.find(m => m.id === messageId)
    if (!message || message.deleted_at) return

    const existing = message.reactions.find(r => r.reaction === code)
    const removing = existing?.mine === true
    const myName = user.name ?? 'You'

    // Applied locally first: a reaction has to answer on the tap, not on the
    // round trip. The realtime refresh that follows is what reconciles it, and
    // is also what corrects this if the write fails.
    setMessages(prev => prev.map(m => {
      if (m.id !== messageId) return m
      const others = m.reactions.filter(r => r.reaction !== code)
      if (removing) {
        // By id, not by name — two people can share a first name.
        const users = existing!.users.filter(u => u.id !== user.id)
        return {
          ...m,
          reactions: users.length > 0
            ? [...others, { reaction: code, count: users.length, users, mine: false }]
            : others,
        }
      }
      const users = [...(existing?.users ?? []), { id: user.id, name: myName }]
      return {
        ...m,
        reactions: [...others, { reaction: code, count: users.length, users, mine: true }],
      }
    }))

    const { error } = removing
      ? await supabase.from('talk_reactions').delete()
          .eq('message_id', messageId).eq('user_id', user.id).eq('reaction', code)
      : await supabase.from('talk_reactions')
          .insert({ message_id: messageId, user_id: user.id, reaction: code })

    if (error) {
      setPostError(error.message.includes('talk_reactions')
        ? 'Reactions are not set up yet. Run supabase/migrations/15_talk_reactions.sql.'
        : 'Could not save that reaction.')
      await load('refresh')
    }
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this message?')) return
    setOpenActions(null)
    await fetch('/api/talk', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ messageId: id }),
    })
    await load('refresh')
  }

  const toggleNotify = async () => {
    setNotifyBusy(true)
    try {
      const { state, enabled } = await setTalkEnabled(!notifyOn)
      setPushState(state)
      setNotifyOn(enabled)
    } finally {
      setNotifyBusy(false)
    }
  }

  if (loading || dataLoading) {
    return (
      <div className="fixed inset-x-0 top-0 h-app flex flex-col bg-surface overflow-hidden">
        <Nav />
        <div className="flex-1 min-h-0 overflow-hidden">
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className={`flex ${i % 3 === 0 ? 'justify-end' : ''}`}>
                <div className={`skeleton rounded-2xl h-12 ${i % 3 === 0 ? 'w-40' : 'w-56'}`} />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }
  if (!user) return null

  const mentionMatches = players
    .filter(p => p.id !== user.id && p.name.toLowerCase().includes(mentionQuery))
    .slice(0, 6)

  const canSend = (!!draft.trim() || !!pendingImage) && !posting

  return (
    <div className="fixed inset-x-0 top-0 h-app flex flex-col bg-surface overflow-hidden">
      <Nav />

      {/* Thread header — thin, so the conversation gets the screen. */}
      <div className="shrink-0 border-b border-white/[0.06] bg-surface/80 backdrop-blur-xl">
        <div className="max-w-3xl mx-auto px-4 h-11 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base leading-none">💩</span>
            <span className="text-sm font-semibold text-white truncate">Talk</span>
            <span className="text-[11px] text-slate-500 shrink-0">
              {players.length} {players.length === 1 ? 'member' : 'members'}
            </span>
          </div>

          {pushState === 'granted' || pushState === 'default' ? (
            <button
              onClick={toggleNotify}
              disabled={notifyBusy}
              aria-pressed={notifyOn}
              title={notifyOn ? 'Notifications on' : 'Turn on notifications'}
              className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition disabled:opacity-50 ${
                notifyOn
                  ? 'bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30'
                  : 'bg-white/[0.06] text-slate-400 hover:text-slate-200'
              }`}
            >
              {notifyOn ? '🔔 On' : '🔕 Notify me'}
            </button>
          ) : pushState === 'denied' ? (
            <span className="shrink-0 text-[11px] text-slate-500" title="Re-enable notifications in your settings">
              🔕 Blocked
            </span>
          ) : pushState === 'needs-install' ? (
            <span className="shrink-0 text-[11px] text-slate-500">Install for alerts</span>
          ) : null}
        </div>
      </div>

      {/* ── The thread ───────────────────────────────────────────────────── */}
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
      >
        <div className="max-w-3xl mx-auto px-3 sm:px-4 py-4">
          {pushState === 'needs-install' && (
            <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-[11px] text-blue-300/90">
              To get notified of new messages on iPhone, tap Share → <strong>Add to Home Screen</strong> and open
              it from there. Safari tabs can&apos;t receive notifications.
            </div>
          )}

          {loadError && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm">{loadError}</div>
          )}

          {hasMore && (
            <button
              onClick={loadOlder}
              disabled={loadingMore}
              className="mx-auto mb-4 block px-4 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 bg-white/[0.04] hover:bg-white/[0.07] rounded-full transition disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load earlier messages'}
            </button>
          )}

          {ordered.length === 0 && !loadError && (
            <div className="py-20 text-center">
              <p className="text-5xl mb-3">💩</p>
              <p className="text-white font-medium">No messages yet</p>
              <p className="text-slate-500 text-sm mt-1.5">Start the trash talk. Type @ to tag someone.</p>
            </div>
          )}

          {ordered.map((m, i) => {
            const prev = ordered[i - 1]
            const next = ordered[i + 1]
            const mine = m.user_id === user.id
            const tagged = m.mentions.includes(user.id)
            const t = new Date(m.created_at).getTime()

            const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at)
            const startsGroup = newDay || !prev || prev.user_id !== m.user_id ||
              t - new Date(prev.created_at).getTime() > GROUP_WINDOW_MS
            const endsGroup = !next || next.user_id !== m.user_id ||
              dayKey(next.created_at) !== dayKey(m.created_at) ||
              new Date(next.created_at).getTime() - t > GROUP_WINDOW_MS

            const imageOnly = !!m.image_url && !m.body && !m.deleted_at
            const deletable = !m.deleted_at && (mine || isAdmin)

            // Square off the corner facing the rest of the group, so a run of
            // messages reads as one block instead of separate cards.
            const corners = mine
              ? `${startsGroup ? '' : 'rounded-tr-md '}${endsGroup ? '' : 'rounded-br-md'}`
              : `${startsGroup ? '' : 'rounded-tl-md '}${endsGroup ? '' : 'rounded-bl-md'}`

            return (
              <div key={m.id}>
                {newDay && (
                  <div className="flex items-center gap-3 my-4">
                    <div className="flex-1 h-px bg-white/[0.06]" />
                    <span className="text-[11px] font-medium text-slate-500">{dayLabel(m.created_at)}</span>
                    <div className="flex-1 h-px bg-white/[0.06]" />
                  </div>
                )}

                {/* A reacted-to message needs room for its pills, or they
                    read as belonging to the bubble below them. */}
                <div className={`flex gap-2 ${
                  endsGroup ? 'mb-3' : m.reactions.length > 0 ? 'mb-2' : 'mb-0.5'
                } ${mine ? 'justify-end' : ''}`}>
                  {/* Avatar gutter — filled once per group, reserved otherwise
                      so the bubbles in a run stay aligned. */}
                  {!mine && (
                    <div className="w-7 shrink-0 self-end">
                      {endsGroup && (
                        m.avatar_url
                          ? <img src={m.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover border border-white/[0.08]" />
                          : <span className="w-7 h-7 rounded-full bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center text-[11px] font-bold text-white">
                              {m.author_name.charAt(0)}
                            </span>
                      )}
                    </div>
                  )}

                  <div className={`max-w-[80%] sm:max-w-[70%] min-w-0 ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                    {startsGroup && !mine && (
                      <span className="text-[11px] font-semibold text-slate-400 mb-1 px-1">
                        {m.author_name}
                        {tagged && <span className="ml-1.5 text-blue-400 font-medium">· tagged you</span>}
                      </span>
                    )}

                    {/* Hold to open the actions; a tap does nothing, as in
                        Signal. select-none and the callout suppression are what
                        stop iOS answering the same gesture with its own text
                        selection popover — the platform gesture and ours are
                        the same gesture, so only one of them can win. */}
                    <div
                      id={`msg-${m.id}`}
                      role="button"
                      aria-haspopup="true"
                      tabIndex={m.deleted_at ? -1 : 0}
                      onPointerDown={e => startPress(e, m.id, !!m.deleted_at)}
                      onPointerMove={movePress}
                      onPointerUp={cancelPress}
                      onPointerCancel={cancelPress}
                      onPointerLeave={cancelPress}
                      onContextMenu={e => {
                        if (m.deleted_at) return
                        e.preventDefault()   // right-click is the desktop hold
                        setOpenActions(m.id)
                        dismissHoldHint()
                      }}
                      onKeyDown={e => {
                        if (m.deleted_at || (e.key !== 'Enter' && e.key !== ' ')) return
                        e.preventDefault()
                        setOpenActions(openActions === m.id ? null : m.id)
                      }}
                      className={`text-left rounded-2xl select-none [-webkit-touch-callout:none] ${corners} ${
                        m.deleted_at
                          ? 'px-3.5 py-2 bg-white/[0.03] border border-white/[0.06]'
                          : imageOnly
                            ? 'p-0 overflow-hidden bg-white/[0.04]'
                            : mine
                              ? 'px-3.5 py-2 bg-blue-600 text-white'
                              : 'px-3.5 py-2 bg-white/[0.07] text-slate-100'
                      } ${tagged && !mine && !m.deleted_at ? 'ring-1 ring-blue-500/40' : ''}`}
                    >
                      {m.deleted_at ? (
                        <span className="text-sm text-slate-600 italic">Message deleted</span>
                      ) : (
                        <>
                          {m.reply_to && (
                            <button
                              onClick={e => { e.stopPropagation(); jumpToMessage(m.reply_to!.id) }}
                              className={`flex flex-col items-start w-full text-left mb-1.5 pl-2 border-l-2 rounded-r ${
                                mine
                                  ? 'border-white/50 bg-white/10'
                                  : 'border-blue-400/70 bg-white/[0.04]'
                              } py-1 pr-2 transition hover:opacity-80`}
                            >
                              <span className={`text-[11px] font-semibold ${mine ? 'text-white/90' : 'text-blue-300'}`}>
                                {m.reply_to.author_name}
                              </span>
                              <span className={`text-[12px] leading-snug line-clamp-2 ${
                                m.reply_to.deleted
                                  ? 'italic ' + (mine ? 'text-white/50' : 'text-slate-600')
                                  : mine ? 'text-white/80' : 'text-slate-400'
                              }`}>
                                {m.reply_to.deleted ? 'Message deleted' : m.reply_to.excerpt}
                              </span>
                            </button>
                          )}
                          {m.body && (
                            <p className={`text-[15px] leading-snug whitespace-pre-wrap break-words ${mine ? 'text-white' : 'text-slate-100'}`}>
                              <MessageBody text={m.body} players={players} mine={mine} />
                            </p>
                          )}
                          {m.image_url && (
                            <img
                              src={m.image_url}
                              alt=""
                              loading="lazy"
                              onLoad={onMediaLoad}
                              className={`max-h-72 rounded-xl object-cover ${imageOnly ? '' : 'mt-2'}`}
                            />
                          )}
                        </>
                      )}
                    </div>

                    {m.reactions.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {sortReactions(m.reactions).map(r => (
                          <button
                            key={r.reaction}
                            // Tapping shows who, rather than toggling. Adding
                            // and removing lives in the hold picker, which is
                            // where the rest of a message's actions are — one
                            // meaning per gesture.
                            onClick={e => { e.stopPropagation(); setReactorsFor(m.id) }}
                            title={`${r.users.map(u => u.name).join(', ')} — ${reactionLabel(r.reaction)}`}
                            className={`flex items-center gap-1 pl-1.5 pr-2 py-0.5 rounded-full border text-[11px] transition ${
                              r.mine
                                ? 'bg-blue-500/20 border-blue-500/40 text-blue-200'
                                : 'bg-white/[0.06] border-white/[0.08] text-slate-400 hover:bg-white/[0.10]'
                            }`}
                          >
                            <span className="text-[13px] leading-none">{reactionEmoji(r.reaction)}</span>
                            <span className="font-semibold tabular-nums">{r.count}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {openActions === m.id && !m.deleted_at && (
                      <div className="flex items-center gap-0.5 mt-1.5 p-1 rounded-full bg-[#1a1d23] border border-white/[0.08] shadow-xl shadow-black/40">
                        {REACTIONS.map(r => {
                          const on = m.reactions.some(x => x.reaction === r.code && x.mine)
                          return (
                            <button
                              key={r.code}
                              onClick={() => toggleReaction(m.id, r.code)}
                              aria-label={r.label}
                              aria-pressed={on}
                              className={`w-8 h-8 rounded-full text-lg leading-none transition active:scale-90 ${
                                on ? 'bg-blue-500/25' : 'hover:bg-white/[0.08]'
                              }`}
                            >
                              {r.emoji}
                            </button>
                          )
                        })}
                        <span className="w-px h-5 bg-white/[0.10] mx-0.5" />
                        <button
                          onClick={() => {
                            setReplyTo({
                              id: m.id,
                              author_name: m.author_name,
                              excerpt: m.body?.replace(/\s+/g, ' ').trim().slice(0, 140) ||
                                (m.image_url ? '📷 Photo' : ''),
                              deleted: false,
                            })
                            textareaRef.current?.focus()
                          }}
                          className="px-2.5 h-8 text-[11px] font-medium text-slate-300 hover:text-white transition"
                        >
                          Reply
                        </button>
                        {deletable && (
                          <button
                            onClick={() => remove(m.id)}
                            className="px-2.5 h-8 text-[11px] font-medium text-red-400 hover:text-red-300 transition"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    )}

                    {/* Timestamp closes the group; a run of rapid-fire messages
                        gets one time, not five. */}
                    {endsGroup && (
                      <span className="text-[10px] text-slate-500 mt-1 px-1">{clockTime(m.created_at)}</span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Who reacted. One sheet for the whole thread rather than one per
          message — only ever one can be open. */}
      {reactorsFor && (() => {
        const message = messages.find(m => m.id === reactorsFor)
        if (!message || message.reactions.length === 0) return null
        const avatarOf = (id: string) => players.find(pl => pl.id === id)?.avatar_url ?? null
        const total = message.reactions.reduce((n, r) => n + r.count, 0)

        return (
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setReactorsFor(null)} />
            <div className="relative w-full sm:max-w-sm max-h-[70vh] flex flex-col bg-[#1a1d23] border border-white/[0.08] rounded-t-2xl sm:rounded-2xl shadow-2xl shadow-black/50 animate-slide-up safe-bottom safe-x">
              <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
                <p className="text-sm font-semibold text-white">
                  {total} {total === 1 ? 'reaction' : 'reactions'}
                </p>
                <button
                  onClick={() => setReactorsFor(null)}
                  aria-label="Close"
                  className="p-1 text-slate-500 hover:text-slate-300 transition"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              <div className="overflow-y-auto overscroll-contain px-4 pb-4">
                {sortReactions(message.reactions).map(r => (
                  <div key={r.reaction} className="mb-3 last:mb-0">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      <span className="text-[15px] leading-none">{reactionEmoji(r.reaction)}</span>
                      {reactionLabel(r.reaction)} · {r.count}
                    </p>
                    {r.users.map(u => {
                      const isMe = u.id === user.id
                      const avatar = avatarOf(u.id)
                      return (
                        <button
                          key={u.id}
                          disabled={!isMe}
                          onClick={() => toggleReaction(message.id, r.reaction)}
                          className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition ${
                            isMe ? 'hover:bg-white/[0.06]' : 'cursor-default'
                          }`}
                        >
                          {avatar
                            ? <img src={avatar} alt="" className="w-7 h-7 rounded-full object-cover border border-white/[0.08]" />
                            : <span className="w-7 h-7 rounded-full bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center text-[11px] font-bold text-white">
                                {u.name.charAt(0)}
                              </span>}
                          <span className="text-sm text-slate-200 truncate flex-1">
                            {isMe ? 'You' : u.name}
                          </span>
                          {/* Only your own reaction is yours to take back, so
                              only your own row does anything. */}
                          {isMe && <span className="text-[11px] text-slate-500 shrink-0">Tap to remove</span>}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Composer ─────────────────────────────────────────────────────── */}
      <div className={`shrink-0 relative border-t border-white/[0.08] bg-surface/95 backdrop-blur-xl safe-x ${keyboardOpen ? '' : 'pb-nav'}`}>
        {/* Never both at once — they occupy the same spot. */}
        {showHoldHint && !showJump && ordered.length > 0 && (
          <button
            onClick={dismissHoldHint}
            className="absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap px-3 py-1.5 rounded-full bg-white/[0.10] backdrop-blur-xl text-[11px] text-slate-300 shadow-lg shadow-black/40"
          >
            Hold a message to react or reply ✕
          </button>
        )}

        {showJump && (
          <button
            onClick={jumpToBottom}
            className="absolute -top-11 left-1/2 -translate-x-1/2 px-3.5 py-1.5 rounded-full bg-blue-600 text-white text-xs font-semibold shadow-lg shadow-black/40 hover:bg-blue-500 transition"
          >
            New messages ↓
          </button>
        )}

        <div className="max-w-3xl mx-auto px-3 sm:px-4 py-2.5">
          {postError && <p className="mb-2 text-xs text-red-400">{postError}</p>}

          {replyTo && (
            <div className="flex items-center gap-2 mb-2 pl-2 pr-1 py-1.5 border-l-2 border-blue-400/70 bg-white/[0.04] rounded-r-lg">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-blue-300">Replying to {replyTo.author_name}</p>
                <p className="text-[12px] text-slate-400 truncate">{replyTo.excerpt}</p>
              </div>
              <button
                onClick={() => setReplyTo(null)}
                aria-label="Cancel reply"
                className="shrink-0 w-7 h-7 rounded-full text-slate-500 hover:text-slate-200 hover:bg-white/[0.06] flex items-center justify-center transition"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}

          {pendingImage && (
            <div className="relative mb-2 inline-block">
              <img src={pendingImage} alt="" className="max-h-24 rounded-xl border border-white/[0.08]" />
              <button
                onClick={() => setPendingImage(null)}
                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-600 text-white text-xs font-bold"
                aria-label="Remove photo"
              >×</button>
            </div>
          )}

          <div className="relative flex items-end gap-2">
            {showMentions && mentionMatches.length > 0 && (
              <div className="absolute left-0 right-0 bottom-full mb-2 bg-[#1a1d23] border border-white/[0.08] rounded-xl shadow-2xl shadow-black/40 overflow-hidden z-20">
                {mentionMatches.map(p => (
                  <button
                    key={p.id}
                    onClick={() => insertMention(p.name)}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-200 hover:bg-white/[0.06] transition text-left"
                  >
                    {p.avatar_url
                      ? <img src={p.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover" />
                      : <span className="w-5 h-5 rounded-full bg-slate-700 flex items-center justify-center text-[10px]">{p.name.charAt(0)}</span>}
                    {p.name}
                  </button>
                ))}
              </div>
            )}

            <input ref={fileRef} type="file" accept="image/*" onChange={pickImage} className="hidden" />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label="Attach a photo"
              className="shrink-0 w-9 h-9 rounded-full bg-white/[0.06] text-slate-400 hover:text-slate-200 hover:bg-white/[0.10] flex items-center justify-center transition disabled:opacity-50"
            >
              {uploading
                ? <span className="w-4 h-4 border-2 border-slate-500 border-t-slate-200 rounded-full animate-spin" />
                : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                )}
            </button>

            <textarea
              ref={textareaRef}
              value={draft}
              onChange={e => onDraftChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Message…"
              rows={1}
              className="flex-1 min-w-0 px-4 py-2 bg-white/[0.06] border border-white/[0.08] rounded-2xl text-white placeholder-slate-500 text-[15px] leading-snug resize-none max-h-[132px] focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />

            <button
              onClick={post}
              disabled={!canSend}
              aria-label="Send"
              className="shrink-0 w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-500 disabled:opacity-30 disabled:hover:bg-blue-600 transition"
            >
              {posting
                ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
