import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import Nav from '@/components/Nav'

interface Game {
  id: string
  away_team: string
  home_team: string
  kickoff_time: string
  week: number
}

interface UserPick {
  [gameId: string]: string
}

const CURRENT_SEASON = 2025
const MAX_BEST_PICKS = 3

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

function getTeam(abbr: string) {
  return NFL_TEAMS[abbr] ?? { city: abbr, name: '', logo: '' }
}

function formatKickoff(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  })
}

// Compute lock time: Thursday 8:15 PM ET of the current NFL week.
// We find the Thursday on or before the first game, then set 8:15 PM ET.
function computeLockTime(games: Game[]): Date | null {
  if (games.length === 0) return null
  const kickoffs = games.map(g => new Date(g.kickoff_time))
  const earliest = new Date(Math.min(...kickoffs.map(d => d.getTime())))

  // Walk back to Thursday (day 4)
  const thursday = new Date(earliest)
  const dow = thursday.getUTCDay()
  const daysBack = dow >= 4 ? dow - 4 : dow + 3
  thursday.setUTCDate(thursday.getUTCDate() - daysBack)

  // NFL season: EDT (UTC-4) Sep–Oct, EST (UTC-5) Nov onwards
  const month = thursday.getUTCMonth() // 0-indexed
  const utcOffset = month >= 10 ? 5 : 4  // Nov (10) = EST
  // 8:15 PM ET = 20:15 local = (20 + utcOffset):15 UTC
  thursday.setUTCHours(20 + utcOffset, 15, 0, 0)
  return thursday
}

