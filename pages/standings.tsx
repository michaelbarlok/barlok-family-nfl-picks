import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { CURRENT_SEASON } from '@/lib/constants'
import { computeRecords, recordSort } from '@/lib/computeStandings'
import Nav from '@/components/Nav'

// Canvas confetti burst — shown when a perfect week is spotted
function ConfettiLayer({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!active) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    const colors = ['#F59E0B', '#3B82F6', '#10B981', '#EF4444', '#8B5CF6', '#F97316', '#FBBF24', '#34D399']
    const particles = Array.from({ length: 120 }, () => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * 120,
      vx: (Math.random() - 0.5) * 6,
      vy: 2 + Math.random() * 5,
      color: colors[Math.floor(Math.random() * colors.length)],
      w: 7 + Math.random() * 8,
      h: 3 + Math.random() * 4,
      rot: Math.random() * 360,
      rotV: (Math.random() - 0.5) * 12,
    }))

    const start = Date.now()
    let rafId: number
    const tick = () => {
      const t = Date.now() - start
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.globalAlpha = t > 2800 ? Math.max(0, 1 - (t - 2800) / 700) : 1
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.09; p.rot += p.rotV
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot * Math.PI / 180)
        ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        ctx.restore()
      })
      if (t < 3500) rafId = requestAnimationFrame(tick)
      else ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [active])

  if (!active) return null
  return <canvas ref={canvasRef} className="fixed inset-0 z-50 pointer-events-none" style={{ width: '100vw', height: '100vh' }} />
}

interface User {
  id: string
  name: string
  email: string
  avatar_url?: string | null
}

interface WeekRecord {
  week: number
  wins: number
  losses: number
  ties: number
  bestWins: number
  bestLosses: number
  bestTies: number
}

interface UserStanding {
  user: User
  wins: number
  losses: number
  ties: number
  bestWins: number
  bestLosses: number
  bestTies: number
  totalPicks: number
  weekRecords: WeekRecord[]
  rankChange: number | null // positive = moved up, negative = moved down, 0 = same, null = no prior data
  winStreak: number // consecutive correct picks (current streak)
}

