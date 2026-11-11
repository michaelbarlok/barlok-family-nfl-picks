import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { useBowlAuth } from '@/lib/bowls/auth'
import { PHASE_BY_KEY, pickSections, type BowlGame, type BowlTeam, type PickSection, type SectionKey } from '@/lib/bowls/sheet'
import { eliminated, isDecided, pickState, teamDirectory, type PickState, type Standing } from '@/lib/bowls/scoring'
import { kickoffText } from '@/lib/bowls/format'
import BowlHeader, { BowlAvatar } from '@/components/bowls/BowlHeader'
import { PHASE_TONE, TeamLogo, TeamName } from '@/components/bowls/ui'
import {
  Chips, DemoNote, HiddenUntilLock, PlayerChip, ResultsLine, Segmented, UpdateResults,
  firstName, pts, sectionPoints, useBoard, type Board, type BoardPlayer,
} from '@/components/bowls/board'
import { GameCast, LiveTag, PlayFlash } from '@/components/bowls/live'
import { ourSide, scoreOf, type BowlLive } from '@/lib/bowls/live'
import { useBowlLive, useBowlPlays, type PlayEvent } from '@/lib/bowls/useBowlLive'

type View = 'game' | 'grid' | 'player'
type Show = 'all' | 'live' | 'upcoming' | 'final'
type Tab = SectionKey | 'all'
type LiveMap = Map<string, BowlLive>
/** A run of games under one heading: a playoff round, a phase, or "Live now". */
interface Group { key: string; label: string; games: BowlGame[] }
const VIEW_KEY = 'bowls-allpicks-view'
const NAMES_KEY = 'bowls-allpicks-names'
const isView = (v: unknown): v is View => v === 'game' || v === 'grid' || v === 'player'
const isTab = (v: unknown): v is Tab => v === 'all' || v === 'little' || v === 'between' || v === 'big' || v === 'playoff'

/** A player's points in one phase of the pick'em (the playoff counts its semis and title game). */

const STATE_CELL: Record<PickState, string> = {
  won: 'bg-emerald-500/20 border-emerald-500/40',
  lost: 'bg-red-500/15 border-red-500/30',
  dead: 'bg-red-500/10 border-red-500/20',
  pending: 'bg-white/[0.03] border-white/[0.06]',
}

/**
 * All Picks — everyone's pick for every game, once picks lock at the first
 * kickoff. By game, as a grid, or one player at a time, a phase at a time:
 * tabs for Phase 1, 2, 3 and the Playoff (or All), opening on the phase being
 * played. The grid puts you first and keeps each player's points for the
 * phase, their total and their Best 5 record pinned along the bottom.
 *
 * By game, the cards show how the group split — counts and percentages, and
 * your own pick — with everyone's names behind a "Show names" switch (off
 * to start, then remembered on this device), so a full family reads cleanly.
 *
 * While games are on, each card carries the live game cast (score, clock,
 * where the ball is, the last play, a flash for every score) and the live
 * games come first. Results land on their own (the results job), and the
 * page reloads them every few minutes while anything is on.
 */
