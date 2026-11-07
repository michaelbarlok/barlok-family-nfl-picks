import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { useBowlAuth } from '@/lib/bowls/auth'
import { bowlSeasonLabel } from '@/lib/bowls/constants'
import { PHASES, PHASE_BY_KEY, PICKABLE_PHASES, type BowlGame, type BowlTeam, type Phase } from '@/lib/bowls/sheet'
import { gameLabel } from '@/lib/bowls/bracket'
import { kickoffText, lockText } from '@/lib/bowls/format'
import { useToast } from '@/components/Toast'
import AdminTabs from '@/components/bowls/AdminTabs'
import BowlHeader from '@/components/bowls/BowlHeader'
import { PHASE_TONE, TeamLine } from '@/components/bowls/ui'
import SheetBoard from '@/components/bowls/SheetBoard'

interface PullSummary { added: number; updated: number; finals: string[]; removed: string[]; notFound: string[]; pulledAt: string }
interface SheetAdmin {
  season: number
  status: 'setup' | 'open' | 'locked' | 'complete'
  lockAt: string | null
  pulledAt: string | null
  games: BowlGame[]
  issues: string[]
  sampleTeams: number
  counts: Partial<Record<Phase, number>>
  playersWithPicks: number
}
interface FoundGame {
  espn_id: string; name: string; kickoff_time: string | null; time_tbd: boolean; tv: string | null
  away: BowlTeam | null; home: BowlTeam | null; phase: Phase | null; removed: boolean; inPool: boolean
}

const ROUND_NAME = { first: 'First round', quarter: 'Quarterfinal', semi: 'Semifinal', title: 'Title game' } as const
const ROUND_RANK = { first: 0, quarter: 1, semi: 2, title: 3 } as const

/**
 * Bowl admin: the games in this year's pick'em.
 *
 * Pull the bowl season from ESPN, drag each bowl into its phase (playoff
 * games place themselves), add anything else by date (Army–Navy), link up
 * the playoff bracket and open picks. ESPN is only ever asked when you tap
 * Pull — results included.
 */
