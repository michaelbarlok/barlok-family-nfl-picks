import { useState } from 'react'
import type { BowlTeam, Phase } from '@/lib/bowls/sheet'

/* Small pieces shared by the bowl pick sheet and the sheet builder. */

/** Each phase's color: a dot, a soft badge and the selected-pick look. */
export const PHASE_TONE: Record<Phase, { dot: string; badge: string }> = {
  little: { dot: 'bg-lime-500', badge: 'bg-lime-500/10 text-lime-300 border-lime-500/20' },
  between: { dot: 'bg-yellow-400', badge: 'bg-yellow-400/10 text-yellow-200 border-yellow-400/20' },
  big: { dot: 'bg-amber-500', badge: 'bg-amber-500/10 text-amber-300 border-amber-500/20' },
  playoff: { dot: 'bg-red-500', badge: 'bg-red-500/10 text-red-300 border-red-500/20' },
  semi: { dot: 'bg-rose-500', badge: 'bg-rose-500/10 text-rose-300 border-rose-500/20' },
  title: { dot: 'bg-orange-400', badge: 'bg-orange-400/10 text-orange-200 border-orange-400/20' },
}

export function TeamLogo({ team, size = 28 }: { team: BowlTeam | null; size?: number }) {
  const [broken, setBroken] = useState(false)
  if (team?.logo && !broken) {
    return <img src={team.logo} alt="" loading="lazy" onError={() => setBroken(true)} className="object-contain shrink-0" style={{ width: size, height: size }} />
  }
  return (
    <span className="rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-[10px] font-bold text-slate-400 shrink-0"
      style={{ width: size, height: size }}>
      {team?.abbr?.slice(0, 4) ?? '?'}
    </span>
  )
}

/** "#9 Alabama" */
export function TeamName({ team, className = '' }: { team: BowlTeam; className?: string }) {
  return (
    <span className={className}>
      {team.rank && <span className="text-[0.8em] font-semibold text-slate-400 mr-1">#{team.rank}</span>}
      {team.name}
    </span>
  )
}

/** One team in a short line: "#9 Alabama (10-3)", or TBD. */
export function TeamLine({ team, fallback = 'TBD' }: { team: BowlTeam | null; fallback?: string }) {
  if (!team) return <span className="text-slate-500 italic">{fallback}</span>
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <TeamLogo team={team} size={18} />
      <TeamName team={team} className="truncate" />
      {team.record && <span className="text-slate-500 text-[11px] shrink-0">({team.record})</span>}
    </span>
  )
}
