import { useCallback, useEffect, useRef, useState } from 'react'
import { PHASE_BY_KEY, type BowlGame, type Phase } from '@/lib/bowls/sheet'
import { kickoffText } from '@/lib/bowls/format'
import { PHASE_TONE, TeamLine } from '@/components/bowls/ui'

/*
 * The pick sheet as a board: drag each bowl into The Little Ones, In
 * Betweeners or The Big Ones — or back to "Not included". Playoff games
 * place themselves. Within a section, games are listed by kickoff, so only
 * which section matters.
 *
 * Mouse: drag the card. Touch: drag by the grip (⠿) so the page still
 * scrolls normally; while dragging, the four sections are pinned along the
 * bottom of the screen to drop onto. Every card also has a Move menu.
 */

type Lane = 'off' | 'little' | 'between' | 'big'
const LANES: { key: Lane; label: string; sub: string }[] = [
  { key: 'off', label: 'Not included', sub: 'Drag games from here into a phase' },
  { key: 'little', label: `${PHASE_BY_KEY.little.tag} · ${PHASE_BY_KEY.little.label}`, sub: '1 point per win' },
  { key: 'between', label: `${PHASE_BY_KEY.between.tag} · ${PHASE_BY_KEY.between.label}`, sub: '1.5 points per win' },
  { key: 'big', label: `${PHASE_BY_KEY.big.tag} · ${PHASE_BY_KEY.big.label}`, sub: '2 points per win' },
]
const SHORT: Record<Lane, string> = { off: 'Not included', little: 'Little Ones', between: 'In Betweeners', big: 'Big Ones' }
const DOT: Record<Lane, string> = { off: 'bg-zinc-500', little: PHASE_TONE.little.dot, between: PHASE_TONE.between.dot, big: PHASE_TONE.big.dot }
const ROUND_NAME = { first: 'First round', quarter: 'Quarterfinals', semi: 'Semifinals', title: 'National Championship' } as const

const laneOf = (g: BowlGame): Lane => (g.phase === 'little' || g.phase === 'between' || g.phase === 'big' ? g.phase : 'off')
const byKickoff = (a: BowlGame, b: BowlGame) => (a.kickoff_time ?? '9').localeCompare(b.kickoff_time ?? '9') || a.name.localeCompare(b.name)

interface Props {
  games: BowlGame[]
  locked: boolean
  canDelete: boolean
  onMove: (game: BowlGame, to: Phase | null) => void
  onRename: (game: BowlGame, name: string) => Promise<boolean>
  onRemove: (game: BowlGame, removed: boolean) => void
  onDelete: (game: BowlGame) => void
}

interface Pending {
  id: string
  pointerId: number
  startX: number
  startY: number
  offX: number
  offY: number
  width: number
  started: boolean
}