export default function AllPicks() {
  const router = useRouter()
  const { loading, account, player } = useBowlAuth()
  const { board, error, reload } = useBoard()
  const [show, setShow] = useState<Show>('all')
  // By game: everyone's names on the cards, or just the split. Off to start.
  const [names, setNames] = useState(false)
  useEffect(() => {
    try { setNames(window.localStorage.getItem(NAMES_KEY) === '1') } catch { /* private mode */ }
  }, [])
  const chooseNames = (on: boolean) => {
    setNames(on)
    try { window.localStorage.setItem(NAMES_KEY, on ? '1' : '0') } catch { /* private mode */ }
  }

  // By game, Grid or By player: a link can ask for one (?view=); otherwise
  // your last choice; otherwise cards on a phone and the grid on a wide screen.
  const [view, setView] = useState<View>('game')
  useEffect(() => {
    if (!router.isReady) return
    if (isView(router.query.view)) { setView(router.query.view); return }
    let saved: string | null = null
    try { saved = window.localStorage.getItem(VIEW_KEY) } catch { /* private mode */ }
    setView(isView(saved) ? saved : window.innerWidth >= 1024 ? 'grid' : 'game')
  }, [router.isReady, router.query.view])

  useEffect(() => { if (!loading && !account) router.replace('/bowls/login') }, [loading, account, router])

  const setQuery = (q: Record<string, string>) => router.replace({ pathname: router.pathname, query: { ...router.query, ...q } }, undefined, { shallow: true, scroll: false })

  const live = useBowlLive(board && !board.hidden ? board.games : undefined, reload)
  const plays = useBowlPlays(live.byGameId)
  const isOn = (id: string) => live.byGameId.get(id)?.state === 'in'
  const liveCount = (board?.games ?? []).filter(g => isOn(g.id)).length

  // A phase at a time. Opens on the phase being played: the one with the
  // earliest game still waiting on a result (or the playoff, once it's all done).
  const sections = useMemo(() => pickSections(board?.games ?? []), [board])
  const sectionOf = useMemo(() => {
    const m = new Map<string, SectionKey>()
    for (const sec of sections) for (const g of sec.games) m.set(g.id, sec.key)
    return m
  }, [sections])
  const [tab, setTabState] = useState<Tab | null>(null)
  useEffect(() => {
    if (tab !== null || !board || board.hidden || !sections.length) return
    if (isTab(router.query.phase) && (router.query.phase === 'all' || sections.some(sec => sec.key === router.query.phase))) { setTabState(router.query.phase); return }
    const next = [...(board.games ?? [])].filter(g => !isDecided(g) && g.kickoff_time).sort((a, b) => a.kickoff_time!.localeCompare(b.kickoff_time!))[0]
    setTabState((next && sectionOf.get(next.id)) ?? sections[sections.length - 1].key)
  }, [tab, board, sections, sectionOf, router.query.phase])
  const current: Tab = tab ?? 'all'

  const games = useMemo(() => (board?.games ?? []).filter(g =>
    (current === 'all' || sectionOf.get(g.id) === current)
    && (show === 'all' || (show === 'live' ? live.byGameId.get(g.id)?.state === 'in' : show === 'final' ? isDecided(g) : !isDecided(g)))),
  [board, current, sectionOf, show, live.byGameId])

  // Headings: a phase's rounds (the playoff), or each phase on "All" — and on
  // the cards, whatever's on now comes first under its own heading.
  const groups = useMemo((): Group[] => {
    const keep = new Set(games.map(g => g.id))
    const onNow = view === 'game' ? games.filter(g => live.byGameId.get(g.id)?.state === 'in') : []
    const pinned = new Set(onNow.map(g => g.id))
    const out: Group[] = onNow.length ? [{ key: 'live', label: 'Live now', games: onNow }] : []
    for (const sec of sections) {
      if (current !== 'all' && sec.key !== current) continue
      for (const r of sec.rounds) {
        const list = r.games.filter(g => keep.has(g.id) && !pinned.has(g.id))
        if (!list.length) continue
        const label = current === 'all' ? (r.label ? `${sec.short} · ${r.label}` : sec.title) : r.label
        out.push({ key: `${sec.key}-${r.key}`, label, games: list })
      }
    }
    return out
  }, [games, sections, current, view, live.byGameId])

  const chooseView = (v: View) => {
    setView(v)
    try { window.localStorage.setItem(VIEW_KEY, v) } catch { /* private mode */ }
    setQuery({ view: v })
  }
  const chooseTab = (t: Tab) => { setTabState(t); setQuery({ phase: t }) }

  // Arriving from Today's Games (…#game-<id>): open at that game's card — and
  // stay on it when the live scores arrive and move the games that are on to
  // the top. Let go after a few seconds, so it never fights your scrolling.
  const jumpTo = useRef<string | null>(null)
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (!id.startsWith('game-')) return
    jumpTo.current = id
    const t = setTimeout(() => { jumpTo.current = null }, 5000)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => {
    const id = jumpTo.current
    if (!id || !board || board.hidden || tab === null) return
    // The game may be in another phase than the one the page opened on.
    const sec = sectionOf.get(id.slice('game-'.length))
    if (sec && tab !== 'all' && tab !== sec) { setTabState(sec); return }
    if (view !== 'game') { setView('game'); return }
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }))
    if (live.updatedAt) jumpTo.current = null
  }, [board, games, live.updatedAt, tab, sectionOf, view])

  return (
    <div className="min-h-screen bg-zinc-950 pb-16">
      <BowlHeader subtitle="All Picks" />
      <main className={`${view === 'grid' ? 'max-w-6xl' : 'max-w-3xl'} mx-auto px-4 py-5 space-y-3 animate-fade-in`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-white">All Picks</h1>
            {board && !board.hidden && <ResultsLine board={board} />}
          </div>
          {board && !board.hidden && !board.demo && <UpdateResults onDone={reload} />}
        </div>
        {board?.demo && <DemoNote />}

        {error ? <div className="glass-card rounded-2xl p-4 text-sm text-red-400">{error}</div>
          : !board ? <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="skeleton h-40 rounded-2xl" />)}</div>
          : board.hidden ? <HiddenUntilLock board={board} what="Everyone's picks" />
          : (
            <>
              <Segmented label="View" value={view} onChange={chooseView}
                options={[{ key: 'game', label: 'By game' }, { key: 'grid', label: 'Grid' }, { key: 'player', label: 'By player' }]} />
              <PhaseTabs sections={sections} tab={current} onChange={chooseTab} live={live.byGameId} />
              {view !== 'player' && (() => {
                const inTab = (board.games ?? []).filter(g => current === 'all' || sectionOf.get(g.id) === current)
                const onInTab = inTab.filter(g => isOn(g.id)).length
                return (
                  <Chips label="Show" value={show} onChange={setShow}
                    options={[
                      { key: 'all', label: 'All games', count: inTab.length },
                      ...(liveCount || show === 'live' ? [{ key: 'live' as const, label: '🔴 Live', count: onInTab }] : []),
                      { key: 'upcoming', label: 'Still to play', count: inTab.filter(g => !isDecided(g)).length },
                      { key: 'final', label: 'Final', count: inTab.filter(g => isDecided(g)).length },
                    ]} />
                )
              })()}
              {view === 'game' && <NamesSwitch on={names} onChange={chooseNames} />}
              {view === 'game' && (show === 'live' && !games.length
                ? <p className="text-sm text-zinc-500 px-1 py-6 text-center">No games are on right now.</p>
                : <ByGame board={board} groups={groups} me={player?.id} live={live.byGameId} plays={plays} names={names} />)}
              {view === 'grid' && <Grid board={board} groups={groups} me={player?.id} live={live.byGameId} tab={current} sections={sections} />}
              {view === 'player' && <ByPlayer board={board} me={player?.id} live={live.byGameId} tab={current} sections={sections} selected={typeof router.query.player === 'string' ? router.query.player : undefined} onSelect={id => setQuery({ player: id })} />}
            </>
          )}
      </main>
    </div>
  )
}

