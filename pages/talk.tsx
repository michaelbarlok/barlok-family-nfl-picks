import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { processImageFile, TALK_MAX_DIMENSION } from '@/lib/avatarUtils'
import {
  getPushState, getTalkEnabled, setTalkEnabled, refreshSubscription, isStandalone, type PushState,
} from '@/lib/pushClient'
import Nav from '@/components/Nav'

interface Player { id: string; name: string; avatar_url?: string | null }

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
}

/** Renders @mentions as highlighted chips, leaving the rest as plain text. */
function MessageBody({ text, players }: { text: string; players: Player[] }) {
  const names = players.map(p => p.name).sort((a, b) => b.length - a.length)
  if (names.length === 0) return <>{text}</>

  // Longest name first, so "Joe Sr" wins over "Joe".
  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const parts = text.split(new RegExp(`(@(?:${escaped.join('|')}))`, 'g'))

  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('@') && names.includes(part.slice(1))
          ? <span key={i} className="text-blue-400 font-medium">{part}</span>
          : <span key={i}>{part}</span>,
      )}
    </>
  )
}

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

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

  useEffect(() => {
    if (!loading && !user) router.push('/login')
  }, [user, loading, router])

  const token = async () => (await supabase.auth.getSession()).data.session?.access_token ?? ''

  const load = useCallback(async (before?: string) => {
    try {
      const url = before ? `/api/talk?before=${encodeURIComponent(before)}` : '/api/talk'
      const res = await fetch(url, { headers: { Authorization: `Bearer ${await token()}` } })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load the thread')
      setMessages(prev => before ? [...prev, ...json.messages] : json.messages)
      setHasMore(json.hasMore)
      setLoadError('')
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load the thread')
    } finally {
      setDataLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    load()
    supabase.from('users').select('id, name, avatar_url').order('name')
      .then(({ data }) => setPlayers(data ?? []))

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'talk_messages' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user, load])

  const onDraftChange = (value: string) => {
    setDraft(value)
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
    try {
      // Resolve @names back to ids so mentions survive a later rename.
      const mentionIds = players.filter(p => draft.includes(`@${p.name}`)).map(p => p.id)
      const res = await fetch('/api/talk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ body: draft.trim(), imageUrl: pendingImage, mentionIds }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not post')
      setDraft('')
      setPendingImage(null)
      await load()
    } catch (err) {
      setPostError(err instanceof Error ? err.message : 'Could not post')
    } finally {
      setPosting(false)
    }
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this message?')) return
    await fetch('/api/talk', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ messageId: id }),
    })
    await load()
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
      <div className="min-h-screen bg-surface pb-20">
        <Nav />
        <main className="max-w-3xl mx-auto px-4 py-6">
          <div className="skeleton h-4 w-32 rounded mb-5" />
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-20 rounded-2xl" />)}
          </div>
        </main>
      </div>
    )
  }
  if (!user) return null

  const mentionMatches = players
    .filter(p => p.id !== user.id && p.name.toLowerCase().includes(mentionQuery))
    .slice(0, 6)

  return (
    <div className="min-h-screen bg-surface pb-20">
      <Nav />

      <main className="max-w-3xl mx-auto px-4 py-6 animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">💩 Talk</h2>

          {pushState === 'granted' || pushState === 'default' ? (
            <button
              onClick={toggleNotify}
              disabled={notifyBusy}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition disabled:opacity-50 ${
                notifyOn
                  ? 'bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30'
                  : 'bg-white/[0.06] text-slate-400 hover:text-slate-200'
              }`}
            >
              {notifyOn ? '🔔 Notifications on' : '🔕 Notify me'}
            </button>
          ) : pushState === 'denied' ? (
            <span className="text-[11px] text-slate-500" title="Re-enable notifications in your settings">
              🔕 Blocked in settings
            </span>
          ) : pushState === 'needs-install' ? (
            <span className="text-[11px] text-slate-500">Add to Home Screen for alerts</span>
          ) : null}
        </div>

        {pushState === 'needs-install' && (
          <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-[11px] text-blue-300/90">
            To get notified of new messages on iPhone, tap Share → <strong>Add to Home Screen</strong> and open
            it from there. Safari tabs can&apos;t receive notifications.
          </div>
        )}

        {/* Composer */}
        <div className="glass-card rounded-2xl p-3 mb-5">
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={e => onDraftChange(e.target.value)}
              placeholder="Say something… use @ to tag someone"
              rows={3}
              className="w-full px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-slate-500 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
            {showMentions && mentionMatches.length > 0 && (
              <div className="absolute left-0 right-0 bottom-full mb-1 bg-[#1a1d23] border border-white/[0.08] rounded-xl shadow-2xl shadow-black/40 overflow-hidden z-20">
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
          </div>

          {pendingImage && (
            <div className="relative mt-2 inline-block">
              <img src={pendingImage} alt="" className="max-h-40 rounded-xl border border-white/[0.08]" />
              <button
                onClick={() => setPendingImage(null)}
                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-600 text-white text-xs font-bold"
                aria-label="Remove photo"
              >×</button>
            </div>
          )}

          {postError && <p className="mt-2 text-xs text-red-400">{postError}</p>}

          <div className="flex items-center justify-between mt-2">
            <input ref={fileRef} type="file" accept="image/*" onChange={pickImage} className="hidden" />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 rounded-lg hover:bg-white/[0.04] disabled:opacity-50 transition"
            >
              {uploading ? 'Uploading…' : '📷 Photo'}
            </button>
            <button
              onClick={post}
              disabled={posting || (!draft.trim() && !pendingImage)}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-500 disabled:opacity-40 transition"
            >
              {posting ? 'Posting…' : 'Post'}
            </button>
          </div>
        </div>

        {loadError && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm">{loadError}</div>
        )}

        {messages.length === 0 && !loadError ? (
          <div className="glass-card rounded-2xl p-12 text-center">
            <p className="text-4xl mb-3">💩</p>
            <p className="text-white font-medium">Nothing here yet</p>
            <p className="text-slate-500 text-sm mt-1.5">Start the trash talk.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map(m => {
              const isMe = m.user_id === user.id
              const tagged = m.mentions.includes(user.id)
              return (
                <div
                  key={m.id}
                  className={`glass-card rounded-2xl p-3.5 ${tagged ? 'ring-1 ring-blue-500/30' : ''}`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    {m.avatar_url
                      ? <img src={m.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover border border-white/[0.08]" />
                      : <span className="w-6 h-6 rounded-full bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center text-[10px] font-bold text-white">{m.author_name.charAt(0)}</span>}
                    <span className={`text-sm font-semibold ${isMe ? 'text-blue-400' : 'text-white'}`}>{m.author_name}</span>
                    <span className="text-[11px] text-slate-500">{timeAgo(m.created_at)}</span>
                    {tagged && <span className="text-[10px] font-semibold text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded-full">tagged you</span>}
                    {isMe && !m.deleted_at && (
                      <button
                        onClick={() => remove(m.id)}
                        className="ml-auto text-[11px] text-slate-600 hover:text-red-400 transition"
                      >Delete</button>
                    )}
                  </div>

                  {m.deleted_at ? (
                    <p className="text-sm text-slate-600 italic">Message deleted</p>
                  ) : (
                    <>
                      {m.body && (
                        <p className="text-sm text-slate-200 whitespace-pre-wrap break-words">
                          <MessageBody text={m.body} players={players} />
                        </p>
                      )}
                      {m.image_url && (
                        <a href={m.image_url} target="_blank" rel="noreferrer">
                          <img src={m.image_url} alt="" loading="lazy" className="mt-2 max-h-80 rounded-xl border border-white/[0.08]" />
                        </a>
                      )}
                    </>
                  )}
                </div>
              )
            })}

            {hasMore && (
              <button
                onClick={() => { setLoadingMore(true); load(messages[messages.length - 1].created_at) }}
                disabled={loadingMore}
                className="w-full py-2.5 text-sm text-slate-400 hover:text-slate-200 glass-card rounded-2xl transition disabled:opacity-50"
              >
                {loadingMore ? 'Loading…' : 'Load older messages'}
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
