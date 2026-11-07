import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { useBowlAuth } from '@/lib/bowls/auth'
import { pickSections, type BowlGame, type BowlTeam } from '@/lib/bowls/sheet'
import { cleanPicks, indexGames, optionsFor, progress, type PickMap } from '@/lib/bowls/bracket'
import { countdown, kickoffText, lockText } from '@/lib/bowls/format'
import { useToast } from '@/components/Toast'
import BowlHeader from '@/components/bowls/BowlHeader'
import BowlRules from '@/components/bowls/BowlRules'
import { PHASE_TONE, TeamLogo, TeamName, fullTeamName } from '@/components/bowls/ui'

interface SheetData {
  season: number
  status: 'setup' | 'open' | 'locked' | 'complete'
  lockAt: string | null
  inSeason: boolean
  player?: { id: string; name: string }
  proxy?: boolean
  /** Picking for a managed player you make picks for. */
  managed?: boolean
  /** The admin, who may change someone's picks after the lock. */
  override?: boolean
  canEdit?: boolean
  managing?: Managed[]
  games: BowlGame[]
  picks?: PickMap
  best5?: string[]
  titleTotal?: number | null
  enteredByAdmin?: number
}

interface Managed { id: string; name: string; avatar_url: string | null }

interface Pending { picks: Record<string, string | null>; best5?: string[]; titleTotal?: number | null }
const emptyPending = (): Pending => ({ picks: {} })

/**
 * My Picks — the Bowl Pick'em sheet.
 *
 * Pick a winner for every game, star your Best 5, and guess the title game's
 * total. The playoff is your own bracket: a quarterfinal is the bye team
 * against whoever you picked in the first round, and so on to the champion.
 * Everything saves as you go and locks at the first kickoff.
 *
 * Someone who makes a managed player's picks (a kid without a phone) gets a
 * tab for each, like the NFL side: My Picks | 👤 Dani. The bowl admin can open
 * anyone's picks (?for=) to enter picks they sent in.
 *
 * Each player's picks get their own instance of the page (keyed on ?for=), so
 * a save still on its way when you switch tabs goes to the player it was for.
 */
export default function BowlPicks() {
  const router = useRouter()
  const forId = typeof router.query.for === 'string' && router.query.for ? router.query.for : undefined
  const [managing, setManaging] = useState<Managed[]>([])
  return <PicksFor key={forId ?? 'me'} forId={forId} managing={managing} onManaging={setManaging} />
}

