import type { LiveGame } from '@/lib/liveScores'

/*
 * A small football field showing where the ball is.
 *
 * Away end zone on the left, home on the right — the same order the cards
 * list the teams in ("away @ home"). Yard lines every ten yards, the ball on
 * the line of scrimmage with an arrow for the direction of the drive, a
 * yellow first-down line, and the red zone shaded once they're inside it.
 *
 * Draws nothing when the feed hasn't said where the ball is (between plays
 * ESPN sometimes drops it), so a stale or partial situation never shows the
 * ball somewhere it isn't.
 */

export default function FieldStrip({ game, compact = false }: { game: LiveGame; compact?: boolean }) {
  const x = game.ballOn // 0 = away goal line, 100 = home goal line
  if (x === null || !game.possession) return null

  const towardHome = game.possession === game.away // away team drives left → right
  const firstDown = game.distance !== null && !game.goalToGo
    ? clamp(towardHome ? x + game.distance : x - game.distance)
    : null
  // Inside the opponent's 20, on the side they're driving toward.
  const inRedZone = towardHome ? x >= 80 : x <= 20

  // Field geometry, in percent of the strip's width: two end zones of 8%
  // and 100 yards across the 84% between them.
  const EZ = 8
  const pos = (yard: number) => EZ + (yard / 100) * (100 - 2 * EZ)
  const h = compact ? 'h-7' : 'h-9'

  return (
    <div className="select-none" aria-label={`${game.possession} ball${game.downDistance ? `, ${game.downDistance}` : ''}`}>
      <div className={`relative ${h} rounded-md overflow-hidden bg-emerald-900/50 border border-emerald-500/20`}>
        {/* End zones */}
        <div
          className="absolute inset-y-0 left-0 flex items-center justify-center text-[9px] font-black tracking-wider bg-emerald-800/70 text-emerald-200/40"
          style={{ width: `${EZ}%` }}
        >
          <span className="-rotate-90 whitespace-nowrap">{game.away}</span>
        </div>
        <div
          className="absolute inset-y-0 right-0 flex items-center justify-center text-[9px] font-black tracking-wider bg-emerald-800/70 text-emerald-200/40"
          style={{ width: `${EZ}%` }}
        >
          <span className="rotate-90 whitespace-nowrap">{game.home}</span>
        </div>

        {/* Red zone: the 20 yards in front of the end zone they're attacking */}
        {inRedZone && (
          <div
            className="absolute inset-y-0 bg-red-500/25"
            style={towardHome
              ? { left: `${pos(80)}%`, width: `${pos(100) - pos(80)}%` }
              : { left: `${pos(0)}%`, width: `${pos(20) - pos(0)}%` }}
          />
        )}

        {/* Yard lines every 10, the 50 a little brighter */}
        {[10, 20, 30, 40, 50, 60, 70, 80, 90].map(y => (
          <div
            key={y}
            className={`absolute inset-y-0 w-px ${y === 50 ? 'bg-white/40' : 'bg-white/15'}`}
            style={{ left: `${pos(y)}%` }}
          />
        ))}
        {!compact && [20, 50, 80].map(y => (
          <span
            key={y}
            className="absolute bottom-0 -translate-x-1/2 text-[7px] font-bold text-white/30 leading-none pb-0.5"
            style={{ left: `${pos(y)}%` }}
          >
            {y === 50 ? 50 : 20}
          </span>
        ))}

        {/* First-down line */}
        {firstDown !== null && (
          <div className="absolute inset-y-0 w-0.5 bg-yellow-300/90 shadow-[0_0_4px_rgba(253,224,71,0.8)]" style={{ left: `${pos(firstDown)}%` }} />
        )}

        {/* Line of scrimmage + ball, arrow pointing the way they're going */}
        <div className="absolute inset-y-0 w-0.5 bg-blue-300/80" style={{ left: `${pos(x)}%` }} />
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex items-center transition-[left] duration-700 ease-out"
          style={{ left: `${pos(x)}%` }}
        >
          {!towardHome && <span className="text-[10px] text-white font-black leading-none mr-px">◀</span>}
          <span className={`${compact ? 'text-sm' : 'text-base'} leading-none drop-shadow`}>🏈</span>
          {towardHome && <span className="text-[10px] text-white font-black leading-none ml-px">▶</span>}
        </div>
      </div>

      {!compact && (
        <div className="flex items-center justify-between gap-2 mt-1.5 text-[11px]">
          <span className="font-bold text-white shrink-0">🏈 {game.possession} ball</span>
          {/* Between plays there's no down & distance; say what's happening instead */}
          {(game.downDistance ?? game.lastPlayType) && (
            <span className="text-slate-300 font-medium truncate">{game.downDistance ?? game.lastPlayType}</span>
          )}
        </div>
      )}
    </div>
  )
}

const clamp = (y: number) => Math.max(0, Math.min(100, y))
