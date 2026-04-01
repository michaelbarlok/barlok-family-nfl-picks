import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { CURRENT_SEASON } from '@/lib/constants'
import { computeLockTime, formatKickoff } from '@/lib/lockTime'
import Nav from '@/components/Nav'

interface DashboardData {
  // Your record
  wins: number
  losses: number
  ties: number
  rank: number
  totalPlayers: number
  // Best 3
  bestWins: number
  bestLosses: number
  bestTies: number
  // This week
  currentWeek: number | null
  pickedCount: number
  totalGames: number
  bestPickCount: number
  lockTime: Date | null
  isLocked: boolean
  // Last week
  lastWeek: number | null
  lastWeekWins: number
  lastWeekLosses: number
  lastWeekTies: number
  lastWeekRank: number | null
  // Leaderboard top 3
  leaderboard: { name: string; wins: number; losses: number; ties: number; isYou: boolean; avatar_url?: string | null }[]
}

function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-surface pb-20">
      <Nav />
      <main className="max-w-3xl mx-auto px-4 py-6">
        <div className="skeleton h-6 w-48 rounded mb-6" />
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="skeleton h-28 rounded-2xl" />
          <div className="skeleton h-28 rounded-2xl" />
        </div>
        <div className="skeleton h-40 rounded-2xl mb-4" />
        <div className="skeleton h-32 rounded-2xl" />
      </main>
    </div>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const { user, loading, configError } = useAuth()
  const [data, setData] = useState<DashboardData | null>(null)
  const [dataLoading, setDataLoading] = useState(true)
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!loading && !user) router.push('/login')
  }, [user, loading, router])

  useEffect(() => {
    const fetchDashboard = async () => {
      if (!user) return
      try {
        const [
          { data: users },
          { data: allPicks },
          { data: allGames },
          { data: scores },
          { data: threeBests },
        ] = await Promise.all([
          supabase.from('users').select('id, name, avatar_url').order('name'),
          supabase.from('picks').select('user_id, game_id, picked_team, week').eq('season', CURRENT_SEASON),
          supabase.from('games').select('id, week, away_team, home_team, kickoff_time, winning_team, away_score, home_score').eq('season', CURRENT_SEASON).order('kickoff_time'),
          supabase.from('scores').select('user_id, game_id, is_correct, week').eq('season', CURRENT_SEASON),
          supabase.from('three_best').select('user_id, week, pick_1, pick_2, pick_3').eq('season', CURRENT_SEASON),
        ])

        if (!users || !allGames) { setDataLoading(false); return }

        const userIds = users.map(u => u.id)
        const decidedGames = allGames.filter(g => g.winning_team)

        // Build user participation
        const userWeeks = new Map<string, Set<number>>()
        ;(allPicks ?? []).forEach(p => {
          if (!userWeeks.has(p.user_id)) userWeeks.set(p.user_id, new Set())
          userWeeks.get(p.user_id)!.add(p.week)
        })

        // Compute per-user total + per-week records
        const allDecidedWeeks = [...new Set(decidedGames.map(g => g.week))].sort((a, b) => a - b)
        const picksMap = new Map((allPicks ?? []).map(p => [`${p.user_id}-${p.game_id}`, p]))

        type UserRecord = { wins: number; losses: number; ties: number; weekWins: Map<number, number>; weekLosses: Map<number, number>; weekTies: Map<number, number>; bestWins: number; bestLosses: number; bestTies: number }
        const records = new Map<string, UserRecord>()
        userIds.forEach(uid => records.set(uid, { wins: 0, losses: 0, ties: 0, weekWins: new Map(), weekLosses: new Map(), weekTies: new Map(), bestWins: 0, bestLosses: 0, bestTies: 0 }))

        // Participants: compute record from decided games
        for (const game of decidedGames) {
          const isTie = game.winning_team === 'TIE'
          for (const uid of userIds) {
            const weeks = userWeeks.get(uid)
            if (!weeks || !weeks.has(game.week)) continue
            const pick = picksMap.get(`${uid}-${game.id}`)
            const r = records.get(uid)!
            let result: 'w' | 'l' | 't'
            if (!pick) result = isTie ? 't' : 'l'
            else if (isTie) result = 't'
            else if (pick.picked_team === game.winning_team) result = 'w'
            else result = 'l'
            if (result === 'w') { r.wins++; r.weekWins.set(game.week, (r.weekWins.get(game.week) ?? 0) + 1) }
            else if (result === 'l') { r.losses++; r.weekLosses.set(game.week, (r.weekLosses.get(game.week) ?? 0) + 1) }
            else { r.ties++; r.weekTies.set(game.week, (r.weekTies.get(game.week) ?? 0) + 1) }
          }
        }

        // Non-participant penalty — only for users who have played at least one week
        for (const wk of allDecidedWeeks) {
          const wkGames = decidedGames.filter(g => g.week === wk)
          const total = wkGames.length
          if (total === 0) continue
          let worstWins = Infinity; let any = false
          for (const uid of userIds) {
            if ((userWeeks.get(uid) || new Set()).has(wk)) {
              any = true
              worstWins = Math.min(worstWins, records.get(uid)!.weekWins.get(wk) ?? 0)
            }
          }
          if (!any) continue
          const pw = Math.max(0, worstWins - 1); const pl = total - pw
          for (const uid of userIds) {
            if ((userWeeks.get(uid) || new Set()).has(wk)) continue
            if ((userWeeks.get(uid) || new Set()).size === 0) continue // never played
            const r = records.get(uid)!
            r.wins += pw; r.losses += pl
            r.weekWins.set(wk, pw); r.weekLosses.set(wk, pl)
          }
        }

        // Best 3
        ;(threeBests ?? []).forEach(tb => {
          [tb.pick_1, tb.pick_2, tb.pick_3].filter(Boolean).forEach((team: string) => {
            const game = decidedGames.find(g => g.week === tb.week && (g.away_team === team || g.home_team === team))
            if (!game) return
            const isTie = game.winning_team === 'TIE'
            const pick = picksMap.get(`${tb.user_id}-${game.id}`)
            const r = records.get(tb.user_id)
            if (!r) return
            if (!pick) r.bestLosses++
            else if (isTie) r.bestTies++
            else if (pick.picked_team === game.winning_team) r.bestWins++
            else r.bestLosses++
          })
        })

        // Rank all users
        const ranked = userIds.map(uid => ({ uid, ...records.get(uid)! }))
          .sort((a, b) => {
            if (b.wins !== a.wins) return b.wins - a.wins
            if (a.losses !== b.losses) return a.losses - b.losses
            if (b.bestWins !== a.bestWins) return b.bestWins - a.bestWins
            return a.bestLosses - b.bestLosses
          })

        const myRankIdx = ranked.findIndex(r => r.uid === user.id)
        const myRecord = records.get(user.id) ?? { wins: 0, losses: 0, ties: 0, weekWins: new Map(), weekLosses: new Map(), weekTies: new Map(), bestWins: 0, bestLosses: 0, bestTies: 0 }

        // Current week detection
        const maxWeek = allGames.length > 0 ? Math.max(...allGames.map(g => g.week)) : null
        const currentWeekGames = maxWeek ? allGames.filter(g => g.week === maxWeek) : []
        const lt = computeLockTime(currentWeekGames)
        const locked = lt ? now >= lt : false

        const myPicks = (allPicks ?? []).filter(p => p.user_id === user.id && p.week === maxWeek)
        const myBest = (threeBests ?? []).find(tb => tb.user_id === user.id && tb.week === maxWeek)
        const bestCount = myBest ? [myBest.pick_1, myBest.pick_2, myBest.pick_3].filter(Boolean).length : 0

        // Last decided week
        const lastDecidedWeek = allDecidedWeeks.length > 0 ? allDecidedWeeks[allDecidedWeeks.length - 1] : null

        // Last week rank — compute rank using only records up to lastDecidedWeek
        let lastWeekRank: number | null = null
        if (lastDecidedWeek !== null) {
          // Rank by week-specific record
          const weekRanked = userIds
            .filter(uid => (userWeeks.get(uid) || new Set()).has(lastDecidedWeek) || records.get(uid)!.weekWins.has(lastDecidedWeek))
            .map(uid => {
              const r = records.get(uid)!
              return { uid, w: r.weekWins.get(lastDecidedWeek) ?? 0, l: r.weekLosses.get(lastDecidedWeek) ?? 0 }
            })
            .sort((a, b) => b.w !== a.w ? b.w - a.w : a.l - b.l)
          const lwIdx = weekRanked.findIndex(r => r.uid === user.id)
          lastWeekRank = lwIdx >= 0 ? lwIdx + 1 : null
        }

        // Leaderboard top 3
        const leaderboard = ranked.slice(0, 3).map(r => {
          const u = users.find(u => u.id === r.uid)
          return {
            name: u?.name ?? 'Unknown',
            wins: r.wins,
            losses: r.losses,
            ties: r.ties,
            isYou: r.uid === user.id,
            avatar_url: u?.avatar_url,
          }
        })

        setData({
          wins: myRecord.wins,
          losses: myRecord.losses,
          ties: myRecord.ties,
          rank: myRankIdx + 1,
          totalPlayers: ranked.filter(r => r.wins + r.losses + r.ties > 0).length,
          bestWins: myRecord.bestWins,
          bestLosses: myRecord.bestLosses,
          bestTies: myRecord.bestTies,
          currentWeek: maxWeek,
          pickedCount: myPicks.length,
          totalGames: currentWeekGames.length,
          bestPickCount: bestCount,
          lockTime: lt,
          isLocked: locked,
          lastWeek: lastDecidedWeek,
          lastWeekWins: lastDecidedWeek ? (myRecord.weekWins.get(lastDecidedWeek) ?? 0) : 0,
          lastWeekLosses: lastDecidedWeek ? (myRecord.weekLosses.get(lastDecidedWeek) ?? 0) : 0,
          lastWeekTies: lastDecidedWeek ? (myRecord.weekTies.get(lastDecidedWeek) ?? 0) : 0,
          lastWeekRank,
          leaderboard,
        })
      } catch (err) {
        console.error('Dashboard error:', err)
      } finally {
        setDataLoading(false)
      }
    }
    fetchDashboard()
  }, [user])

  if (configError) {
    return (
      <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
        <h1>Configuration Error</h1>
        <p>The app is missing required Supabase environment variables.</p>
        <p>Please check that <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> are set.</p>
      </div>
    )
  }

  if (loading || dataLoading) return <DashboardSkeleton />
  if (!user) return null
  if (!data) return <DashboardSkeleton />

  const d = data
  const hasRecord = d.wins + d.losses + d.ties > 0
  const winPct = hasRecord ? Math.round((d.wins / (d.wins + d.losses + d.ties)) * 100) : null

  // Countdown
  const diff = d.lockTime ? Math.max(0, d.lockTime.getTime() - now.getTime()) : 0
  const cDays = Math.floor(diff / (1000 * 60 * 60 * 24))
  const cHours = Math.floor((diff / (1000 * 60 * 60)) % 24)
  const cMinutes = Math.floor((diff / (1000 * 60)) % 60)
  const cSeconds = Math.floor((diff / 1000) % 60)

  const incomplete = !d.isLocked && d.totalGames > 0
    ? (d.totalGames - d.pickedCount) + (d.bestPickCount < 3 ? 1 : 0)
    : 0

  return (
    <div className="min-h-screen bg-surface pb-20">
      <Nav incompleteCount={incomplete} />

      <main className="max-w-3xl mx-auto px-4 py-6 animate-fade-in">
        <h1 className="text-lg font-bold text-white mb-1">
          Hey, {user.name?.split(' ')[0]}
        </h1>
        <p className="text-xs text-slate-500 mb-6">{CURRENT_SEASON} Season</p>

        {/* ── YOUR RECORD ── */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          {/* Season record card */}
          <div className="glass-card rounded-2xl p-4 animate-slide-up">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Season Record</p>
            {hasRecord ? (
              <>
                <p className="text-2xl font-bold text-white mb-1">
                  <span className="text-emerald-400">{d.wins}</span>
                  <span className="text-slate-500 mx-1">&ndash;</span>
                  <span className="text-red-400">{d.losses}</span>
                  {d.ties > 0 && <><span className="text-slate-500 mx-1">&ndash;</span><span className="text-slate-400">{d.ties}</span></>}
                </p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full" style={{ width: `${winPct}%` }} />
                  </div>
                  <span className="text-[11px] text-slate-400 font-medium">{winPct}%</span>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">No results yet</p>
            )}
          </div>

          {/* Rank card */}
          <div className="glass-card rounded-2xl p-4 animate-slide-up" style={{ animationDelay: '50ms' }}>
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Your Rank</p>
            {hasRecord ? (
              <>
                <p className="text-2xl font-bold text-white mb-1">
                  {d.rank <= 3 ? ['🥇', '🥈', '🥉'][d.rank - 1] : `#${d.rank}`}
                  <span className="text-sm text-slate-500 font-normal ml-1.5">of {d.totalPlayers}</span>
                </p>
                <p className="text-[11px] text-slate-500">
                  Best 3: <span className="text-amber-400 font-medium">{d.bestWins}</span>
                  <span className="mx-0.5">&ndash;</span>
                  <span className="text-amber-600 font-medium">{d.bestLosses}</span>
                  {d.bestTies > 0 && <><span className="mx-0.5">&ndash;</span><span>{d.bestTies}</span></>}
                </p>
              </>
            ) : (
              <p className="text-sm text-slate-500">Submit picks to rank</p>
            )}
          </div>
        </div>

        {/* ── THIS WEEK STATUS ── */}
        {d.currentWeek && (
          <Link href="/picks" className="block mb-5 animate-slide-up" style={{ animationDelay: '100ms' }}>
            <div className={`glass-card rounded-2xl p-4 transition-all hover:bg-white/[0.06] ${
              !d.isLocked && d.pickedCount < d.totalGames ? 'border-amber-500/20' : ''
            }`}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Week {d.currentWeek}</p>
                {d.isLocked ? (
                  <span className="text-[10px] font-semibold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">Locked</span>
                ) : (
                  <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">Open</span>
                )}
              </div>

              {d.isLocked ? (
                <p className="text-sm text-slate-400">
                  {d.pickedCount}/{d.totalGames} picks submitted
                  {d.bestPickCount >= 3 && <span className="text-amber-400 ml-2">⭐ Best 3 set</span>}
                </p>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex-1">
                      <div className="flex justify-between text-xs text-slate-400 mb-1">
                        <span>{d.pickedCount}/{d.totalGames} picks</span>
                        <span className={d.bestPickCount >= 3 ? 'text-amber-400' : ''}>⭐ {d.bestPickCount}/3 best</span>
                      </div>
                      <div className="w-full bg-white/[0.06] rounded-full h-2 overflow-hidden">
                        <div className="progress-gradient h-2 rounded-full transition-all duration-500" style={{ width: `${d.totalGames > 0 ? (d.pickedCount / d.totalGames) * 100 : 0}%` }} />
                      </div>
                    </div>
                  </div>
                  {/* Countdown */}
                  {d.lockTime && diff > 0 && (
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs text-amber-400 animate-pulse-glow">⏰</span>
                      <span className="text-xs text-slate-400">
                        {cDays > 0 && `${cDays}d `}{String(cHours).padStart(2, '0')}:{String(cMinutes).padStart(2, '0')}:{String(cSeconds).padStart(2, '0')}
                        <span className="text-slate-600 ml-1.5">until lock</span>
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </Link>
        )}

        {/* ── LAST WEEK RESULTS ── */}
        {d.lastWeek !== null && (
          <div className="glass-card rounded-2xl p-4 mb-5 animate-slide-up" style={{ animationDelay: '150ms' }}>
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Week {d.lastWeek} Results</p>
            <div className="flex items-center justify-between">
              <p className="text-lg font-bold text-white">
                <span className="text-emerald-400">{d.lastWeekWins}</span>
                <span className="text-slate-500 mx-1">&ndash;</span>
                <span className="text-red-400">{d.lastWeekLosses}</span>
                {d.lastWeekTies > 0 && <><span className="text-slate-500 mx-1">&ndash;</span><span className="text-slate-400">{d.lastWeekTies}</span></>}
              </p>
              {d.lastWeekRank && (
                <span className="text-xs text-slate-400">
                  Ranked <span className="text-white font-semibold">#{d.lastWeekRank}</span> that week
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── LEADERBOARD SNAPSHOT ── */}
        {d.leaderboard.length > 0 && (
          <div className="animate-slide-up" style={{ animationDelay: '200ms' }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Leaderboard</p>
              <Link href="/standings" className="text-[10px] font-semibold text-blue-400 hover:text-blue-300 transition">
                View all →
              </Link>
            </div>
            <div className="glass-card rounded-2xl overflow-hidden">
              {d.leaderboard.map((p, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-3 px-4 py-3 border-b border-white/[0.04] last:border-0 ${
                    p.isYou ? 'bg-blue-500/10' : ''
                  }`}
                >
                  <span className="text-base w-6 text-center">{['🥇', '🥈', '🥉'][i]}</span>
                  {p.avatar_url ? (
                    <img src={p.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover border border-white/[0.08]" />
                  ) : (
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border border-white/[0.08] ${
                      p.isYou ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white' : 'bg-gradient-to-br from-slate-600 to-slate-700 text-slate-300'
                    }`}>
                      {p.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${p.isYou ? 'text-blue-400' : 'text-white'}`}>
                      {p.name}{p.isYou ? ' (you)' : ''}
                    </p>
                  </div>
                  <p className="text-sm font-bold">
                    <span className="text-emerald-400">{p.wins}</span>
                    <span className="text-slate-500 mx-0.5">&ndash;</span>
                    <span className="text-red-400">{p.losses}</span>
                    {p.ties > 0 && <><span className="text-slate-500 mx-0.5">&ndash;</span><span className="text-slate-400">{p.ties}</span></>}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── QUICK LINKS ── */}
        <div className="grid grid-cols-2 gap-3 mt-5 animate-slide-up" style={{ animationDelay: '250ms' }}>
          <Link
            href="/all-picks"
            className="glass-card rounded-2xl p-4 text-center hover:bg-white/[0.06] transition-all"
          >
            <span className="text-2xl mb-1 block">📋</span>
            <span className="text-xs font-medium text-slate-400">All Picks</span>
          </Link>
          <Link
            href="/spreadsheets"
            className="glass-card rounded-2xl p-4 text-center hover:bg-white/[0.06] transition-all"
          >
            <span className="text-2xl mb-1 block">📊</span>
            <span className="text-xs font-medium text-slate-400">Spreadsheets</span>
          </Link>
        </div>
      </main>
    </div>
  )
}
