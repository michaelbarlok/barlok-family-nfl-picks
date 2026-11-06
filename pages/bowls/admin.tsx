import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { useBowlAuth } from '@/lib/bowls/auth'
import { bowlSeasonLabel } from '@/lib/bowls/constants'
import { useToast } from '@/components/Toast'
import BowlHeader, { BowlAvatar } from '@/components/bowls/BowlHeader'

interface AdminPlayer {
  id: string
  name: string
  email: string | null
  avatar_url: string | null
  is_admin: boolean
  signed_in: boolean
}

/**
 * Bowl admin — run separately from the NFL admin page.
 *
 * Invite people by name and email: someone new gets a bowl-only account with
 * no NFL access; an NFL player is added with the login they already have.
 * The pick sheet builder comes in the next update.
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

  if (loading || !isAdmin) return <div className="min-h-screen bg-surface"><BowlHeader /></div>

  const input = 'w-full px-3.5 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40'

  return (
    <div className="min-h-screen bg-surface pb-12">
      <BowlHeader subtitle="Admin" />
      <main className="max-w-3xl mx-auto px-4 py-5 space-y-4 animate-fade-in">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-white">Bowl admin</h1>
          {season && (
            <span className="text-[11px] font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-full">
              {bowlSeasonLabel(season.season)} · {season.status === 'setup' ? 'Setting up' : season.status}
            </span>
          )}
        </div>

        <form onSubmit={invite} className="glass-card rounded-2xl p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-white">Invite a player</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Someone new gets a Bowl Pick&apos;em account only — no NFL access. An NFL player is added with the login they already have.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-2.5">
            <input value={name} onChange={e => setName(e.target.value)} className={input} placeholder="Name" required aria-label="Name" />
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={input} placeholder="Email" required aria-label="Email" />
          </div>
          <button type="submit" disabled={busy === 'invite'}
            className="press w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white text-sm font-semibold hover:brightness-110 disabled:opacity-50 transition">
            {busy === 'invite' ? 'Sending…' : 'Send invite'}
          </button>
        </form>

        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
            <p className="text-sm font-semibold text-white">This season&apos;s players</p>
            <span className="text-xs text-slate-500">{players.length}</span>
          </div>
          {listLoading ? (
            <div className="p-4"><div className="skeleton h-12 rounded-lg" /></div>
          ) : listError ? (
            <p className="p-4 text-sm text-red-400">{listError}</p>
          ) : players.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">Nobody yet. Invite people above — NFL players can also join themselves from the Bowl Pick&apos;em home page.</p>
          ) : (
            players.map(p => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.04] last:border-0">
                <BowlAvatar name={p.name} url={p.avatar_url} size={32} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {p.name}
                    {p.is_admin && <span className="ml-1.5 text-[10px] text-amber-300">admin</span>}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {p.email}{!p.signed_in && <span className="text-amber-400"> · hasn&apos;t signed in yet</span>}
                  </p>
                </div>
                {!p.signed_in && (
                  <button onClick={() => act(p, 'resend')} disabled={busy === p.id}
                    className="text-xs font-medium text-amber-400 hover:text-amber-300 disabled:opacity-50 transition">
                    Resend
                  </button>
                )}
                <button onClick={() => act(p, 'remove')} disabled={busy === p.id}
                  className="text-xs text-slate-500 hover:text-red-400 disabled:opacity-50 transition">
                  Remove
                </button>
              </div>
            ))
          )}
        </div>

        <p className="text-xs text-slate-600 text-center">
          The pick sheet builder — pulling bowl games from ESPN, phases and the playoff bracket — comes in the next update.
        </p>
        <Link href="/bowls" className="block text-center text-sm text-amber-400 hover:text-amber-300">← Bowl Pick&apos;em home</Link>
      </main>
    </div>
  )
}