export default function SheetBoard({ games, locked, canDelete, onMove, onRename, onRemove, onDelete }: Props) {
  const [drag, setDrag] = useState<{ id: string; over: Lane | null; width: number; offX: number; offY: number } | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [announce, setAnnounce] = useState('')
  const pending = useRef<Pending | null>(null)
  const pointer = useRef({ x: 0, y: 0 })
  const overRef = useRef<Lane | null>(null)
  const ghost = useRef<HTMLDivElement>(null)
  const raf = useRef<number | null>(null)
  const justDragged = useRef(false)

  const bowls = games.filter(g => !g.playoff_round)
  const playoff = games.filter(g => g.playoff_round)
  const inLane = (lane: Lane) => bowls.filter(g => !g.removed && laneOf(g) === lane).sort(byKickoff)
  const removed = games.filter(g => g.removed).sort(byKickoff)
  const dragged = drag ? games.find(g => g.id === drag.id) ?? null : null

  const move = useCallback((g: BowlGame, to: Lane) => {
    if (to === laneOf(g)) return
    onMove(g, to === 'off' ? null : to)
    setAnnounce(`${g.name} moved to ${to === 'off' ? 'Not included' : PHASE_BY_KEY[to].label}`)
  }, [onMove])

  // Where the pointer is: the section under it, if any.
  const hitTest = useCallback(() => {
    const el = document.elementFromPoint(pointer.current.x, pointer.current.y)?.closest('[data-drop]')
    const lane = (el?.getAttribute('data-drop') as Lane | null) ?? null
    if (lane !== overRef.current) {
      overRef.current = lane
      setDrag(d => (d ? { ...d, over: lane } : d))
    }
  }, [])

  const placeGhost = useCallback(() => {
    const p = pending.current
    if (ghost.current && p) ghost.current.style.transform = `translate(${pointer.current.x - p.offX}px, ${pointer.current.y - p.offY}px)`
  }, [])

  // Scroll the page while a card is held near the top or bottom edge.
  const autoScroll = useCallback(() => {
    const y = pointer.current.y
    const dock = document.getElementById('sheet-dock')?.getBoundingClientRect().top ?? innerHeight
    const top = 150, bottom = dock - 40
    const step = y < top ? -Math.ceil((top - y) / 6) : y > bottom ? Math.ceil((y - bottom) / 6) : 0
    if (step) { window.scrollBy(0, Math.max(-24, Math.min(24, step))); hitTest() }
    raf.current = requestAnimationFrame(autoScroll)
  }, [hitTest])

  const stop = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current)
    raf.current = null
    pending.current = null
    overRef.current = null
    setDrag(null)
  }, [])

  useEffect(() => {
    if (!drag) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') stop() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [drag, stop])
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current) }, [])

  const begin = (p: Pending, g: BowlGame) => {
    p.started = true
    overRef.current = laneOf(g)
    setDrag({ id: g.id, over: laneOf(g), width: p.width, offX: p.offX, offY: p.offY })
    raf.current = requestAnimationFrame(autoScroll)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>, g: BowlGame) => {
    if (locked || g.removed || renaming?.id === g.id || e.button !== 0) return
    const target = e.target as Element
    const onGrip = !!target.closest('[data-grip]')
    // Touch drags start from the grip only, so a finger anywhere else scrolls.
    if (e.pointerType !== 'mouse' && !onGrip) return
    if (!onGrip && target.closest('button, select, input, a')) return
    const rect = e.currentTarget.getBoundingClientRect()
    pointer.current = { x: e.clientX, y: e.clientY }
    pending.current = { id: g.id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, offX: e.clientX - rect.left, offY: e.clientY - rect.top, width: rect.width, started: false }
    e.currentTarget.setPointerCapture(e.pointerId)
    if (e.pointerType !== 'mouse') { e.preventDefault(); begin(pending.current, g) }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>, g: BowlGame) => {
    const p = pending.current
    if (!p || p.pointerId !== e.pointerId) return
    pointer.current = { x: e.clientX, y: e.clientY }
    if (!p.started) {
      if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < 6) return
      begin(p, g)
    }
    e.preventDefault()
    placeGhost()
    hitTest()
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>, g: BowlGame) => {
    const p = pending.current
    if (!p || p.pointerId !== e.pointerId) return
    const over = overRef.current
    const started = p.started
    stop()
    if (!started) return
    justDragged.current = true
    setTimeout(() => { justDragged.current = false }, 0)
    if (over) move(g, over)
  }

  const card = (g: BowlGame) => {
    const isOpen = open === g.id
    const lane = laneOf(g)
    return (
      <div key={g.id} data-card={g.id}
        onPointerDown={e => onPointerDown(e, g)} onPointerMove={e => onPointerMove(e, g)}
        onPointerUp={e => onPointerUp(e, g)} onPointerCancel={stop}
        onClick={e => {
          if (justDragged.current || (e.target as Element).closest('button, select, input, a, form')) return
          setOpen(o => (o === g.id ? null : g.id))
        }}
        className={`group relative flex gap-2 rounded-xl border px-2 py-2 bg-zinc-900/70 border-white/[0.07] transition select-none
          ${!locked && !g.removed ? 'sm:cursor-grab' : ''} ${drag?.id === g.id ? 'opacity-30' : 'hover:border-white/[0.14]'}`}>
        {!locked && !g.removed && (
          <span data-grip aria-hidden="true" title="Drag"
            className="shrink-0 w-6 -my-2 -ml-2 pl-2 flex items-center justify-center text-zinc-500 text-base leading-none cursor-grab"
            style={{ touchAction: 'none' }}>⠿</span>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            {renaming?.id === g.id ? (
              <form className="flex-1 flex gap-1.5" onSubmit={async e => { e.preventDefault(); if (await onRename(g, renaming.name)) setRenaming(null) }}>
                <input autoFocus value={renaming.name} onChange={e => setRenaming({ id: g.id, name: e.target.value })} aria-label="Game name"
                  className="flex-1 min-w-0 px-2 py-1 bg-white/[0.06] border border-white/[0.1] rounded-lg text-sm text-white focus:outline-none" />
                <button type="submit" className="text-xs font-semibold text-yellow-400">Save</button>
                <button type="button" onClick={() => setRenaming(null)} className="text-xs text-zinc-500">Cancel</button>
              </form>
            ) : (
              <p className="flex-1 min-w-0 text-[13px] font-semibold text-white truncate" title={g.espn_name || undefined}>{g.name}</p>
            )}
            {!locked && !g.removed && renaming?.id !== g.id && (
              <label className="shrink-0 relative">
                <span className="sr-only">Section for {g.name}</span>
                <select value={lane} onChange={e => move(g, e.target.value as Lane)} aria-label={`Section for ${g.name}`}
                  className="appearance-none text-[11px] font-medium text-zinc-300 bg-white/[0.05] border border-white/[0.08] rounded-full pl-2 pr-5 py-0.5 focus:outline-none focus:ring-2 focus:ring-yellow-500/40">
                  {LANES.map(l => <option key={l.key} value={l.key}>{SHORT[l.key]}</option>)}
                </select>
                <span className="pointer-events-none absolute right-1.5 top-1/2 -tranzinc-y-1/2 text-[8px] text-zinc-500">▼</span>
              </label>
            )}
          </div>
          <p className="text-[11px] text-zinc-500 truncate">
            {kickoffText(g.kickoff_time, g.time_tbd)}{g.tv ? ` · ${g.tv}` : ''}
            {g.status === 'final' && g.away_score !== null && ` · Final ${g.away_score}–${g.home_score}`}
          </p>
          <p className="text-[11px] text-zinc-300 mt-0.5 flex items-center gap-1 min-w-0 overflow-hidden whitespace-nowrap">
            <TeamLine team={g.away} /><span className="text-zinc-600 shrink-0">vs</span><TeamLine team={g.home} />
          </p>
          {g.removed && (g.status === 'canceled' || g.status === 'postponed') && (
            <p className="text-[11px] text-red-300 mt-0.5">ESPN: {g.status}</p>
          )}
          {isOpen && renaming?.id !== g.id && (
            <div className="mt-2 pt-2 border-t border-white/[0.06] flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
              <button onClick={() => setRenaming({ id: g.id, name: g.name })} className="font-semibold text-yellow-400 hover:text-yellow-300">Rename</button>
              {g.removed ? (
                <button onClick={() => onRemove(g, false)} className="font-semibold text-yellow-400 hover:text-yellow-300">Put back</button>
              ) : (g.phase && (
                <button onClick={() => confirm(`Take ${g.name} off the pick'em? Use this for a canceled or postponed game — it won't count for anyone.`) && onRemove(g, true)}
                  className="text-zinc-400 hover:text-red-400">Canceled or postponed…</button>
              ))}
              {g.manual && canDelete && (
                <button onClick={() => confirm(`Delete ${g.name} from the list?`) && onDelete(g)} className="text-zinc-400 hover:text-red-400">Delete</button>
              )}
              {g.espn_name && g.espn_name !== g.name && <span className="text-zinc-600 truncate">ESPN: {g.espn_name}</span>}
            </div>
          )}
        </div>
      </div>
    )
  }

  const lane = (l: (typeof LANES)[number], extra = '') => {
    const list = inLane(l.key)
    const hot = drag && drag.over === l.key
    return (
      <section key={l.key} data-drop={locked ? undefined : l.key} aria-label={l.label}
        className={`glass-card rounded-2xl p-3 transition ${hot ? 'ring-2 ring-yellow-400/70 bg-yellow-500/[0.06]' : ''} ${extra}`}>
        <div className="flex items-baseline gap-2 mb-2 px-0.5">
          <span className={`w-2 h-2 rounded-full self-center shrink-0 ${DOT[l.key]}`} />
          <h3 className="text-sm font-bold text-white truncate">{l.label}</h3>
          <span className="ml-auto text-xs text-zinc-400 tabular-nums shrink-0">{list.length}</span>
        </div>
        <p className="text-[11px] text-zinc-500 -mt-1.5 mb-2 px-0.5">{l.sub}</p>
        <div className="space-y-1.5 min-h-[52px]">
          {list.map(card)}
          {!list.length && (
            <div className="h-[52px] rounded-xl border border-dashed border-white/[0.1] flex items-center justify-center text-[11px] text-zinc-500">
              {locked ? 'No games' : 'Drop games here'}
            </div>
          )}
        </div>
      </section>
    )
  }

  return (
    <div className="space-y-3">
      <p className="sr-only" aria-live="polite">{announce}</p>
      <div className="grid sm:grid-cols-2 gap-3 items-start">
        {lane(LANES[0], 'sm:sticky sm:top-[108px] sm:max-h-[calc(100vh-124px)] sm:overflow-y-auto')}
        <div className="space-y-3">
          {LANES.slice(1).map(l => lane(l))}
        </div>
      </div>

      {playoff.length > 0 && (
        <section aria-label="Phase 4 · The Playoff" className="glass-card rounded-2xl p-3">
          <div className="flex items-baseline gap-2 mb-1 px-0.5">
            <span className={`w-2 h-2 rounded-full self-center ${PHASE_TONE.playoff.dot}`} />
            <h3 className="text-sm font-bold text-white">Phase 4 · The Playoff</h3>
            <span className="ml-auto text-xs text-zinc-400 tabular-nums">{playoff.filter(g => !g.removed).length}</span>
          </div>
          <p className="text-[11px] text-zinc-500 mb-2 px-0.5">Placed automatically · 3 points per win, semifinals and champion 3 each</p>
          {(['first', 'quarter', 'semi', 'title'] as const).map(round => {
            const list = playoff.filter(g => g.playoff_round === round && !g.removed).sort(byKickoff)
            if (!list.length) return null
            return (
              <div key={round} className="mb-2 last:mb-0">
                <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider px-0.5 mb-1">{ROUND_NAME[round]}</p>
                <div className="grid sm:grid-cols-2 gap-1.5">
                  {list.map(g => (
                    <div key={g.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                      <p className="text-[12px] font-semibold text-zinc-200 truncate">{g.name}</p>
                      <p className="text-[11px] text-zinc-500 truncate">{kickoffText(g.kickoff_time, g.time_tbd)}{g.tv ? ` · ${g.tv}` : ''}</p>
                      <p className="text-[11px] text-zinc-300 flex items-center gap-1 min-w-0 overflow-hidden whitespace-nowrap">
                        <TeamLine team={g.away} fallback={g.away_from ? 'Winner' : 'TBD'} /><span className="text-zinc-600 shrink-0">vs</span>
                        <TeamLine team={g.home} fallback={g.home_from ? 'Winner' : 'TBD'} />
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </section>
      )}

      {removed.length > 0 && (
        <section aria-label="Canceled or postponed" className="glass-card rounded-2xl p-3">
          <h3 className="text-sm font-bold text-white px-0.5">Canceled or postponed · {removed.length}</h3>
          <p className="text-[11px] text-zinc-500 mb-2 px-0.5">Off the pick&apos;em — tap one to put it back.</p>
          <div className="space-y-1.5">{removed.map(card)}</div>
        </section>
      )}

      {/* While dragging: the sections, pinned to the bottom of the screen. */}
      {drag && (
        <div id="sheet-dock" className="fixed inset-x-0 bottom-0 z-50 bg-zinc-950/95 backdrop-blur-xl border-t border-white/[0.1] safe-bottom">
          <div className="max-w-3xl mx-auto px-3 py-2 grid grid-cols-4 gap-1.5">
            {LANES.map(l => (
              <div key={l.key} data-drop={l.key}
                className={`rounded-xl border px-1.5 py-2.5 text-center transition ${drag.over === l.key
                  ? 'border-yellow-400 bg-yellow-500/20 text-white'
                  : 'border-white/[0.1] bg-white/[0.03] text-zinc-300'}`}>
                <span className={`inline-block w-1.5 h-1.5 rounded-full mb-1 ${DOT[l.key]}`} />
                <p className="text-[11px] font-semibold leading-tight">{SHORT[l.key]}</p>
                <p className="text-[10px] text-zinc-500 tabular-nums">{inLane(l.key).length}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {drag && dragged && (
        <div ref={ghost} aria-hidden="true"
          className="fixed left-0 top-0 z-[60] pointer-events-none rounded-xl border border-yellow-400/60 bg-zinc-800/95 shadow-2xl shadow-black/50 px-3 py-2"
          style={{ width: drag.width, transform: `translate(${pointer.current.x - drag.offX}px, ${pointer.current.y - drag.offY}px)` }}>
          <p className="text-[13px] font-semibold text-white truncate">{dragged.name}</p>
          <p className="text-[11px] text-zinc-400 truncate">{kickoffText(dragged.kickoff_time, dragged.time_tbd)}</p>
        </div>
      )}
    </div>
  )
}