/** Phase 1 · Phase 2 · Phase 3 · Playoff · All — each with how many of its games are final. */
function PhaseTabs({ sections, tab, onChange, live }: { sections: PickSection[]; tab: Tab; onChange: (t: Tab) => void; live: LiveMap }) {
  if (sections.length < 2) return null
  const pill = (on: boolean) => `shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition ${on
    ? 'bg-yellow-500/15 border-yellow-500/50 text-yellow-100'
    : 'border-white/[0.08] bg-white/[0.03] text-zinc-300 hover:text-white'}`
  return (
    <div role="tablist" aria-label="Phase" className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4">
      {sections.map(sec => {
        const done = sec.games.filter(isDecided).length
        const on = sec.games.some(g => live.get(g.id)?.state === 'in')
        return (
          <button key={sec.key} type="button" role="tab" aria-selected={tab === sec.key} onClick={() => onChange(sec.key)} className={pill(tab === sec.key)}>
            <span className={`w-1.5 h-1.5 rounded-full ${PHASE_TONE[sec.key].dot}`} />
            {sec.short}
            <span className="tabular-nums text-zinc-400 font-medium">{done}/{sec.games.length}</span>
            {on && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" aria-label="live now" />}
          </button>
        )
      })}
      <button type="button" role="tab" aria-selected={tab === 'all'} onClick={() => onChange('all')} className={pill(tab === 'all')}>All</button>
    </div>
  )
}

function GroupHeading({ label }: { label: string }) {
  if (!label) return null
  return <p className={`text-[11px] font-semibold uppercase tracking-wider px-1 pt-1 ${label === 'Live now' ? 'text-red-400' : 'text-zinc-500'}`}>{label}</p>
}

function ordinal(n: number): string {
  const v = n % 100
  return n + (v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
}

function useLookups(board: Board) {
  return useMemo(() => ({
    teams: teamDirectory(board.games ?? []),
    out: eliminated(board.games ?? []),
    players: new Map((board.players ?? []).map(p => [p.id, p])),
  }), [board])
}

function GameMeta({ g, live }: { g: BowlGame; live?: BowlLive }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className={`w-2 h-2 rounded-full shrink-0 ${PHASE_TONE[g.phase!].dot}`} />
      <p className="text-sm font-semibold text-white truncate">{g.name}</p>
      <span className="ml-auto shrink-0 text-[11px] text-zinc-500">
        {g.status === 'final' ? <span className="font-semibold text-zinc-300">Final</span>
          : live && live.state !== 'pre' ? <LiveTag live={live} />
          : g.status === 'in_progress' ? <span className="font-semibold text-emerald-400">{g.status_detail ?? 'Live'}</span>
          : <>{kickoffText(g.kickoff_time, g.time_tbd)}{g.tv ? ` · ${g.tv}` : ''}</>}
      </span>
    </div>
  )
}

/* ── By game ──────────────────────────────────────────────────────── */

/** "Show names": everyone's picks on the By game cards, or just how the group split. */
function NamesSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex justify-end -mt-1">
      <button role="switch" aria-checked={on} onClick={() => onChange(!on)}
        className="press inline-flex items-center gap-2 py-1 text-xs font-medium text-zinc-400 hover:text-zinc-200">
        Show names
        <span aria-hidden="true" className={`relative inline-block w-8 h-[18px] rounded-full border transition-colors ${on ? 'bg-yellow-500 border-yellow-400' : 'bg-white/[0.08] border-white/[0.12]'}`}>
          <span className={`absolute top-[2px] w-3 h-3 rounded-full shadow transition-all ${on ? 'left-[15px] bg-zinc-950' : 'left-[2px] bg-zinc-300'}`} />
        </span>
      </button>
    </div>
  )
}

