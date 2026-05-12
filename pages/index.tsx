import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { CURRENT_SEASON, MAX_BEST_PICKS } from '@/lib/constants'
import { computeLockTime, formatKickoff } from '@/lib/lockTime'
import { computeRecords, recordSort } from '@/lib/computeStandings'
import Nav from '@/components/Nav'

interface ManagedPlayerSummary {
  id: string
  name: string
  avatar_url?: string | null
  pickedCount: number
  totalGames: number
  bestPickCount: number
  complete: boolean
}

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
  // Players the current user manages (empty if not a manager)
  managedPlayers: ManagedPlayerSummary[]
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

  // Tick every second for live countdown — paused when tab hidden to save battery
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (interval) return
      setNow(new Date())
      interval = setInterval(() => setNow(new Date()), 1_000)
    }
    const stop = () => {
      if (interval) { clearInterval(interval); interval = null }
    }
    const handleVisibility = () => {
      if (document.hidden) stop()
      else start()
    }
    start()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
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
          { data: threeBests },
        ] = await Promise.all([
          supabase.from('users').select('id, name, avatar_url').order('name'),
          supabase.from('picks').select('user_id, game_id, picked_team, week').eq('season', CURRENT_SEASON),
          supabase.from('games').select('id, week, away_team, home_team, kickoff_time, winning_team, away_score, home_score').eq('season', CURRENT_SEASON).order('kickoff_time'),
          supabase.from('three_best').select('user_id, week, pick_1, pick_2, pick_3').eq('season', CURRENT_SEASON),
        ])

        if (!users || !allGames) { setDataLoading(false); return }

        const userIds = users.map(u => u.id)
        const decidedGames = allGames.filter(g => g.winning_team)
        const allDecidedWeeks = [...new Set(decidedGames.map(g => g.week))].sort((a, b) => a - b)

        // Per-user records via the shared module
        const records = computeRecords({
          userIds,
          games: allGames,
          picks: allPicks ?? [],
          threeBests: threeBests ?? [],
        })

        // Rank all users
        const ranked = userIds
          .map(uid => ({ uid, r: records.get(uid)! }))
          .sort((a, b) => recordSort(a.r, b.r))

        const myRankIdx = ranked.findIndex(x => x.uid === user.id)
        const myRecord = records.get(user.id)!

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

        // Last week rank — rank by that week's record (penalties already applied in shared module)
        let lastWeekRank: number | null = null
        if (lastDecidedWeek !== null) {
          const weekRanked = userIds
            .map(uid => {
              const wr = records.get(uid)!.weekRecords.get(lastDecidedWeek)
              return { uid, w: wr?.wins ?? 0, l: wr?.losses ?? 0, hasRow: !!wr }
            })
            .filter(x => x.hasRow)
            .sort((a, b) => b.w !== a.w ? b.w - a.w : a.l - b.l)
          const lwIdx = weekRanked.findIndex(r => r.uid === user.id)
          lastWeekRank = lwIdx >= 0 ? lwIdx + 1 : null
        }

        // Leaderboard top 3
        const leaderboard = ranked.slice(0, 3).map(({ uid, r }) => {
          const u = users.find(u => u.id === uid)
          return {
            name: u?.name ?? 'Unknown',
            wins: r.wins, losses: r.losses, ties: r.ties,
            isYou: uid === user.id,
            avatar_url: u?.avatar_url,
          }
        })

        // Managed players: load any players where I'm a manager
        let managedPlayers: ManagedPlayerSummary[] = []
        try {
          const { data: { session } } = await supabase.auth.getSession()
          const token = session?.access_token ?? ''
          const res = await fetch('/api/managed-players', {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (res.ok) {
            const json = await res.json()
            const players: Array<{ id: string; name: string }> = json.players ?? []
            const totalGamesThisWeek = currentWeekGames.length
            managedPlayers = players.map(p => {
              const playerPicks = (allPicks ?? []).filter(pk => pk.user_id === p.id && pk.week === maxWeek)
              const playerBest = (threeBests ?? []).find(tb => tb.user_id === p.id && tb.week === maxWeek)
              const playerBestCount = playerBest ? [playerBest.pick_1, playerBest.pick_2, playerBest.pick_3].filter(Boolean).length : 0
              const u = users.find(u => u.id === p.id)
              return {
                id: p.id,
                name: p.name,
                avatar_url: u?.avatar_url,
                pickedCount: playerPicks.length,
                totalGames: totalGamesThisWeek,
                bestPickCount: playerBestCount,
                complete: playerPicks.length >= totalGamesThisWeek && playerBestCount >= MAX_BEST_PICKS,
              }
            })
          }
        } catch (err) {
          console.error('Managed players fetch error:', err)
        }

        setData({
          wins: myRecord.wins,
          losses: myRecord.losses,
          ties: myRecord.ties,
          rank: myRankIdx + 1,
          totalPlayers: ranked.filter(x => x.r.wins + x.r.losses + x.r.ties > 0).length,
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
          lastWeekWins: lastDecidedWeek ? (myRecord.weekRecords.get(lastDecidedWeek)?.wins ?? 0) : 0,
          lastWeekLosses: lastDecidedWeek ? (myRecord.weekRecords.get(lastDecidedWeek)?.losses ?? 0) : 0,
          lastWeekTies: lastDecidedWeek ? (myRecord.weekRecords.get(lastDecidedWeek)?.ties ?? 0) : 0,
          lastWeekRank,
          leaderboard,
          managedPlayers,
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

        {/* ── MANAGED PLAYERS (only if you manage anyone) ── */}
        {d.managedPlayers.length > 0 && d.currentWeek !== null && (
          <div className="mb-5 animate-slide-up" style={{ animationDelay: '175ms' }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Players you manage</p>
              <Link href="/picks" className="text-[10px] font-semibold text-blue-400 hover:text-blue-300 transition">
                Make picks →
              </Link>
            </div>
            <div className="glass-card rounded-2xl overflow-hidden">
              {d.managedPlayers.map((mp, i) => (
                <div
                  key={mp.id}
                  className={`flex items-center gap-3 px-4 py-3 border-b border-white/[0.04] last:border-0 ${
                    !mp.complete && !d.isLocked ? 'bg-amber-500/5' : ''
                  }`}
                >
                  {mp.avatar_url ? (
                    <img src={mp.avatar_url} alt="" loading="lazy" decoding="async" className="w-8 h-8 rounded-full object-cover border border-white/[0.08]" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white text-[11px] font-bold border border-white/[0.08]">
                      {mp.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{mp.name}</p>
                    <p className="text-[11px] text-slate-500">
                      {mp.totalGames > 0 ? (
                        <>
                          {mp.pickedCount}/{mp.totalGames} picks
                          {mp.bestPickCount >= MAX_BEST_PICKS
                            ? <span className="text-amber-400 ml-1.5">⭐ Best 3 set</span>
                            : <span className="text-slate-500 ml-1.5">⭐ {mp.bestPickCount}/{MAX_BEST_PICKS}</span>
                          }
                        </>
                      ) : (
                        'No games yet'
                      )}
                    </p>
                  </div>
                  {mp.totalGames > 0 && (
                    mp.complete ? (
                      <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">Ready</span>
                    ) : d.isLocked ? (
                      <span className="text-[10px] font-semibold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">Locked</span>
                    ) : (
                      <span className="text-[10px] font-semibold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">Incomplete</span>
                    )
                  )}
                </div>
              ))}
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
