import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { useBowlAuth } from '@/lib/bowls/auth'
import { pickSections, type BowlGame, type BowlTeam, type PickSection, type SectionKey } from '@/lib/bowls/sheet'
import { isDecided } from '@/lib/bowls/scoring'
import { cleanPicks, indexGames, optionsFor, progress, type PickMap } from '@/lib/bowls/bracket'
import { countdown, kickoffText, lockText } from '@/lib/bowls/format'
import { useToast } from '@/components/Toast'
import BowlHeader from '@/components/bowls/BowlHeader'
import BowlRules from '@/components/bowls/BowlRules'
import { PHASE_TONE, TeamLogo, TeamName, fullTeamName } from '@/components/bowls/ui'
import { LiveTag } from '@/components/bowls/live'
import { scoreOf, type BowlLive } from '@/lib/bowls/live'
import { useBowlLive } from '@/lib/bowls/useBowlLive'

interface SheetData {
  season: number
  status: 'setup' | 'open' | 'locked' | 'complete'
  lockAt: string | null
  inSeason: boolean
  player?: { id: string; name: string }
  proxy?: boolean
  /** Sample teams are on — a preview everyone in the season can try. */
  sample?: boolean
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
  // Once games are being played, each card shows its live score.
  const live = useBowlLive(data?.status === 'locked' ? games : undefined)

  // One phase at a time, by tab. Opens where you left off — the first phase
  // with a game still to pick — or, once picks lock, on the phase being
  // played. A link can ask for one (?phase=).
  const sections = useMemo(() => pickSections(games), [games])
  const [phaseTab, setPhaseTab] = useState<SectionKey | null>(null)
  useEffect(() => {
    if (phaseTab || !data || !sections.length) return
    const asked = router.query.phase
    if (typeof asked === 'string' && sections.some(sec => sec.key === asked)) { setPhaseTab(asked as SectionKey); return }
    if (data.status === 'setup' || data.status === 'open') {
      setPhaseTab((sections.find(sec => sec.games.some(g => !picks[g.id])) ?? sections[0]).key)
      return
    }
    const next = [...games].filter(g => !isDecided(g) && g.kickoff_time).sort((a, b) => a.kickoff_time!.localeCompare(b.kickoff_time!))[0]
    setPhaseTab((next && sections.find(sec => sec.games.some(g => g.id === next.id))?.key) ?? sections[sections.length - 1].key)
  }, [phaseTab, data, sections, games, picks, router.query.phase])
  const chooseTab = (key: SectionKey) => {
    setPhaseTab(key)
    router.replace({ pathname: router.pathname, query: { ...router.query, phase: key } }, undefined, { shallow: true, scroll: false })
    // Start the phase from its top, just under the pinned header.
    requestAnimationFrame(() => {
      const el = document.getElementById('phase-panel')
      if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' })
    })
  }
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
  const tab = sections.find(sec => sec.key === phaseTab) ?? sections[0]
  // From the Best 5 list: open the game's phase and bring the game into view.
  const openGame = (id: string) => {
    const sec = sections.find(x => x.games.some(g => g.id === id))
    if (sec && sec.key !== tab?.key) chooseTab(sec.key)
    setTimeout(() => document.querySelector(`[data-game="${id}"]`)?.scrollIntoView({ block: 'center' }), 80)
  }
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
          {sections.length > 1 && tab && (
            <div className="max-w-3xl mx-auto px-4 pb-2.5">
              <PhaseTabs sections={sections} current={tab.key} picks={picks} onChange={chooseTab} />
            </div>
          )}
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
              data.sample ? (
                <div className="rounded-2xl px-4 py-3 bg-sky-500/10 border border-sky-500/20 text-sm text-sky-100">
                  <strong>Preview with sample teams.</strong> These are last season&apos;s bowl matchups, to show how the pick&apos;em works —
                  tap around all you like: nothing here is saved. Real picks open once the playoff field is set on Selection Sunday.
                </div>
              ) : (
                <div className="rounded-2xl px-4 py-3 bg-white/[0.04] border border-white/[0.08] text-sm text-zinc-300">
                  Preview — picks aren&apos;t open yet, and players can&apos;t see these games. Tap around all you like: nothing here is saved.
                </div>
              )
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

            <Best5Summary games={games} byId={byId} picks={picks} best5={best5} whose={data.proxy ? `${firstName}'s` : 'Your'} onOpen={openGame} />

