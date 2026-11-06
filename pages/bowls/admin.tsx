import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { useBowlAuth } from '@/lib/bowls/auth'
import { bowlSeasonLabel } from '@/lib/bowls/constants'
import { useToast } from '@/components/Toast'
import AdminTabs from '@/components/bowls/AdminTabs'
import BowlHeader, { BowlAvatar } from '@/components/bowls/BowlHeader'

interface AdminPlayer {
  id: string
  name: string
  email: string | null
  avatar_url: string | null
  is_admin: boolean
  signed_in: boolean
}

interface Progress { id: string; picked: number; complete: boolean }

/**
 * Bowl admin — run separately from the NFL admin page.
 *
 * Invite people by name and email: someone new gets a bowl-only account with
 * no NFL access; an NFL player is added with the login they already have.
 * Each player's progress shows as counts, and "Enter picks" opens their picks
 * for picks they sent you. The sheet itself is built on /bowls/admin/sheet.
 */
export default function BowlAdmin() {
  const router = useRouter()
  const { loading, account, isAdmin, token } = useBowlAuth()
  const toast = useToast()
  const [season, setSeason] = useState<{ season: number; status: string } | null>(null)
  const [players, setPlayers] = useState<AdminPlayer[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [sheet, setSheet] = useState<{ status: string; totalGames: number; players: Progress[] } | null>(null)

  useEffect(() => {
    if (loading) return
    if (!account) router.replace('/bowls/login')
    else if (!isAdmin) router.replace('/bowls')
  }, [loading, account, isAdmin, router])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/bowls/players', { headers: { Authorization: `Bearer ${await token()}` } })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load players')
      setSeason({ season: json.season, status: json.status })
      setPlayers(json.players ?? [])
      setListError('')
      try {
        const st = await fetch('/api/bowls/status', { headers: { Authorization: `Bearer ${await token()}` } })
        if (st.ok) setSheet(await st.json())
      } catch { /* progress is extra */ }
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Could not load players')
    } finally {
      setListLoading(false)
    }
  }, [token])

  useEffect(() => { if (isAdmin) load() }, [isAdmin, load])

  const post = async (url: string, body: object) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Something went wrong')
    return json
  }

  const invite = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy('invite')
    try {
      const json = await post('/api/bowls/invite', { name: name.trim(), email: email.trim() })
      toast.show(json.message, 'success')
      setName(''); setEmail('')
      await load()
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Invite failed', 'error')
    } finally {
      setBusy(null)
    }
  }

  const act = async (p: AdminPlayer, action: 'remove' | 'resend') => {
    if (action === 'remove' && !confirm(`Remove ${p.name} from this season's Bowl Pick'em?`)) return
    setBusy(p.id)
    try {
      const json = await post('/api/bowls/players', { action, playerId: p.id })
      toast.show(json.message, 'success')
      await load()
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed', 'error')
    } finally {
      setBusy(null)
    }
  }

  const remind = async () => {
    const waiting = (sheet?.players ?? []).filter(p => !p.complete).length
    if (!confirm(`Email and push a reminder to the ${waiting} player${waiting === 1 ? '' : 's'} who haven't finished their picks?`)) return
    setBusy('remind')
    try {
      const r = await post('/api/bowls/admin/remind', {})
      toast.show(r.players
        ? `Reminder sent to ${r.players} player${r.players === 1 ? '' : 's'} (${r.emails} email${r.emails === 1 ? '' : 's'}, ${r.pushes} push)${r.failed ? ` — ${r.failed} email${r.failed === 1 ? '' : 's'} failed` : ''}`
        : 'Everyone has finished — nobody to remind.', r.failed ? 'error' : 'success')
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Reminder failed', 'error')
    } finally {
      setBusy(null)
    }
  }

  if (loading || !isAdmin) return <div className="min-h-screen bg-zinc-950"><BowlHeader /></div>

  const sheetOut = !!sheet && sheet.status !== 'setup' && sheet.totalGames > 0
  const progressOf = new Map((sheet?.players ?? []).map(p => [p.id, p]))

  const input = 'w-full px-3.5 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/40'

  return (
    <div className="min-h-screen bg-zinc-950 pb-12">
      <BowlHeader subtitle="Admin · Players" />
      <main className="max-w-3xl mx-auto px-4 py-5 space-y-4 animate-fade-in">
        <div className="flex items-center justify-between">
          <h1 className="sr-only">Bowl admin</h1>
          <AdminTabs />
          {season && (
            <span className="text-[11px] font-semibold text-yellow-300 bg-yellow-500/10 border border-yellow-500/20 px-2.5 py-1 rounded-full">
              {bowlSeasonLabel(season.season)} · {season.status === 'setup' ? 'Setting up' : season.status}
            </span>
          )}
        </div>

        <form onSubmit={invite} className="glass-card rounded-2xl p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-white">Invite a player</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Someone new gets a Bowl Pick&apos;em account only — no NFL access. An NFL player is added with the login they already have.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-2.5">
            <input value={name} onChange={e => setName(e.target.value)} className={input} placeholder="Name" required aria-label="Name" />
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={input} placeholder="Email" required aria-label="Email" />
          </div>
          <button type="submit" disabled={busy === 'invite'}
            className="press w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-b from-yellow-400 to-yellow-600 text-zinc-950 text-sm font-semibold hover:brightness-110 disabled:opacity-50 transition">
            {busy === 'invite' ? 'Sending…' : 'Send invite'}
          </button>
        </form>

        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
            <p className="text-sm font-semibold text-white">This season&apos;s players</p>
            <span className="text-xs text-zinc-500">{players.length}</span>
          </div>
          {listLoading ? (
            <div className="p-4"><div className="skeleton h-12 rounded-lg" /></div>
          ) : listError ? (
            <p className="p-4 text-sm text-red-400">{listError}</p>
          ) : players.length === 0 ? (
            <p className="p-4 text-sm text-zinc-500">Nobody yet. Invite people above — NFL players can also join themselves from the Bowl Pick&apos;em home page.</p>
          ) : (
            players.map(p => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.04] last:border-0">
                <BowlAvatar name={p.name} url={p.avatar_url} size={32} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {p.name}
                    {p.is_admin && <span className="ml-1.5 text-[10px] text-yellow-300">admin</span>}
                  </p>
                  <p className="text-[11px] text-zinc-500 truncate">
                    {p.email}{!p.signed_in && <span className="text-yellow-400"> · hasn&apos;t signed in yet</span>}
                  </p>
                  {sheetOut && (
                    <p className={`text-[11px] ${progressOf.get(p.id)?.complete ? 'text-emerald-300' : 'text-zinc-400'}`}>
                      {progressOf.get(p.id)?.complete ? '✓ All picks in' : `${progressOf.get(p.id)?.picked ?? 0} of ${sheet!.totalGames} picks`}
                    </p>
                  )}
                </div>
                {sheetOut && (
                  <Link href={`/bowls/picks?for=${p.id}`} className="text-xs font-medium text-yellow-400 hover:text-yellow-300 transition">
                    Enter picks
                  </Link>
                )}
                {!p.signed_in && (
                  <button onClick={() => act(p, 'resend')} disabled={busy === p.id}
                    className="text-xs font-medium text-yellow-400 hover:text-yellow-300 disabled:opacity-50 transition">
                    Resend
                  </button>
                )}
                <button onClick={() => act(p, 'remove')} disabled={busy === p.id}
                  className="text-xs text-zinc-500 hover:text-red-400 disabled:opacity-50 transition">
                  Remove
                </button>
              </div>
            ))
          )}
        </div>

        {sheet?.status === 'open' && players.length > 0 && (() => {
          const waiting = (sheet.players ?? []).filter(p => !p.complete).length
          return (
            <div className="glass-card rounded-2xl p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">Reminders</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {waiting ? `${waiting} player${waiting === 1 ? ' hasn’t' : 's haven’t'} finished.` : 'Everyone’s picks are in.'}{' '}
                  Automatic reminders go out when picks open, then 3 days, 1 day, 1 hour and 15 minutes before the lock — only to players who aren&apos;t done.
                </p>
              </div>
              <button onClick={remind} disabled={busy === 'remind' || !waiting}
                className="press shrink-0 px-4 py-2 rounded-xl border border-yellow-500/30 bg-yellow-500/10 text-yellow-300 text-sm font-semibold hover:bg-yellow-500/15 disabled:opacity-40 transition">
                {busy === 'remind' ? 'Sending…' : 'Send a reminder now'}
              </button>
            </div>
          )
        })()}

        <p className="text-xs text-zinc-500 text-center px-4">
          &ldquo;Enter picks&rdquo; is for picks someone sent you — it shows you their picks, so use it only when they ask.
        </p>
        <div className="flex justify-center gap-5 text-sm">
          <Link href="/bowls/admin/sheet" className="text-yellow-400 hover:text-yellow-300">Games</Link>
          <Link href="/bowls" className="text-yellow-400 hover:text-yellow-300">Bowl Pick&apos;em home</Link>
        </div>
      </main>
    </div>
  )
}
