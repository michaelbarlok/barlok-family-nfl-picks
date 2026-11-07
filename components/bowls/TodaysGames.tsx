import Link from 'next/link'
import type { BowlGame, BowlTeam } from '@/lib/bowls/sheet'
import { ourSide, scoreOf, type BowlLive } from '@/lib/bowls/live'
import { kickoffText } from '@/lib/bowls/format'
import { PHASE_TONE, TeamLogo, TeamName } from '@/components/bowls/ui'
import { LiveTag } from '@/components/bowls/live'
import type { Board } from '@/components/bowls/board'

/*
 * Today's games, on the Bowl Pick'em home page once picks have locked: every
 * game on today (in your own time zone) plus any still going from last night,
 * live ones first — the score, the clock, who has the ball, your pick and how
 * the group split. On a day without games it shows the next game day instead.
 * Each game opens its card in All Picks.
 */

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

export function todaysGames(board: Board, live: Map<string, BowlLive>, now = new Date()): { title: string; games: BowlGame[] } | null {
  const sheet = (board.games ?? []).filter(g => g.kickoff_time && !g.removed)
  const isOn = (g: BowlGame) => live.get(g.id)?.state === 'in'
  const today = dayKey(now)
  let games = sheet.filter(g => dayKey(new Date(g.kickoff_time!)) === today || isOn(g))
  let title = "Today's games"
  if (!games.length) {
    const next = sheet.filter(g => Date.parse(g.kickoff_time!) > now.getTime())
      .sort((a, b) => a.kickoff_time!.localeCompare(b.kickoff_time!))[0]
    if (!next) return null
    const day = dayKey(new Date(next.kickoff_time!))
    games = sheet.filter(g => dayKey(new Date(g.kickoff_time!)) === day)
    title = `Next up · ${new Date(next.kickoff_time!).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`
  }
  const order = (g: BowlGame) => (isOn(g) ? 0 : 1)
  return { title, games: [...games].sort((a, b) => order(a) - order(b) || a.kickoff_time!.localeCompare(b.kickoff_time!)) }
}

export default function TodaysGames({ board, live, me }: { board: Board; live: Map<string, BowlLive>; me?: string }) {
  const day = todaysGames(board, live)
  if (!day) return null
  const liveCount = day.games.filter(g => live.get(g.id)?.state === 'in').length
  const pickers = (teamId: string, gameId: string) =>
    Object.values(board.picks ?? {}).filter(p => p[gameId] === teamId).length

  return (
    <section aria-label={day.title} className="glass-card rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
        <h2 className="text-sm font-semibold text-white">{day.title}</h2>
        {liveCount > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-400">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />{liveCount} live
          </span>
        )}
        <Link href="/bowls/all-picks" className="ml-auto text-xs font-semibold text-yellow-500 hover:text-yellow-400">All games →</Link>
      </div>
      <ul className="divide-y divide-white/[0.05]">
        {day.games.map(g => {
          const lv = live.get(g.id)
          const on = lv?.state === 'in'
          const final = g.status === 'final' || lv?.state === 'post'
          const sc = scoreOf(g, lv)
          const ball = on && lv!.possession ? ourSide(g, lv!, lv!.possession) : null
          const mine = me ? board.picks?.[me]?.[g.id] : undefined
          const winner = g.status === 'final' ? g.winner_team_id
            : lv?.state === 'post' && sc.away !== null && sc.home !== null && sc.away !== sc.home ? (sc.away > sc.home ? g.away?.id : g.home?.id) ?? null
            : null
          const row = (t: BowlTeam | null, side: 'away' | 'home') => {
            const score = side === 'away' ? sc.away : sc.home
            const other = side === 'away' ? sc.home : sc.away
            const ahead = score !== null && other !== null && score > other
            const lost = !!winner && !!t && winner !== t.id
            const picked = !!t && mine === t.id
            return (
              <div className="flex items-center gap-2 min-w-0 py-0.5">
                <TeamLogo team={t} size={20} />
                {t ? <TeamName team={t} className={`text-sm truncate ${lost ? 'text-zinc-500' : 'text-white'} ${ahead ? 'font-semibold' : ''}`} />
                  : <span className="text-sm text-zinc-500 italic">TBD</span>}
                {ball === side && <span className="text-xs shrink-0" title="Has the ball">🏈</span>}
                {picked && (
                  <span className={`shrink-0 text-[10px] font-semibold rounded-full px-1.5 py-px border ${winner ? (winner === t!.id ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' : 'text-red-300 border-red-500/30 bg-red-500/10') : 'text-yellow-300 border-yellow-500/30 bg-yellow-500/10'}`}>
                    {winner ? (winner === t!.id ? '✓ ' : '✗ ') : ''}Your pick
                  </span>
                )}
                <span className="ml-auto shrink-0 text-[11px] text-zinc-500 tabular-nums">{t ? `${pickers(t.id, g.id)} picks` : ''}</span>
                <span className={`w-7 shrink-0 text-right text-base font-extrabold tabular-nums ${score === null ? 'text-zinc-700' : ahead || (winner && t && winner === t.id) ? 'text-white' : 'text-zinc-400'}`}>
                  {score ?? ''}
                </span>
              </div>
            )
          }
          return (
            <li key={g.id}>
              <Link href={`/bowls/all-picks?view=game#game-${g.id}`} className={`block px-4 py-2.5 transition hover:bg-white/[0.03] ${on ? 'bg-red-500/[0.05]' : ''}`}>
                <div className="flex items-center gap-2 text-[11px] mb-1 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PHASE_TONE[g.phase!].dot}`} />
                  <span className="font-semibold text-zinc-300 truncate">{g.name}</span>
                  <span className="ml-auto shrink-0 text-zinc-500">
                    {on || lv?.state === 'post' ? <LiveTag live={lv!} />
                      : final ? <span className="font-semibold text-zinc-300">Final</span>
                      : <>{kickoffText(g.kickoff_time, g.time_tbd).split(' · ').pop()}{g.tv ? ` · ${g.tv}` : ''}</>}
                  </span>
                </div>
                {row(g.away, 'away')}
                {row(g.home, 'home')}
                {on && (lv!.downDistance || lv!.lastPlayType) && (
                  <p className="text-[10px] text-zinc-500 mt-0.5 truncate">{lv!.downDistance ?? lv!.lastPlayType}</p>
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