export default function PicksPage() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const [currentWeek, setCurrentWeek] = useState<number | null>(null)
  const [games, setGames] = useState<Game[]>([])
  const [picks, setPicks] = useState<UserPick>({})
  const [bestPicks, setBestPicks] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [dataLoading, setDataLoading] = useState(true)
  const [now, setNow] = useState(new Date())

  // Keep clock ticking so lock state stays live
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 10_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!loading && !user) router.push('/login')
  }, [user, loading, router])

  // Detect current week: the latest week in the DB for this season
  useEffect(() => {
    const detectWeek = async () => {
      if (!user) return
      const { data } = await supabase
        .from('games').select('week')
        .eq('season', CURRENT_SEASON)
        .order('week', { ascending: false })
        .limit(1)
      if (data && data.length > 0) {
        setCurrentWeek(data[0].week)
      } else {
        setDataLoading(false)
      }
    }
    detectWeek()
  }, [user])

  useEffect(() => {
    const fetchData = async () => {
      if (!user || currentWeek === null) return
      try {
        const { data: gamesData } = await supabase
          .from('games').select('*')
          .eq('week', currentWeek).eq('season', CURRENT_SEASON)
          .order('kickoff_time')

        if (gamesData) setGames(gamesData)

        if (gamesData) {
          const { data: picksData } = await supabase
            .from('picks').select('*')
            .eq('user_id', user.id).eq('week', currentWeek).eq('season', CURRENT_SEASON)

          const picksMap: UserPick = {}
          picksData?.forEach(p => { picksMap[p.game_id] = p.picked_team })
          setPicks(picksMap)

          const { data: threeBestData } = await supabase
            .from('three_best').select('*')
            .eq('user_id', user.id).eq('week', currentWeek).eq('season', CURRENT_SEASON)
            .single()

          if (threeBestData) {
            const bestTeams = new Set([threeBestData.pick_1, threeBestData.pick_2, threeBestData.pick_3].filter(Boolean))
            const bestGameIds = new Set<string>()
            picksData?.forEach(p => { if (bestTeams.has(p.picked_team)) bestGameIds.add(p.game_id) })
            setBestPicks(bestGameIds)
          }
        }
      } catch (err) {
        console.error('Error fetching data:', err)
      } finally {
        setDataLoading(false)
      }
    }
    fetchData()
  }, [user, currentWeek])

  const lockTime = computeLockTime(games)
  const isLocked = lockTime ? now >= lockTime : false

  const handlePickChange = (gameId: string, team: string) => {
    if (isLocked) return
    setPicks(prev => ({ ...prev, [gameId]: team }))
  }

  const toggleBestPick = (gameId: string) => {
    if (isLocked || !picks[gameId]) return
    setBestPicks(prev => {
      const next = new Set(prev)
      if (next.has(gameId)) { next.delete(gameId) }
      else if (next.size < MAX_BEST_PICKS) { next.add(gameId) }
      return next
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user || isLocked || currentWeek === null) return
    if (bestPicks.size !== MAX_BEST_PICKS) {
      setError(`Please star exactly 3 Best Picks (you have ${bestPicks.size}).`)
      return
    }
    setSubmitting(true); setError(''); setSuccess('')
    try {
      for (const gameId in picks) {
        await supabase.from('picks').upsert({
          user_id: user.id, game_id: gameId, picked_team: picks[gameId],
          week: currentWeek, season: CURRENT_SEASON,
        })
      }
      const bestTeams = Array.from(bestPicks).map(id => picks[id])
      await supabase.from('three_best').upsert({
        user_id: user.id, week: currentWeek, season: CURRENT_SEASON,
        pick_1: bestTeams[0] ?? '', pick_2: bestTeams[1] ?? '', pick_3: bestTeams[2] ?? '',
      })
      setSuccess('Picks saved!')
      setTimeout(() => setSuccess(''), 4000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit picks')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading || dataLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-3">🏈</div>
          <p className="text-gray-500 text-sm">Loading your picks...</p>
        </div>
      </div>
    )
  }

  if (!user) return null

  const pickedCount = Object.keys(picks).length
  const totalGames = games.length

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />

      <main className="max-w-3xl mx-auto px-4 py-6">
        {/* Lock banner */}
        {isLocked && (
          <div className="mb-5 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
            <span className="text-xl">🔒</span>
            <div>
              <p className="font-semibold text-red-800 text-sm">Picks are locked</p>
              <p className="text-red-600 text-xs mt-0.5">
                The deadline of {lockTime ? formatKickoff(lockTime.toISOString()) : ''} has passed. Your saved picks are shown below.
              </p>
            </div>
          </div>
        )}

        {/* Lock countdown */}
        {!isLocked && lockTime && (
          <div className="mb-5 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2 text-amber-800 text-xs">
            <span>⏰</span>
            <span>Picks lock at <strong>{formatKickoff(lockTime.toISOString())}</strong> — Thursday 8:15 PM ET</span>
          </div>
        )}

        {/* Progress */}
        {totalGames > 0 && (
          <div className="mb-5">
            <div className="flex justify-between text-xs text-gray-500 mb-1.5">
              <span>{pickedCount} of {totalGames} games picked</span>
              <span className={bestPicks.size === MAX_BEST_PICKS ? 'text-amber-500 font-medium' : ''}>
                ⭐ {bestPicks.size}/{MAX_BEST_PICKS} best picks
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-1.5">
              <div
                className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                style={{ width: totalGames > 0 ? `${(pickedCount / totalGames) * 100}%` : '0%' }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
        )}
        {success && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm flex items-center gap-2">
            <span>✓</span> {success}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-6">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Week {currentWeek} Games
            </h2>

            {games.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                <p className="text-2xl mb-2">📅</p>
                <p className="text-gray-500 text-sm">No games available yet. Check back soon!</p>
              </div>
            ) : (
              <div className="space-y-2">
                {games.map(game => {
                  const away = getTeam(game.away_team)
                  const home = getTeam(game.home_team)
                  const pickedTeam = picks[game.id]
                  const isStarred = bestPicks.has(game.id)
                  const canStar = !!pickedTeam && !isLocked
                  const starDisabled = !canStar || (!isStarred && bestPicks.size >= MAX_BEST_PICKS)

                  return (
                    <div key={game.id} className={`bg-white rounded-xl border overflow-hidden ${isLocked ? 'border-gray-100 opacity-90' : 'border-gray-200'}`}>
                      <div className="flex items-center justify-between px-4 pt-3 pb-2">
                        <p className="text-xs text-gray-400">{formatKickoff(game.kickoff_time)}</p>
                        {!isLocked && (
                          <button
                            type="button"
                            onClick={() => toggleBestPick(game.id)}
                            disabled={starDisabled}
                            title={!canStar ? 'Pick a team first' : isStarred ? 'Remove best pick' : bestPicks.size >= MAX_BEST_PICKS ? 'Already selected 3' : 'Mark as best pick'}
                            className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full border transition font-medium ${
                              isStarred ? 'bg-amber-50 border-amber-300 text-amber-600'
                              : starDisabled ? 'border-gray-100 text-gray-300 cursor-not-allowed'
                              : 'border-gray-200 text-gray-400 hover:border-amber-300 hover:text-amber-500'
                            }`}
                          >
                            <span>{isStarred ? '⭐' : '☆'}</span>
                            <span>Best Pick</span>
                          </button>
                        )}
                        {isLocked && isStarred && (
                          <span className="text-xs text-amber-600 font-medium">⭐ Best Pick</span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 px-3 pb-3">
                        {[{ abbr: game.away_team, info: away, label: 'Away' }, { abbr: game.home_team, info: home, label: 'Home' }].map(({ abbr, info, label }) => (
                          <button
                            key={abbr}
                            type="button"
                            onClick={() => handlePickChange(game.id, abbr)}
                            disabled={isLocked}
                            className={`flex items-center gap-3 py-3 px-4 rounded-lg border-2 transition text-left ${
                              pickedTeam === abbr
                                ? 'border-blue-600 bg-blue-600 text-white'
                                : isLocked
                                ? 'border-gray-100 bg-gray-50 text-gray-400 cursor-default'
                                : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50'
                            }`}
                          >
                            <img
                              src={info.logo} alt={abbr}
                              className={`w-8 h-8 object-contain flex-shrink-0 ${isLocked && pickedTeam !== abbr ? 'opacity-30' : ''}`}
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                            />
                            <div className="min-w-0">
                              <p className="text-xs opacity-70 leading-tight truncate">{info.city}</p>
                              <p className="font-semibold text-sm leading-tight truncate">{info.name}</p>
                              <p className={`text-xs mt-0.5 ${pickedTeam === abbr ? 'opacity-70' : 'text-gray-400'}`}>{label}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Best picks summary */}
          {bestPicks.size > 0 && (
            <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-2">⭐ Your Best Picks</p>
              <div className="flex flex-wrap gap-2">
                {Array.from(bestPicks).map(gameId => {
                  const team = picks[gameId]
                  const t = getTeam(team)
                  return (
                    <div key={gameId} className="flex items-center gap-1.5 bg-white border border-amber-200 rounded-lg px-2.5 py-1.5">
                      <img src={t.logo} alt={team} className="w-5 h-5 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                      <span className="text-sm font-semibold text-gray-800">{t.city} {t.name}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {!isLocked && (
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {submitting ? 'Saving...' : 'Save Picks'}
            </button>
          )}
        </form>
      </main>
    </div>
  )
}
