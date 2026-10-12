import type { PlayEvent, PlayKind } from '@/lib/useLiveEvents'

/*
 * The big-play highlight: a colour wash over a live game's scoreboard and a
 * banner naming the play. Absolutely positioned — drop it inside any
 * `relative` panel. Keyed on the event, so a second touchdown re-animates.
 */

const LOOK: Record<PlayKind, { label: string; icon: string; wash: string; pill: string }> = {
  touchdown: {
    label: 'Touchdown', icon: '🏈',
    wash: 'bg-gradient-to-r from-amber-400/0 via-amber-400/35 to-amber-400/0',
    pill: 'bg-amber-400 text-slate-900 shadow-amber-500/50',
  },
  field_goal: {
    label: 'Field goal', icon: '🥅',
    wash: 'bg-gradient-to-r from-sky-400/0 via-sky-400/30 to-sky-400/0',
    pill: 'bg-sky-400 text-slate-900 shadow-sky-500/50',
  },
  safety: {
    label: 'Safety', icon: '🛡️',
    wash: 'bg-gradient-to-r from-fuchsia-400/0 via-fuchsia-400/30 to-fuchsia-400/0',
    pill: 'bg-fuchsia-400 text-slate-900 shadow-fuchsia-500/50',
  },
  turnover: {
    label: 'Turnover', icon: '🔄',
    wash: 'bg-gradient-to-r from-red-500/0 via-red-500/35 to-red-500/0',
    pill: 'bg-red-500 text-white shadow-red-600/50',
  },
}

export default function PlayFlash({ event, compact = false }: { event: PlayEvent | undefined; compact?: boolean }) {
  if (!event) return null
  const look = LOOK[event.kind]
  const what = event.kind === 'turnover' ? `${event.team} ball` : event.team
  return (
    <div key={event.key} className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center" role="status" aria-live="polite">
      <div className={`play-wash absolute inset-0 ${look.wash}`} />
      <div className={`play-banner relative flex flex-col items-center rounded-xl shadow-lg ${look.pill} ${compact ? 'px-2.5 py-1' : 'px-4 py-1.5'}`}>
        <span className={`font-black uppercase tracking-wider leading-tight ${compact ? 'text-[11px]' : 'text-sm'}`}>
          {look.icon} {look.label} · {what}
        </span>
        {event.detail && !compact && (
          <span className="text-[10px] font-semibold opacity-80 leading-tight">{event.detail}</span>
        )}
      </div>
    </div>
  )
}
