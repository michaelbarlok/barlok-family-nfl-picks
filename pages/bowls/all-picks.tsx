import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { useBowlAuth } from '@/lib/bowls/auth'
import { PHASE_BY_KEY, pickSections, type BowlGame, type BowlTeam, type Phase } from '@/lib/bowls/sheet'
import { eliminated, isDecided, pickState, teamDirectory, type PickState } from '@/lib/bowls/scoring'
import { kickoffText } from '@/lib/bowls/format'
import BowlHeader, { BowlAvatar } from '@/components/bowls/BowlHeader'
import { PHASE_TONE, TeamLogo, TeamName } from '@/components/bowls/ui'
import {
  Chips, HiddenUntilLock, PHASE_FILTERS, PlayerChip, ResultsLine, Segmented, UpdateResults,
  firstName, pts, useBoard, type Board, type BoardPlayer,
} from '@/components/bowls/board'
import { GameCast, LiveTag, PlayFlash } from '@/components/bowls/live'
import { ourSide, scoreOf, type BowlLive } from '@/lib/bowls/live'
import { useBowlLive, useBowlPlays, type PlayEvent } from '@/lib/bowls/useBowlLive'

type View = 'game' | 'grid' | 'player'
type Show = 'all' | 'live' | 'upcoming' | 'final'
type LiveMap = Map<string, BowlLive>

const STATE_CELL: Record<PickState, string> = {
  won: 'bg-emerald-500/20 border-emerald-500/40',
  lost: 'bg-red-500/15 border-red-500/30',
  dead: 'bg-red-500/10 border-red-500/20',
  pending: 'bg-white/[0.03] border-white/[0.06]',
}