function StandingsSkeleton() {
  return (
    <div className="min-h-screen bg-surface pb-20">
      <Nav />
      <main className="max-w-3xl mx-auto px-4 py-6">
        <div className="skeleton h-4 w-40 rounded mb-5" />
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="skeleton h-10 w-full" />
          {[...Array(6)].map((_, i) => (
            <div key={i} className="px-4 py-4 border-t border-white/[0.04]">
              <div className="skeleton h-5 w-full rounded" />
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}

export default function StandingsPage() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const [standings, setStandings] = useState<UserStanding[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null)
  const [showConfetti, setShowConfetti] = useState(false)
  const confettiShownFor = useRef<string | null>(null)

  useEffect(() => {
    if (!loading && !user) router.push('/login')
  }, [user, loading, router])

  const fetchStandings = useCallback(async () => {
    if (!user) return
      try {
        const [
          { data: users },
          { data: scores },
          { data: picks },
          { data: threeBests },
          { data: games },
        ] = await Promise.all([
          supabase.from('users').select('*').order('name'),
          supabase.from('scores').select('user_id, created_at').eq('season', CURRENT_SEASON).order('created_at', { ascending: false }).limit(1),
          supabase.from('picks').select('user_id, game_id, picked_team, week').eq('season', CURRENT_SEASON),
          supabase.from('three_best').select('user_id, week, pick_1, pick_2, pick_3').eq('season', CURRENT_SEASON),
          supabase.from('games').select('id, away_team, home_team, kickoff_time, week, season, winning_team').eq('season', CURRENT_SEASON),
        ])

        if (!users) return

        // Last updated banner from most recent score row
        if (scores && scores.length > 0) {
          setLastUpdated(new Date(scores[0].created_at).toLocaleString('en-US', {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
            timeZone: 'America/New_York',
          }))
        }

        const userIds = users.map(u => u.id)
        const allGames = games ?? []
        const decidedGames = allGames.filter((g: any) => g.winning_team)
        const picksMap = new Map((picks || []).map(p => [`${p.user_id}-${p.game_id}`, p]))
        const userWeeks = new Map<string, Set<number>>()
        ;(picks || []).forEach((p: any) => {
          if (!userWeeks.has(p.user_id)) userWeeks.set(p.user_id, new Set())
          userWeeks.get(p.user_id)!.add(p.week)
        })

        // Compute records using shared logic
        const records = computeRecords({
          userIds,
          games: allGames,
          picks: picks ?? [],
          threeBests: threeBests ?? [],
        })

        // Project into UserStanding shape
        const result: UserStanding[] = users.map(u => {
          const r = records.get(u.id)!
          const weekRecords: WeekRecord[] = [...r.weekRecords.entries()]
            .map(([week, wr]) => ({ week, ...wr }))
            .sort((a, b) => a.week - b.week)
          return {
            user: u,
            wins: r.wins, losses: r.losses, ties: r.ties,
            bestWins: r.bestWins, bestLosses: r.bestLosses, bestTies: r.bestTies,
            totalPicks: r.wins + r.losses + r.ties,
            weekRecords,
            rankChange: null,
            winStreak: 0,
          }
        })

        // Sort by current record
        result.sort((a, b) => recordSort(records.get(a.user.id)!, records.get(b.user.id)!))

        // Rank change: compare current rank to rank WITHOUT the latest decided week
        const allDecidedWeeks = [...new Set(decidedGames.map((g: any) => g.week))].sort((a: number, b: number) => a - b)
        if (allDecidedWeeks.length >= 2) {
          const latestWeek = allDecidedWeeks[allDecidedWeeks.length - 1]
          const prevResult = result.map(s => {
            const r = records.get(s.user.id)!
            const lwr = r.weekRecords.get(latestWeek)
            return {
              userId: s.user.id,
              wins: r.wins - (lwr?.wins ?? 0),
              losses: r.losses - (lwr?.losses ?? 0),
              bestWins: r.bestWins - (lwr?.bestWins ?? 0),
              bestLosses: r.bestLosses - (lwr?.bestLosses ?? 0),
            }
          })
          prevResult.sort((a, b) => {
            if (b.wins !== a.wins) return b.wins - a.wins
            if (a.losses !== b.losses) return a.losses - b.losses
            if (b.bestWins !== a.bestWins) return b.bestWins - a.bestWins
            return a.bestLosses - b.bestLosses
          })
          const prevRankMap = new Map(prevResult.map((r, i) => [r.userId, i + 1]))
          result.forEach((s, i) => {
            const prevRank = prevRankMap.get(s.user.id)
            if (prevRank != null) s.rankChange = prevRank - (i + 1)
          })
        }

        // Win streaks: consecutive correct picks going backwards
        const sortedDecided = [...decidedGames].sort((a: any, b: any) => {
          if (a.week !== b.week) return b.week - a.week
          return new Date(b.kickoff_time || 0).getTime() - new Date(a.kickoff_time || 0).getTime()
        })
        for (const s of result) {
          let streak = 0
          for (const game of sortedDecided) {
            const participated = userWeeks.get(s.user.id)?.has(game.week)
            if (!participated) continue
            if (game.winning_team === 'TIE') { streak = 0; break }
            const pick = picksMap.get(`${s.user.id}-${game.id}`)
            if (pick && pick.picked_team === game.winning_team) streak++
            else break
          }
          s.winStreak = streak
        }

        setStandings(result)
      } catch (err) {
        console.error('Error fetching standings:', err)
        setLoadError('Failed to load standings. Please refresh the page.')
      } finally {
        setDataLoading(false)
      }
  }, [user])

  // Fetch on mount
  useEffect(() => { fetchStandings() }, [fetchStandings])

  // Real-time: re-fetch when games or picks change.
  // Debounced so a burst of pick updates only triggers one refetch.
  useEffect(() => {
    if (!user) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const scheduleRefetch = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { fetchStandings() }, 500)
    }
    const gamesChannel = supabase
      .channel('standings-games')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, scheduleRefetch)
      .subscribe()
    const picksChannel = supabase
      .channel('standings-picks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'picks' }, scheduleRefetch)
      .subscribe()
    const threeBestChannel = supabase
      .channel('standings-threebest')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'three_best' }, scheduleRefetch)
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(gamesChannel)
      supabase.removeChannel(picksChannel)
      supabase.removeChannel(threeBestChannel)
    }
  }, [user, fetchStandings])

  if (loading || dataLoading) return <StandingsSkeleton />
  if (!user) return null

  const hasScores = standings.some(s => s.totalPicks > 0)
  const podiumStandings = standings.filter(s => s.totalPicks > 0).slice(0, 3)

  // Confetti: fire when the current user expands their own row and has a perfect week
  const handleExpandRow = (userId: string, weekRecords: WeekRecord[]) => {
    const isExpanded = expandedUserId === userId
    setExpandedUserId(isExpanded ? null : userId)
    if (!isExpanded && userId === user.id && confettiShownFor.current !== userId) {
      const hasPerfectWeek = weekRecords.some(wr => wr.wins > 0 && wr.losses === 0 && wr.ties === 0)
      if (hasPerfectWeek) {
        confettiShownFor.current = userId
        setShowConfetti(true)
        setTimeout(() => setShowConfetti(false), 3600)
      }
    }
  }

  const podiumConfig = [
    // 1st — gold, center (rendered in middle slot)
    { emoji: '🥇', textColor: 'text-amber-400', ringColor: 'ring-amber-400/40', podiumColor: 'bg-amber-500/20', podiumH: 40, avatarSize: 64, nameSz: 'text-sm' },
    // 2nd — silver, left slot
    { emoji: '🥈', textColor: 'text-slate-300', ringColor: 'ring-slate-400/30', podiumColor: 'bg-slate-400/15', podiumH: 28, avatarSize: 52, nameSz: 'text-xs' },
    // 3rd — bronze, right slot
    { emoji: '🥉', textColor: 'text-orange-400', ringColor: 'ring-orange-500/30', podiumColor: 'bg-orange-600/15', podiumH: 20, avatarSize: 44, nameSz: 'text-xs' },
  ]

  return (
    <div className="min-h-screen bg-surface pb-20">
      <Nav />
      <ConfettiLayer active={showConfetti} />

      <main className="max-w-3xl mx-auto px-4 py-6 animate-fade-in">
        {loadError && (
          <div className="mb-5 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-start gap-3 animate-slide-up">
            <span className="text-xl">⚠️</span>
            <div className="flex-1">
              <p className="font-semibold text-red-400 text-sm">{loadError}</p>
              <button onClick={() => window.location.reload()} className="text-red-400/70 text-xs underline mt-1 hover:text-red-300">Reload page</button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            {CURRENT_SEASON} Season Standings
          </h2>
          {lastUpdated && (
            <p className="text-xs text-slate-500">Updated {lastUpdated}</p>
          )}
        </div>

        {!hasScores ? (
          <div className="glass-card rounded-2xl p-12 text-center">
            <p className="text-4xl mb-3">🏈</p>
            <p className="text-white font-medium">Season hasn&apos;t started yet</p>
            <p className="text-slate-500 text-sm mt-1.5">Standings will appear here once Week 1 results are recorded.</p>
          </div>
        ) : (
          <>
          {/* ── PODIUM ── top 3 visual before the table */}
          {podiumStandings.length >= 2 && (
            <div className="mb-6 animate-slide-up">
              {/* Order: 2nd (left) | 1st (center) | 3rd (right) */}
              {(() => {
                const slots = [
                  podiumStandings[1] ? { standing: podiumStandings[1], rank: 1 } : null,
                  { standing: podiumStandings[0], rank: 0 },
                  podiumStandings[2] ? { standing: podiumStandings[2], rank: 2 } : null,
                ].filter(Boolean) as { standing: UserStanding; rank: number }[]

                return (
                  <div className="flex items-end justify-center gap-3">
                    {slots.map(({ standing: s, rank }) => {
                      const cfg = podiumConfig[rank]
                      const isMe = s.user.id === user.id
                      const record = `${s.wins}-${s.losses}${s.ties > 0 ? `-${s.ties}` : ''}`
                      return (
                        <div key={s.user.id} className="flex flex-col items-center" style={{ minWidth: rank === 0 ? 100 : 80 }}>
                          {/* Avatar + medal */}
                          <div className="relative mb-2">
                            {s.user.avatar_url ? (
                              <img
                                src={s.user.avatar_url}
                                alt=""
                                className={`rounded-full object-cover border-2 ring-2 ${cfg.ringColor} ${isMe ? 'border-blue-400/60' : 'border-white/10'} transition-all`}
                                style={{ width: cfg.avatarSize, height: cfg.avatarSize }}
                              />
                            ) : (
                              <div
                                className={`rounded-full flex items-center justify-center font-bold ring-2 ${cfg.ringColor} ${
                                  isMe ? 'bg-gradient-to-br from-blue-500 to-indigo-600 border-2 border-blue-400/60' : 'bg-gradient-to-br from-slate-600 to-slate-700 border-2 border-white/10'
                                } text-white`}
                                style={{ width: cfg.avatarSize, height: cfg.avatarSize, fontSize: cfg.avatarSize * 0.35 }}
                              >
                                {s.user.name?.charAt(0).toUpperCase()}
                              </div>
                            )}
                            <span className="absolute -bottom-1 -right-1 text-base leading-none">{cfg.emoji}</span>
                          </div>
                          {/* Name */}
                          <p className={`font-semibold text-center truncate w-full px-1 ${cfg.nameSz} ${isMe ? 'text-blue-400' : 'text-white'}`}>
                            {s.user.name.split(' ')[0]}
                          </p>
                          {/* Record */}
                          <p className={`text-[11px] font-mono mt-0.5 mb-2 ${cfg.textColor}`}>{record}</p>
                          {/* Podium block */}
                          <div
                            className={`w-full rounded-t-lg ${cfg.podiumColor} border border-white/[0.06]`}
                            style={{ height: cfg.podiumH }}
                          />
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
          )}

          <div className="glass-card rounded-2xl overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-12 px-4 py-3 bg-white/[0.03] border-b border-white/[0.06] text-xs font-semibold text-slate-500 uppercase tracking-wider">
              <div className="col-span-1 text-center">#</div>
              <div className="col-span-5">Player</div>
              <div className="col-span-3 text-center">Overall</div>
              <div className="col-span-3 text-center">Best 3</div>
            </div>

            {standings.map((s, idx) => {
              const isMe = s.user.id === user.id
              const winPct = s.totalPicks > 0 ? Math.round((s.wins / s.totalPicks) * 100) : null
              const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null
              const podium = idx < 3 ? [
                { bg: 'from-amber-500/20 to-amber-600/10', border: 'border-amber-500/30', text: 'text-amber-400' },
                { bg: 'from-slate-300/15 to-slate-400/5', border: 'border-slate-400/20', text: 'text-slate-300' },
                { bg: 'from-orange-600/15 to-orange-700/5', border: 'border-orange-600/20', text: 'text-orange-400' },
              ][idx] : null
              const isExpanded = expandedUserId === s.user.id
              const hasWeekData = s.weekRecords.length > 0

              return (
                <div key={s.user.id}>
                  <div
                    onClick={() => hasWeekData && handleExpandRow(s.user.id, s.weekRecords)}
                    className={`grid grid-cols-12 px-4 py-4 items-center border-b border-white/[0.04] last:border-0 transition-colors animate-slide-up ${
                      hasWeekData ? 'cursor-pointer' : ''
                    } ${
                      isMe
                        ? 'bg-blue-500/10 border-l-2 border-l-blue-500'
                        : podium
                        ? `bg-gradient-to-r ${podium.bg}`
                        : 'hover:bg-white/[0.02]'
                    }`}
                    style={{ animationDelay: `${idx * 50}ms` }}
                  >
                    {/* Rank + change arrow */}
                    <div className="col-span-1 text-center">
                      <div className="flex flex-col items-center">
                        {medal ? (
                          <span className="text-lg">{medal}</span>
                        ) : (
                          <span className="text-sm text-slate-500 font-medium">{idx + 1}</span>
                        )}
                        {s.rankChange !== null && s.rankChange !== 0 && (
                          <span className={`text-[9px] font-bold leading-none ${s.rankChange > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {s.rankChange > 0 ? '▲' : '▼'}{Math.abs(s.rankChange)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Name + streak */}
                    <div className="col-span-5">
                      <div className="flex items-center gap-2">
                        {s.user.avatar_url ? (
                          <img src={s.user.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover border border-white/[0.08] shrink-0" />
                        ) : (
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold border border-white/[0.08] ${
                            isMe ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white' : 'bg-gradient-to-br from-slate-600 to-slate-700 text-slate-300'
                          }`}>
                            {s.user.name?.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className={`text-sm font-semibold truncate ${isMe ? 'text-blue-400' : 'text-white'}`}>
                              {s.user.name} {isMe && <span className="text-blue-400/60 font-normal text-xs">(you)</span>}
                            </p>
                            {s.winStreak >= 3 && (
                              <span className="text-[10px] font-bold text-orange-400 bg-orange-500/10 px-1.5 py-0.5 rounded-full leading-none shrink-0" title={`${s.winStreak} correct in a row`}>
                                🔥{s.winStreak}
                              </span>
                            )}
                            {hasWeekData && (
                              <svg
                                className={`w-3.5 h-3.5 text-slate-500 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                              </svg>
                            )}
                          </div>
                          {winPct !== null && (
                            <div className="flex items-center gap-2 mt-0.5">
                              <div className="w-12 h-1 bg-white/[0.06] rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full"
                                  style={{ width: `${winPct}%` }}
                                />
                              </div>
                              <p className="text-[11px] text-slate-500">{winPct}%</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Overall W-L-T */}
                    <div className="col-span-3 text-center">
                      {s.totalPicks > 0 ? (
                        <p className="text-sm font-bold text-white">
                          <span className="text-emerald-400">{s.wins}</span>
                          <span className="text-slate-500 mx-0.5">&ndash;</span>
                          <span className="text-red-400">{s.losses}</span>
                          {s.ties > 0 && <><span className="text-slate-500 mx-0.5">&ndash;</span><span className="text-slate-400">{s.ties}</span></>}
                        </p>
                      ) : (
                        <p className="text-sm text-slate-600">&mdash;</p>
                      )}
                    </div>

                    {/* Best 3 W-L-T */}
                    <div className="col-span-3 text-center">
                      {s.bestWins + s.bestLosses + s.bestTies > 0 ? (
                        <p className="text-sm font-bold">
                          <span className="text-amber-400">{s.bestWins}</span>
                          <span className="text-slate-500 mx-0.5">&ndash;</span>
                          <span className="text-amber-600">{s.bestLosses}</span>
                          {s.bestTies > 0 && <><span className="text-slate-500 mx-0.5">&ndash;</span><span className="text-slate-400">{s.bestTies}</span></>}
                        </p>
                      ) : (
                        <p className="text-sm text-slate-600">&mdash;</p>
                      )}
                    </div>
                  </div>

                  {/* Weekly breakdown — expandable */}
                  {isExpanded && (
                    <div className="bg-white/[0.02] border-b border-white/[0.04]">
                      <div className="px-4 py-2 grid grid-cols-12 text-[10px] font-semibold text-slate-600 uppercase tracking-wider border-b border-white/[0.03]">
                        <div className="col-span-1" />
                        <div className="col-span-5">Week</div>
                        <div className="col-span-3 text-center">W-L</div>
                        <div className="col-span-3 text-center">Best 3</div>
                      </div>
                      {s.weekRecords.map(wr => {
                        const isPerfect = wr.wins > 0 && wr.losses === 0 && wr.ties === 0
                        return (
                        <div key={wr.week} className={`px-4 py-2 grid grid-cols-12 items-center text-xs hover:bg-white/[0.02] transition-colors ${isPerfect ? 'bg-amber-500/5' : ''}`}>
                          <div className="col-span-1 text-center">{isPerfect ? '🏆' : ''}</div>
                          <div className={`col-span-5 font-medium ${isPerfect ? 'text-amber-300' : 'text-slate-400'}`}>Week {wr.week}{isPerfect ? ' — Perfect!' : ''}</div>
                          <div className="col-span-3 text-center">
                            <span className="text-emerald-400">{wr.wins}</span>
                            <span className="text-slate-600 mx-0.5">-</span>
                            <span className="text-red-400">{wr.losses}</span>
                            {wr.ties > 0 && <><span className="text-slate-600 mx-0.5">-</span><span className="text-slate-400">{wr.ties}</span></>}
                          </div>
                          <div className="col-span-3 text-center">
                            {wr.bestWins + wr.bestLosses + wr.bestTies > 0 ? (
                              <>
                                <span className="text-amber-400">{wr.bestWins}</span>
                                <span className="text-slate-600 mx-0.5">-</span>
                                <span className="text-amber-600">{wr.bestLosses}</span>
                                {wr.bestTies > 0 && <><span className="text-slate-600 mx-0.5">-</span><span className="text-slate-400">{wr.bestTies}</span></>}
                              </>
                            ) : (
                              <span className="text-slate-600">&mdash;</span>
                            )}
                          </div>
                        </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          </>
        )}

        <p className="text-xs text-slate-600 text-center mt-5">
          Tap a player to see their week-by-week breakdown.
        </p>
      </main>
    </div>
  )
}
