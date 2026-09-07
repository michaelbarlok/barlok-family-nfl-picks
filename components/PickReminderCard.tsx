import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatLockTime } from '@/lib/lockTime'

interface Outstanding {
  name: string
  missingPicks: number
  missingBest: number
  self: boolean
}

interface TargetRow {
  id: string
  name: string
  hasEmail: boolean
  emailOptOut: boolean
  pushOptOut: boolean
  devices: number
  outstanding: Outstanding[]
}

interface Preview {
  week: number
  season: number
  totalGames: number
  lockTime: string | null
  locked: boolean
  pushConfigured: boolean
  unreachable: string[]
  targets: TargetRow[]
}

type Channel = 'email' | 'push' | 'both'

const CHANNELS: { key: Channel; label: string }[] = [
  { key: 'email', label: '📧 Email' },
  { key: 'push', label: '🔔 Push' },
  { key: 'both', label: 'Both' },
]

function missingLabel(o: Outstanding): string {
  const parts: string[] = []
  if (o.missingPicks > 0) parts.push(`${o.missingPicks} pick${o.missingPicks === 1 ? '' : 's'}`)
  if (o.missingBest > 0) parts.push('Best 3')
  return parts.join(' + ')
}

/**
 * Admin nudge for the players who still owe picks.
 *
 * The list comes from the server rather than being assembled here, because who
 * is reachable is not a UI question: a managed player's reminder has to go to
 * whoever picks for them, and a player who muted a channel must not be counted
 * as notified. The card only shows what the endpoint already decided, so the
 * preview and the send can't disagree.
 */
