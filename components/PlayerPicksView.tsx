import { useState } from 'react'
import { NFL_TEAMS } from '@/lib/nflTeams'
import { shortName } from '@/lib/displayName'
import type { LiveGame } from '@/lib/liveScores'

/*
 * All Picks → By player: one person's whole week at a glance. Pick someone
 * from the row of faces (you first) and see their record for the week, their
 * Best 3 and season records, and every game: their pick, ⭐ for a Best 3, and
 * how it's going — won, lost, or live and winning/losing right now.
 *
 * Display only: it reads the same picks the Games and Table views do.
 */

interface Game {
  id: string
  away_team: string
  home_team: string
  kickoff_time: string
  winning_team: string | null
  away_score: number | null
  home_score: number | null
}

interface User { id: string; name: string; avatar_url: string | null }

export interface PlayerRecord {
  weekW: number; weekL: number; weekT: number
  weekB3W: number; weekB3L: number; weekB3T: number
  totalW: number; totalL: number; totalT: number
}

const rec = (w: number, l: number, t: number) => `${w}–${l}${t ? `–${t}` : ''}`

function Face({ user, size }: { user: User; size: number }) {
  return user.avatar_url
    ? <img src={user.avatar_url} alt="" className="rounded-full object-cover border border-white/[0.08] shrink-0" style={{ width: size, height: size }} />
    : (
      <span className="rounded-full bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center font-bold text-white shrink-0"
        style={{ width: size, height: size, fontSize: size * 0.42 }}>
        {user.name.charAt(0).toUpperCase()}
      </span>
    )
}

export default function PlayerPicksView({ users, games, pickOf, bestOf, meId, live, week, recordOf, formatKickoff }: {
  users: User[]
  games: Game[]
  pickOf: (userId: string, gameId: string) => string | undefined
  bestOf: (userId: string) => Set<string> | undefined
  meId: string
  live: Map<string, LiveGame>
  week: number
  recordOf: (userId: string) => PlayerRecord
  formatKickoff: (iso: string) => string
}) {
  const ordered = [...users.filter(u => u.id === meId), ...users.filter(u => u.id !== meId)]
  const [selected, setSelected] = useState<string>(ordered[0]?.id ?? '')
  const who = ordered.find(u => u.id === selected) ?? ordered[0]
  if (!who) return null
  const r = recordOf(who.id)
  const best = bestOf(who.id)

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Player" className="flex gap-2 overflow-x-auto no-scrollbar -mx-3 px-3 pb-1">
        {ordered.map(u => (
          <button key={u.id} type="button" role="tab" aria-selected={u.id === who.id} onClick={() => setSelected(u.id)}
            className={`press shrink-0 flex flex-col items-center gap-1 w-14 py-1.5 rounded-xl transition ${u.id === who.id ? 'bg-blue-500/15 ring-1 ring-blue-500/50' : 'hover:bg-white/[0.04]'}`}>
            <Face user={u} size={34} />
            <span className={`text-[10px] truncate max-w-[52px] ${u.id === who.id ? 'text-blue-200 font-semibold' : 'text-slate-400'}`}>{u.id === meId ? 'You' : shortName(u.name)}</span>
          </button>
        ))}
      </div>

      <div className="glass-card rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <Face user={who} size={46} />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold text-white truncate">{who.name}</p>
            <p className="text-xs text-slate-400">Season {rec(r.totalW, r.totalL, r.totalT)}</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl bg-white/[0.04] py-2">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Week {week}</p>
            <p className="text-base font-bold text-white tabular-nums">{rec(r.weekW, r.weekL, r.weekT)}</p>
          </div>
          <div className="rounded-xl bg-white/[0.04] py-2">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">⭐ Best 3</p>
            <p className="text-base font-bold text-amber-400 tabular-nums">{rec(r.weekB3W, r.weekB3L, r.weekB3T)}</p>
          </div>
        </div>
      </div>

      <div className="glass-card rounded-2xl divide-y divide-white/[0.05]">
        {games.map(g => {
          const picked = pickOf(who.id, g.id)
          const team = picked ? NFL_TEAMS[picked] : undefined
          const star = !!(picked && best?.has(picked))
          const lg = live.get(g.id)
          const on = !g.winning_team && lg?.state === 'in'
          const tie = g.winning_team === 'TIE'
          const won = !!(picked && g.winning_team && !tie && picked === g.winning_team)
          const lost = !!(picked && g.winning_team && !tie && picked !== g.winning_team)
          const mine = picked === g.away_team ? lg?.awayScore : lg?.homeScore
          const theirs = picked === g.away_team ? lg?.homeScore : lg?.awayScore
          const ahead = on && picked && mine != null && theirs != null ? Math.sign(mine - theirs) : null
          return (
            <div key={g.id} className={`flex items-center gap-3 px-3 py-2.5 ${star ? 'bg-amber-500/[0.05]' : ''}`}>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-slate-500 truncate">
                  {g.away_team} @ {g.home_team}
                  {g.winning_team && g.away_score != null && <span className="ml-1 tabular-nums">· {g.away_score}–{g.home_score}</span>}
                </p>
                {picked ? (
                  <p className={`flex items-center gap-2 min-w-0 text-sm ${lost ? 'text-slate-500' : 'text-white'}`}>
                    {team && <img src={team.logo} alt="" className="logo-edge w-6 h-6 object-contain shrink-0" />}
                    <span className="truncate"><span className="font-bold">{team?.city ?? picked}</span> <span className="font-normal">{team?.name ?? ''}</span></span>
                    {star && <span className="text-amber-400 shrink-0" title="Best 3">⭐</span>}
                  </p>
                ) : <p className="text-sm text-slate-600">No pick</p>}
              </div>
              <div className="shrink-0 text-right">
                {won ? <span className="text-sm font-bold text-emerald-400">✓</span>
                  : lost ? <span className="text-sm font-bold text-red-400">✗</span>
                  : tie ? <span className="text-[11px] font-semibold text-slate-400">Tie</span>
                  : on ? (
                    <span className="flex flex-col items-end leading-tight">
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-400"><span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />{lg?.label}</span>
                      <span className="text-xs font-semibold tabular-nums text-white">{lg?.awayScore ?? 0}–{lg?.homeScore ?? 0}</span>
                      {ahead !== null && <span className={`text-[10px] font-semibold ${ahead > 0 ? 'text-emerald-400' : ahead < 0 ? 'text-red-400' : 'text-slate-400'}`}>{ahead > 0 ? 'Winning' : ahead < 0 ? 'Losing' : 'Tied'}</span>}
                    </span>
                  )
                  : <span className="text-[11px] text-slate-500">{formatKickoff(g.kickoff_time)}</span>}
              </div>
            </div>
          )
        })}
        {!games.length && <p className="px-3 py-6 text-center text-sm text-slate-500">No games match.</p>}
      </div>
    </div>
  )
}
