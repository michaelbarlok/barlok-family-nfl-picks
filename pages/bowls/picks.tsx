import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { useBowlAuth } from '@/lib/bowls/auth'
import { PHASES, type BowlGame, type BowlTeam } from '@/lib/bowls/sheet'
import { cleanPicks, indexGames, optionsFor, progress, type PickMap } from '@/lib/bowls/bracket'
import { countdown, kickoffText, lockText, pointsText } from '@/lib/bowls/format'
import { useToast } from '@/components/Toast'
import BowlHeader from '@/components/bowls/BowlHeader'
import BowlRules from '@/components/bowls/BowlRules'
import { PHASE_TONE, TeamLogo } from '@/components/bowls/ui'

interface SheetData {
  season: number
  status: 'setup' | 'open' | 'locked' | 'complete'
  lockAt: string | null
  inSeason: boolean
  player?: { id: string; name: string }
  proxy?: boolean
  canEdit?: boolean
  games: BowlGame[]
  picks?: PickMap
  best5?: string[]
  titleTotal?: number | null
  enteredByAdmin?: number
}

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
 * The bowl admin can open someone's sheet (?for=) to enter picks they sent in.
 */
export default function BowlPicks() {
  const router = useRouter()
  const forId = typeof router.query.for === 'string' ? router.query.for : undefined
  const { loading, account, isAdmin, token } = useBowlAuth()
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
      if (!res.ok) throw new Error(json.error ?? 'Could not load the sheet')
      setData(json)
      setPicks(json.picks ?? {})
      setBest5(json.best5 ?? [])
      setTotal(json.titleTotal == null ? '' : String(json.titleTotal))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the sheet')
    }
  }, [forId, token])

  useEffect(() => { if (account && router.isReady) load() }, [account, router.isReady, load])

  const games = useMemo(() => data?.games ?? [], [data])
  const byId = useMemo(() => indexGames(games), [games])
  const lockPassed = !!data?.lockAt && now >= Date.parse(data.lockAt)
  const editable = !!data?.canEdit && (!lockPassed || !!data?.proxy)

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

  const queue = useCallback((delay = 250) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, delay)
  }, [flush])

  const choose = (game: BowlGame, team: BowlTeam) => {
    if (!editable || picks[game.id] === team.id) return
    const { picks: next, cleared } = cleanPicks(games, { ...picks, [game.id]: team.id })
    setPicks(next)
    pending.current.picks[game.id] = team.id
    for (const id of cleared) pending.current.picks[id] = null
    if (cleared.length) {
      toast.show(`That changes your bracket — ${cleared.length} later playoff ${cleared.length === 1 ? 'pick was' : 'picks were'} cleared. Pick ${cleared.length === 1 ? 'it' : 'them'} again.`, 'info')
    }
    queue()
  }

  const toggleStar = (game: BowlGame) => {
    if (!editable) return
    const has = best5.includes(game.id)
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

  // Save anything waiting before the page goes away.
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); flush() } }, [flush])

  if (loading || !account || (!data && !error)) {
    return (
      <div className="min-h-screen bg-surface">
        <BowlHeader subtitle="My Picks" />
        <main className="max-w-3xl mx-auto px-4 py-6 space-y-3">
          <div className="skeleton h-14 rounded-2xl" />
          {[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-28 rounded-2xl" />)}
        </main>
      </div>
    )
  }

  const titleGame = games.find(g => g.phase === 'title')
  const prog = progress(games, picks, best5, total === '' ? null : Number(total))
  const left = data?.lockAt ? countdown(data.lockAt, now) : null
  const firstName = data?.player?.name.split(' ')[0] ?? ''

  const message = (icon: string, title: string, body?: React.ReactNode) => (
    <div className="glass-card rounded-2xl p-6 text-center">
      <p className="text-3xl mb-2">{icon}</p>
      <p className="text-white font-medium">{title}</p>
      {body && <div className="text-sm text-slate-400 mt-2">{body}</div>}
    </div>
  )

  return (
    <div className="min-h-screen bg-surface pb-16">
      <BowlHeader subtitle={data?.proxy ? `Picks for ${data.player?.name}` : 'My Picks'}>
      {data && data.inSeason && games.length > 0 && (
        <div className="border-t border-white/[0.06]">
          <div className="max-w-3xl mx-auto px-4 py-2 flex items-center gap-2 text-[11px]">
            <span className={`font-semibold px-2 py-1 rounded-full ${prog.picked === prog.total ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/[0.06] text-slate-200'}`}>
              {prog.picked}/{prog.total} picks
            </span>
            <span className={`font-semibold px-2 py-1 rounded-full ${prog.best5 === prog.best5Needed ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/[0.06] text-slate-200'}`}>
              ★ {prog.best5}/{prog.best5Needed}
            </span>
            {prog.needsTotal && (
              <span className={`font-semibold px-2 py-1 rounded-full ${prog.hasTotal ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/[0.06] text-slate-200'}`}>
                Total {prog.hasTotal ? '✓' : '—'}
              </span>
            )}
            <span className="ml-auto text-slate-500 truncate" aria-live="polite">
              {saving ? 'Saving…' : saveFailed ? 'Not saved' : editable && left ? `Due in ${left}` : lockPassed ? 'Locked' : ''}
            </span>
          </div>
        </div>
      )}
      </BowlHeader>

      <main className="max-w-3xl mx-auto px-4 py-4 space-y-3 animate-fade-in">
        {error ? message('⚠️', error) : !data ? null : !data.inSeason ? (
          message('🏆', "You're not in this year's Bowl Pick'em yet", <Link href="/bowls" className="text-amber-400 hover:text-amber-300">Go to the Bowl Pick&apos;em home to join</Link>)
        ) : games.length === 0 ? (
          message('📋', "The pick sheet isn't out yet", 'It comes out once the College Football Playoff field is set on Selection Sunday. All picks are due at the first kickoff.')
        ) : (
          <>
            {data.proxy && (
              <div className="rounded-2xl px-4 py-3 bg-amber-500/10 border border-amber-500/25 flex items-center gap-3">
                <p className="flex-1 text-sm text-amber-100">
                  Entering picks for <strong>{data.player?.name}</strong>
                  {lockPassed && <span className="block text-xs text-amber-200/80 mt-0.5">Picks are locked — you&apos;re changing them after the deadline.</span>}
                </p>
                <Link href="/bowls/admin" className="shrink-0 text-xs font-semibold text-amber-300 hover:text-amber-200">Done</Link>
              </div>
            )}
            {data.status === 'setup' && (
              <div className="rounded-2xl px-4 py-3 bg-white/[0.04] border border-white/[0.08] text-sm text-slate-300">
                Preview — picks aren&apos;t open yet, and players can&apos;t see the sheet.
              </div>
            )}
            {!data.proxy && data.status !== 'setup' && (
              lockPassed ? (
                <div className="rounded-2xl px-4 py-3 bg-white/[0.04] border border-white/[0.08] text-sm text-slate-300">
                  🔒 Picks locked {data.lockAt ? lockText(data.lockAt) : ''}. Here&apos;s your sheet.
                </div>
              ) : prog.complete ? (
                <div className="rounded-2xl px-4 py-3 bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-200">
                  ✓ Your sheet is complete, {firstName}. You can change anything until {data.lockAt ? lockText(data.lockAt) : 'the first kickoff'}.
                </div>
              ) : (
                <div className="rounded-2xl px-4 py-3 bg-gradient-to-br from-amber-600/20 to-orange-700/10 border border-amber-500/20 text-sm text-amber-100">
                  Pick every game, star your <strong>Best 5</strong> and guess the title game&apos;s total. All picks are due{' '}
                  <strong>{data.lockAt ? lockText(data.lockAt) : 'at the first kickoff'}</strong>.
                </div>
              )
            )}
            {!!data.enteredByAdmin && !data.proxy && (
              <p className="text-xs text-slate-500 px-1">The bowl admin entered {data.enteredByAdmin} of these picks for you.</p>
            )}

            <Best5Summary games={games} best5={best5} />

            {PHASES.map(p => {
              const list = games.filter(g => g.phase === p.key)
              if (!list.length) return null
              const done = list.filter(g => picks[g.id]).length
              const sub = p.key === 'playoff'
                ? [['First round', list.filter(g => g.playoff_round === 'first')], ['Quarterfinals', list.filter(g => g.playoff_round !== 'first')]] as const
                : [[null, list]] as const
              return (
                <section key={p.key} aria-label={p.label} className="pt-3">
                  <div className="flex items-baseline gap-2 mb-2 px-1">
                    <span className={`w-2 h-2 rounded-full self-center ${PHASE_TONE[p.key].dot}`} />
                    <h2 className="text-sm font-bold text-white">
                      {p.key === 'semi' || p.key === 'title' ? p.label : `${p.tag} · ${p.label}`}
                    </h2>
                    <span className="text-[11px] text-slate-500">{p.key === 'semi' ? '3 points each' : p.key === 'title' ? '3 points' : pointsText(p.points)}</span>
                    <span className="ml-auto text-[11px] text-slate-400 tabular-nums">{done}/{list.length}</span>
                  </div>
                  {sub.map(([label, gs]) => gs.length > 0 && (
                    <div key={label ?? 'all'} className="space-y-2 mb-3">
                      {label && <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-1 pt-1">{label}</p>}
                      {gs.map(g => (
                        <GameCard key={g.id} game={g} byId={byId} picks={picks}
                          starred={best5.includes(g.id)} editable={editable}
                          onPick={t => choose(g, t)} onStar={() => toggleStar(g)} />
                      ))}
                    </div>
                  ))}
                  {p.key === 'title' && titleGame && (
                    <div className="glass-card rounded-2xl p-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white">Total points in the title game</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">The last tiebreaker: closest guess wins. On an equal miss, the guess under wins.</p>
                      </div>
                      <input value={total} onChange={e => changeTotal(e.target.value)} disabled={!editable}
                        inputMode="numeric" pattern="[0-9]*" placeholder="—" aria-label="Total points in the title game"
                        className="w-20 shrink-0 text-center text-lg font-bold px-2 py-2 bg-white/[0.04] border border-white/[0.1] rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/40 disabled:opacity-60" />
                    </div>
                  )}
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

function Best5Summary({ games, best5 }: { games: BowlGame[]; best5: string[] }) {
  const names = best5.map(id => games.find(g => g.id === id)).filter(Boolean) as BowlGame[]
  return (
    <div className="glass-card rounded-2xl px-4 py-3">
      <p className="text-sm font-semibold text-white">★ Your Best 5 <span className="text-slate-500 font-normal">· {names.length} of 5</span></p>
      <p className="text-xs text-slate-400 mt-1">
        {names.length
          ? names.map(g => g.playoff_round === 'first' ? `${g.away?.name ?? 'TBD'}–${g.home?.name ?? 'TBD'}` : g.name).join(' · ')
          : 'Tap the star on any five games — your Best 5 record is the first tiebreaker.'}
      </p>
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
          <p className="text-[11px] text-slate-500 truncate">
            {kickoffText(game.kickoff_time, game.time_tbd)}{game.tv ? ` · ${game.tv}` : ''}
            {game.status === 'final' && game.away_score !== null && ` · Final ${game.away_score}–${game.home_score}`}
          </p>
        </div>
        <button onClick={onStar} disabled={!editable && !starred} aria-pressed={starred}
          aria-label={starred ? `Remove ${game.name} from your Best 5` : `Add ${game.name} to your Best 5`}
          className={`shrink-0 w-8 h-8 -mr-1 -mt-1 rounded-full flex items-center justify-center text-lg transition ${starred ? 'text-amber-400' : 'text-slate-600 hover:text-slate-300'} disabled:cursor-default`}>
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
                <p className="text-xs text-slate-400 leading-tight">{from ? feederText(byId.get(from), byId, picks) : 'TBD'}</p>
                {from && <p className="text-[10px] text-slate-600 mt-0.5">Pick that game first</p>}
              </div>
            )
          }
          const selected = picked === team.id
          const right = decided && selected && game.winner_team_id === team.id
          const wrong = decided && selected && game.winner_team_id !== team.id
          return (
            <button key={side} onClick={() => onPick(team)} disabled={!editable} aria-pressed={selected}
              aria-label={`Pick ${team.name}`}
              className={`press relative flex items-center gap-2 rounded-xl px-2.5 py-2.5 min-h-[52px] text-left border transition disabled:cursor-default ${selected
                ? right ? 'bg-emerald-500/15 border-emerald-500/50' : wrong ? 'bg-red-500/10 border-red-500/40' : 'bg-amber-500/15 border-amber-500/60 ring-1 ring-amber-500/30'
                : `bg-white/[0.03] border-white/[0.06] ${editable ? 'hover:bg-white/[0.06]' : 'opacity-60'}`}`}>
              <TeamLogo team={team} size={30} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-white truncate">
                  {team.rank && <span className="text-[10px] font-semibold text-slate-400 mr-1">#{team.rank}</span>}
                  {team.name}
                </span>
                {team.record && <span className="block text-[11px] text-slate-500">{team.record}</span>}
              </span>
              {selected && (
                <span className={`absolute top-1.5 right-1.5 w-4 h-4 rounded-full text-[9px] text-white flex items-center justify-center ${right ? 'bg-emerald-500' : wrong ? 'bg-red-500' : 'bg-amber-500'}`}>
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
