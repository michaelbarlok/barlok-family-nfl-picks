import type { BowlGame } from '@/lib/bowls/sheet'
import { ourSide, type BowlLive, type Side } from '@/lib/bowls/live'
import type { PlayEvent, PlayKind } from '@/lib/bowls/useBowlLive'

/*
 * The live pieces of a bowl game card — the bowl version of the NFL's game
 * cast: a LIVE tag with the clock, a small field showing where the ball is,
 * the last play, and a flash for a touchdown, field goal, safety or turnover.
 */

/** "● LIVE Q3 4:12" while on; "Final" once the feed has it before our result does. */
export function LiveTag({ live, className = '' }: { live: BowlLive; className?: string }) {
  if (live.state === 'post') return <span className={`font-semibold text-zinc-300 ${className}`}>{live.label ?? 'Final'}</span>
  if (live.state !== 'in') return null
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="inline-flex items-center gap-1 font-bold text-red-400">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />LIVE
      </span>
      {live.label && <span className="font-mono font-semibold text-white">{live.label}</span>}
      {live.redZone && <span className="text-[9px] font-bold text-red-300 bg-red-500/20 px-1.5 py-0.5 rounded-full">RED ZONE</span>}
    </span>
  )
}

const hex = (c: string | null, fallback: string) => (c ? `#${c}` : fallback)

/**
 * A small field: the away team's end zone on the left, home on the right (the
 * order the cards list them), yard lines every ten, the ball on the line of
 * scrimmage with an arrow for the direction of the drive, and the red zone
 * shaded once they're inside it. Nothing at all when the feed hasn't said
 * where the ball is, so it never shows the ball somewhere it isn't.
 */
export function FieldStrip({ game, live }: { game: BowlGame; live: BowlLive }) {
  const x = live.ballOn
  if (x === null || !live.possession) return null
  const towardHome = live.possession === 'away'
  const inRedZone = towardHome ? x >= 80 : x <= 20
  const EZ = 8
  const pos = (yard: number) => EZ + (yard / 100) * (100 - 2 * EZ)
  // Our game's names for ESPN's sides.
  const team = (side: Side) => (ourSide(game, live, side) === 'away' ? game.away : game.home)
  const label = (side: Side) => team(side)?.abbr ?? team(side)?.name ?? ''
  const withBall = team(live.possession)

  return (
    <div className="select-none" aria-label={`${withBall?.name ?? 'Team'} ball${live.downDistance ? `, ${live.downDistance}` : ''}`}>
      <div className="relative h-8 rounded-md overflow-hidden bg-emerald-900/45 border border-emerald-500/20">
        {(['away', 'home'] as const).map(side => (
          <div key={side} className={`absolute inset-y-0 ${side === 'away' ? 'left-0' : 'right-0'} flex items-center justify-center`}
            style={{ width: `${EZ}%`, background: hex(side === 'away' ? live.awayColor : live.homeColor, '#065f46'), opacity: 0.85 }}>
            <span className={`${side === 'away' ? '-rotate-90' : 'rotate-90'} whitespace-nowrap text-[8px] font-black tracking-wider text-white/80`}>{label(side)}</span>
          </div>
        ))}
        {inRedZone && (
          <div className="absolute inset-y-0 bg-red-500/25"
            style={towardHome ? { left: `${pos(80)}%`, width: `${pos(100) - pos(80)}%` } : { left: `${pos(0)}%`, width: `${pos(20) - pos(0)}%` }} />
        )}
        {[10, 20, 30, 40, 50, 60, 70, 80, 90].map(y => (
          <div key={y} className={`absolute inset-y-0 w-px ${y === 50 ? 'bg-white/40' : 'bg-white/15'}`} style={{ left: `${pos(y)}%` }} />
        ))}
        <div className="absolute inset-y-0 w-0.5 bg-yellow-300/80" style={{ left: `${pos(x)}%` }} />
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex items-center transition-[left] duration-700 ease-out" style={{ left: `${pos(x)}%` }}>
          {!towardHome && <span className="text-[10px] text-white font-black leading-none mr-px">◀</span>}
          <span className="text-sm leading-none drop-shadow">🏈</span>
          {towardHome && <span className="text-[10px] text-white font-black leading-none ml-px">▶</span>}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 mt-1.5 text-[11px]">
        <span className="font-bold text-white shrink-0">🏈 {withBall?.name ?? 'Their'} ball</span>
        {(live.downDistance ?? live.lastPlayType) && <span className="text-zinc-300 font-medium truncate">{live.downDistance ?? live.lastPlayType}</span>}
      </div>
    </div>
  )
}

/** The game-cast block under a live card's teams: the field and the last play. */
export function GameCast({ game, live }: { game: BowlGame; live: BowlLive }) {
  if (live.state !== 'in') return null
  return (
    <div className="mt-3 space-y-1.5">
      <FieldStrip game={game} live={live} />
      {live.lastPlay && <p className="text-[11px] text-zinc-400 leading-snug line-clamp-2"><span className="text-zinc-500">Last play:</span> {live.lastPlay}</p>}
    </div>
  )
}

const LOOK: Record<PlayKind, { label: string; wash: string; pill: string }> = {
  touchdown: { label: 'Touchdown', wash: 'bg-gradient-to-r from-yellow-400/0 via-yellow-400/35 to-yellow-400/0', pill: 'bg-yellow-400 text-zinc-950 shadow-yellow-500/50' },
  field_goal: { label: 'Field goal', wash: 'bg-gradient-to-r from-sky-400/0 via-sky-400/30 to-sky-400/0', pill: 'bg-sky-400 text-zinc-950 shadow-sky-500/50' },
  safety: { label: 'Safety', wash: 'bg-gradient-to-r from-fuchsia-400/0 via-fuchsia-400/30 to-fuchsia-400/0', pill: 'bg-fuchsia-400 text-zinc-950 shadow-fuchsia-500/50' },
  turnover: { label: 'Turnover', wash: 'bg-gradient-to-r from-red-500/0 via-red-500/35 to-red-500/0', pill: 'bg-red-500 text-white shadow-red-600/50' },
}

/** The big-play highlight over a card. Drop it inside a `relative` box. */
export function PlayFlash({ game, live, event }: { game: BowlGame; live: BowlLive | undefined; event: PlayEvent | undefined }) {
  if (!event || !live) return null
  const look = LOOK[event.kind]
  const t = ourSide(game, live, event.side) === 'away' ? game.away : game.home
  const who = t?.name ?? 'Team'
  return (
    <div key={event.key} className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center" role="status" aria-live="polite">
      <div className={`play-wash absolute inset-0 ${look.wash}`} />
      <div className={`play-banner relative flex flex-col items-center rounded-xl shadow-lg px-4 py-1.5 ${look.pill}`}>
        <span className="font-black uppercase tracking-wider leading-tight text-sm">{look.label} · {event.kind === 'turnover' ? `${who} ball` : who}</span>
        {event.detail && <span className="text-[10px] font-semibold opacity-80 leading-tight">{event.detail}</span>}
      </div>
    </div>
  )
}