function PicksFor({ forId, managing, onManaging }: { forId?: string; managing: Managed[]; onManaging: (m: Managed[]) => void }) {
  const router = useRouter()
  const { loading, account, token } = useBowlAuth()
  const toast = useToast()

  const [data, setData] = useState<SheetData | null>(null)
  const [error, setError] = useState('')
  const [picks, setPicks] = useState<PickMap>({})
  const [best5, setBest5] = useState<string[]>([])
  const [total, setTotal] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const pending = useRef<Pending>(emptyPending())
  const inFlight = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!loading && !account) router.replace('/bowls/login')
  }, [loading, account, router])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/bowls/sheet${forId ? `?for=${encodeURIComponent(forId)}` : ''}`, { headers: { Authorization: `Bearer ${await token()}` } })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load your picks')
      onManaging(json.managing ?? [])
      setData(json)
      setPicks(json.picks ?? {})
      setBest5(json.best5 ?? [])
      setTotal(json.titleTotal == null ? '' : String(json.titleTotal))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your picks')
    }
  }, [forId, token, onManaging])

  useEffect(() => { if (account && router.isReady) load() }, [account, router.isReady, load])

  const games = useMemo(() => data?.games ?? [], [data])
  const byId = useMemo(() => indexGames(games), [games])
  const lockPassed = !!data?.lockAt && now >= Date.parse(data.lockAt)
  // Before picks open only the admin sees the games: a preview to tap around
  // in, where nothing is saved.
  const preview = data?.status === 'setup'
  const previewRef = useRef(false)
  previewRef.current = preview
  const editable = preview || (!!data?.canEdit && (!lockPassed || !!data?.override))

  // One save at a time; taps made meanwhile go in the next one.
  const flush = useCallback(async () => {
    if (inFlight.current) return
    const p = pending.current
    if (!Object.keys(p.picks).length && p.best5 === undefined && p.titleTotal === undefined) return
    pending.current = emptyPending()
    inFlight.current = true
    setSaving(true)
    try {
      const res = await fetch('/api/bowls/picks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({
          ...(forId ? { for: forId } : {}),
          ...(Object.keys(p.picks).length ? { picks: p.picks } : {}),
          ...(p.best5 !== undefined ? { best5: p.best5 } : {}),
          ...(p.titleTotal !== undefined ? { titleTotal: p.titleTotal } : {}),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not save')
      setSaveFailed(false)
      const more = pending.current
      if (!Object.keys(more.picks).length && more.best5 === undefined && more.titleTotal === undefined) {
        setPicks(json.picks)
        setBest5(json.best5)
      }
    } catch (err) {
      setSaveFailed(true)
      toast.show(err instanceof Error ? err.message : 'Could not save — check your connection', 'error')
      pending.current = emptyPending()
      await load()
    } finally {
      inFlight.current = false
      setSaving(false)
      const more = pending.current
      if (Object.keys(more.picks).length || more.best5 !== undefined || more.titleTotal !== undefined) flush()
    }
  }, [forId, token, toast, load])

  // Picks and stars save the moment you tap (like NFL picks); the total waits
  // for you to stop typing.
  const queue = useCallback((delay = 0) => {
    if (previewRef.current) { pending.current = emptyPending(); return }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, delay)
  }, [flush])

  const choose = (game: BowlGame, team: BowlTeam) => {
    if (!editable || picks[game.id] === team.id) return
    const { picks: next, cleared } = cleanPicks(games, { ...picks, [game.id]: team.id })
    setPicks(next)
    pending.current.picks[game.id] = team.id
    for (const id of cleared) pending.current.picks[id] = null
    // A star stays only on a picked game, so it comes off with a cleared pick.
    const unstarred = best5.filter(id => cleared.includes(id))
    if (unstarred.length) {
      const nextBest = best5.filter(id => !cleared.includes(id))
      setBest5(nextBest)
      pending.current.best5 = nextBest
    }
    if (cleared.length) {
      toast.show(`That changes your bracket — ${cleared.length} later playoff ${cleared.length === 1 ? 'pick was' : 'picks were'} cleared${unstarred.length ? ` (and ${unstarred.length === 1 ? 'its' : 'their'} Best 5 ${unstarred.length === 1 ? 'star' : 'stars'})` : ''}. Pick ${cleared.length === 1 ? 'it' : 'them'} again.`, 'info')
    }
    queue()
  }

  const toggleStar = (game: BowlGame) => {
    if (!editable) return
    const has = best5.includes(game.id)
    // Like Best 3: pick the game first, then star it.
    if (!has && !picks[game.id]) {
      toast.show('Pick a team in that game first, then star it.', 'info')
      return
    }
    if (!has && best5.length >= 5) {
      toast.show('You have your Best 5 — unstar one to swap it out.', 'info')
      return
    }
    const next = has ? best5.filter(id => id !== game.id) : [...best5, game.id]
    setBest5(next)
    pending.current.best5 = next
    queue()
  }

  const changeTotal = (text: string) => {
    const clean = text.replace(/[^0-9]/g, '').slice(0, 3)
    setTotal(clean)
    pending.current.titleTotal = clean === '' ? null : Math.min(250, parseInt(clean, 10))
    queue(700)
  }

  // Save anything waiting before the page goes away — or the app goes to the
  // background, where a phone may never come back to it.
  useEffect(() => {
    const now = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; flush() } }
    const onHide = () => { if (document.visibilityState === 'hidden') now() }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', now)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', now)
      now()
    }
  }, [flush])

  if (loading || !account || (!data && !error)) {
    return (
      <div className="min-h-screen bg-zinc-950">
        <BowlHeader subtitle="My Picks" />
        <main className="max-w-3xl mx-auto px-4 py-6 space-y-3">
          <PlayerTabs managing={managing} forId={forId} />
          <div className="skeleton h-14 rounded-2xl" />
          {[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-28 rounded-2xl" />)}
        </main>
      </div>
    )
  }

  const titleGame = games.find(g => g.phase === 'title')
  const sections = pickSections(games)
  const prog = progress(games, picks, best5, total === '' ? null : Number(total))
  const left = data?.lockAt ? countdown(data.lockAt, now) : null
  const firstName = data?.player?.name.split(' ')[0] ?? ''
  // A managed player's page reads like your own, in their name.
  const asManager = !!data?.managed

  const message = (icon: string, title: string, body?: React.ReactNode) => (
    <div className="glass-card rounded-2xl p-6 text-center">
      <p className="text-3xl mb-2">{icon}</p>
      <p className="text-white font-medium">{title}</p>
      {body && <div className="text-sm text-zinc-400 mt-2">{body}</div>}
    </div>
  )

  return (
    <div className="min-h-screen bg-zinc-950 pb-16">
      <BowlHeader subtitle={data?.proxy ? `Picks for ${data.player?.name}` : 'My Picks'}>
      {data && data.inSeason && games.length > 0 && (
        <div className="border-t border-white/[0.06]">
          <div className="max-w-3xl mx-auto px-4 py-2 flex items-center gap-2 text-[11px]">
            <span className={`font-semibold px-2 py-1 rounded-full ${prog.picked === prog.total ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/[0.06] text-zinc-200'}`}>
              {prog.picked}/{prog.total} picks
            </span>
            <span className={`font-semibold px-2 py-1 rounded-full ${prog.best5 === prog.best5Needed ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/[0.06] text-zinc-200'}`}>
              ★ {prog.best5}/{prog.best5Needed}
            </span>
            {prog.needsTotal && (
              <span className={`font-semibold px-2 py-1 rounded-full ${prog.hasTotal ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/[0.06] text-zinc-200'}`}>
                Total {prog.hasTotal ? '✓' : '—'}
              </span>
            )}
            <span className="ml-auto text-zinc-500 truncate" aria-live="polite">
              {preview ? 'Preview' : saving ? 'Saving…' : saveFailed ? 'Not saved' : editable && left ? `Due in ${left}` : lockPassed ? 'Locked' : ''}
            </span>
          </div>
        </div>
      )}
      </BowlHeader>

      <main className="max-w-3xl mx-auto px-4 py-4 space-y-3 animate-fade-in">
        <PlayerTabs managing={managing} forId={forId} />
        {error ? message('⚠️', error) : !data ? null : !data.inSeason ? (
          message('🏆', "You're not in this year's Bowl Pick'em yet", <Link href="/bowls" className="text-yellow-400 hover:text-yellow-300">Go to the Bowl Pick&apos;em home to join</Link>)
        ) : games.length === 0 ? (
          message('🗓️', "Picks aren't open yet", 'They open once the College Football Playoff field is set on Selection Sunday. All picks are due at the first kickoff.')
        ) : (
          <>
            {asManager && (
              <div className="rounded-2xl px-4 py-2.5 bg-sky-500/10 border border-sky-500/20 flex items-center gap-2 text-sm text-sky-200">
                <span aria-hidden>👤</span>
                <span>Picking for <strong>{data.player?.name}</strong></span>
              </div>
            )}
            {data.proxy && !asManager && (
              <div className="rounded-2xl px-4 py-3 bg-yellow-500/10 border border-yellow-500/25 flex items-center gap-3">
                <p className="flex-1 text-sm text-yellow-100">
                  Entering picks for <strong>{data.player?.name}</strong>
                  {lockPassed && <span className="block text-xs text-yellow-200/80 mt-0.5">Picks are locked — you&apos;re changing them after the deadline.</span>}
                </p>
                <Link href="/bowls/admin" className="shrink-0 text-xs font-semibold text-yellow-300 hover:text-yellow-200">Done</Link>
              </div>
            )}
            {data.status === 'setup' && (
              <div className="rounded-2xl px-4 py-3 bg-white/[0.04] border border-white/[0.08] text-sm text-zinc-300">
                Preview — picks aren&apos;t open yet, and players can&apos;t see these games. Tap around all you like: nothing here is saved.
              </div>
            )}
            {(!data.proxy || asManager) && data.status !== 'setup' && (
              lockPassed && !(asManager && data.override) ? (
                <div className="rounded-2xl px-4 py-3 bg-white/[0.04] border border-white/[0.08] text-sm text-zinc-300">
                  🔒 Picks locked {data.lockAt ? lockText(data.lockAt) : ''}. Here are {asManager ? `${firstName}'s` : 'yours'} — <Link href="/bowls/all-picks" className="font-semibold text-yellow-500 hover:text-yellow-400">see everyone&apos;s in All Picks</Link>.
                </div>
              ) : lockPassed ? (
                <div className="rounded-2xl px-4 py-3 bg-yellow-500/10 border border-yellow-500/25 text-sm text-yellow-100">
                  Picks are locked — you&apos;re changing {firstName}&apos;s after the deadline.
                </div>
              ) : prog.complete ? (
                <div className="rounded-2xl px-4 py-3 bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-200">
                  {asManager
                    ? <>✓ {firstName}&apos;s picks are all in. You can change anything until {data.lockAt ? lockText(data.lockAt) : 'the first kickoff'}.</>
                    : <>✓ Your picks are all in, {firstName}. You can change anything until {data.lockAt ? lockText(data.lockAt) : 'the first kickoff'}.</>}
                </div>
              ) : (
                <div className="rounded-2xl px-4 py-3 bg-gradient-to-br from-yellow-500/[0.10] to-transparent border border-yellow-500/25 text-sm text-zinc-200">
                  Pick every game, star your <strong>Best 5</strong> and guess the title game&apos;s total. All picks are due{' '}
                  <strong>{data.lockAt ? lockText(data.lockAt) : 'at the first kickoff'}</strong>.
                </div>
              )
            )}
            {!!data.enteredByAdmin && !data.proxy && (
              <p className="text-xs text-zinc-500 px-1">The bowl admin entered {data.enteredByAdmin} of these picks for you.</p>
            )}

            <Best5Summary games={games} best5={best5} whose={data.proxy ? `${firstName}'s` : 'Your'} />

            {sections.length > 1 && (
              <nav aria-label="Phases" className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4 pt-1">
                {sections.map(sec => {
                  const done = sec.games.filter(g => picks[g.id]).length
                  return (
                    <a key={sec.key} href={`#phase-${sec.key}`}
                      className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition ${done === sec.games.length ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-white/[0.08] bg-white/[0.04] text-zinc-300 hover:text-white'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${PHASE_TONE[sec.key].dot}`} />
                      {sec.short}<span className="tabular-nums text-zinc-400 font-medium">{done}/{sec.games.length}</span>
                    </a>
                  )
                })}
              </nav>
            )}

            {sections.map(sec => {
              const done = sec.games.filter(g => picks[g.id]).length
              return (
                <section key={sec.key} id={`phase-${sec.key}`} aria-label={sec.title} className="pt-3 scroll-mt-[150px]">
                  <div className="flex items-baseline gap-2 mb-2 px-1">
                    <span className={`w-2 h-2 rounded-full self-center ${PHASE_TONE[sec.key].dot}`} />
                    <h2 className="text-sm font-bold text-white">{sec.title}</h2>
                    <span className="text-[11px] text-zinc-500">{sec.points}</span>
                    <span className="ml-auto text-[11px] text-zinc-400 tabular-nums">{done}/{sec.games.length}</span>
                  </div>
                  {sec.rounds.map(r => (
                    <div key={r.key} className="space-y-2 mb-3">
                      {r.label && (
                        <p className="flex items-baseline gap-2 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider px-1 pt-1">
                          {r.label}<span className="normal-case tracking-normal font-normal text-zinc-600">{r.points}</span>
                        </p>
                      )}
                      {r.games.map(g => (
                        <GameCard key={g.id} game={g} byId={byId} picks={picks}
                          starred={best5.includes(g.id)} editable={editable}
                          onPick={t => choose(g, t)} onStar={() => toggleStar(g)} />
                      ))}
                      {r.key === 'title' && titleGame && (
                        <div className="glass-card rounded-2xl p-3 flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-white">Total points in the title game</p>
                            <p className="text-[11px] text-zinc-500 mt-0.5">The last tiebreaker: closest guess wins. On an equal miss, the guess under wins.</p>
                          </div>
                          <input value={total} onChange={e => changeTotal(e.target.value)} disabled={!editable}
                            inputMode="numeric" pattern="[0-9]*" placeholder="—" aria-label="Total points in the title game"
                            className="w-20 shrink-0 text-center text-lg font-bold px-2 py-2 bg-white/[0.04] border border-white/[0.1] rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-yellow-500/40 disabled:opacity-60" />
                        </div>
                      )}
                    </div>
                  ))}
                </section>
              )
            })}

            <div className="pt-4"><BowlRules /></div>
          </>
        )}
      </main>
    </div>
  )
}

