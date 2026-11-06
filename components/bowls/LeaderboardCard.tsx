import Link from 'next/link'
import { BowlAvatar } from '@/components/bowls/BowlHeader'
import { ResultsLine, pts, type Board } from '@/components/bowls/board'
import { TIEBREAK_LABEL } from '@/lib/bowls/scoring'

/** The top of the standings for the bowl home page, plus your own row if you're further down. */
export function LeaderboardCard({ board, me }: { board: Board; me?: string }) {
  const all = board.standings ?? []
  const top = all.slice(0, 5)
  const mine = me ? all.find(s => s.id === me) : undefined
  const rows = mine && !top.some(s => s.id === me) ? [...top, mine] : top
  return (
    <section className="glass-card rounded-2xl p-4" aria-label="Leaderboard">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h2 className="text-sm font-bold text-white">Leaderboard</h2>
        <Link href="/bowls/standings" className="text-xs font-semibold text-yellow-500 hover:text-yellow-400">Full standings →</Link>
      </div>
      <ResultsLine board={board} />
      <ol className="mt-3 space-y-1">
        {rows.map((s, i) => (
          <li key={s.id} className={`flex items-center gap-3 rounded-xl px-2 py-1.5 ${s.id === me ? 'bg-yellow-500/[0.08]' : ''} ${i === top.length && rows.length > top.length ? 'mt-2 border-t border-white/[0.06] pt-2.5' : ''}`}>
            <span className={`w-7 text-center text-sm font-extrabold tabular-nums ${s.rank === 1 && board.decided ? 'text-yellow-400' : 'text-zinc-400'}`}>{s.tied ? 'T' : ''}{s.rank}</span>
            <BowlAvatar name={s.name} url={s.avatar_url} size={28} />
            <span className="flex-1 min-w-0">
              <span className={`block truncate text-sm font-semibold ${s.id === me ? 'text-yellow-300' : 'text-white'}`}>{s.name}</span>
              {s.aheadOn && <span className="block text-[10px] text-yellow-500/80 leading-tight">ahead on {TIEBREAK_LABEL[s.aheadOn]}</span>}
            </span>
            <span className="text-[11px] text-zinc-500 tabular-nums">{s.wins}–{s.losses}</span>
            <span className="w-12 text-right text-base font-extrabold text-white tabular-nums">{pts(s.points)}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