            {tab && (() => {
              const done = tab.games.filter(g => picks[g.id]).length
              const [tag, name] = tab.title.includes(' · ') ? tab.title.split(' · ') : [tab.short, tab.title]
              const i = sections.findIndex(sec => sec.key === tab.key)
              const nextSec = sections[i + 1]
              const unfinished = sections.filter(sec => sec.key !== tab.key && sec.games.some(g => !picks[g.id]))
              return (
                <section id="phase-panel" aria-label={tab.title} className="space-y-4 pt-1 scroll-mt-[190px]">
                  {/* The phase, set apart: its color, its points, how far along you are. */}
                  <div className={`rounded-2xl border p-4 ${PHASE_TONE[tab.key].panel}`}>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className={`text-[11px] font-bold uppercase tracking-wider ${PHASE_TONE[tab.key].text}`}>{tag}</p>
                        <h2 className="text-xl font-extrabold text-white leading-tight">{name}</h2>
                        <p className="text-xs text-zinc-300 mt-0.5">{tab.points}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-2xl font-extrabold text-white tabular-nums leading-none">{done}<span className="text-base text-zinc-500">/{tab.games.length}</span></p>
                        <p className="text-[10px] text-zinc-400 mt-1">{done === tab.games.length ? '✓ all picked' : 'picked'}</p>
                      </div>
                    </div>
                    <div className="mt-3 h-1.5 rounded-full bg-black/30 overflow-hidden" aria-hidden="true">
                      <div className={`h-full rounded-full ${PHASE_TONE[tab.key].dot} transition-[width] duration-500`} style={{ width: `${(done / Math.max(1, tab.games.length)) * 100}%` }} />
                    </div>
                  </div>

                  {tab.rounds.map(r => (
                    <div key={r.key} className="space-y-3">
                      {r.label && (
                        <div className="flex items-center gap-2 pt-1">
                          <span className={`w-1.5 h-1.5 rounded-full ${PHASE_TONE[r.games[0]?.phase ?? tab.key].dot}`} />
                          <h3 className="text-xs font-bold text-white uppercase tracking-wider">{r.label}</h3>
                          <span className="text-[11px] text-zinc-500">{r.points}</span>
                          <span className="flex-1 h-px bg-white/[0.08]" />
                        </div>
                      )}
                      {r.games.map(g => (
                        <GameCard key={g.id} game={g} byId={byId} picks={picks} live={live.byGameId.get(g.id)}
                          starred={best5.includes(g.id)} editable={editable}
                          onPick={t => choose(g, t)} onStar={() => toggleStar(g)} />
                      ))}
                      {r.key === 'title' && titleGame && (
                        <div className="rounded-2xl border border-white/[0.09] border-l-4 border-l-yellow-500 bg-zinc-900 p-3.5 flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-white">Total points in the title game</p>
                            <p className="text-[11px] text-zinc-500 mt-0.5">The last tiebreaker: closest guess wins. On an equal miss, the guess under wins.</p>
                          </div>
                          <input value={total} onChange={e => changeTotal(e.target.value)} disabled={!editable}
                            inputMode="numeric" pattern="[0-9]*" placeholder="—" aria-label="Total points in the title game"
                            className="w-20 shrink-0 text-center text-lg font-bold px-2 py-2 bg-white/[0.06] border border-white/[0.14] rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-yellow-500/40 disabled:opacity-60" />
                        </div>
                      )}
                    </div>
                  ))}

                  {/* On to the next phase — or what's still to pick. */}
                  {nextSec ? (
                    <button type="button" onClick={() => chooseTab(nextSec.key)}
                      className={`press w-full rounded-2xl border p-4 flex items-center gap-3 text-left transition hover:brightness-110 ${PHASE_TONE[nextSec.key].panel}`}>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[11px] text-zinc-400">Next</span>
                        <span className="block text-sm font-bold text-white truncate">{nextSec.title}</span>
                      </span>
                      <span className="shrink-0 text-xs text-zinc-300 tabular-nums">{nextSec.games.filter(g => picks[g.id]).length}/{nextSec.games.length}</span>
                      <span className="shrink-0 text-lg text-white" aria-hidden="true">→</span>
                    </button>
                  ) : editable && unfinished.length ? (
                    <div className="rounded-2xl border border-white/[0.09] bg-zinc-900 p-4 space-y-2">
                      <p className="text-sm font-semibold text-white">Still to pick</p>
                      <div className="flex flex-wrap gap-2">
                        {unfinished.map(sec => (
                          <button key={sec.key} type="button" onClick={() => chooseTab(sec.key)}
                            className={`press inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold ${PHASE_TONE[sec.key].tab}`}>
                            {sec.short} · {sec.games.filter(g => !picks[g.id]).length} left →
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </section>
              )
            })()}

            <div className="pt-4"><BowlRules /></div>
          </>
        )}
      </main>
    </div>
  )
}

/**
 * Which game a Best 5 pick is, when the team alone doesn't say: a playoff
 * game (a team can win its way through several), or a team that's on the
 * pick'em more than once (Army or Navy in a bowl as well as Army–Navy).
 * "CFP Quarterfinal · Rose Bowl" → "Rose Bowl", "CFP First Round" → "First Round".
 */
function best5Context(game: BowlGame, teamId: string, games: BowlGame[]): string | null {
  const again = games.some(g => g.id !== game.id && g.phase && !g.removed && (g.away?.id === teamId || g.home?.id === teamId))
  if (!game.playoff_round && !again) return null
  const name = game.name.includes(' · ') ? game.name.split(' · ').pop()! : game.name
  return name.replace(/^CFP\s+/, '')
}

/** "★ Your Best 5" — the team you starred in each, with the game when it's needed. Tap one to go to it. */
function Best5Summary({ games, byId, picks, best5, whose, onOpen }: {
  games: BowlGame[]; byId: Map<string, BowlGame>; picks: PickMap; best5: string[]; whose: string; onOpen: (gameId: string) => void
}) {
  const starred = best5.map(id => byId.get(id)).filter(Boolean) as BowlGame[]
  return (
    <div className="glass-card rounded-2xl px-4 py-3">
      <p className="text-sm font-semibold text-white">★ {whose} Best 5 <span className="text-zinc-500 font-normal">· {starred.length} of 5</span></p>
      {starred.length ? (
        <ul aria-label={`${whose} Best 5`} className="flex flex-wrap gap-1.5 mt-2">
          {starred.map(g => {
            const team = optionsFor(g, byId, picks).find(t => t && t.id === picks[g.id]) ?? null
            const context = team ? best5Context(g, team.id, games) : null
            return (
              <li key={g.id} className="min-w-0 max-w-full">
                <button type="button" onClick={() => onOpen(g.id)} title={g.name}
                  className="press max-w-full inline-flex items-center gap-1.5 rounded-full border border-yellow-500/30 bg-yellow-500/10 pl-1 pr-2.5 py-1 text-xs text-yellow-50 hover:bg-yellow-500/15 transition">
                  {team ? <TeamLogo team={team} size={18} /> : <span className="w-[18px] text-center text-yellow-400">★</span>}
                  <span className="truncate">
                    {team ? <span className="font-semibold">{team.name}</span> : g.name}
                    {context && <span className="text-yellow-100/60"> ({context})</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-xs text-zinc-400 mt-1">Pick a game, then tap its star — any five games. Your Best 5 record is the first tiebreaker, and empty spots count as losses.</p>
      )}
    </div>
  )
}

/**
 * Phase 1 · Phase 2 · Phase 3 · Playoff — pinned under the progress bar, all
 * four always in view (even on a small phone), each with how many are picked.
 */
function PhaseTabs({ sections, current, picks, onChange }: { sections: PickSection[]; current: SectionKey; picks: PickMap; onChange: (k: SectionKey) => void }) {
  return (
    <div role="tablist" aria-label="Phase" className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${sections.length}, minmax(0, 1fr))` }}>
      {sections.map(sec => {
        const done = sec.games.filter(g => picks[g.id]).length
        const all = done === sec.games.length
        const on = sec.key === current
        return (
          <button key={sec.key} type="button" role="tab" aria-selected={on} onClick={() => onChange(sec.key)}
            className={`press min-w-0 flex flex-col items-center justify-center rounded-xl border px-1 py-1.5 transition ${on
              ? PHASE_TONE[sec.key].tab
              : 'border-white/[0.08] bg-white/[0.03] text-zinc-400 hover:text-white hover:bg-white/[0.06]'}`}>
            <span className="flex items-center gap-1 text-xs font-semibold whitespace-nowrap">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PHASE_TONE[sec.key].dot}`} />{sec.short}
            </span>
            <span className={`text-[11px] tabular-nums leading-tight ${all ? 'text-emerald-300 font-semibold' : on ? 'text-white/70' : 'text-zinc-500'}`}>{all ? '✓' : `${done}/${sec.games.length}`}</span>
          </button>
        )
      })}
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

function GameCard({ game, byId, picks, live, starred, editable, onPick, onStar }: {
  game: BowlGame
  live?: BowlLive
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
    <div className={`rounded-2xl border border-l-4 ${game.phase ? PHASE_TONE[game.phase].stripe : 'border-l-zinc-600'} bg-zinc-900 p-3 sm:p-3.5 shadow-lg shadow-black/30 ${picked ? 'border-white/[0.10]' : 'border-white/[0.07]'}`} data-game={game.id}>
      <div className="flex items-start gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold text-white truncate">{game.name}</p>
          <p className="text-[11px] text-zinc-400 truncate">
            {!picked && editable && <span className="font-semibold text-amber-300">Pick one · </span>}
            {game.status !== 'final' && live && live.state !== 'pre' ? (() => {
              const sc = scoreOf(game, live)
              return <><LiveTag live={live} /> · <span className="font-semibold text-white tabular-nums">{sc.away ?? 0}–{sc.home ?? 0}</span></>
            })() : <>
              {kickoffText(game.kickoff_time, game.time_tbd)}{game.tv ? ` · ${game.tv}` : ''}
              {game.status === 'final' && game.away_score !== null && ` · Final ${game.away_score}–${game.home_score}`}
            </>}
          </p>
        </div>
        {/* "☆ Best 5" — says what the star is for. After the lock, only your starred games show it. */}
        {(editable || starred) && (
          <button onClick={onStar} disabled={(!editable || !picks[game.id]) && !starred} aria-pressed={starred}
            aria-label={starred ? `Remove ${game.name} from your Best 5` : `Add ${game.name} to your Best 5`}
            title={!starred && !picks[game.id] ? 'Pick a team first' : undefined}
            className={`press shrink-0 -mr-0.5 inline-flex items-center gap-1 rounded-full border pl-1.5 pr-2 py-1 text-[11px] font-semibold whitespace-nowrap transition disabled:cursor-default ${starred
              ? 'bg-yellow-500/15 border-yellow-500/50 text-yellow-300'
              : picks[game.id] ? 'border-white/[0.16] text-zinc-300 hover:text-white hover:border-white/[0.3]' : 'border-white/[0.08] text-zinc-600'}`}>
            <span className={`text-sm leading-none ${starred ? 'text-yellow-400' : ''}`} aria-hidden="true">{starred ? '★' : '☆'}</span>Best 5
          </button>
        )}
      </div>
      <div className="relative grid grid-cols-2 gap-2.5 sm:gap-3">
        <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-zinc-950 border border-white/[0.15] flex items-center justify-center text-[8px] sm:text-[9px] font-bold text-zinc-400">VS</span>
        {(['away', 'home'] as const).map((side, i) => {
          const team = options[i]
          if (!team) {
            const from = side === 'away' ? game.away_from : game.home_from
            return (
              <div key={side} className="rounded-xl border border-dashed border-white/[0.14] bg-white/[0.02] px-2.5 py-2.5 min-h-[56px] flex flex-col justify-center">
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
              className={`press relative flex items-center gap-1.5 sm:gap-2 rounded-xl px-2 sm:px-2.5 py-2.5 min-h-[56px] text-left border transition disabled:cursor-default ${selected
                ? right ? 'bg-emerald-500/15 border-emerald-500/50' : wrong ? 'bg-red-500/10 border-red-500/40' : 'bg-yellow-500/15 border-yellow-500/60 ring-1 ring-yellow-500/30'
                : `bg-white/[0.06] border-white/[0.14] ${editable ? 'hover:bg-white/[0.10] hover:border-white/[0.24]' : 'opacity-60'}`}`}>
              <TeamLogo team={team} size={30} />
              <span className="min-w-0 flex-1">
                <TeamName team={team} nickname className="block text-[13px] leading-snug text-white line-clamp-2 break-words hyphens-auto" />
                {team.record && <span className="block text-[11px] text-zinc-500">{team.record}</span>}
              </span>
              {selected && (
                <span className={`absolute -top-2 -right-2 w-5 h-5 rounded-full ring-2 ring-zinc-900 text-[10px] font-bold flex items-center justify-center ${right ? 'bg-emerald-500 text-white' : wrong ? 'bg-red-500 text-white' : 'bg-yellow-500 text-zinc-950'}`}>
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