/**
 * All Picks — everyone's pick for every game, once picks lock at the first
 * kickoff. By game, as a grid, or one player at a time.
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
  const view = (['game', 'grid', 'player'].includes(String(router.query.view)) ? router.query.view : 'game') as View
  const [phase, setPhase] = useState<'all' | Phase>('all')
  const [show, setShow] = useState<Show>('all')

  useEffect(() => { if (!loading && !account) router.replace('/bowls/login') }, [loading, account, router])

  const setQuery = (q: Record<string, string>) => router.replace({ pathname: router.pathname, query: { ...router.query, ...q } }, undefined, { shallow: true, scroll: false })

  const live = useBowlLive(board && !board.hidden ? board.games : undefined, reload)
  const plays = useBowlPlays(live.byGameId)
  const isOn = (id: string) => live.byGameId.get(id)?.state === 'in'
  const liveCount = (board?.games ?? []).filter(g => isOn(g.id)).length

  const games = useMemo(() => {
    const list = (board?.games ?? []).filter(g =>
      (phase === 'all' || g.phase === phase)
      && (show === 'all' || (show === 'live' ? live.byGameId.get(g.id)?.state === 'in' : show === 'final' ? isDecided(g) : !isDecided(g))))
    // What's on now comes first; everything else stays in kickoff order.
    const on = (g: BowlGame) => (live.byGameId.get(g.id)?.state === 'in' ? 0 : 1)
    return view === 'game' ? list.map((g, i) => ({ g, i })).sort((a, b) => on(a.g) - on(b.g) || a.i - b.i).map(x => x.g) : list
  }, [board, phase, show, live.byGameId, view])

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
    if (!id || !board || board.hidden) return
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }))
    if (live.updatedAt) jumpTo.current = null
  }, [board, games, live.updatedAt])

  return (
    <div className="min-h-screen bg-zinc-950 pb-16">
      <BowlHeader subtitle="All Picks" />
      <main className={`${view === 'grid' ? 'max-w-6xl' : 'max-w-3xl'} mx-auto px-4 py-5 space-y-3 animate-fade-in`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-white">All Picks</h1>
            {board && !board.hidden && <ResultsLine board={board} />}
          </div>
          {board && !board.hidden && <UpdateResults onDone={reload} />}
        </div>

        {error ? <div className="glass-card rounded-2xl p-4 text-sm text-red-400">{error}</div>
          : !board ? <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="skeleton h-40 rounded-2xl" />)}</div>
          : board.hidden ? <HiddenUntilLock board={board} what="Everyone's picks" />
          : (
            <>
              <Segmented label="View" value={view} onChange={v => setQuery({ view: v })}
                options={[{ key: 'game', label: 'By game' }, { key: 'grid', label: 'Grid' }, { key: 'player', label: 'By player' }]} />
              {view !== 'player' && (
                <>
                  <Chips label="Phase" value={phase} onChange={setPhase}
                    options={PHASE_FILTERS.filter(f => f.key === 'all' || board.games!.some(g => g.phase === f.key))} />
                  <Chips label="Show" value={show} onChange={setShow}
                    options={[
                      { key: 'all', label: 'All games' },
                      ...(liveCount || show === 'live' ? [{ key: 'live' as const, label: '🔴 Live', count: liveCount }] : []),
                      { key: 'upcoming', label: 'Still to play', count: board.games!.filter(g => !isDecided(g)).length },
                      { key: 'final', label: 'Final', count: board.decided },
                    ]} />
                </>
              )}
              {view === 'game' && (show === 'live' && !games.length
                ? <p className="text-sm text-zinc-500 px-1 py-6 text-center">No games are on right now.</p>
                : <ByGame board={board} games={games} me={player?.id} live={live.byGameId} plays={plays} />)}
              {view === 'grid' && <Grid board={board} games={games} me={player?.id} live={live.byGameId} />}
              {view === 'player' && <ByPlayer board={board} me={player?.id} live={live.byGameId} selected={typeof router.query.player === 'string' ? router.query.player : undefined} onSelect={id => setQuery({ player: id })} />}
            </>
          )}
      </main>
    </div>
  )
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

function ByGame({ board, games, me, live, plays }: { board: Board; games: BowlGame[]; me?: string; live: LiveMap; plays: Map<string, PlayEvent> }) {
  const { teams, out, players } = useLookups(board)
  if (!games.length) return <p className="text-sm text-zinc-500 px-1 py-6 text-center">No games match.</p>
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
                      </div>
                      {sides.length === 2 && score !== null && (
                        <span className="shrink-0 flex flex-col items-end leading-none">
                          <span className={`text-lg font-extrabold tabular-nums ${won ? 'text-emerald-300' : leading ? 'text-white' : 'text-zinc-400'}`}>{score}</span>
                          {ball === i && <span className="text-xs mt-0.5" title="Has the ball">🏈</span>}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {list.map(p => <PlayerChip key={p.id} player={p} me={p.id === me} star={board.best5?.[p.id]?.includes(g.id)} />)}
                      {!list.length && <span className="text-[11px] text-zinc-600">Nobody</span>}
                    </div>
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
                      {(groups.get(id) ?? []).map(p => <PlayerChip key={p.id} player={p} me={p.id === me} star={board.best5?.[p.id]?.includes(g.id)} />)}
                    </div>
                  )
                })}
              </div>
            )}
            {lv && <GameCast game={g} live={lv} />}
            {none.length > 0 && (
              <p className="mt-2 text-[11px] text-zinc-600">No pick: {none.map(p => firstName(p.name)).join(', ')}</p>
            )}
          </article>
        )
      })}
    </div>
  )
}

/* ── Grid ─────────────────────────────────────────────────────────── */