export default function SheetBuilder() {
  const router = useRouter()
  const { loading, account, isAdmin, token } = useBowlAuth()
  const toast = useToast()
  const [data, setData] = useState<SheetAdmin | null>(null)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [pulled, setPulled] = useState<PullSummary | null>(null)
  // Board moves show at once and save one at a time, in order, so a quick run
  // of drags can't land out of order.
  const saves = useRef<Promise<unknown>>(Promise.resolve())
  const pendingSaves = useRef(0)
  const [date, setDate] = useState('')
  const [found, setFound] = useState<FoundGame[] | null>(null)
  const [addPhase, setAddPhase] = useState<Phase>('big')

  useEffect(() => {
    if (loading) return
    if (!account) router.replace('/bowls/login')
    else if (!isAdmin) router.replace('/bowls')
  }, [loading, account, isAdmin, router])

  const call = useCallback(async (body?: object) => {
    const res = await fetch('/api/bowls/admin/sheet', body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` }, body: JSON.stringify(body) }
      : { headers: { Authorization: `Bearer ${await token()}` } })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Something went wrong')
    return json
  }, [token])

  useEffect(() => {
    if (!isAdmin) return
    call().then(setData).catch(err => setLoadError(err instanceof Error ? err.message : 'Could not load the games'))
  }, [isAdmin, call])

  const act = async (key: string, body: object, done?: string) => {
    setBusy(key)
    try {
      const json = await call(body)
      setData(json)
      if (done) toast.show(done, 'success')
      return json
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Something went wrong', 'error')
      return null
    } finally {
      setBusy(null)
    }
  }

  const fillSamples = async () => {
    const json = await act('sample', { action: 'sample' })
    if (json?.result) toast.show(`Sample teams on ${json.result.games} games, from the ${json.result.from} bowls`, 'success')
  }
  const clearSamples = async () => {
    const json = await act('unsample', { action: 'unsample' })
    if (json?.result) toast.show(`Removed ${json.result.teams} sample teams — those slots are TBD again`, 'success')
  }

  const pull = async () => {
    const json = await act('pull', { action: 'pull' })
    if (json?.result) {
      setPulled(json.result)
      toast.show('Pulled from ESPN', 'success')
    }
  }

  const search = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!date) return
    setBusy('search')
    try {
      const json = await call({ action: 'search', date })
      setFound(json.games)
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Could not reach ESPN', 'error')
    } finally {
      setBusy(null)
    }
  }

  const add = async (g: FoundGame) => {
    const json = await act(`add-${g.espn_id}`, { action: 'add', espnId: g.espn_id, date, phase: addPhase }, `${g.name} added to ${PHASE_BY_KEY[addPhase].label}`)
    if (json) setFound(list => list?.map(x => x.espn_id === g.espn_id ? { ...x, inPool: true, phase: addPhase, removed: false } : x) ?? null)
  }

  const byId = useMemo(() => new Map((data?.games ?? []).map(g => [g.id, g])), [data])

  const save = (body: object, patch: (g: BowlGame) => BowlGame, gameId: string) => {
    setData(d => d && { ...d, games: d.games.map(x => (x.id === gameId ? patch(x) : x)) })
    pendingSaves.current++
    saves.current = saves.current.then(async () => {
      try {
        const json = await call(body)
        // Only the last save's answer is shown, so a later move never flickers back.
        if (pendingSaves.current === 1) setData(json)
      } catch (err) {
        toast.show(err instanceof Error ? err.message : 'Could not save that change', 'error')
        call().then(setData).catch(() => {})
      } finally {
        pendingSaves.current--
      }
    })
  }
  const moveGame = (g: BowlGame, to: Phase | null) => save({ action: 'update', gameId: g.id, phase: to }, x => ({ ...x, phase: to }), g.id)
  const removeGame = (g: BowlGame, removed: boolean) => save({ action: 'update', gameId: g.id, removed }, x => ({ ...x, removed }), g.id)
  const renameGame = async (g: BowlGame, name: string) => !!(await act(`name-${g.id}`, { action: 'update', gameId: g.id, name }))

  if (loading || !isAdmin) return <div className="min-h-screen bg-zinc-950"><BowlHeader /></div>

  const locked = data?.status === 'locked' || data?.status === 'complete'
  const games = data?.games ?? []
  const on = games.filter(g => g.phase && !g.removed)
  const playoff = on.filter(g => g.playoff_round)
  const total = on.length
  const counts: Partial<Record<Phase, number>> = {}
  for (const g of on) counts[g.phase!] = (counts[g.phase!] ?? 0) + 1

  return (
    <div className="min-h-screen bg-zinc-950 pb-16">
      <BowlHeader subtitle="Admin · Games" />
      <main className="max-w-3xl mx-auto px-4 py-5 space-y-4 animate-fade-in">
        <div className="flex items-center justify-between gap-2">
          <h1 className="sr-only">Bowl admin</h1>
          <AdminTabs />
          {data && (
            <span className="text-[11px] font-semibold text-yellow-300 bg-yellow-500/10 border border-yellow-500/20 px-2.5 py-1 rounded-full">
              {bowlSeasonLabel(data.season)} · {data.status === 'setup' ? 'Setting up' : data.status === 'open' ? 'Picks open' : data.status === 'locked' ? 'Locked' : 'Complete'}
            </span>
          )}
        </div>

        {loadError && <div className="glass-card rounded-2xl p-4 text-sm text-red-400">{loadError}</div>}
        {!data && !loadError && <div className="skeleton h-40 rounded-2xl" />}

        {data && (
          <>
            {/* ESPN */}
            <section className="glass-card rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">ESPN</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Games, times, teams and results come in only when you tap Pull — nothing updates on its own.
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-1.5">
                    {data.pulledAt ? `Last pulled ${new Date(data.pulledAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Not pulled yet'}
                  </p>
                </div>
                <button onClick={pull} disabled={busy === 'pull'}
                  className="press shrink-0 px-4 py-2.5 rounded-xl bg-gradient-to-b from-yellow-400 to-yellow-600 text-zinc-950 text-sm font-semibold hover:brightness-110 disabled:opacity-50 transition">
                  {busy === 'pull' ? 'Pulling…' : 'Pull from ESPN'}
                </button>
              </div>
              {pulled && (
                <div className="mt-3 text-xs text-zinc-300 bg-white/[0.03] border border-white/[0.06] rounded-xl px-3 py-2 space-y-0.5" role="status">
                  <p>{pulled.added ? `${pulled.added} new games · ` : ''}{pulled.updated} updated{pulled.finals.length ? ` · ${pulled.finals.length} newly final` : ''}</p>
                  {pulled.removed.length > 0 && <p className="text-red-300">Canceled or postponed — off the pick&apos;em: {pulled.removed.join(', ')}</p>}
                  {pulled.notFound.length > 0 && <p className="text-yellow-300">Not found on ESPN this time: {pulled.notFound.join(', ')}</p>}
                </div>
              )}
            </section>

            {/* Where the pick'em stands */}
            <section className="glass-card rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-white">In the pick&apos;em · {total}</p>
                {data.playersWithPicks > 0 && <p className="text-[11px] text-zinc-500">{data.playersWithPicks} {data.playersWithPicks === 1 ? 'player has' : 'players have'} started picking</p>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PHASES.map(p => (
                  <span key={p.key} className={`text-[11px] font-medium px-2 py-1 rounded-full border ${PHASE_TONE[p.key].badge}`}>
                    {p.label} · {counts[p.key] ?? 0}
                  </span>
                ))}
              </div>
              <p className="text-xs text-zinc-400">
                {data.lockAt
                  ? <>Picks lock <span className="text-white font-medium">{lockText(data.lockAt)}</span> — the first kickoff.</>
                  : 'Picks lock at the first kickoff.'}
              </p>
              {data.issues.length > 0 && data.status === 'setup' && (
                <div className="text-xs text-yellow-200/90 bg-yellow-500/[0.06] border border-yellow-500/15 rounded-xl px-3 py-2">
                  <p className="font-semibold mb-1">Before picks can open:</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {data.issues.slice(0, 6).map(i => <li key={i}>{i}</li>)}
                    {data.issues.length > 6 && <li>…and {data.issues.length - 6} more</li>}
                  </ul>
                </div>
              )}
              {data.status === 'setup' && (
                <button onClick={() => confirm(`Open picks? Everyone in the pick'em can start picking, and picks lock ${data.lockAt ? lockText(data.lockAt) : 'at the first kickoff'}.`) && act('open', { action: 'open' }, 'Picks are open')}
                  disabled={busy === 'open' || data.issues.length > 0}
                  className="press w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-b from-yellow-400 to-yellow-600 text-zinc-950 text-sm font-semibold hover:brightness-110 disabled:opacity-40 transition">
                  {busy === 'open' ? 'Opening…' : 'Open picks'}
                </button>
              )}
              {data.status === 'open' && (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs font-semibold text-emerald-300">✓ Picks are open</span>
                  <button onClick={() => confirm('Hide the games from players again while you fix something? Picks already made are kept.') && act('setup', { action: 'setup' }, 'Back to setting up')}
                    disabled={busy === 'setup'} className="text-xs text-zinc-400 hover:text-white transition">
                    Back to setup
                  </button>
                </div>
              )}
              {locked && <p className="text-xs font-semibold text-zinc-300">🔒 Picks are locked. You can still pull results and take a canceled game off.</p>}
            </section>

            {/* Preview with real teams */}
            {(data.status === 'setup' || data.sampleTeams > 0) && games.length > 0 && (
              <section aria-label="Preview with real teams" className={`rounded-2xl p-4 space-y-3 border ${data.sampleTeams ? 'bg-sky-500/[0.06] border-sky-500/20' : 'glass-card'}`}>
                {data.sampleTeams ? (
                  <>
                    <div>
                      <p className="text-sm font-semibold text-white">Sample teams are on</p>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        {data.sampleTeams} team slots are filled with last season&apos;s matchups so you can see how it looks.
                        Everyone in this season&apos;s pick&apos;em can try it on My Picks — nothing they tap is saved — and picks can&apos;t open until these come off.
                        A pull from ESPN replaces any of them it has the real team for.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <button onClick={clearSamples} disabled={busy === 'unsample'}
                        className="press px-4 py-2 rounded-xl bg-white/[0.08] border border-white/[0.12] text-white text-sm font-semibold hover:bg-white/[0.12] disabled:opacity-50 transition">
                        {busy === 'unsample' ? 'Removing…' : 'Remove sample teams'}
                      </button>
                      <Link href="/bowls/picks" className="text-sm font-semibold text-yellow-400 hover:text-yellow-300">See it in My Picks →</Link>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white">Preview with real teams</p>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        Fill every TBD slot with last season&apos;s bowl matchups from ESPN — real names, logos and records — to see
                        how the pick&apos;em will look. Everyone in this season&apos;s pick&apos;em can try it on My Picks (nothing is saved), and one tap takes them all off again.
                      </p>
                    </div>
                    <button onClick={fillSamples} disabled={busy === 'sample'}
                      className="press shrink-0 px-4 py-2 rounded-xl border border-yellow-500/30 bg-yellow-500/10 text-yellow-300 text-sm font-semibold hover:bg-yellow-500/15 disabled:opacity-40 transition">
                      {busy === 'sample' ? 'Filling…' : 'Fill sample teams'}
                    </button>
                  </div>
                )}
              </section>
            )}

            {/* Sections */}
            <div>
              <div className="flex items-baseline justify-between gap-2 mb-2 px-1">
                <h2 className="text-sm font-bold text-white">Sections</h2>
                <p className="text-[11px] text-zinc-500 text-right">{locked ? 'Locked with the picks' : 'Drag games between sections · listed by kickoff'}</p>
              </div>
              {games.length === 0 ? (
                <div className="glass-card rounded-2xl p-4 text-sm text-zinc-500">No games yet — tap Pull from ESPN.</div>
              ) : (
                <SheetBoard games={games} locked={locked} canDelete={data.status === 'setup'}
                  onMove={moveGame} onRemove={removeGame} onRename={renameGame}
                  onDelete={g => act(`del-${g.id}`, { action: 'delete', gameId: g.id })} />
              )}
            </div>

            {/* Add by date */}
            {!locked && (
              <section className="glass-card rounded-2xl p-4 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-white">Add a game by date</p>
                  <p className="text-xs text-zinc-500 mt-0.5">For a game that isn&apos;t in the pull, like Army–Navy: pick its date and the section it goes in, look it up, and tap Add. It lands in that section, and you can drag it from there.</p>
                </div>
                <form onSubmit={search} className="flex flex-wrap gap-2">
                  <input type="date" value={date} onChange={e => { setDate(e.target.value); setFound(null) }} aria-label="Date" required
                    className="flex-1 min-w-[150px] px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/40 [color-scheme:dark]" />
                  <select value={addPhase} onChange={e => setAddPhase(e.target.value as Phase)} aria-label="Phase for the game"
                    className="px-2 py-2 bg-zinc-950 border border-white/[0.08] rounded-xl text-sm text-white focus:outline-none">
                    {PICKABLE_PHASES.map(p => <option key={p} value={p}>{PHASE_BY_KEY[p].label}</option>)}
                  </select>
                  <button type="submit" disabled={busy === 'search' || !date}
                    className="px-4 py-2 rounded-xl bg-white/[0.08] text-sm font-semibold text-white hover:bg-white/[0.12] disabled:opacity-50 transition">
                    {busy === 'search' ? 'Looking…' : 'Look up'}
                  </button>
                </form>
                {found && (
                  found.length === 0 ? <p className="text-xs text-zinc-500">No games that day.</p> : (
                    <div className="max-h-72 overflow-y-auto -mx-1 px-1 space-y-1">
                      {found.map(g => (
                        <div key={g.espn_id} className="flex items-center gap-2 text-xs rounded-lg px-2.5 py-2 bg-white/[0.03]">
                          <div className="flex-1 min-w-0">
                            <p className="text-zinc-200 truncate">{g.name}</p>
                            <p className="text-zinc-500 truncate">{kickoffText(g.kickoff_time, g.time_tbd)}{g.tv ? ` · ${g.tv}` : ''}</p>
                          </div>
                          {g.inPool && g.phase && !g.removed
                            ? <span className="text-emerald-300 shrink-0">Included</span>
                            : <button onClick={() => add(g)} disabled={busy === `add-${g.espn_id}`}
                                className="shrink-0 font-semibold text-yellow-400 hover:text-yellow-300 disabled:opacity-50">Add</button>}
                        </div>
                      ))}
                    </div>
                  )
                )}
              </section>
            )}

            {/* Bracket */}
            {playoff.length > 0 && (
              <section className="glass-card rounded-2xl p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white">Playoff bracket</p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Each slot is the winner of an earlier game — that&apos;s how everyone&apos;s picks carry up their own bracket.
                      Check it against the official bracket: ESPN doesn&apos;t say which semifinal each quarterfinal winner goes to.
                    </p>
                  </div>
                  {!locked && (
                    <button onClick={() => act('guess', { action: 'guess' }, 'Filled in from the rankings')} disabled={busy === 'guess'}
                      className="shrink-0 text-xs font-semibold text-yellow-400 hover:text-yellow-300 disabled:opacity-50 transition">
                      Fill in from rankings
                    </button>
                  )}
                </div>
                {(['quarter', 'semi', 'title'] as const).map(round => {
                  const list = playoff.filter(g => g.playoff_round === round)
                  if (!list.length) return null
                  const feeders = playoff.filter(f => f.playoff_round && ROUND_RANK[f.playoff_round] < ROUND_RANK[round])
                  return (
                    <div key={round} className="space-y-2">
                      <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">{ROUND_NAME[round]}{list.length > 1 ? 's' : ''}</p>
                      {list.map(g => (
                        <div key={g.id} className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-2.5">
                          <p className="text-xs font-medium text-zinc-300 mb-1.5">{g.name}</p>
                          <div className="grid sm:grid-cols-2 gap-1.5">
                            {(['away', 'home'] as const).map(side => {
                              const from = side === 'away' ? g.away_from : g.home_from
                              const team = side === 'away' ? g.away : g.home
                              if (!from && team) {
                                return <div key={side} className="text-xs text-zinc-200 px-2.5 py-2 rounded-lg bg-white/[0.03]"><TeamLine team={team} /></div>
                              }
                              return (
                                <select key={side} value={from ?? ''} disabled={locked || busy === `link-${g.id}-${side}`}
                                  aria-label={`${g.name} ${side === 'away' ? 'first' : 'second'} team`}
                                  onChange={e => act(`link-${g.id}-${side}`, { action: 'link', gameId: g.id, side, from: e.target.value || null })}
                                  className={`w-full text-xs rounded-lg px-2 py-2 bg-zinc-950 border ${from ? 'border-white/[0.1] text-zinc-200' : 'border-yellow-500/40 text-yellow-200'} focus:outline-none focus:ring-2 focus:ring-yellow-500/40`}>
                                  <option value="">Winner of…</option>
                                  {feeders.map(f => <option key={f.id} value={f.id}>Winner of {gameLabel(f)}</option>)}
                                </select>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </section>
            )}

          </>
        )}

        <div className="flex justify-center gap-5 text-sm">
          <Link href="/bowls/admin" className="text-yellow-400 hover:text-yellow-300">Players</Link>
          <Link href="/bowls/picks" className="text-yellow-400 hover:text-yellow-300">Preview My Picks</Link>
          <Link href="/bowls" className="text-yellow-400 hover:text-yellow-300">Home</Link>
        </div>
      </main>
    </div>
  )
}