export default function PickReminderCard({
  week, season, onMessage,
}: {
  week: number
  season: number
  onMessage: (msg: { type: 'success' | 'error'; text: string }) => void
}) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(true)
  const [channel, setChannel] = useState<Channel>('email')
  const [note, setNote] = useState('')
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const token = async () => (await supabase.auth.getSession()).data.session?.access_token ?? ''

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/notify-picks?week=${week}&season=${season}`, {
        headers: { Authorization: `Bearer ${await token()}` },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load who is outstanding')
      setPreview(json)
      setExcluded(new Set())
      setError('')
    } catch (err) {
      setPreview(null)
      setError(err instanceof Error ? err.message : 'Could not load who is outstanding')
    } finally {
      setLoading(false)
    }
  }, [week, season])

  useEffect(() => { load() }, [load])

  const chosen = (preview?.targets ?? []).filter(t => !excluded.has(t.id))

  const send = async () => {
    if (!preview || chosen.length === 0) return
    const how = channel === 'both' ? 'email and push' : channel === 'push' ? 'push' : 'email'
    if (!confirm(
      `Send a Week ${week} pick reminder to ${chosen.length} ` +
      `${chosen.length === 1 ? 'person' : 'people'} by ${how}?`
    )) return

    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/notify-picks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ week, season, channel, note: note.trim(), userIds: chosen.map(t => t.id) }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not send')

      // Say who was skipped and why, rather than reporting a count that quietly
      // includes people who never got anything.
      const detail = (json.skipped ?? []).length > 0
        ? ` Skipped: ${json.skipped.map((s: { name: string; reason: string }) => `${s.name} (${s.reason})`).join(', ')}.`
        : ''
      onMessage({ type: 'success', text: `${json.message}${detail}` })
      setNote('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send')
    } finally {
      setSending(false)
    }
  }

  const toggle = (id: string) => setExcluded(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <div className="p-4 glass-card rounded-xl mb-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <p className="text-sm font-semibold text-slate-200">Remind Outstanding Picks</p>
        <button
          onClick={load}
          disabled={loading}
          className="text-[11px] text-slate-500 hover:text-slate-300 transition disabled:opacity-50"
        >
          Refresh
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Nudge everyone who hasn&apos;t finished Week {week}.
        {preview?.lockTime && (
          <> Locks {formatLockTime(new Date(preview.lockTime))}.</>
        )}
      </p>

      {error && (
        <div className="mb-3 p-2.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-xs">{error}</div>
      )}

      {loading ? (
        <div className="skeleton h-16 rounded-lg" />
      ) : !preview ? null : preview.totalGames === 0 ? (
        <p className="text-sm text-amber-400">
          No games loaded for Week {week} yet — sync the schedule first.
        </p>
      ) : preview.targets.length === 0 ? (
        <p className="text-sm text-emerald-400">
          ✓ Everyone has completed Week {week} picks.
          {preview.unreachable.length > 0 && (
            <span className="block text-xs text-amber-400/80 mt-1">
              Except {preview.unreachable.join(', ')} — managed with nobody assigned to pick for them.
            </span>
          )}
        </p>
      ) : (
        <>
          {preview.locked && (
            <div className="mb-3 p-2.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg text-xs">
              Week {week} picks are already locked. A reminder now only helps if you also grant a grace period.
            </div>
          )}

          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Outstanding — {chosen.length} of {preview.targets.length} selected
          </p>
          <div className="space-y-1.5 mb-3">
            {preview.targets.map(t => {
              const on = !excluded.has(t.id)
              // What this person will actually receive, given their own settings.
              const reach: string[] = []
              if (t.hasEmail && !t.emailOptOut) reach.push('email')
              if (t.devices > 0 && !t.pushOptOut) reach.push(`push ×${t.devices}`)
              const unreachable = reach.length === 0

              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggle(t.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition ${
                    on
                      ? 'bg-white/[0.04] border-white/[0.10]'
                      : 'bg-white/[0.01] border-white/[0.05] opacity-50'
                  }`}
                >
                  <span className={`w-4 h-4 shrink-0 rounded flex items-center justify-center text-[10px] font-bold ${
                    on ? 'bg-blue-600 text-white' : 'bg-white/[0.06] text-transparent'
                  }`}>✓</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-slate-200 truncate">{t.name}</span>
                    {/* Wraps rather than truncates: on a phone "Dylan: 16 picks
                        + Best 3" was cut to "…+ Bes", hiding the part that
                        says what is actually missing. */}
                    <span className="block text-[11px] text-slate-500 leading-snug">
                      {t.outstanding.map(o =>
                        o.self ? missingLabel(o) : `${o.name}: ${missingLabel(o)}`,
                      ).join(' · ')}
                    </span>
                  </span>
                  <span className={`shrink-0 text-[10px] font-medium ${unreachable ? 'text-red-400' : 'text-slate-500'}`}>
                    {unreachable ? 'no way to reach' : reach.join(' · ')}
                  </span>
                </button>
              )
            })}
          </div>

          {preview.unreachable.length > 0 && (
            <p className="text-[11px] text-amber-400/80 mb-3">
              {preview.unreachable.join(', ')} {preview.unreachable.length === 1 ? 'is' : 'are'} managed
              with nobody assigned to pick for them, so there is no one to remind.
            </p>
          )}

          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Send by</p>
          <div className="flex gap-1.5 mb-3">
            {CHANNELS.map(c => (
              <button
                key={c.key}
                type="button"
                onClick={() => setChannel(c.key)}
                className={`press text-xs font-medium px-3 py-1.5 rounded-full border transition ${
                  channel === c.key
                    ? 'bg-blue-500/15 border-blue-500/40 text-blue-300'
                    : 'bg-white/[0.04] border-white/[0.08] text-slate-500 hover:border-blue-500/30'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          {channel !== 'email' && !preview.pushConfigured && (
            <p className="text-[11px] text-amber-400/80 mb-3">
              Push isn&apos;t configured on this deployment — set the VAPID keys and redeploy, or it will fail.
            </p>
          )}

          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Optional note to include…"
            rows={2}
            className="w-full px-3 py-2 text-sm bg-white/[0.04] border border-white/[0.08] rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 mb-3 resize-none"
          />

          <button
            onClick={send}
            disabled={sending || chosen.length === 0}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-600 text-white text-sm font-semibold rounded-lg hover:bg-amber-700 disabled:opacity-50 transition"
          >
            {sending
              ? <><span className="animate-spin">⏳</span> Sending…</>
              : <><span>📣</span> Remind {chosen.length} {chosen.length === 1 ? 'Player' : 'Players'}</>}
          </button>
        </>
      )}
    </div>
  )
}
