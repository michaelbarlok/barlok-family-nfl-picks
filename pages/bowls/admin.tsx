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
  is_managed: boolean
  signed_in: boolean
  managers: { id: string; name: string }[]
}

/** Someone with an account who isn't in this season. */
interface Candidate {
  id: string
  name: string
  email: string | null
  avatar_url: string | null
  managed: boolean
  nfl: boolean
  pastBowls: boolean
}

type AddMode = 'existing' | 'invite' | 'managed'

interface Progress { id: string; picked: number; complete: boolean }

/**
 * Bowl admin — run separately from the NFL admin page.
 *
 * Add players three ways: anyone who already has an account (NFL players,
 * past bowl players, NFL managed players) straight in with no email; someone
 * new by name and email, who gets a bowl-only account; or a managed player —
 * a kid without a phone — whose picks the people you choose make for them.
 * Each player's progress shows as counts, and "Enter picks" opens their picks
 * for picks they sent you. The sheet itself is built on /bowls/admin/sheet.
 */
export default function BowlAdmin() {
  const router = useRouter()
  const { loading, account, isAdmin, token } = useBowlAuth()
  const toast = useToast()
  const [season, setSeason] = useState<{ season: number; status: string } | null>(null)
  const [players, setPlayers] = useState<AdminPlayer[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [mode, setMode] = useState<AddMode>('existing')
  const [search, setSearch] = useState('')
  const [kidName, setKidName] = useState('')
  const [kidManagers, setKidManagers] = useState<string[]>([])
  const [editing, setEditing] = useState<{ id: string; managers: string[] } | null>(null)
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
      setCandidates(json.candidates ?? [])
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

  const addExisting = async (c: Candidate) => {
    setBusy(c.id)
    try {
      const json = await post('/api/bowls/players', { action: 'add', playerId: c.id })
      toast.show(json.message, 'success')
      await load()
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Could not add them', 'error')
    } finally {
      setBusy(null)
    }
  }

  const addManaged = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy('managed')
    try {
      const json = await post('/api/bowls/players', { action: 'createManaged', name: kidName.trim(), managerIds: kidManagers })
      toast.show(json.message, 'success')
      setKidName(''); setKidManagers([])
      await load()
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Could not add them', 'error')
    } finally {
      setBusy(null)
    }
  }

  const saveManagers = async () => {
    if (!editing) return
    setBusy(editing.id)
    try {
      const json = await post('/api/bowls/players', { action: 'setManagers', playerId: editing.id, managerIds: editing.managers })
      toast.show(json.message, 'success')
      setEditing(null)
      await load()
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Could not save', 'error')
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

  // Who can make picks for a managed player: this season's players with their own login.
  const pickers = players.filter(p => !p.is_managed)
  const q = search.trim().toLowerCase()
  const found = q
    ? candidates.filter(c => c.name.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q))
    : candidates

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

        <div className="glass-card rounded-2xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-white">Add players</p>
            <div role="tablist" aria-label="How to add" className="inline-flex p-0.5 rounded-full bg-white/[0.05] border border-white/[0.08]">
              {([['existing', 'Existing account'], ['invite', 'Invite new'], ['managed', 'Managed']] as [AddMode, string][]).map(([m, label]) => (
                <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition ${mode === m ? 'bg-gradient-to-b from-yellow-400 to-yellow-600 text-zinc-950' : 'text-zinc-400 hover:text-white'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {mode === 'existing' && (
            <div className="space-y-2.5" role="tabpanel" aria-label="Existing account">
              <p className="text-xs text-zinc-500">
                NFL players, past bowl players and NFL managed players. They&apos;re in right away — no email is sent, and they sign in with the login they already have.
              </p>
              <input value={search} onChange={e => setSearch(e.target.value)} className={input} placeholder="Search by name or email"
                aria-label="Search accounts" type="search" autoComplete="off" />
              {candidates.length === 0 ? (
                <p className="text-xs text-zinc-500 px-1">Everyone with an account is already in this season.</p>
              ) : found.length === 0 ? (
                <p className="text-xs text-zinc-500 px-1">No one by that name — try &ldquo;Invite new&rdquo;.</p>
              ) : (
                <ul className="max-h-72 overflow-y-auto -mx-1 px-1 divide-y divide-white/[0.04] rounded-xl border border-white/[0.06]" aria-label="Accounts not in this season">
                  {found.map(c => (
                    <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                      <BowlAvatar name={c.name} url={c.avatar_url} size={28} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">{c.name}</p>
                        <p className="text-[11px] text-zinc-500 truncate">
                          {[c.managed ? 'Managed — no login' : c.email, c.nfl ? 'NFL' : null, c.pastBowls ? 'Past bowl player' : null].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <button type="button" onClick={() => addExisting(c)} disabled={busy === c.id} aria-label={`Add ${c.name}`}
                        className="press shrink-0 px-3 py-1.5 rounded-lg border border-yellow-500/30 bg-yellow-500/10 text-yellow-300 text-xs font-semibold hover:bg-yellow-500/15 disabled:opacity-50 transition">
                        {busy === c.id ? 'Adding…' : 'Add'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {mode === 'invite' && (
            <form onSubmit={invite} className="space-y-3" role="tabpanel" aria-label="Invite new">
              <p className="text-xs text-zinc-500">
                For someone new: they get a Bowl Pick&apos;em account only — no NFL access — and an email to set a password.
              </p>
              <div className="grid sm:grid-cols-2 gap-2.5">
                <input value={name} onChange={e => setName(e.target.value)} className={input} placeholder="Name" required aria-label="Name" />
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={input} placeholder="Email" required aria-label="Email" />
              </div>
              <button type="submit" disabled={busy === 'invite'}
                className="press w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-b from-yellow-400 to-yellow-600 text-zinc-950 text-sm font-semibold hover:brightness-110 disabled:opacity-50 transition">
                {busy === 'invite' ? 'Sending…' : 'Send invite'}
              </button>
            </form>
          )}

          {mode === 'managed' && (
            <form onSubmit={addManaged} className="space-y-3" role="tabpanel" aria-label="Managed">
              <p className="text-xs text-zinc-500">
                For kids and anyone without a phone: no login and no email. The people you choose make their picks from their own My Picks page, until the picks lock.
                Already a managed player on the NFL side? Add them from &ldquo;Existing account&rdquo; instead — the people who pick for them come along.
              </p>
              <input value={kidName} onChange={e => setKidName(e.target.value)} className={input} placeholder="Name" required aria-label="Managed player's name" maxLength={60} />
              <ManagerPicker label="Who makes their picks?" pickers={pickers} chosen={kidManagers} onChange={setKidManagers} />
              <button type="submit" disabled={busy === 'managed' || !kidName.trim()}
                className="press w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-b from-yellow-400 to-yellow-600 text-zinc-950 text-sm font-semibold hover:brightness-110 disabled:opacity-50 transition">
                {busy === 'managed' ? 'Adding…' : 'Add managed player'}
              </button>
            </form>
          )}
        </div>

        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">This season&apos;s players</p>
              <span className="text-xs text-zinc-500">{players.length}</span>
            </div>
            {sheet?.status === 'open' && (
              <p className="text-[11px] text-zinc-500 mt-0.5" data-privacy-note>
                Everyone&apos;s picks stay private until the first kickoff — even from you. Then you can override anyone&apos;s here.
              </p>
            )}
          </div>
          {listLoading ? (
            <div className="p-4"><div className="skeleton h-12 rounded-lg" /></div>
          ) : listError ? (
            <p className="p-4 text-sm text-red-400">{listError}</p>
          ) : players.length === 0 ? (
            <p className="p-4 text-sm text-zinc-500">Nobody yet. Add people above — NFL players can also join themselves from the Bowl Pick&apos;em home page.</p>
          ) : (
            players.map(p => (
              <div key={p.id} className="px-4 py-2.5 border-b border-white/[0.04] last:border-0">
              <div className="flex items-center gap-3">
                <BowlAvatar name={p.name} url={p.avatar_url} size={32} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {p.name}
                    {p.is_admin && <span className="ml-1.5 text-[10px] text-yellow-300">admin</span>}
                    {p.is_managed && <span className="ml-1.5 text-[10px] font-semibold text-sky-300 bg-sky-500/10 border border-sky-500/20 px-1.5 py-px rounded-full">👤 managed</span>}
                  </p>
                  {p.is_managed ? (
                    <>
                      <p className={`text-[11px] ${p.managers.length ? 'text-zinc-500' : 'text-yellow-400'}`}>
                        {p.managers.length
                          ? `Picks made by ${p.managers.map(m => m.name.split(' ')[0]).join(', ')}`
                          : 'No one makes their picks yet'}
                      </p>
                      <button type="button" onClick={() => setEditing(editing?.id === p.id ? null : { id: p.id, managers: p.managers.map(m => m.id) })}
                        aria-expanded={editing?.id === p.id}
                        className="block text-[11px] font-medium text-yellow-400 hover:text-yellow-300 transition">
                        {editing?.id === p.id ? 'Close' : 'Change who picks'}
                      </button>
                    </>
                  ) : (
                  <p className="text-[11px] text-zinc-500 truncate">
                    {p.email}{!p.signed_in && <span className="text-yellow-400"> · hasn&apos;t signed in yet</span>}
                  </p>
                  )}
                  {sheetOut && (
                    <p className={`text-[11px] ${progressOf.get(p.id)?.complete ? 'text-emerald-300' : 'text-zinc-400'}`}>
                      {progressOf.get(p.id)?.complete ? '✓ All picks in' : `${progressOf.get(p.id)?.picked ?? 0} of ${sheet!.totalGames} picks`}
                    </p>
                  )}
                </div>
                {/* Someone else's picks stay private until the lock — then the admin can fix them (like the NFL override). */}
                {sheet?.status === 'locked' && (
                  <Link href={`/bowls/picks?for=${p.id}`} className="text-xs font-medium text-yellow-400 hover:text-yellow-300 transition">
                    Override picks
                  </Link>
                )}
                {!p.signed_in && !p.is_managed && (
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
              {editing?.id === p.id && (
                <div className="mt-2.5 ml-11 space-y-2.5">
                  <ManagerPicker label={`Who makes ${p.name.split(' ')[0]}'s picks?`}
                    pickers={[...pickers, ...p.managers.filter(m => !pickers.some(x => x.id === m.id)).map(m => ({ ...m, avatar_url: null }))]}
                    chosen={editing.managers} onChange={ids => setEditing({ id: p.id, managers: ids })} />
                  <div className="flex gap-2">
                    <button type="button" onClick={saveManagers} disabled={busy === p.id}
                      className="press px-4 py-1.5 rounded-lg bg-gradient-to-b from-yellow-400 to-yellow-600 text-zinc-950 text-xs font-semibold hover:brightness-110 disabled:opacity-50 transition">
                      {busy === p.id ? 'Saving…' : 'Save'}
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white transition">Cancel</button>
                  </div>
                </div>
              )}
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
          A managed player&apos;s picks are made by the people you chose, from their own My Picks page.
        </p>
        <div className="flex justify-center gap-5 text-sm">
          <Link href="/bowls/admin/sheet" className="text-yellow-400 hover:text-yellow-300">Games</Link>
          <Link href="/bowls" className="text-yellow-400 hover:text-yellow-300">Bowl Pick&apos;em home</Link>
        </div>
      </main>
    </div>
  )
}

/** Tap the people who make a managed player's picks. */
function ManagerPicker({ label, pickers, chosen, onChange }: {
  label: string
  pickers: { id: string; name: string; avatar_url: string | null }[]
  chosen: string[]
  onChange: (ids: string[]) => void
}) {
  return (
    <fieldset>
      <legend className="text-xs font-semibold text-zinc-300 mb-1.5">{label}</legend>
      {pickers.length === 0 ? (
        <p className="text-xs text-zinc-500">Add the people who&apos;ll make their picks first — then choose them here.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {pickers.map(p => {
            const on = chosen.includes(p.id)
            return (
              <button key={p.id} type="button" aria-pressed={on}
                onClick={() => onChange(on ? chosen.filter(id => id !== p.id) : [...chosen, p.id])}
                className={`press inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border text-xs font-medium transition ${on
                  ? 'bg-yellow-500/15 border-yellow-500/50 text-yellow-100'
                  : 'bg-white/[0.03] border-white/[0.08] text-zinc-300 hover:text-white'}`}>
                <BowlAvatar name={p.name} url={p.avatar_url} size={20} />
                {p.name}
                {on && <span aria-hidden className="text-yellow-300">✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </fieldset>
  )
}