function Best5Summary({ games, best5, whose }: { games: BowlGame[]; best5: string[]; whose: string }) {
  const names = best5.map(id => games.find(g => g.id === id)).filter(Boolean) as BowlGame[]
  return (
    <div className="glass-card rounded-2xl px-4 py-3">
      <p className="text-sm font-semibold text-white">★ {whose} Best 5 <span className="text-zinc-500 font-normal">· {names.length} of 5</span></p>
      <p className="text-xs text-zinc-400 mt-1">
        {names.length
          ? names.map(g => g.playoff_round === 'first' ? `${g.away?.name ?? 'TBD'}–${g.home?.name ?? 'TBD'}` : g.name).join(' · ')
          : 'Pick a game, then tap its star — any five games. Your Best 5 record is the first tiebreaker, and empty spots count as losses.'}
      </p>
    </div>
  )
}

/**
 * My Picks | 👤 Dani | 👤 Maddie — for someone who makes a managed player's
 * picks. Hidden while the admin has someone else's picks open.
 */
function PlayerTabs({ managing, forId }: { managing: Managed[]; forId?: string }) {
  const router = useRouter()
  if (!managing.length || (forId && !managing.some(m => m.id === forId))) return null
  const go = (id?: string) => {
    if (id === forId) return
    router.replace({ pathname: '/bowls/picks', query: id ? { for: id } : {} }, undefined, { shallow: true })
  }
  const tab = (on: boolean, managed: boolean) => `press shrink-0 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-full transition whitespace-nowrap ${on
    ? managed ? 'bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/30' : 'bg-white/[0.10] text-white'
    : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'}`
  return (
    <div role="tablist" aria-label="Whose picks" className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4">
      <button type="button" role="tab" aria-selected={!forId} onClick={() => go()} className={tab(!forId, false)}>My Picks</button>
      {managing.map(m => (
        <button key={m.id} type="button" role="tab" aria-selected={forId === m.id} onClick={() => go(m.id)} className={tab(forId === m.id, true)}>
          <span aria-hidden className="text-xs">👤</span>{m.name}
        </button>
      ))}
    </div>
  )
}

