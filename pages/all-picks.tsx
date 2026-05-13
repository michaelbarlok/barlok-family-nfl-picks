import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { CURRENT_SEASON } from '@/lib/constants'
import { parseUTC, computeLockTime } from '@/lib/lockTime'
import { NFL_TEAMS } from '@/lib/nflTeams'
import { computeRecords } from '@/lib/computeStandings'
import Nav from '@/components/Nav'
import WeekNavigator from '@/components/WeekNavigator'

interface Game {
  id: string
  away_team: string
  home_team: string
  kickoff_time: string
  week: number
  winning_team: string | null
  away_score: number | null
  home_score: number | null
}

interface AllPicksData {
  users: { id: string; name: string }[]
  picks: { user_id: string; game_id: string; picked_team: string }[]
  threeBests: { user_id: string; pick_1: string; pick_2: string; pick_3: string }[]
}

interface SeasonData {
  games: { id: string; week: number; winning_team: string | null }[]
  picks: { user_id: string; game_id: string; picked_team: string; week: number }[]
  threeBests: { user_id: string; week: number; pick_1: string; pick_2: string; pick_3: string }[]
}

// parseUTC and computeLockTime imported from @/lib/lockTime

function AllPicksSkeleton() {
  return (
    <div className="min-h-screen bg-surface pb-20">
      <Nav />
      <main className="max-w-4xl mx-auto px-4 py-6">
        <div className="skeleton h-4 w-40 rounded mb-4" />
        <div className="skeleton h-10 w-full rounded-xl mb-5" />
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="skeleton h-10 w-full" />
          {[...Array(8)].map((_, i) => (
            <div key={i} className="px-4 py-4 border-t border-white/[0.04]">
              <div className="skeleton h-5 w-full rounded" />
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}

export default function AllPicksPage() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const [availableWeeks, setAvailableWeeks] = useState<number[]>([])
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null)
  const [games, setGames] = useState<Game[]>([])
  const [allPicksData, setAllPicksData] = useState<AllPicksData | null>(null)
  const [viewMode, setViewMode] = useState<'player' | 'game'>('player')
  const [dataLoading, setDataLoading] = useState(true)
  const [picksLoading, setPicksLoading] = useState(false)
  const [isLocked, setIsLocked] = useState(false)
  const [lockTime, setLockTime] = useState<Date | null>(null)
  const [seasonData, setSeasonData] = useState<SeasonData | null>(null)
  const [submissionStatus, setSubmissionStatus] = useState<{ userId: string; name: string; pickCount: number; hasThreeBest: boolean }[]>([])
  const [totalGames, setTotalGames] = useState(0)

  useEffect(() => {
    if (!loading && !user) router.push('/login')
  }, [user, loading, router])

  // Fetch available weeks
  useEffect(() => {
    const fetchWeeks = async () => {
      if (!user) return
      const { data } = await supabase
        .from('games').select('week')
        .eq('season', CURRENT_SEASON)
        .order('week')
      if (data) {
        const weeks = [...new Set(data.map(g => g.week))].sort((a, b) => a - b)
        setAvailableWeeks(weeks)
        if (weeks.length > 0) {
          setSelectedWeek(weeks[weeks.length - 1])
        }
      }
      setDataLoading(false)
    }
    fetchWeeks()
  }, [user])

  // Fetch games + picks for selected week
  const fetchWeekData = useCallback(async (week: number) => {
    setPicksLoading(true)
    setAllPicksData(null)

    const { data: gamesData } = await supabase
      .from('games').select('*')
      .eq('week', week).eq('season', CURRENT_SEASON)
      .order('kickoff_time')

    const weekGames = gamesData ?? []
    setGames(weekGames)

    const lt = computeLockTime(weekGames)
    const locked = lt ? new Date() >= lt : false
    setIsLocked(locked)
    setLockTime(lt)
    setTotalGames(weekGames.length)

    if (!locked) {
      // Fetch submission status (pick counts per user) without revealing actual picks
      const [{ data: usersData }, { data: pickCounts }, { data: threeBestRows }] = await Promise.all([
        supabase.from('users').select('id, name').order('name'),
        supabase.from('picks').select('user_id, game_id')
          .eq('week', week).eq('season', CURRENT_SEASON),
        supabase.from('three_best').select('user_id')
          .eq('week', week).eq('season', CURRENT_SEASON),
      ])
      const countMap = new Map<string, number>()
      for (const p of pickCounts ?? []) {
        countMap.set(p.user_id, (countMap.get(p.user_id) || 0) + 1)
      }
      const tbSet = new Set((threeBestRows ?? []).map((r: any) => r.user_id))
      setSubmissionStatus(
        (usersData ?? []).map((u: any) => ({
          userId: u.id,
          name: u.name,
          pickCount: countMap.get(u.id) || 0,
          hasThreeBest: tbSet.has(u.id),
        }))
      )
      setPicksLoading(false)
      return
    }

    const [
      { data: usersData },
      { data: picksData },
      { data: threeBestsData },
      { data: allSeasonGames },
      { data: allSeasonPicks },
      { data: allSeasonThreeBests },
    ] = await Promise.all([
      supabase.from('users').select('id, name').order('name'),
      supabase.from('picks').select('user_id, game_id, picked_team')
        .eq('week', week).eq('season', CURRENT_SEASON),
      supabase.from('three_best').select('user_id, pick_1, pick_2, pick_3')
        .eq('week', week).eq('season', CURRENT_SEASON),
      supabase.from('games').select('id, week, winning_team')
        .eq('season', CURRENT_SEASON),
      supabase.from('picks').select('user_id, game_id, picked_team, week')
        .eq('season', CURRENT_SEASON),
      supabase.from('three_best').select('user_id, week, pick_1, pick_2, pick_3')
        .eq('season', CURRENT_SEASON),
    ])

    setAllPicksData({
      users: usersData ?? [],
      picks: picksData ?? [],
      threeBests: threeBestsData ?? [],
    })
    setSeasonData({
      games: allSeasonGames ?? [],
      picks: allSeasonPicks ?? [],
      threeBests: allSeasonThreeBests ?? [],
    })
    setPicksLoading(false)
  }, [])

  useEffect(() => {
    if (selectedWeek !== null) fetchWeekData(selectedWeek)
  }, [selectedWeek, fetchWeekData])

  if (loading || dataLoading) return <AllPicksSkeleton />
  if (!user) return null

  const picksLookup = new Map<string, string>()
  allPicksData?.picks.forEach(p => picksLookup.set(`${p.user_id}-${p.game_id}`, p.picked_team))
  const threeBestLookup = new Map<string, Set<string>>()
  allPicksData?.threeBests.forEach(tb => {
    threeBestLookup.set(tb.user_id, new Set([tb.pick_1, tb.pick_2, tb.pick_3].filter(Boolean)))
  })

  // Build game result lookup: gameId -> winning_team
  const gameResultLookup = new Map<string, string | null>()
  games.forEach(g => gameResultLookup.set(g.id, g.winning_team))

  // Compute records via the shared module. We pass only weeks <= selectedWeek
  // so totals don't include future weeks. The Best 3 logic needs team
  // abbreviations on games, so we hydrate from the current-week games list
  // (other weeks are looked up via this map below).
  const userIdsForRecords = allPicksData?.users.map(u => u.id) ?? []

  // Games lookup with team abbrs — needed because seasonData.games only has id/week/winning_team
  const gameTeamsLookup = new Map<string, { away_team: string; home_team: string }>()
  games.forEach(g => gameTeamsLookup.set(g.id, { away_team: g.away_team, home_team: g.home_team }))

  const recordsWithBest3 = (seasonData && selectedWeek != null)
    ? computeRecords({
        userIds: userIdsForRecords,
        games: seasonData.games
          .filter(g => g.week <= selectedWeek)
          .map(g => {
            const teams = gameTeamsLookup.get(g.id)
            return {
              id: g.id, week: g.week,
              away_team: teams?.away_team ?? '',
              home_team: teams?.home_team ?? '',
              winning_team: g.winning_team,
            }
          }),
        picks: seasonData.picks
          .filter(p => p.week <= selectedWeek)
          .map(p => ({ user_id: p.user_id, game_id: p.game_id, picked_team: p.picked_team, week: p.week })),
        threeBests: seasonData.threeBests
          .filter(tb => tb.week <= selectedWeek)
          .map(tb => ({ user_id: tb.user_id, week: tb.week, pick_1: tb.pick_1, pick_2: tb.pick_2, pick_3: tb.pick_3 })),
      })
    : null

  const computeRecordsForRow = (userId: string) => {
    const empty = { priorW: 0, priorL: 0, priorT: 0, weekW: 0, weekL: 0, weekT: 0, totalW: 0, totalL: 0, totalT: 0, priorB3W: 0, priorB3L: 0, priorB3T: 0, weekB3W: 0, weekB3L: 0, weekB3T: 0, totalB3W: 0, totalB3L: 0, totalB3T: 0 }
    if (!recordsWithBest3 || !selectedWeek) return empty
    const r = recordsWithBest3.get(userId)
    if (!r) return empty
    const wkRec = r.weekRecords.get(selectedWeek)
    const weekW = wkRec?.wins ?? 0, weekL = wkRec?.losses ?? 0, weekT = wkRec?.ties ?? 0
    const weekB3W = wkRec?.bestWins ?? 0, weekB3L = wkRec?.bestLosses ?? 0, weekB3T = wkRec?.bestTies ?? 0
    return {
      priorW: r.wins - weekW, priorL: r.losses - weekL, priorT: r.ties - weekT,
      weekW, weekL, weekT,
      totalW: r.wins, totalL: r.losses, totalT: r.ties,
      priorB3W: r.bestWins - weekB3W, priorB3L: r.bestLosses - weekB3L, priorB3T: r.bestTies - weekB3T,
      weekB3W, weekB3L, weekB3T,
      totalB3W: r.bestWins, totalB3L: r.bestLosses, totalB3T: r.bestTies,
    }
  }

  return (
    <div className="min-h-screen bg-surface pb-20">
      <Nav />

      <main className="max-w-4xl mx-auto px-4 py-6 animate-fade-in">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">
          All Picks
        </h2>

        {/* Week selector */}
        <WeekNavigator
          selectedWeek={selectedWeek}
          onWeekChange={setSelectedWeek}
          availableWeeks={availableWeeks}
        />

        {/* Content */}
        {picksLoading ? (
          <div className="glass-card rounded-2xl p-10 text-center">
            <span className="w-5 h-5 border-2 border-slate-400/30 border-t-slate-400 rounded-full animate-spin inline-block mb-3" />
            <p className="text-slate-400 text-sm">Loading picks...</p>
          </div>
        ) : !isLocked ? (
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.06]">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">🔒</span>
                <p className="text-white font-medium">Picks not yet locked</p>
              </div>
              <p className="text-slate-500 text-sm">
                Week {selectedWeek} picks will be revealed {lockTime
                  ? `on ${lockTime.toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: 'America/New_York' })}`
                  : 'after the Thursday deadline'}.
              </p>
            </div>
            {submissionStatus.length > 0 && (
              <div className="divide-y divide-white/[0.04]">
                {submissionStatus.map(s => {
                  const complete = s.pickCount >= totalGames && s.hasThreeBest
                  const partial = s.pickCount > 0
                  return (
                    <div key={s.userId} className="flex items-center justify-between px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center ${
                          complete
                            ? 'bg-emerald-500/20 border border-emerald-500/30'
                            : partial
                            ? 'bg-amber-500/20 border border-amber-500/30'
                            : 'bg-white/[0.04] border border-white/[0.08]'
                        }`}>
                          {complete ? (
                            <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          ) : partial ? (
                            <span className="text-amber-400 text-xs font-bold">{s.pickCount}</span>
                          ) : (
                            <svg className="w-3.5 h-3.5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12h-15" />
                            </svg>
                          )}
                        </div>
                        <span className="text-sm text-slate-300">{s.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {!complete && partial && (
                          <span className="text-[11px] text-slate-500">{s.pickCount}/{totalGames}{!s.hasThreeBest ? ' + B3' : ''}</span>
                        )}
                        {!complete && !partial && (
                          <span className="text-[11px] text-slate-600">0/{totalGames}</span>
                        )}
                        {complete && (
                          <span className="text-[11px] text-emerald-500/70">{totalGames}/{totalGames}</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : allPicksData && allPicksData.users.length > 0 ? (
          <>
          {/* ── VIEW MODE TOGGLE ── */}
          <div className="mb-4 flex gap-1 p-1 bg-white/[0.04] border border-white/[0.06] rounded-xl w-fit">
            <button
              onClick={() => setViewMode('player')}
              className={`press text-xs font-semibold px-3 py-1.5 rounded-lg transition ${
                viewMode === 'player' ? 'bg-white/[0.10] text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              By Player
            </button>
            <button
              onClick={() => setViewMode('game')}
              className={`press text-xs font-semibold px-3 py-1.5 rounded-lg transition ${
                viewMode === 'game' ? 'bg-white/[0.10] text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              By Game
            </button>
          </div>

          {/* ── PICK DISTRIBUTION ── per-game consensus visualization */}
          <div className="mb-5 animate-slide-up">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
              Pick Distribution
            </p>
            <div className="glass-card rounded-2xl overflow-hidden divide-y divide-white/[0.04]">
              {games.map(game => {
                const total = allPicksData.users.length
                let awayCount = 0
                let homeCount = 0
                for (const u of allPicksData.users) {
                  const pk = picksLookup.get(`${u.id}-${game.id}`)
                  if (pk === game.away_team) awayCount++
                  else if (pk === game.home_team) homeCount++
                }
                const noPick = total - awayCount - homeCount
                const awayPct = total > 0 ? (awayCount / total) * 100 : 0
                const homePct = total > 0 ? (homeCount / total) * 100 : 0
                const winner = game.winning_team
                const isTie = winner === 'TIE'
                const awayInfo = NFL_TEAMS[game.away_team]
                const homeInfo = NFL_TEAMS[game.home_team]
                return (
                  <div key={game.id} className="px-3 py-2.5">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        {awayInfo && <img src={awayInfo.logo} alt="" loading="lazy" decoding="async" className="w-4 h-4 object-contain shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />}
                        <span className={`text-[11px] font-semibold ${winner === game.away_team ? 'text-emerald-300' : winner && !isTie ? 'text-slate-500' : 'text-slate-300'}`}>{game.away_team}</span>
                        <span className="text-[10px] text-slate-500">@</span>
                        {homeInfo && <img src={homeInfo.logo} alt="" loading="lazy" decoding="async" className="w-4 h-4 object-contain shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />}
                        <span className={`text-[11px] font-semibold ${winner === game.home_team ? 'text-emerald-300' : winner && !isTie ? 'text-slate-500' : 'text-slate-300'}`}>{game.home_team}</span>
                      </div>
                      <span className="text-[10px] text-slate-500 shrink-0">
                        {awayCount}-{homeCount}{noPick > 0 ? ` (${noPick} no pick)` : ''}
                      </span>
                    </div>
                    <div className="flex w-full h-2 rounded-full overflow-hidden bg-white/[0.04]">
                      <div
                        className={`${winner === game.away_team ? 'bg-emerald-400/80' : winner === game.home_team ? 'bg-red-400/60' : 'bg-blue-400/60'} h-full transition-all`}
                        style={{ width: `${awayPct}%` }}
                        title={`${game.away_team}: ${awayCount} (${awayPct.toFixed(0)}%)`}
                      />
                      <div
                        className={`${winner === game.home_team ? 'bg-emerald-400/80' : winner === game.away_team ? 'bg-red-400/60' : 'bg-indigo-400/60'} h-full transition-all`}
                        style={{ width: `${homePct}%` }}
                        title={`${game.home_team}: ${homeCount} (${homePct.toFixed(0)}%)`}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                      <span>{awayCount > 0 ? `${awayPct.toFixed(0)}%` : ''}</span>
                      <span>{homeCount > 0 ? `${homePct.toFixed(0)}%` : ''}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── BY-PLAYER VIEW ── one card per user, no horizontal scroll ── */}
          {viewMode === 'player' && (
            <div className="space-y-3">
              {allPicksData.users.map((u, userIdx) => {
                const userPicks = games.map(g => ({
                  game: g,
                  pick: picksLookup.get(`${u.id}-${g.id}`) ?? null,
                }))
                const bestSet = threeBestLookup.get(u.id) ?? new Set<string>()
                const rec = computeRecordsForRow(u.id)
                const isMe = u.id === user.id
                return (
                  <div
                    key={u.id}
                    className={`glass-card rounded-2xl overflow-hidden animate-slide-up ${
                      isMe ? 'ring-1 ring-blue-500/40' : ''
                    }`}
                    style={{ animationDelay: `${userIdx * 30}ms` }}
                  >
                    {/* Card header — user name + week record */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-white/[0.02]">
                      <p className={`text-sm font-semibold truncate ${isMe ? 'text-blue-400' : 'text-white'}`}>
                        {u.name}{isMe && <span className="text-blue-400/60 font-normal text-xs ml-1.5">(you)</span>}
                      </p>
                      <div className="flex items-center gap-3 shrink-0">
                        {(rec.weekW + rec.weekL + rec.weekT > 0) && (
                          <span className="text-xs font-bold tabular-nums">
                            <span className="text-emerald-400">{rec.weekW}</span>
                            <span className="text-slate-600 mx-0.5">-</span>
                            <span className="text-red-400">{rec.weekL}</span>
                            {rec.weekT > 0 && <><span className="text-slate-600 mx-0.5">-</span><span className="text-slate-400">{rec.weekT}</span></>}
                          </span>
                        )}
                        {(rec.weekB3W + rec.weekB3L + rec.weekB3T > 0) && (
                          <span className="text-[11px] font-bold tabular-nums">
                            <span className="text-amber-400">⭐{rec.weekB3W}</span>
                            <span className="text-slate-600 mx-0.5">-</span>
                            <span className="text-amber-600">{rec.weekB3L}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Picks list — one row per game */}
                    <div className="divide-y divide-white/[0.04]">
                      {userPicks.map(({ game, pick }) => {
                        const winner = game.winning_team
                        const isTie = winner === 'TIE'
                        const isWin = pick && winner && !isTie && pick === winner
                        const isLoss = pick && winner && !isTie && pick !== winner
                        const isBest = pick ? bestSet.has(pick) : false
                        const away = NFL_TEAMS[game.away_team]
                        const home = NFL_TEAMS[game.home_team]
                        const pickedInfo = pick ? NFL_TEAMS[pick] : null
                        return (
                          <div key={game.id} className="flex items-center gap-2 px-4 py-2">
                            {/* Matchup */}
                            <div className="flex items-center gap-1 min-w-0 flex-1">
                              {away && <img src={away.logo} alt="" loading="lazy" decoding="async" className="w-4 h-4 object-contain shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />}
                              <span className={`text-[11px] font-medium ${winner === game.away_team ? 'text-white' : 'text-slate-500'}`}>{game.away_team}</span>
                              <span className="text-[10px] text-slate-600 mx-0.5">@</span>
                              {home && <img src={home.logo} alt="" loading="lazy" decoding="async" className="w-4 h-4 object-contain shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />}
                              <span className={`text-[11px] font-medium ${winner === game.home_team ? 'text-white' : 'text-slate-500'}`}>{game.home_team}</span>
                            </div>
                            {/* Arrow + pick */}
                            <span className="text-slate-700 text-xs">→</span>
                            <div className="flex items-center gap-1 shrink-0 min-w-[68px] justify-end">
                              {pick ? (
                                <>
                                  {isBest && <span className="text-amber-400 text-[11px] leading-none">⭐</span>}
                                  {pickedInfo && <img src={pickedInfo.logo} alt="" loading="lazy" decoding="async" className="w-4 h-4 object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />}
                                  <span className={`text-xs font-bold leading-none ${
                                    isTie ? 'text-slate-300'
                                    : isWin ? 'text-emerald-400'
                                    : isLoss ? 'text-red-400'
                                    : 'text-slate-200'
                                  }`}>
                                    {pick}
                                  </span>
                                  {isWin && <span className="text-emerald-400 text-xs leading-none">✓</span>}
                                  {isLoss && <span className="text-red-400 text-xs leading-none">✗</span>}
                                  {isTie && winner && <span className="text-slate-400 text-xs leading-none">=</span>}
                                </>
                              ) : (
                                <span className="text-slate-700 text-[11px] italic">no pick</span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {/* Card footer — totals */}
                    <div className="px-4 py-2 bg-white/[0.02] border-t border-white/[0.04] flex items-center justify-between text-[11px] text-slate-500">
                      <span>Season total</span>
                      <span className="font-bold tabular-nums">
                        <span className="text-emerald-400">{rec.totalW}</span>
                        <span className="text-slate-600 mx-0.5">-</span>
                        <span className="text-red-400">{rec.totalL}</span>
                        {rec.totalT > 0 && <><span className="text-slate-600 mx-0.5">-</span><span className="text-slate-400">{rec.totalT}</span></>}
                        {(rec.totalB3W + rec.totalB3L + rec.totalB3T > 0) && (
                          <span className="ml-2.5 text-amber-400">⭐{rec.totalB3W}</span>
                        )}
                        {(rec.totalB3W + rec.totalB3L + rec.totalB3T > 0) && (
                          <>
                            <span className="text-slate-600 mx-0.5">-</span>
                            <span className="text-amber-600">{rec.totalB3L}</span>
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ── BY-GAME VIEW ── original wide grid, useful for cross-user comparison ── */}
          {viewMode === 'game' && (
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-white/[0.03] border-b border-white/[0.06]">
                    <th className="sticky left-0 z-10 bg-[#0f1729] px-2 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase w-[88px] min-w-[88px]">
                      Game
                    </th>
                    {allPicksData.users.map(u => (
                      <th key={u.id} className="px-1.5 py-2.5 text-center text-[11px] font-semibold text-slate-400 whitespace-nowrap">
                        {u.name.split(' ')[0]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {games.map(game => {
                    const away = NFL_TEAMS[game.away_team]
                    const home = NFL_TEAMS[game.home_team]
                    const hasScore = game.away_score != null && game.home_score != null
                    const awayWon = game.winning_team === game.away_team
                    const homeWon = game.winning_team === game.home_team
                    const isTieGame = game.winning_team === 'TIE'
                    return (
                      <tr key={game.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                        <td className="sticky left-0 z-10 bg-[#0f1729] px-2 py-1.5">
                          <div className="flex flex-col gap-0.5">
                            {/* Away team row */}
                            <div className="flex items-center gap-1.5">
                              {away && <img src={away.logo} alt="" loading="lazy" decoding="async" className="w-4 h-4 object-contain shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />}
                              <span className={`text-[11px] font-semibold ${awayWon ? 'text-white' : isTieGame ? 'text-slate-400' : hasScore ? 'text-slate-500' : 'text-slate-300'}`}>{game.away_team}</span>
                              {hasScore && <span className={`text-[11px] ml-auto tabular-nums ${awayWon ? 'text-white font-bold' : 'text-slate-500'}`}>{game.away_score}</span>}
                            </div>
                            {/* Home team row */}
                            <div className="flex items-center gap-1.5">
                              {home && <img src={home.logo} alt="" loading="lazy" decoding="async" className="w-4 h-4 object-contain shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />}
                              <span className={`text-[11px] font-semibold ${homeWon ? 'text-white' : isTieGame ? 'text-slate-400' : hasScore ? 'text-slate-500' : 'text-slate-300'}`}>{game.home_team}</span>
                              {hasScore && <span className={`text-[11px] ml-auto tabular-nums ${homeWon ? 'text-white font-bold' : 'text-slate-500'}`}>{game.home_score}</span>}
                            </div>
                          </div>
                        </td>
                        {allPicksData.users.map(u => {
                          const picked = picksLookup.get(`${u.id}-${game.id}`)
                          const bestSet = threeBestLookup.get(u.id)
                          const isBest = picked && bestSet?.has(picked)
                          const winner = gameResultLookup.get(game.id)
                          const isTie = winner === 'TIE'
                          const isWin = picked && winner && !isTie && picked === winner
                          const isLoss = picked && winner && !isTie && picked !== winner
                          return (
                            <td key={u.id} className="px-1 py-1.5 text-center align-middle">
                              {picked ? (
                                <span className={`text-[11px] font-medium leading-none ${
                                  isTie ? (isBest ? 'text-slate-300' : 'text-slate-400')
                                  : isWin ? (isBest ? 'text-emerald-300' : 'text-emerald-400')
                                  : isLoss ? (isBest ? 'text-red-300' : 'text-red-400')
                                  : (isBest ? 'text-amber-400' : 'text-slate-300')
                                }`}>
                                  {isBest && '\u2B50'}{picked}
                                </span>
                              ) : (
                                <span className="text-slate-600 text-[11px]">&mdash;</span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                  {/* Record summary rows */}
                  {(() => {
                    const userRecords = allPicksData.users.map(u => computeRecordsForRow(u.id))
                    const rows = [
                      { label: `Prior Wks`, key: 'prior' as const },
                      { label: `Week ${selectedWeek}`, key: 'week' as const },
                      { label: 'Total', key: 'total' as const },
                    ]
                    const b3Rows = [
                      { label: 'Best 3 Prior', key: 'prior' as const },
                      { label: `Best 3 Wk ${selectedWeek}`, key: 'week' as const },
                      { label: 'Best 3 Total', key: 'total' as const },
                    ]
                    return (
                      <>
                        <tr className="bg-white/[0.03]">
                          <td colSpan={allPicksData.users.length + 1} className="px-2 py-1.5">
                            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Overall Record</span>
                          </td>
                        </tr>
                        {rows.map(r => (
                          <tr key={r.key} className="border-t border-white/[0.04]">
                            <td className="sticky left-0 z-10 bg-[#0f1729] px-2 py-2 text-[11px] font-medium text-slate-400 whitespace-nowrap">
                              {r.label}
                            </td>
                            {userRecords.map((rec, i) => {
                              const w = r.key === 'prior' ? rec.priorW : r.key === 'week' ? rec.weekW : rec.totalW
                              const l = r.key === 'prior' ? rec.priorL : r.key === 'week' ? rec.weekL : rec.totalL
                              const t = r.key === 'prior' ? rec.priorT : r.key === 'week' ? rec.weekT : rec.totalT
                              return (
                                <td key={allPicksData!.users[i].id} className="px-1 py-2 text-center">
                                  <span className={`text-xs font-semibold ${r.key === 'total' ? 'text-white' : 'text-slate-300'}`}>
                                    {w}-{l}{t > 0 ? `-${t}` : ''}
                                  </span>
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                        <tr className="bg-white/[0.03]">
                          <td colSpan={allPicksData.users.length + 1} className="px-2 py-1.5">
                            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Best 3 Record</span>
                          </td>
                        </tr>
                        {b3Rows.map(r => (
                          <tr key={`b3-${r.key}`} className="border-t border-white/[0.04]">
                            <td className="sticky left-0 z-10 bg-[#0f1729] px-2 py-2 text-[11px] font-medium text-slate-400 whitespace-nowrap">
                              {r.label}
                            </td>
                            {userRecords.map((rec, i) => {
                              const w = r.key === 'prior' ? rec.priorB3W : r.key === 'week' ? rec.weekB3W : rec.totalB3W
                              const l = r.key === 'prior' ? rec.priorB3L : r.key === 'week' ? rec.weekB3L : rec.totalB3L
                              const t = r.key === 'prior' ? rec.priorB3T : r.key === 'week' ? rec.weekB3T : rec.totalB3T
                              return (
                                <td key={allPicksData!.users[i].id} className="px-1 py-2 text-center">
                                  <span className={`text-xs font-semibold ${r.key === 'total' ? 'text-amber-400' : 'text-slate-300'}`}>
                                    {w}-{l}{t > 0 ? `-${t}` : ''}
                                  </span>
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </>
                    )
                  })()}
                </tbody>
              </table>
            </div>
          </div>
          )}
          </>
        ) : (
          <div className="glass-card rounded-2xl p-10 text-center">
            <p className="text-3xl mb-3">📅</p>
            <p className="text-white font-medium">No picks data</p>
            <p className="text-slate-500 text-sm mt-1.5">No games or picks found for Week {selectedWeek}.</p>
          </div>
        )}
      </main>
    </div>
  )
}
