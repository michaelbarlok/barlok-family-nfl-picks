import { useState } from 'react'
import type { BowlTeam, Phase } from '@/lib/bowls/sheet'

/* Small pieces shared by the bowl pages. */

/**
 * Each phase's color: a dot, a soft badge, its text color, and — on My Picks —
 * the phase banner, the stripe down each game card's edge, and the selected tab.
 */
// fill: how much of a phase is picked, filling its tab; on: the open tab's outline.
export const PHASE_TONE: Record<Phase, { dot: string; badge: string; text: string; panel: string; stripe: string; tab: string; fill: string; on: string }> = {
  little: {
    dot: 'bg-emerald-400', badge: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20', text: 'text-emerald-300',
    panel: 'bg-gradient-to-br from-emerald-500/[0.16] via-emerald-500/[0.05] to-zinc-900 border-emerald-400/30',
    stripe: 'border-l-emerald-400', tab: 'bg-emerald-400/15 text-emerald-100 border-emerald-400/50',
    fill: 'bg-emerald-500/40', on: 'border-emerald-300 ring-1 ring-emerald-300/60',
  },
  between: {
    dot: 'bg-sky-400', badge: 'bg-sky-400/10 text-sky-300 border-sky-400/20', text: 'text-sky-300',
    panel: 'bg-gradient-to-br from-sky-500/[0.16] via-sky-500/[0.05] to-zinc-900 border-sky-400/30',
    stripe: 'border-l-sky-400', tab: 'bg-sky-400/15 text-sky-100 border-sky-400/50',
    fill: 'bg-sky-500/40', on: 'border-sky-300 ring-1 ring-sky-300/60',
  },
  big: {
    dot: 'bg-violet-400', badge: 'bg-violet-400/10 text-violet-300 border-violet-400/20', text: 'text-violet-300',
    panel: 'bg-gradient-to-br from-violet-500/[0.18] via-violet-500/[0.05] to-zinc-900 border-violet-400/30',
    stripe: 'border-l-violet-400', tab: 'bg-violet-400/15 text-violet-100 border-violet-400/50',
    fill: 'bg-violet-500/45', on: 'border-violet-300 ring-1 ring-violet-300/60',
  },
  playoff: {
    dot: 'bg-red-500', badge: 'bg-red-500/10 text-red-300 border-red-500/20', text: 'text-red-300',
    panel: 'bg-gradient-to-br from-red-500/[0.16] via-red-500/[0.05] to-zinc-900 border-red-500/30',
    stripe: 'border-l-red-500', tab: 'bg-red-500/15 text-red-100 border-red-500/50',
    fill: 'bg-red-500/40', on: 'border-red-400 ring-1 ring-red-400/60',
  },
  semi: {
    dot: 'bg-rose-400', badge: 'bg-rose-400/10 text-rose-300 border-rose-400/20', text: 'text-rose-300',
    panel: 'bg-gradient-to-br from-rose-500/[0.16] via-rose-500/[0.05] to-zinc-900 border-rose-400/30',
    stripe: 'border-l-rose-400', tab: 'bg-rose-400/15 text-rose-100 border-rose-400/50',
    fill: 'bg-rose-500/40', on: 'border-rose-300 ring-1 ring-rose-300/60',
  },
  title: {
    dot: 'bg-yellow-500', badge: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/20', text: 'text-yellow-300',
    panel: 'bg-gradient-to-br from-yellow-500/[0.16] via-yellow-500/[0.05] to-zinc-900 border-yellow-500/30',
    stripe: 'border-l-yellow-500', tab: 'bg-yellow-500/15 text-yellow-100 border-yellow-500/50',
    fill: 'bg-yellow-500/40', on: 'border-yellow-400 ring-1 ring-yellow-400/60',
  },
}

// A faint light edge, so dark logos (maroon, navy, black) still read on the
// black background; bright ones barely change. Keeps every team's colors.
const LOGO_EDGE = 'drop-shadow(0 0 1px rgba(255,255,255,0.55)) drop-shadow(0 0 1px rgba(255,255,255,0.35))'

export function TeamLogo({ team, size = 28 }: { team: BowlTeam | null; size?: number }) {
  const [broken, setBroken] = useState(false)
  if (team?.logo && !broken) {
    return <img src={team.logo} alt="" loading="lazy" onError={() => setBroken(true)} className="object-contain shrink-0" style={{ width: size, height: size, filter: LOGO_EDGE }} />
  }
  return (
    <span className="rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-[10px] font-bold text-zinc-400 shrink-0"
      style={{ width: size, height: size }}>
      {team?.abbr?.slice(0, 4) ?? '?'}
    </span>
  )
}

/**
 * "#9 Alabama" — or, with `nickname`, "#9 **Alabama** Crimson Tide": the
 * school in bold, the nickname in regular weight.
 */
export function TeamName({ team, className = '', nickname = false }: { team: BowlTeam; className?: string; nickname?: boolean }) {
  return (
    <span className={className}>
      {team.rank && <span className="text-[0.8em] font-semibold text-zinc-400 mr-1">#{team.rank}</span>}
      {nickname ? <span className="font-bold">{team.name}</span> : team.name}
      {nickname && team.nickname && <span className="font-normal"> {team.nickname}</span>}
    </span>
  )
}

/** "Tennessee Volunteers", for labels. */
export const fullTeamName = (team: BowlTeam): string => team.nickname ? `${team.name} ${team.nickname}` : team.name

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
