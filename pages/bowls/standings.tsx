import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { useBowlAuth } from '@/lib/bowls/auth'
import { PHASES, pickSections } from '@/lib/bowls/sheet'
import { TIEBREAK_LABEL, type Standing } from '@/lib/bowls/scoring'
import BowlHeader, { BowlAvatar } from '@/components/bowls/BowlHeader'
import { PHASE_TONE, TeamLogo } from '@/components/bowls/ui'
import { DemoNote, HiddenUntilLock, ResultsLine, StreakBadge, UpdateResults, firstName, pts, sectionPoints, useBoard, winStreak } from '@/components/bowls/board'
import { useBowlLive } from '@/lib/bowls/useBowlLive'

const rankText = (s: Standing) => `${s.tied ? 'T' : ''}${s.rank}`
const MEDAL = ['from-yellow-300 to-yellow-600', 'from-zinc-200 to-zinc-400', 'from-amber-600 to-amber-800']

/**
 * Standings: points, then Best 5, then semifinal picks, then the closest
 * title-game total (the guess under wins an equal miss). Results are as of
 * the last "Pull from ESPN".
 */
export default function BowlStandings() {
  const router = useRouter()
  const { loading, account, player } = useBowlAuth()
  const { board, error, reload } = useBoard()
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => { if (!loading && !account) router.replace('/bowls/login') }, [loading, account, router])
  // While games are on, reload every few minutes: results, standings and who's eliminated stay current.
  useBowlLive(board && !board.hidden && !board.demo ? board.games : undefined, reload)

  const rows = board?.standings ?? []
  const anyFinal = (board?.decided ?? 0) > 0
  const sections = pickSections(board?.games ?? [])
  const podium = anyFinal && rows.length >= 3 ? rows.slice(0, 3) : []

  return (
    <div className="min-h-screen bg-zinc-950 pb-16">
      <BowlHeader subtitle="Standings" />
      <main className="max-w-3xl mx-auto px-4 py-5 space-y-4 animate-fade-in">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-white">Standings</h1>
            {board && !board.hidden && <ResultsLine board={board} />}
          </div>
          {board && !board.hidden && !board.demo && <UpdateResults onDone={reload} />}
        </div>
        {board?.demo && <DemoNote />}

        {error ? <div className="glass-card rounded-2xl p-4 text-sm text-red-400">{error}</div>
          : !board ? <div className="space-y-2">{[0, 1, 2, 3, 4].map(i => <div key={i} className="skeleton h-16 rounded-2xl" />)}</div>
          : board.hidden ? <HiddenUntilLock board={board} what="Standings and everyone's picks" />
          : (
            <>
              {podium.length === 3 && (
                <div className="grid grid-cols-3 gap-2 items-end" aria-label="Top three">
                  {[podium[1], podium[0], podium[2]].map((s, i) => {
                    const place = [1, 0, 2][i]
                    return (
                      <div key={s.id} className={`relative rounded-2xl border text-center px-2 pt-3 pb-3 ${place === 0 ? 'bg-gradient-to-b from-yellow-500/[0.14] to-zinc-900/60 border-yellow-500/40 pb-5' : 'bg-white/[0.03] border-white/[0.07]'}`}>
                        <span className={`absolute -top-2.5 left-1/2 -translate-x-1/2 min-w-[28px] h-6 px-1.5 rounded-full bg-gradient-to-b ${MEDAL[Math.min(s.rank, 3) - 1]} text-zinc-950 text-xs font-extrabold flex items-center justify-center shadow`}>{rankText(s)}</span>
                        <div className={`mx-auto mt-2 rounded-full p-0.5 bg-gradient-to-b ${MEDAL[Math.min(s.rank, 3) - 1]} w-fit`}>
                          <BowlAvatar name={s.name} url={s.avatar_url} size={place === 0 ? 60 : 46} />
                        </div>
                        <p className={`mt-1.5 text-sm font-semibold truncate ${s.id === player?.id ? 'text-yellow-300' : 'text-white'}`}>{firstName(s.name)}</p>
                        <p className={`font-extrabold tabular-nums ${place === 0 ? 'text-2xl text-yellow-400' : 'text-lg text-zinc-100'}`}>{pts(s.points)}</p>
                        <p className="text-[10px] text-zinc-500 tabular-nums">{s.wins}–{s.losses}</p>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="glass-card rounded-2xl overflow-hidden" role="list" aria-label="Standings">
                <div className="hidden sm:grid grid-cols-[3rem_1fr_4.5rem_4.5rem_4rem] gap-2 px-4 py-2 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider border-b border-white/[0.06]">
                  <span>Rank</span><span>Player</span><span className="text-right">W–L</span><span className="text-right">Max</span><span className="text-right">Pts</span>
                </div>
                {rows.map(s => {
                  const me = s.id === player?.id
                  const isOpen = open === s.id
                  return (
                    <div key={s.id} role="listitem" className={`border-b border-white/[0.04] last:border-0 ${me ? 'bg-yellow-500/[0.06]' : ''}`}>
                      <button onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen}
                        className="w-full text-left px-3 sm:px-4 py-2.5 grid grid-cols-[2.25rem_1fr_auto] sm:grid-cols-[3rem_1fr_4.5rem_4.5rem_4rem] gap-2 items-center hover:bg-white/[0.03] transition">
                        <span className={`text-base font-extrabold tabular-nums text-center ${s.rank === 1 && anyFinal ? 'text-yellow-400' : 'text-zinc-300'}`}>{rankText(s)}</span>
                        <span className="flex items-center gap-2.5 min-w-0">
                          <BowlAvatar name={s.name} url={s.avatar_url} size={34} />
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5">
                              <span className={`text-sm font-semibold truncate ${me ? 'text-yellow-300' : 'text-white'}`}>{s.name}</span>
                              {me && <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-yellow-400/90">You</span>}
                              <StreakBadge n={winStreak(board.games ?? [], board.picks?.[s.id])} />
                            </span>
                            <span className="flex items-center gap-1.5 text-[11px] text-zinc-500 min-w-0">
                              <span className="sm:hidden tabular-nums">{s.wins}–{s.losses} ·</span>
                              <span className="tabular-nums">★ {s.best5Wins}–{s.best5Losses}</span>
                              {s.champion && (
                                <span className={`inline-flex items-center gap-1 min-w-0 ${s.championState === 'lost' || s.championState === 'dead' ? 'line-through opacity-60' : ''}`}>
                                  · <TeamLogo team={s.champion} size={14} /><span className="truncate">{s.champion.name}</span>
                                </span>
                              )}
                            </span>
                            {/* Points by phase, in the phases' colors. */}
                            <span className="flex items-center gap-2.5 mt-0.5 text-[10px] text-zinc-400 tabular-nums" aria-label={sections.map(sec => `${sec.short} ${pts(sectionPoints(s, sec.key))}`).join(', ')}>
                              {sections.map(sec => (
                                <span key={sec.key} className="inline-flex items-center gap-1" title={`${sec.title}: ${pts(sectionPoints(s, sec.key))} points`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${PHASE_TONE[sec.key].dot}`} aria-hidden="true" />{pts(sectionPoints(s, sec.key))}
                                </span>
                              ))}
                            </span>
                            {s.aheadOn && <span className="block text-[10px] text-yellow-500/80">Ahead on {TIEBREAK_LABEL[s.aheadOn]}</span>}
                            {s.out && (
                              <span className="block text-[10px] leading-snug mt-0.5" data-eliminated={s.id}>
                                <span className="font-semibold text-red-400/90">Eliminated</span>
                                <span className="text-zinc-500"> · {s.out.text}</span>
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="hidden sm:block text-right text-sm text-zinc-300 tabular-nums">{s.wins}–{s.losses}</span>
                        <span className="hidden sm:block text-right text-sm text-zinc-500 tabular-nums">{pts(s.maxPoints)}</span>
                        <span className="text-right">
                          <span className={`block text-lg font-extrabold tabular-nums leading-tight ${s.out ? 'text-zinc-400' : 'text-white'}`}>{pts(s.points)}</span>
                          <span className="sm:hidden block text-[10px] text-zinc-500 tabular-nums">max {pts(s.maxPoints)}</span>
                        </span>
                      </button>
                      {isOpen && (
                        <div className="px-4 pb-3 pt-1 space-y-2.5 animate-fade-in">
                          <div className="flex flex-wrap gap-1.5">
                            {PHASES.map(p => (
                              <span key={p.key} className={`text-[11px] px-2 py-1 rounded-full border ${PHASE_TONE[p.key].badge}`}>
                                {p.key === 'semi' || p.key === 'title' ? p.label : p.label.replace('The ', '')} · {pts(s.byPhase[p.key])}
                              </span>
                            ))}
                          </div>
                          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                            {[
                              ['Record', `${s.wins}–${s.losses}${s.pending ? ` · ${s.pending} to play` : ''}`],
                              ['Best 5', `${s.best5Wins}–${s.best5Losses}`],
                              ['Semifinals', `${s.semiWins}–${s.semiLosses}`],
                              ['Title total', s.titleTotal === null ? '—' : `${s.titleTotal}${s.titleMiss !== null ? ` (off by ${s.titleMiss})` : ''}`],
                            ].map(([k, v]) => (
                              <div key={k} className="rounded-xl bg-white/[0.03] border border-white/[0.05] px-2.5 py-2">
                                <dt className="text-[10px] text-zinc-500 uppercase tracking-wider">{k}</dt>
                                <dd className="text-zinc-100 font-semibold tabular-nums mt-0.5">{v}</dd>
                              </div>
                            ))}
                          </dl>
                          <Link href={`/bowls/all-picks?view=player&player=${s.id}`} className="inline-block text-xs font-semibold text-yellow-500 hover:text-yellow-400">
                            See {firstName(s.name)}&apos;s picks →
                          </Link>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <p className="text-[11px] text-zinc-500 px-1 leading-relaxed">
                Ties go to the better Best 5 record, then semifinal picks, then the closest guess at the title game&apos;s total points — on an equal miss, the guess under wins.
                &ldquo;Max&rdquo; is the most points still possible, counting only picks still alive.
                Eliminated means no way the games left can go puts that player first — or tied for first going into the title-game total.
              </p>
            </>
          )}
      </main>
    </div>
  )
}
