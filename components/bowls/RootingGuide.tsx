import { useState } from 'react'
import { rootingGuide, LEAD_MARGIN, type Rival } from '@/lib/bowls/rooting'
import { kickoffText } from '@/lib/bowls/format'
import { scoreOf, type BowlLive } from '@/lib/bowls/live'
import { PHASE_TONE, TeamLogo } from '@/components/bowls/ui'
import { firstName, pts, type Board } from '@/components/bowls/board'

/**
 * "Rooting guide" — for the signed-in player, the games still to play where
 * their pick differs from the top 3 (or, in first, from anyone within 2
 * points), with what each is worth. Picks only come out at the lock, so this
 * only shows once the board does.
 */
const SHOWN = 5

const names = (rs: Rival[]) => {
  const n = rs.map(r => firstName(r.name))
  return n.length <= 2 ? n.join(' & ') : `${n.slice(0, -1).join(', ')} & ${n[n.length - 1]}`
}
const place = (r: Rival) => `${r.tied ? 'T' : ''}${r.rank}`

export function RootingGuideCard({ board, me, live }: { board: Board; me?: string; live?: Map<string, BowlLive> }) {
  const [all, setAll] = useState(false)
  if (board.hidden) return null
  const guide = rootingGuide(board, me)
  if (guide.mode === 'none') return null

  return (
    <section className="glass-card rounded-2xl p-4" aria-label="Rooting guide">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-white">📣 Rooting guide</h2>
        {guide.rows.length > 0 && <span className="text-[11px] text-zinc-500 tabular-nums">{guide.rows.length} {guide.rows.length === 1 ? 'game' : 'games'} that matter</span>}
      </div>

      {guide.mode === 'out' ? (
        <p className="text-xs text-zinc-400 mt-1.5">You can&apos;t finish first any more — {guide.reason}. Root for whoever you like!</p>
      ) : (
        <p className="text-xs text-zinc-400 mt-1">
          {guide.mode === 'leading'
            ? guide.rivals.length
              ? <>You&apos;re in first. Within {LEAD_MARGIN} points of you: {guide.rivals.map((r, i) => <span key={r.id}>{i ? ', ' : ''}<strong className="text-zinc-200">{firstName(r.name)}</strong> {pts(r.points)}</span>)}.</>
              : <>You&apos;re in first, and nobody&apos;s within {LEAD_MARGIN} points of you.</>
            : <>Where your picks differ from the top 3: {guide.rivals.map((r, i) => <span key={r.id}>{i ? ', ' : ''}<strong className="text-zinc-200">{firstName(r.name)}</strong> ({place(r)}, {pts(r.points)})</span>)}.</>}
        </p>
      )}

      {guide.mode !== 'out' && guide.rivals.length > 0 && !guide.rows.length && (
        <p className="text-xs text-zinc-500 mt-2">You picked the same as {names(guide.rivals)} in every game left that can still count.</p>
      )}

      {guide.rows.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label="Games to root for">
          {(all ? guide.rows : guide.rows.slice(0, SHOWN)).map(r => {
            const lv = live?.get(r.game.id)
            const on = lv?.state === 'in'
            const sc = on ? scoreOf(r.game, lv) : null
            return (
              <li key={r.game.id} className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2.5" data-root={r.game.id}>
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.game.phase ? PHASE_TONE[r.game.phase].dot : 'bg-zinc-500'}`} />
                  <span className="truncate">{r.game.name}</span>
                  <span className="shrink-0">· {pts(r.points)} {r.points === 1 ? 'pt' : 'pts'}</span>
                  <span className="ml-auto shrink-0">
                    {on ? <span className="font-semibold text-red-400 tabular-nums">● {lv?.label ?? 'Live'} {sc?.away ?? 0}–{sc?.home ?? 0}</span> : kickoffText(r.game.kickoff_time, r.game.time_tbd)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 min-w-0">
                  {r.rootFor ? (
                    <span className="flex items-center gap-1.5 min-w-0 text-sm font-semibold text-white">
                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-emerald-300">Root for</span>
                      <TeamLogo team={r.rootFor} size={20} />
                      <span className="truncate">{r.rootFor.name}</span>
                      {r.mine && r.myStar && <span className="shrink-0 text-yellow-400" title="In your Best 5">★</span>}
                    </span>
                  ) : r.rootAgainst && (
                    <span className="flex items-center gap-1.5 min-w-0 text-sm font-semibold text-white">
                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-red-300">Root against</span>
                      <TeamLogo team={r.rootAgainst} size={20} />
                      <span className="truncate">{r.rootAgainst.name}</span>
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-zinc-400 leading-snug">
                  {!r.mine && <span className="text-zinc-500">Your pick&apos;s out of this one. </span>}
                  {r.others.map((o, i) => (
                    <span key={o.team?.id ?? 'none'}>{i ? ' · ' : ''}{names(o.rivals)}: {o.team ? <span className="text-zinc-200">{o.team.name}</span> : <span className="text-zinc-500">no pick alive</span>}</span>
                  ))}
                </p>
              </li>
            )
          })}
        </ul>
      )}
      {guide.rows.length > SHOWN && (
        <button type="button" onClick={() => setAll(!all)} className="mt-2 text-xs font-semibold text-yellow-500 hover:text-yellow-400">
          {all ? 'Show fewer' : `Show all ${guide.rows.length}`}
        </button>
      )}
    </section>
  )
}