/** What a bracket slot says before you've picked the game that fills it. */
function feederText(feeder: BowlGame | undefined, byId: Map<string, BowlGame>, picks: PickMap): string {
  if (!feeder) return 'TBD'
  if (feeder.playoff_round === 'first' || !feeder.playoff_round) {
    const [a, h] = optionsFor(feeder, byId, picks)
    return `${a?.name ?? 'TBD'} / ${h?.name ?? 'TBD'} winner`
  }
  const bowl = feeder.name.includes(' · ') ? feeder.name.split(' · ').pop() : feeder.name
  return `Your ${bowl} winner`
}

function GameCard({ game, byId, picks, starred, editable, onPick, onStar }: {
  game: BowlGame
  byId: Map<string, BowlGame>
  picks: PickMap
  starred: boolean
  editable: boolean
  onPick: (t: BowlTeam) => void
  onStar: () => void
}) {
  const options = optionsFor(game, byId, picks)
  const picked = picks[game.id]
  const decided = game.status === 'final' && game.winner_team_id
  return (
    <div className={`glass-card rounded-2xl p-3 ${picked ? '' : 'ring-1 ring-inset ring-white/[0.04]'}`} data-game={game.id}>
      <div className="flex items-start gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{game.name}</p>
          <p className="text-[11px] text-zinc-500 truncate">
            {kickoffText(game.kickoff_time, game.time_tbd)}{game.tv ? ` · ${game.tv}` : ''}
            {game.status === 'final' && game.away_score !== null && ` · Final ${game.away_score}–${game.home_score}`}
          </p>
        </div>
        <button onClick={onStar} disabled={(!editable || !picks[game.id]) && !starred} aria-pressed={starred}
          aria-label={starred ? `Remove ${game.name} from your Best 5` : `Add ${game.name} to your Best 5`}
          title={!starred && !picks[game.id] ? 'Pick a team first' : undefined}
          className={`shrink-0 w-8 h-8 -mr-1 -mt-1 rounded-full flex items-center justify-center text-lg transition ${starred ? 'text-yellow-400' : 'text-zinc-600 hover:text-zinc-300'} disabled:cursor-default`}>
          {starred ? '★' : '☆'}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(['away', 'home'] as const).map((side, i) => {
          const team = options[i]
          if (!team) {
            const from = side === 'away' ? game.away_from : game.home_from
            return (
              <div key={side} className="rounded-xl border border-dashed border-white/[0.1] px-2.5 py-2.5 min-h-[52px] flex flex-col justify-center">
                <p className="text-xs text-zinc-400 leading-tight">{from ? feederText(byId.get(from), byId, picks) : 'TBD'}</p>
                {from && <p className="text-[10px] text-zinc-600 mt-0.5">Pick that game first</p>}
              </div>
            )
          }
          const selected = picked === team.id
          const right = decided && selected && game.winner_team_id === team.id
          const wrong = decided && selected && game.winner_team_id !== team.id
          return (
            <button key={side} onClick={() => onPick(team)} disabled={!editable} aria-pressed={selected}
              aria-label={`Pick ${fullTeamName(team)}`}
              className={`press relative flex items-center gap-2 rounded-xl px-2.5 py-2.5 min-h-[52px] text-left border transition disabled:cursor-default ${selected
                ? right ? 'bg-emerald-500/15 border-emerald-500/50' : wrong ? 'bg-red-500/10 border-red-500/40' : 'bg-yellow-500/15 border-yellow-500/60 ring-1 ring-yellow-500/30'
                : `bg-white/[0.03] border-white/[0.06] ${editable ? 'hover:bg-white/[0.06]' : 'opacity-60'}`}`}>
              <TeamLogo team={team} size={30} />
              <span className="min-w-0 flex-1">
                <TeamName team={team} nickname className="block text-[13px] leading-snug text-white line-clamp-2" />
                {team.record && <span className="block text-[11px] text-zinc-500">{team.record}</span>}
              </span>
              {selected && (
                <span className={`absolute top-1.5 right-1.5 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center ${right ? 'bg-emerald-500 text-white' : wrong ? 'bg-red-500 text-white' : 'bg-yellow-500 text-zinc-950'}`}>
                  {wrong ? '✗' : '✓'}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