function ByGame({ board, groups, me, live, plays, names }: { board: Board; groups: Group[]; me?: string; live: LiveMap; plays: Map<string, PlayEvent>; names: boolean }) {
  if (!groups.length) return <p className="text-sm text-zinc-500 px-1 py-6 text-center">No games match.</p>
  return (
    <div className="space-y-4">
      {groups.map(gr => (
        <section key={gr.key} aria-label={gr.label || undefined} className="space-y-2">
          <GroupHeading label={gr.label} />
          <GameCards board={board} games={gr.games} me={me} live={live} plays={plays} names={names} />
        </section>
      ))}
    </div>
  )
}

function GameCards({ board, games, me, live, plays, names }: { board: Board; games: BowlGame[]; me?: string; live: LiveMap; plays: Map<string, PlayEvent>; names: boolean }) {
  const { teams, out } = useLookups(board)
  return (
    <div className="space-y-3">
      {games.map(g => {
        // Who picked what. The two teams playing come first; in the later
        // playoff rounds people may have someone else from their own bracket.
        const groups = new Map<string, BoardPlayer[]>()
        const none: BoardPlayer[] = []
        for (const p of board.players ?? []) {
          const t = board.picks?.[p.id]?.[g.id]
          if (!t) { none.push(p); continue }
          groups.set(t, [...(groups.get(t) ?? []), p])
        }
        const sides = [g.away, g.home].filter(Boolean) as BowlTeam[]
        const others = Array.from(groups.keys()).filter(id => !sides.some(s => s.id === id))
          .sort((a, b) => (groups.get(b)!.length - groups.get(a)!.length))
        const main = sides.length === 2 ? sides : Array.from(groups.keys()).sort((a, b) => groups.get(b)!.length - groups.get(a)!.length).slice(0, 2).map(id => teams.get(id)).filter(Boolean) as BowlTeam[]
        const extra = sides.length === 2 ? others : others.filter(id => !main.some(m => m.id === id))
        const counted = (board.players ?? []).length - none.length
        const n = (id: string) => groups.get(id)?.length ?? 0
        const decided = isDecided(g)
        const lv = live.get(g.id)
        const on = lv?.state === 'in'
        const sc = scoreOf(g, lv)
        // While it's on: who's ahead, and who has the ball, on our game's sides.
        const lead = on && sc.away !== null && sc.home !== null && sc.away !== sc.home ? (sc.away > sc.home ? 0 : 1) : null
        const ball = on && lv!.possession ? (ourSide(g, lv!, lv!.possession) === 'away' ? 0 : 1) : null
        // With names hidden, your own pick is still marked on its team.
        const mine = me ? board.picks?.[me]?.[g.id] : undefined
        const myStar = !!me && !!board.best5?.[me]?.includes(g.id)
        const yours = (id: string) => !names && mine === id
          ? <span className="block text-[10px] font-semibold text-yellow-300" data-your-pick>✓ Your pick{myStar && <span className="text-yellow-400"> ★</span>}</span>
          : null
        return (
          <article key={g.id} id={`game-${g.id}`} aria-label={g.name}
            className={`relative overflow-hidden glass-card rounded-2xl p-3.5 scroll-mt-32 ${on ? 'ring-1 ring-inset ring-red-500/30 bg-gradient-to-b from-red-500/[0.06] to-transparent' : ''}`}>
            <PlayFlash game={g} live={lv} event={plays.get(g.id)} />
            <GameMeta g={g} live={lv} />
            {main.length === 2 && counted > 0 && (
              <div className="mt-3 h-1.5 rounded-full overflow-hidden flex bg-white/[0.05]" aria-hidden="true">
                <span className={`${decided && g.winner_team_id === main[0].id ? 'bg-emerald-400' : decided ? 'bg-zinc-600' : 'bg-yellow-500'}`} style={{ width: `${(n(main[0].id) / counted) * 100}%` }} />
                <span className={`${decided && g.winner_team_id === main[1].id ? 'bg-emerald-400' : decided ? 'bg-zinc-600' : 'bg-zinc-400'}`} style={{ width: `${(n(main[1].id) / counted) * 100}%` }} />
              </div>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              {main.map((t, i) => {
                const won = decided && g.winner_team_id === t.id
                const lost = decided && g.winner_team_id !== t.id
                const score = i === 0 ? sc.away : sc.home
                const leading = lead === i
                const list = groups.get(t.id) ?? []
                return (
                  <div key={t.id} className={`rounded-xl border p-2.5 min-w-0 ${won ? 'border-emerald-500/40 bg-emerald-500/[0.07]' : lost ? 'border-white/[0.05] bg-white/[0.02]' : leading ? 'border-yellow-500/40 bg-yellow-500/[0.06]' : 'border-white/[0.07] bg-white/[0.03]'}`}>
                    <div className={`flex items-center gap-2 min-w-0 ${lost ? 'opacity-60' : ''}`}>
                      <TeamLogo team={t} size={26} />
                      <div className="min-w-0 flex-1">
                        <TeamName team={t} nickname className="block text-[13px] leading-snug text-white line-clamp-2" />
                        <p className="text-[11px] text-zinc-500">{list.length} {list.length === 1 ? 'pick' : 'picks'}{counted ? ` · ${Math.round((list.length / counted) * 100)}%` : ''}</p>
                        {yours(t.id)}
                      </div>
                      {sides.length === 2 && score !== null && (
                        <span className="shrink-0 flex flex-col items-end leading-none">
                          <span className={`text-lg font-extrabold tabular-nums ${won ? 'text-emerald-300' : leading ? 'text-white' : 'text-zinc-400'}`}>{score}</span>
                          {ball === i && <span className="text-xs mt-0.5" title="Has the ball">🏈</span>}
                        </span>
                      )}
                    </div>
                    {names && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {list.map(p => <PlayerChip key={p.id} player={p} me={p.id === me} star={board.best5?.[p.id]?.includes(g.id)} />)}
                        {!list.length && <span className="text-[11px] text-zinc-600">Nobody</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {extra.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {extra.map(id => {
                  const t = teams.get(id)
                  const gone = out.has(id) || (decided && g.winner_team_id !== id)
                  return (
                    <div key={id} className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className={`inline-flex items-center gap-1 text-zinc-400 ${gone ? 'line-through opacity-70' : ''}`}><TeamLogo team={t ?? null} size={14} />{t?.name ?? 'Team'}</span>
                      {gone && <span className="text-red-300/80">out</span>}
                      {names
                        ? (groups.get(id) ?? []).map(p => <PlayerChip key={p.id} player={p} me={p.id === me} star={board.best5?.[p.id]?.includes(g.id)} />)
                        : <span className="text-zinc-500">{n(id)} {n(id) === 1 ? 'pick' : 'picks'}{mine === id && <span className="font-semibold text-yellow-300"> · ✓ Your pick{myStar && ' ★'}</span>}</span>}
                    </div>
                  )
                })}
              </div>
            )}
            {lv && <GameCast game={g} live={lv} />}
            {none.length > 0 && (
              <p className="mt-2 text-[11px] text-zinc-600">{names ? `No pick: ${none.map(p => firstName(p.name)).join(', ')}` : `${none.length} didn't pick`}</p>
            )}
          </article>
        )
      })}
    </div>
  )
}

/* ── Grid ─────────────────────────────────────────────────────────── */

const FOOT_ROW = 34 // px — fixed, so the pinned totals can stack along the bottom

/**
 * Every pick in a phase as one table: a row per game, a column per player —
 * you first, then by rank — with the header, the game column and the totals
 * (the phase's points, total points, Best 5 record) all pinned, so 20-odd
 * players and 15 games still read at a glance.
 */
function Grid({ board, groups, me, live, tab, sections }: { board: Board; groups: Group[]; me?: string; live: LiveMap; tab: Tab; sections: PickSection[] }) {
  const { teams, out } = useLookups(board)
  const ranked = board.standings ?? []
  const mine = ranked.find(s => s.id === me)
  const cols = mine ? [mine, ...ranked.filter(s => s.id !== me)] : ranked
  if (!groups.length) return <p className="text-sm text-zinc-500 px-1 py-6 text-center">No games match.</p>

  // The totals along the bottom.
  type Foot = { key: string; label: string; value: (s: Standing) => number | null; show: (s: Standing) => React.ReactNode; best?: 'max' }
  const phaseRows: Foot[] = sections
    .filter(sec => tab === 'all' || sec.key === tab)
    .map(sec => ({ key: sec.key, label: `${sec.short} pts`, value: s => sectionPoints(s, sec.key), show: s => pts(sectionPoints(s, sec.key)), best: 'max' as const }))
  const foot: Foot[] = [
    ...phaseRows,
    { key: 'total', label: 'Total pts', value: s => s.points, show: s => pts(s.points), best: 'max' },
    { key: 'best5', label: 'Best 5', value: s => s.best5Wins, show: s => `${s.best5Wins}–${s.best5Losses}` },
    ...(tab === 'playoff' || tab === 'all' ? [{
      key: 'title', label: 'Title total', value: () => null,
      show: (s: Standing) => <>{s.titleTotal ?? '—'}{s.titleMiss !== null && <span className="text-[9px] text-zinc-500 ml-1">off {s.titleMiss}</span>}</>,
    }] : []),
  ]
  // How the group split: the share of everyone who picked this game that took each team.
  const splitOf = (g: BowlGame) => {
    let n = 0, away = 0, home = 0
    for (const c of cols) {
      const t = board.picks?.[c.id]?.[g.id]
      if (!t) continue
      n++
      if (t === g.away?.id) away++
      else if (t === g.home?.id) home++
    }
    return n ? { away: Math.round((away / n) * 100), home: Math.round((home / n) * 100) } : null
  }
  const topOf = (f: Foot) => (f.best === 'max' ? Math.max(...cols.map(c => f.value(c) ?? -Infinity)) : null)
  const bottomOf = (i: number) => (foot.length - 1 - i) * FOOT_ROW

  return (
    // Sized to fit under the page header, so once it's scrolled into view the
    // names, the games and the totals along the bottom are all on screen.
    <div className="glass-card rounded-2xl overflow-auto max-h-[calc(100dvh-180px)] -mx-1" role="region" aria-label="Picks grid" tabIndex={0}>
      <table className="border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-30 bg-zinc-900 min-w-[148px] max-w-[148px] sm:min-w-[196px] sm:max-w-[196px] px-2.5 sm:px-3 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider border-b border-r border-white/[0.08]">Game</th>
            {cols.map(s => {
              const you = s.id === me
              return (
                <th key={s.id} scope="col" className={`sticky top-0 z-20 min-w-[56px] px-1 py-2 border-b border-white/[0.08] ${you ? 'bg-zinc-800' : 'bg-zinc-900'}`}>
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[9px] font-semibold text-zinc-500 tabular-nums">{s.tied ? 'T' : ''}{s.rank}</span>
                    <BowlAvatar name={s.name} url={s.avatar_url} size={24} />
                    <span className={`text-[10px] font-semibold truncate max-w-[52px] ${you ? 'text-yellow-300' : 'text-zinc-200'}`}>{you ? 'You' : firstName(s.name)}</span>
                  </div>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {groups.map(gr => (
            <GridGroup key={gr.key} label={gr.label} span={cols.length}>
              {gr.games.map(g => {
                const lv = live.get(g.id)
                return (
                  <tr key={g.id}>
                    <th scope="row" className={`sticky left-0 z-10 min-w-[148px] max-w-[148px] sm:min-w-[196px] sm:max-w-[196px] px-2.5 sm:px-3 py-1.5 text-left font-normal align-middle border-b border-r border-white/[0.06] ${lv?.state === 'in' ? 'bg-zinc-900 shadow-[inset_3px_0_0_rgba(239,68,68,0.8)]' : 'bg-zinc-900'}`}>
                      <GameCell game={g} live={lv} split={splitOf(g)} />
                    </th>
                    {cols.map(s => {
                      const t = board.picks?.[s.id]?.[g.id]
                      const team = t ? teams.get(t) : null
                      const st = t ? pickState(g, t, out) : null
                      const star = board.best5?.[s.id]?.includes(g.id)
                      return (
                        <td key={s.id} className={`px-1 py-1 border-b border-white/[0.04] ${s.id === me ? 'bg-white/[0.04]' : ''}`}>
                          {team ? (
                            <div className={`relative mx-auto w-[50px] rounded-lg border flex flex-col items-center py-1 ${STATE_CELL[st!]}`} title={`${s.name}: ${team.name}`}>
                              <TeamLogo team={team} size={18} />
                              <span className={`text-[9px] font-semibold text-zinc-200 ${st === 'dead' ? 'line-through opacity-60' : ''}`}>{team.abbr ?? team.name.slice(0, 4)}</span>
                              {star && <span className="absolute -top-1 -right-1 text-[10px] text-yellow-400 leading-none">★</span>}
                            </div>
                          ) : <div className="text-center text-zinc-700">—</div>}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </GridGroup>
          ))}
        </tbody>
        <tfoot>
          {foot.map((f, i) => {
            const top = topOf(f)
            const emphasize = f.key === 'total'
            return (
              <tr key={f.key} style={{ height: FOOT_ROW }}>
                <th scope="row" className={`sticky left-0 z-20 bg-zinc-900 px-3 text-left text-[10px] font-semibold uppercase tracking-wider border-r border-white/[0.08] ${i === 0 ? 'border-t border-t-yellow-600/30' : ''} ${emphasize ? 'text-yellow-300' : 'text-zinc-400'}`}
                  style={{ bottom: bottomOf(i), height: FOOT_ROW }}>
                  {f.label}
                </th>
                {cols.map(s => {
                  const v = f.value(s)
                  const lead = top !== null && v === top && top > 0
                  return (
                    <td key={s.id} className={`sticky z-10 px-1 text-center text-[11px] tabular-nums ${s.id === me ? 'bg-zinc-800' : 'bg-zinc-900'} ${i === 0 ? 'border-t border-t-yellow-600/30' : ''} ${emphasize ? 'font-extrabold text-white' : 'font-semibold text-zinc-300'} ${lead ? 'text-yellow-300' : ''}`}
                      style={{ bottom: bottomOf(i), height: FOOT_ROW }}>
                      {f.show(s)}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tfoot>
      </table>
    </div>
  )
}

/** A playoff round (or phase, on All) heading across the grid, then its games. */
/**
 * The Grid's Game column: the bowl, then both teams by name with the score —
 * the winner (or whoever leads, live) in white. Live games show the clock in
 * red; games still to come show their date. No logos: the picks beside it
 * already have them.
 */
function GameCell({ game: g, live: lv, split }: { game: BowlGame; live?: BowlLive; split?: { away: number; home: number } | null }) {
  const on = !isDecided(g) && lv?.state === 'in'
  const sc = scoreOf(g, lv)
  const scored = sc.away !== null && sc.home !== null && (isDecided(g) || on || g.status === 'final')
  const lead = scored ? (sc.away! > sc.home! ? 'away' : sc.home! > sc.away! ? 'home' : null) : null
  const winner = isDecided(g) ? (g.winner_team_id === g.away?.id ? 'away' : g.winner_team_id === g.home?.id ? 'home' : null) : lead
  const status = on ? <span className="text-red-400 font-semibold">● {lv!.label ?? 'Live'}</span>
    // "Final" only where there's room: on a phone the scores already say so.
    : isDecided(g) || g.status === 'final' ? <span className="hidden sm:inline text-zinc-400 font-semibold">Final</span>
    : <span className="text-zinc-500">{kickoffText(g.kickoff_time, g.time_tbd).split(' · ')[0].replace(/^\w+, /, '')}</span>
  const row = (side: 'away' | 'home') => {
    const t = side === 'away' ? g.away : g.home
    const n = side === 'away' ? sc.away : sc.home
    const top = winner === side
    const faded = scored && winner !== null && !top
    return (
      <span className="flex items-baseline gap-1 sm:gap-1.5 leading-tight">
        <span className={`min-w-0 flex-1 truncate text-[11px] ${t ? (top ? 'text-white font-semibold' : faded ? 'text-zinc-500' : 'text-zinc-200') : 'text-zinc-600 italic'}`}>
          {t ? t.name : 'TBD'}
        </span>
        {t && split && <span className="shrink-0 w-[19px] sm:w-7 text-right tabular-nums text-[9px] text-zinc-500" title={`${split[side]}% of the group picked ${t.name}`}>{split[side]}%</span>}
        {scored && <span className={`shrink-0 w-[15px] sm:w-5 text-right tabular-nums text-[11px] ${top ? 'text-white font-bold' : 'text-zinc-500'} ${on ? 'text-red-200' : ''}`}>{n}</span>}
      </span>
    )
  }
  return (
    <span className="block" title={`${g.name}${g.away && g.home ? ` · ${g.away.name} vs ${g.home.name}` : ''}`}>
      <span className="flex items-center gap-1.5 mb-0.5">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PHASE_TONE[g.phase!].dot}`} />
        <span className="min-w-0 flex-1 text-[10px] font-semibold text-zinc-300 truncate">{g.name.replace('CFP ', '')}</span>
        <span className="shrink-0 text-[9px]">{status}</span>
      </span>
      <span className="block sm:pl-3">
        {row('away')}
        {row('home')}
      </span>
    </span>
  )
}

function GridGroup({ label, span, children }: { label: string; span: number; children: React.ReactNode }) {
  return (
    <>
      {label && (
        <tr>
          <th scope="rowgroup" className={`sticky left-0 z-10 bg-zinc-950 px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider border-b border-white/[0.06] ${label === 'Live now' ? 'text-red-400' : 'text-zinc-500'}`}>{label}</th>
          <td colSpan={span} className="bg-zinc-950 border-b border-white/[0.06]" />
        </tr>
      )}
      {children}
    </>
  )
}

/* ── By player ────────────────────────────────────────────────────── */

function ByPlayer({ board, me, live, tab, sections, selected, onSelect }: { board: Board; me?: string; live: LiveMap; tab: Tab; sections: PickSection[]; selected?: string; onSelect: (id: string) => void }) {
  const { teams, out } = useLookups(board)
  const standings = board.standings ?? []
  const id = selected && standings.some(s => s.id === selected) ? selected : (me && standings.some(s => s.id === me) ? me : standings[0]?.id)
  const s = standings.find(x => x.id === id)
  if (!s) return <p className="text-sm text-zinc-500">Nobody in the pick&apos;em yet.</p>
  const picks = board.picks?.[s.id] ?? {}
  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1" role="tablist" aria-label="Player">
        {standings.map(p => (
          <button key={p.id} role="tab" aria-selected={p.id === s.id} onClick={() => onSelect(p.id)}
            className={`shrink-0 flex flex-col items-center gap-1 w-14 py-1.5 rounded-xl transition ${p.id === s.id ? 'bg-yellow-500/15 ring-1 ring-yellow-500/50' : 'hover:bg-white/[0.04]'}`}>
            <BowlAvatar name={p.name} url={p.avatar_url} size={34} />
            <span className={`text-[10px] truncate max-w-[52px] ${p.id === s.id ? 'text-yellow-300 font-semibold' : 'text-zinc-400'}`}>{firstName(p.name)}</span>
          </button>
        ))}
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-yellow-600/25 bg-gradient-to-br from-zinc-800/80 via-zinc-900 to-zinc-950 p-4">
        <div className="flex items-center gap-3">
          <BowlAvatar name={s.name} url={s.avatar_url} size={48} />
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold text-white truncate">{s.name}</p>
            <p className="text-xs text-zinc-400">{s.tied ? 'Tied for ' : ''}{ordinal(s.rank)} place · {s.wins}–{s.losses}{s.pending ? ` · ${s.pending} to play` : ''}</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-extrabold text-yellow-400 tabular-nums leading-none">{pts(s.points)}</p>
            <p className="text-[10px] text-zinc-500 mt-1">max {pts(s.maxPoints)}</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-white/[0.04] py-2"><p className="text-[10px] text-zinc-500 uppercase tracking-wider">Best 5</p><p className="text-sm font-bold text-white tabular-nums">{s.best5Wins}–{s.best5Losses}</p></div>
          <div className="rounded-xl bg-white/[0.04] py-2 min-w-0 px-1">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Champion</p>
            {s.champion ? <p className={`text-sm font-bold text-white truncate inline-flex items-center gap-1 ${s.championState === 'lost' || s.championState === 'dead' ? 'line-through opacity-60' : ''}`}><TeamLogo team={s.champion} size={16} />{s.champion.name}</p> : <p className="text-sm text-zinc-600">—</p>}
          </div>
          <div className="rounded-xl bg-white/[0.04] py-2"><p className="text-[10px] text-zinc-500 uppercase tracking-wider">Title total</p><p className="text-sm font-bold text-white tabular-nums">{s.titleTotal ?? '—'}</p></div>
        </div>
        <div className="mt-2 grid gap-2 text-center" style={{ gridTemplateColumns: `repeat(${sections.length}, minmax(0, 1fr))` }} aria-label="Points by phase">
          {sections.map(sec => (
            <div key={sec.key} className={`rounded-xl py-1.5 ${tab === sec.key ? 'bg-yellow-500/10 ring-1 ring-inset ring-yellow-500/30' : 'bg-white/[0.03]'}`}>
              <p className="text-[10px] text-zinc-500 inline-flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${PHASE_TONE[sec.key].dot}`} />{sec.short}</p>
              <p className="text-sm font-bold text-white tabular-nums">{pts(sectionPoints(s, sec.key))}</p>
            </div>
          ))}
        </div>
      </div>

      {sections.filter(sec => tab === 'all' || sec.key === tab).map(sec => {
        const secPts = sectionPoints(s, sec.key)
        return (
          <section key={sec.key} aria-label={sec.title}>
            <div className="flex items-baseline gap-2 px-1 mb-1.5">
              <span className={`w-2 h-2 rounded-full self-center ${PHASE_TONE[sec.key].dot}`} />
              <h2 className="text-sm font-bold text-white">{sec.title}</h2>
              <span className="ml-auto text-[11px] text-zinc-400 tabular-nums">{pts(secPts)} pts</span>
            </div>
            {sec.rounds.map(r => (
              <div key={r.key} className="mb-2">
                {r.label && <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider px-1 mb-1">{r.label}</p>}
                <div className="glass-card rounded-2xl divide-y divide-white/[0.04]">
                  {r.games.map(g => {
                    const t = picks[g.id]
                    const team = t ? teams.get(t) : null
                    const st = t ? pickState(g, t, out) : null
                    const star = s.best5.includes(g.id)
                    return (
                      <div key={g.id} className="flex items-center gap-3 px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-zinc-400 truncate">{star && <span className="text-yellow-400 mr-1">★</span>}{g.name}</p>
                          {team ? (
                            <p className={`flex items-center gap-1.5 text-sm text-white min-w-0 ${st === 'dead' || st === 'lost' ? 'opacity-70' : ''}`}>
                              <TeamLogo team={team} size={18} /><TeamName team={team} nickname className={`truncate ${st === 'dead' ? 'line-through' : ''}`} />
                            </p>
                          ) : <p className="text-sm text-zinc-600">No pick</p>}
                        </div>
                        {st === 'won' && <span className="shrink-0 text-xs font-bold text-emerald-300">+{pts(PHASE_BY_KEY[g.phase!].points)}</span>}
                        {st === 'lost' && <span className="shrink-0 text-xs font-bold text-red-300">✗</span>}
                        {st === 'dead' && <span className="shrink-0 text-[11px] text-red-300/80">out</span>}
                        {st === 'pending' && (() => {
                          const lv = live.get(g.id)
                          if (lv?.state === 'in') {
                            const sc = scoreOf(g, lv)
                            return <span className="shrink-0 text-[11px] font-semibold text-red-400 tabular-nums">● {sc.away ?? 0}–{sc.home ?? 0}</span>
                          }
                          return <span className="shrink-0 text-[11px] text-zinc-500">{g.status === 'in_progress' ? 'Live' : kickoffText(g.kickoff_time, g.time_tbd).split(' · ')[0]}</span>
                        })()}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}
