import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Tally { wins: number; losses: number; ties: number }
interface Player { id: string; name: string; week: Tally; best3: Tally; rank: number; isTied: boolean; rankChange: number | null; perfect: boolean }

type Channel = 'email' | 'talk'

interface Preview {
  week: number | null
  season: number
  complete: boolean
  gamesInWeek: number
  gamesDecided: number
  leaders: Player[]
  perfect: Player[]
  bestThreeSweeps: Player[]
  climbers: Player[]
  upset: { away: string; home: string; winner: string; calledBy: string[]; outOf: number } | null
  players: Player[]
  sentAt: string | null
  talkPostedAt: string | null
  recipients: string[]
  pendingWeeks: number[]
  message?: string
}

const record = (t: Tally) => `${t.wins}-${t.losses}${t.ties > 0 ? `-${t.ties}` : ''}`
const names = (list: { name: string }[] | string[]) => {
  const flat = list.map(x => (typeof x === 'string' ? x : x.name))
  return flat.length <= 1 ? flat.join('') : `${flat.slice(0, -1).join(', ')} and ${flat[flat.length - 1]}`
}

/**
 * Preview and send the weekly recap.
 *
 * It shows the same highlights the email will, off the same endpoint, so what
 * an admin approves is what the league reads. The send is guarded server-side
 * — an unfinished week and an already-sent week both refuse and offer a
 * confirm — so this card can stay a thin view over that.
 */