function Grid({ board, games, me, live }: { board: Board; games: BowlGame[]; me?: string; live: LiveMap }) {
  const { teams, out } = useLookups(board)
  const ranked = board.standings ?? []
  if (!games.length) return <p className="text-sm text-zinc-500 px-1 py-6 text-center">No games match.</p>
  return (
    <div className="glass-card rounded-2xl overflow-auto max-h-[calc(100vh-230px)] -mx-1" role="region" aria-label="Picks grid" tabIndex={0}>
      <table className="border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-30 bg-zinc-900 min-w-[132px] max-w-[132px] px-3 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider border-b border-r border-white/[0.08]">Game</th>
            {ranked.map(s => (
              <th key={s.id} scope="col" className={`sticky top-0 z-20 min-w-[64px] px-1.5 py-2 border-b border-white/[0.08] ${s.id === me ? 'bg-zinc-800' : 'bg-zinc-900'}`}>
                <div className="flex flex-col items-center gap-0.5">
                  <BowlAvatar name={s.name} url={s.avatar_url} size={26} />
                  <span className={`text-[11px] font-semibold truncate max-w-[60px] ${s.id === me ? 'text-yellow-300' : 'text-zinc-200'}`}>{firstName(s.name)}</span>
                  <span className="text-[10px] text-yellow-400 font-bold tabular-nums">{pts(s.points)}</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {games.map(g => (
            <tr key={g.id}>
              <th scope="row" className="sticky left-0 z-10 bg-zinc-900 min-w-[132px] max-w-[132px] px-3 py-1.5 text-left font-normal border-b border-r border-white/[0.06]">
                <span className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PHASE_TONE[g.phase!].dot}`} />
                  <span className="text-[11px] font-semibold text-zinc-100 truncate">{g.name.replace('CFP ', '')}</span>
                </span>
                <span className="block text-[10px] text-zinc-500 truncate pl-3">
                  {(() => {
                    const lv = live.get(g.id)
                    if (!isDecided(g) && lv?.state === 'in') {
                      const sc = scoreOf(g, lv)
                      return <span className="text-red-400 font-semibold">● {lv.label ?? 'Live'} · {sc.away ?? 0}–{sc.home ?? 0}</span>
                    }
                    return isDecided(g) ? `Final · ${teams.get(g.winner_team_id!)?.abbr ?? ''}` : g.playoff_round === 'first' ? `${g.away?.abbr ?? 'TBD'} v ${g.home?.abbr ?? 'TBD'}` : `${PHASE_BY_KEY[g.phase!].points} pts`
                  })()}
                </span>
              </th>
              {ranked.map(s => {
                const t = board.picks?.[s.id]?.[g.id]
                const team = t ? teams.get(t) : null
                const st = t ? pickState(g, t, out) : null
                const star = board.best5?.[s.id]?.includes(g.id)
                return (
                  <td key={s.id} className={`px-1 py-1 border-b border-white/[0.04] ${s.id === me ? 'bg-white/[0.03]' : ''}`}>
                    {team ? (
                      <div className={`relative mx-auto w-[56px] rounded-lg border flex flex-col items-center py-1 ${STATE_CELL[st!]}`} title={`${s.name}: ${team.name}`}>
                        <TeamLogo team={team} size={18} />
                        <span className={`text-[9px] font-semibold text-zinc-200 ${st === 'dead' ? 'line-through opacity-60' : ''}`}>{team.abbr ?? team.name.slice(0, 4)}</span>
                        {star && <span className="absolute -top-1 -right-1 text-[10px] text-yellow-400 leading-none">★</span>}
                      </div>
                    ) : <div className="text-center text-zinc-700">—</div>}
                  </td>
                )
              })}
            </tr>
          ))}
          <tr>
            <th scope="row" className="sticky left-0 z-10 bg-zinc-900 px-3 py-2 text-left text-[11px] font-semibold text-zinc-300 border-r border-white/[0.06]">Title total</th>
            {ranked.map(s => (
              <td key={s.id} className="px-1 py-2 text-center text-[11px] text-zinc-300 tabular-nums">
                {s.titleTotal ?? '—'}{s.titleMiss !== null && <span className="block text-[9px] text-zinc-500">off {s.titleMiss}</span>}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/* ── By player ────────────────────────────────────────────────────── */

function ByPlayer({ board, me, live, selected, onSelect }: { board: Board; me?: string; live: LiveMap; selected?: string; onSelect: (id: string) => void }) {
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
      </div>

      {pickSections(board.games ?? []).map(sec => {
        const secPts = sec.key === 'playoff' ? s.byPhase.playoff + s.byPhase.semi + s.byPhase.title : s.byPhase[sec.key]
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
