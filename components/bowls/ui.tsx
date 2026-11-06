import { useState } from 'react'
import type { BowlTeam, Phase } from '@/lib/bowls/sheet'

/* Small pieces shared by the bowl pages. */

/** Each phase's color: a dot, a soft badge and the selected-pick look. */
export const PHASE_TONE: Record<Phase, { dot: string; badge: string; text: string }> = {
  little: { dot: 'bg-emerald-400', badge: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20', text: 'text-emerald-300' },
  between: { dot: 'bg-sky-400', badge: 'bg-sky-400/10 text-sky-300 border-sky-400/20', text: 'text-sky-300' },
  big: { dot: 'bg-violet-400', badge: 'bg-violet-400/10 text-violet-300 border-violet-400/20', text: 'text-violet-300' },
  playoff: { dot: 'bg-red-500', badge: 'bg-red-500/10 text-red-300 border-red-500/20', text: 'text-red-300' },
  semi: { dot: 'bg-rose-400', badge: 'bg-rose-400/10 text-rose-300 border-rose-400/20', text: 'text-rose-300' },
  title: { dot: 'bg-yellow-500', badge: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/20', text: 'text-yellow-300' },
}

export function TeamLogo({ team, size = 28 }: { team: BowlTeam | null; size?: number }) {
  const [broken, setBroken] = useState(false)
  if (team?.logo && !broken) {
    return <img src={team.logo} alt="" loading="lazy" onError={() => setBroken(true)} className="object-contain shrink-0" style={{ width: size, height: size }} />
  }
  return (
    <span className="rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-[10px] font-bold text-zinc-400 shrink-0"
      style={{ width: size, height: size }}>
      {team?.abbr?.slice(0, 4) ?? '?'}
    </span>
  )
}

/** "#9 Alabama" */
export function TeamName({ team, className = '' }: { team: BowlTeam; className?: string }) {
  return (
    <span className={className}>
      {team.rank && <span className="text-[0.8em] font-semibold text-zinc-400 mr-1">#{team.rank}</span>}
      {team.name}
    </span>
  )
}

/** One team in a short line: "#9 Alabama (10-3)", or TBD. */
export function TeamLine({ team, fallback = 'TBD' }: { team: BowlTeam | null; fallback?: string }) {
  if (!team) return <span className="text-zinc-500 italic">{fallback}</span>
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <TeamLogo team={team} size={18} />
      <TeamName team={team} className="truncate" />
      {team.record && <span className="text-zinc-500 text-[11px] shrink-0">({team.record})</span>}
    </span>
  )
}