export default function WeeklyDigestCard({
  season, onMessage,
}: {
  season: number
  onMessage: (msg: { type: 'success' | 'error'; text: string }) => void
}) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [week, setWeek] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  // Which button is in flight — each channel is its own action.
  const [sending, setSending] = useState<Channel | null>(null)
  const [error, setError] = useState('')

  const token = async () => (await supabase.auth.getSession()).data.session?.access_token ?? ''

  const load = useCallback(async (forWeek?: number) => {
    setLoading(true)
    try {
      const qs = `season=${season}${forWeek ? `&week=${forWeek}` : ''}`
      const res = await fetch(`/api/weekly-digest?${qs}`, {
        headers: { Authorization: `Bearer ${await token()}` },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not build the recap')
      setPreview(json)
      setWeek(json.week ?? null)
      setError('')
    } catch (err) {
      setPreview(null)
      setError(err instanceof Error ? err.message : 'Could not build the recap')
    } finally {
      setLoading(false)
    }
  }, [season])

  useEffect(() => { load() }, [load])

  const send = async (channel: Channel, force = false) => {
    if (!preview?.week) return
    const ask = channel === 'talk'
      ? `Post the Week ${preview.week} recap to 💩 Talk? Anyone with Talk notifications on gets a push.`
      : `Email the Week ${preview.week} recap to ${preview.recipients.length} ${preview.recipients.length === 1 ? 'person' : 'people'}?`
    if (!force && !confirm(ask)) return

    setSending(channel)
    setError('')
    try {
      const res = await fetch('/api/weekly-digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ season, week: preview.week, force, channels: [channel] }),
      })
      const json = await res.json()
      // Already done for this week, or the week isn't finished — the server
      // says which; ask before overriding.
      if (res.status === 400 && json.requiresForce) {
        setSending(null)
        if (confirm(`${json.error}\n\nSend it anyway?`)) return send(channel, true)
        return
      }
      if (!res.ok) throw new Error(json.error ?? 'Could not send')
      onMessage({ type: 'success', text: json.message })
      await load(preview.week)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send')
    } finally {
      setSending(null)
    }
  }

  if (loading) return <div className="glass-card rounded-xl p-4 mb-5"><div className="skeleton h-20 rounded-lg" /></div>
  if (!preview) {
    return error
      ? <div className="glass-card rounded-xl p-4 mb-5"><p className="text-xs text-red-400">{error}</p></div>
      : null
  }
  // Nothing has finished yet — say so rather than offering an empty recap.
  if (!preview.week) {
    return (
      <div className="p-4 glass-card rounded-xl mb-5">
        <p className="text-sm font-semibold text-slate-200 mb-1">Weekly Recap</p>
        <p className="text-xs text-slate-500">
          Sends once a week is fully scored. No week has finished yet.
        </p>
      </div>
    )
  }

  const bullets: { icon: string; text: string }[] = []
  if (preview.leaders.length > 0) {
    bullets.push({ icon: '🥇', text: `${names(preview.leaders)} — ${record(preview.leaders[0].week)}` })
  }
  if (preview.perfect.length > 0) bullets.push({ icon: '🏆', text: `Perfect week: ${names(preview.perfect)}` })
  if (preview.bestThreeSweeps.length > 0) bullets.push({ icon: '⭐', text: `Best 3 swept: ${names(preview.bestThreeSweeps)}` })
  if (preview.climbers.length > 0) {
    bullets.push({ icon: '📈', text: `Biggest climb: ${names(preview.climbers)} (+${preview.climbers[0].rankChange})` })
  }
  if (preview.upset) {
    bullets.push({
      icon: '🔮',
      text: preview.upset.calledBy.length === 0
        ? `Nobody called ${preview.upset.winner} in ${preview.upset.away} @ ${preview.upset.home}`
        : `${names(preview.upset.calledBy)} called ${preview.upset.winner} (${preview.upset.calledBy.length} of ${preview.upset.outOf})`,
    })
  }

  return (
    <div className="p-4 glass-card rounded-xl mb-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <p className="text-sm font-semibold text-slate-200">Weekly Recap — Week {preview.week}</p>
        {preview.pendingWeeks.length > 1 && (
          <select
            value={week ?? ''}
            onChange={e => load(parseInt(e.target.value))}
            className="text-[11px] bg-white/[0.06] border border-white/[0.08] rounded-lg px-2 py-1 text-slate-300"
          >
            {preview.pendingWeeks.map(w => <option key={w} value={w}>Week {w}</option>)}
          </select>
        )}
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Nothing goes out on its own — post it to 💩 Talk, email it, or both.
      </p>

      {error && (
        <div className="mb-3 p-2.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-xs">{error}</div>
      )}

      {!preview.complete && (
        <div className="mb-3 p-2.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg text-xs">
          Week {preview.week} isn&apos;t finished — {preview.gamesDecided} of {preview.gamesInWeek} games scored.
        </div>
      )}
      <div className="space-y-1.5 mb-3">
        {bullets.map((b, i) => (
          <div key={i} className="flex items-start gap-2 text-xs text-slate-300">
            <span className="shrink-0">{b.icon}</span>
            <span className="min-w-0">{b.text}</span>
          </div>
        ))}
        <p className="text-[11px] text-slate-500 pt-1">
          …plus the full table for all {preview.players.length} players.
        </p>
      </div>

      {/* Two separate actions. Nothing is sent automatically — this card is the
          only way a recap goes out. */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <button
            onClick={() => send('talk')}
            disabled={sending !== null}
            className={`w-full flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-semibold rounded-lg transition disabled:opacity-50 ${
              preview.talkPostedAt
                ? 'bg-white/[0.06] text-slate-300 hover:bg-white/[0.10]'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {sending === 'talk'
              ? <><span className="animate-spin">⏳</span> Posting…</>
              : <>💩 {preview.talkPostedAt ? 'Post again' : 'Post to Talk'}</>}
          </button>
          <p className={`text-[11px] mt-1 text-center ${preview.talkPostedAt ? 'text-emerald-400' : 'text-slate-500'}`}>
            {preview.talkPostedAt
              ? `✓ Posted ${new Date(preview.talkPostedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
              : 'Shows the recap card in the chat'}
          </p>
        </div>
        <div>
          <button
            onClick={() => send('email')}
            disabled={sending !== null || preview.recipients.length === 0}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-semibold rounded-lg border border-white/[0.12] text-slate-200 hover:bg-white/[0.06] transition disabled:opacity-50"
          >
            {sending === 'email'
              ? <><span className="animate-spin">⏳</span> Emailing…</>
              : <>📧 {preview.sentAt ? 'Email again' : 'Email it'}</>}
          </button>
          <p className={`text-[11px] mt-1 text-center ${preview.sentAt ? 'text-emerald-400' : 'text-slate-500'}`}>
            {preview.recipients.length === 0
              ? 'Nobody has the recap email on'
              : preview.sentAt
                ? `✓ Emailed ${new Date(preview.sentAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                : `To ${preview.recipients.length} ${preview.recipients.length === 1 ? 'person' : 'people'}`}
          </p>
        </div>
      </div>
    </div>
  )
}
