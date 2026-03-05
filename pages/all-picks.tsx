import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { CURRENT_SEASON } from '@/lib/constants'
import Nav from '@/components/Nav'

const NFL_TEAMS: Record<string, { city: string; name: string; logo: string }> = {
  ARI: { city: 'Arizona',       name: 'Cardinals',   logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/ari.png' },
  ATL: { city: 'Atlanta',       name: 'Falcons',      logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/atl.png' },
  BAL: { city: 'Baltimore',     name: 'Ravens',       logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/bal.png' },
  BUF: { city: 'Buffalo',       name: 'Bills',        logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/buf.png' },
  CAR: { city: 'Carolina',      name: 'Panthers',     logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/car.png' },
  CHI: { city: 'Chicago',       name: 'Bears',        logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/chi.png' },
  CIN: { city: 'Cincinnati',    name: 'Bengals',      logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/cin.png' },
  CLE: { city: 'Cleveland',     name: 'Browns',       logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/cle.png' },
  DAL: { city: 'Dallas',        name: 'Cowboys',      logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/dal.png' },
  DEN: { city: 'Denver',        name: 'Broncos',      logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/den.png' },
  DET: { city: 'Detroit',       name: 'Lions',        logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/det.png' },
  GB:  { city: 'Green Bay',     name: 'Packers',      logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/gb.png'  },
  HOU: { city: 'Houston',       name: 'Texans',       logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/hou.png' },
  IND: { city: 'Indianapolis',  name: 'Colts',        logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/ind.png' },
  JAC: { city: 'Jacksonville',  name: 'Jaguars',      logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/jax.png' },
  KC:  { city: 'Kansas City',   name: 'Chiefs',       logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/kc.png'  },
  LAC: { city: 'LA',            name: 'Chargers',     logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/lac.png' },
  LAR: { city: 'LA',            name: 'Rams',         logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/lar.png' },
  LV:  { city: 'Las Vegas',     name: 'Raiders',      logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/lv.png'  },
  MIA: { city: 'Miami',         name: 'Dolphins',     logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/mia.png' },
  MIN: { city: 'Minnesota',     name: 'Vikings',      logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/min.png' },
  NE:  { city: 'New England',   name: 'Patriots',     logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/ne.png'  },
  NO:  { city: 'New Orleans',   name: 'Saints',       logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/no.png'  },
  NYG: { city: 'NY',            name: 'Giants',       logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/nyg.png' },
  NYJ: { city: 'NY',            name: 'Jets',         logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/nyj.png' },
  PHI: { city: 'Philadelphia',  name: 'Eagles',       logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/phi.png' },
  PIT: { city: 'Pittsburgh',    name: 'Steelers',     logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/pit.png' },
  SEA: { city: 'Seattle',       name: 'Seahawks',     logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/sea.png' },
  SF:  { city: 'San Francisco', name: '49ers',        logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/sf.png'  },
  TB:  { city: 'Tampa Bay',     name: 'Buccaneers',   logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/tb.png'  },
  TEN: { city: 'Tennessee',     name: 'Titans',       logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/ten.png' },
  WAS: { city: 'Washington',    name: 'Commanders',   logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/wsh.png' },
}

interface Game {
  id: string
  away_team: string
  home_team: string
  kickoff_time: string
  week: number
}

interface AllPicksData {
  users: { id: string; name: string }[]
  picks: { user_id: string; game_id: string; picked_team: string }[]
  threeBests: { user_id: string; pick_1: string; pick_2: string; pick_3: string }[]
}

function computeLockTime(games: Game[]): Date | null {
  if (games.length === 0) return null
  const kickoffs = games.map(g => new Date(g.kickoff_time))
  const earliest = new Date(Math.min(...kickoffs.map(d => d.getTime())))
  const thursday = new Date(earliest)
  const dow = thursday.getUTCDay()
  const daysBack = dow >= 4 ? dow - 4 : dow + 3
  thursday.setUTCDate(thursday.getUTCDate() - daysBack)
  const month = thursday.getUTCMonth()
  const utcOffset = month >= 10 ? 5 : 4
  thursday.setUTCHours(20 + utcOffset, 15, 0, 0)
  return thursday
}

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
  const [dataLoading, setDataLoading] = useState(true)
  const [picksLoading, setPicksLoading] = useState(false)
  const [isLocked, setIsLocked] = useState(false)

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

    const lockTime = computeLockTime(weekGames)
    const locked = lockTime ? new Date() >= lockTime : false
    setIsLocked(locked)

    if (!locked) {
      setPicksLoading(false)
      return
    }

    const [
      { data: usersData },
      { data: picksData },
      { data: threeBestsData },
    ] = await Promise.all([
      supabase.from('users').select('id, name').order('name'),
      supabase.from('picks').select('user_id, game_id, picked_team')
        .eq('week', week).eq('season', CURRENT_SEASON),
      supabase.from('three_best').select('user_id, pick_1, pick_2, pick_3')
        .eq('week', week).eq('season', CURRENT_SEASON),
    ])

    setAllPicksData({
      users: usersData ?? [],
      picks: picksData ?? [],
      threeBests: threeBestsData ?? [],
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

  return (
    <div className="min-h-screen bg-surface pb-20">
      <Nav />

      <main className="max-w-4xl mx-auto px-4 py-6 animate-fade-in">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">
          All Picks
        </h2>

        {/* Week selector */}
        {availableWeeks.length > 0 && (
          <div className="flex items-center gap-2 mb-5">
            <button
              onClick={() => {
                const idx = availableWeeks.indexOf(selectedWeek!)
                if (idx > 0) setSelectedWeek(availableWeeks[idx - 1])
              }}
              disabled={selectedWeek === availableWeeks[0]}
              className="press w-9 h-9 flex items-center justify-center rounded-xl bg-white/[0.06] text-slate-400 hover:bg-white/[0.10] disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            </button>

            <div className="flex-1 overflow-x-auto">
              <div className="flex gap-1.5 justify-center">
                {availableWeeks.map(week => (
                  <button
                    key={week}
                    onClick={() => setSelectedWeek(week)}
                    className={`press px-3.5 py-2 text-sm font-medium rounded-full transition-all whitespace-nowrap ${
                      selectedWeek === week
                        ? 'bg-white/[0.10] text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                    }`}
                  >
                    Wk {week}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => {
                const idx = availableWeeks.indexOf(selectedWeek!)
                if (idx < availableWeeks.length - 1) setSelectedWeek(availableWeeks[idx + 1])
              }}
              disabled={selectedWeek === availableWeeks[availableWeeks.length - 1]}
              className="press w-9 h-9 flex items-center justify-center rounded-xl bg-white/[0.06] text-slate-400 hover:bg-white/[0.10] disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
        )}

        {/* Content */}
        {picksLoading ? (
          <div className="glass-card rounded-2xl p-10 text-center">
            <span className="w-5 h-5 border-2 border-slate-400/30 border-t-slate-400 rounded-full animate-spin inline-block mb-3" />
            <p className="text-slate-400 text-sm">Loading picks...</p>
          </div>
        ) : !isLocked ? (
          <div className="glass-card rounded-2xl p-10 text-center">
            <p className="text-3xl mb-3">🔒</p>
            <p className="text-white font-medium">Picks not yet locked</p>
            <p className="text-slate-500 text-sm mt-1.5">
              Week {selectedWeek} picks will be visible here after the Thursday deadline.
            </p>
          </div>
        ) : allPicksData && allPicksData.users.length > 0 ? (
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-white/[0.03] border-b border-white/[0.06]">
                    <th className="sticky left-0 z-10 bg-[#0f1729] px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase min-w-[120px]">
                      Game
                    </th>
                    {allPicksData.users.map(u => (
                      <th key={u.id} className="px-2 py-2.5 text-center text-xs font-semibold text-slate-400 whitespace-nowrap">
                        {u.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {games.map(game => {
                    const away = NFL_TEAMS[game.away_team]
                    const home = NFL_TEAMS[game.home_team]
                    return (
                      <tr key={game.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                        <td className="sticky left-0 z-10 bg-[#0f1729] px-3 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {away && <img src={away.logo} alt="" className="w-5 h-5 object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />}
                            <span className="text-slate-300 text-xs font-medium">
                              {game.away_team} @ {game.home_team}
                            </span>
                            {home && <img src={home.logo} alt="" className="w-5 h-5 object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />}
                          </div>
                        </td>
                        {allPicksData.users.map(u => {
                          const picked = picksLookup.get(`${u.id}-${game.id}`)
                          const bestSet = threeBestLookup.get(u.id)
                          const isBest = picked && bestSet?.has(picked)
                          return (
                            <td key={u.id} className="px-2 py-2.5 text-center">
                              {picked ? (
                                <span className={`text-xs font-medium ${isBest ? 'text-amber-400' : 'text-slate-300'}`}>
                                  {isBest && '\u2B50 '}{picked}
                                </span>
                              ) : (
                                <span className="text-slate-600 text-xs">&mdash;</span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
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
