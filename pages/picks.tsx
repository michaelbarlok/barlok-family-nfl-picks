import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

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

const CURRENT_WEEK = 1
const CURRENT_SEASON = 2025
const MAX_BEST_PICKS = 3

// Full team info — name, city, ESPN logo CDN
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
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

export default function PicksPage() {
  const router = useRouter()
  const { user, loading, signOut } = useAuth()
  const [games, setGames] = useState<Game[]>([])
  const [picks, setPicks] = useState<UserPick>({})
  // bestPicks: Set of gameIds the user has starred as their 3 best
  const [bestPicks, setBestPicks] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [dataLoading, setDataLoading] = useState(true)

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login')
    }
  }, [user, loading, router])

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return

      try {
        const { data: gamesData } = await supabase
          .from('games')
          .select('*')
          .eq('week', CURRENT_WEEK)
          .eq('season', CURRENT_SEASON)
          .order('kickoff_time')

        if (gamesData) {
          setGames(gamesData)
        }

        if (gamesData) {
          const { data: picksData } = await supabase
            .from('picks')
            .select('*')
            .eq('user_id', user.id)
            .eq('week', CURRENT_WEEK)
            .eq('season', CURRENT_SEASON)

          const picksMap: UserPick = {}
          picksData?.forEach(pick => {
            picksMap[pick.game_id] = pick.picked_team
          })
          setPicks(picksMap)

          // Load 3 best picks and reconstruct which gameIds they correspond to
          const { data: threeBestData } = await supabase
            .from('three_best')
            .select('*')
            .eq('user_id', user.id)
            .eq('week', CURRENT_WEEK)
            .eq('season', CURRENT_SEASON)
            .single()

          if (threeBestData) {
            const bestTeams = new Set([
              threeBestData.pick_1,
              threeBestData.pick_2,
              threeBestData.pick_3,
            ].filter(Boolean))

            // Find gameIds where the user's pick matches a best-pick team
            const bestGameIds = new Set<string>()
            picksData?.forEach(pick => {
              if (bestTeams.has(pick.picked_team)) {
                bestGameIds.add(pick.game_id)
              }
            })
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
  }, [user])

  const handlePickChange = (gameId: string, team: string) => {
    setPicks(prev => ({ ...prev, [gameId]: team }))
    // If this game was starred as a best pick, keep it starred (pick changed)
    // but if there's no longer a pick for this game, remove the star
  }

  const toggleBestPick = (gameId: string) => {
    // Can only star a game if a pick has been made
    if (!picks[gameId]) return

    setBestPicks(prev => {
      const next = new Set(prev)
      if (next.has(gameId)) {
        next.delete(gameId)
      } else if (next.size < MAX_BEST_PICKS) {
        next.add(gameId)
      }
      return next
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return

    if (bestPicks.size !== MAX_BEST_PICKS) {
      setError(`Please select exactly 3 Best Picks (you have ${bestPicks.size}).`)
      return
    }

    setSubmitting(true)
    setError('')
    setSuccess('')

    try {
      // Submit all game picks
      for (const gameId in picks) {
        await supabase.from('picks').upsert({
          user_id: user.id,
          game_id: gameId,
          picked_team: picks[gameId],
          week: CURRENT_WEEK,
          season: CURRENT_SEASON,
        })
      }

      // Convert starred gameIds → team abbreviations for three_best table
      const bestTeams = Array.from(bestPicks).map(gameId => picks[gameId])
      await supabase.from('three_best').upsert({
        user_id: user.id,
        week: CURRENT_WEEK,
        season: CURRENT_SEASON,
        pick_1: bestTeams[0] ?? '',
        pick_2: bestTeams[1] ?? '',
        pick_3: bestTeams[2] ?? '',
      })

      setSuccess('Picks saved!')
      setTimeout(() => setSuccess(''), 4000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit picks')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSignOut = async () => {
    await signOut()
    router.push('/login')
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
      {/* Sticky header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🏈</span>
            <div>
              <p className="font-semibold text-gray-900 text-sm leading-tight">Barlok Family NFL Picks</p>
              <p className="text-xs text-gray-400">Week {CURRENT_WEEK} · 2025 Season</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">Hi, {user.name}</span>
            <button onClick={handleSignOut} className="text-sm text-gray-400 hover:text-gray-700 transition">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* Progress */}
        {totalGames > 0 && (
          <div className="mb-5">
            <div className="flex justify-between text-xs text-gray-500 mb-1.5">
              <span>{pickedCount} of {totalGames} games picked</span>
              <span className={bestPicks.size === MAX_BEST_PICKS ? 'text-amber-500 font-medium' : ''}>
                ⭐ {bestPicks.size}/{MAX_BEST_PICKS} best picks selected
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
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm flex items-center gap-2">
            <span>✓</span> {success}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-6">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Week {CURRENT_WEEK} Games
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
                  const canStar = !!pickedTeam
                  const starDisabled = !canStar || (!isStarred && bestPicks.size >= MAX_BEST_PICKS)

                  return (
                    <div key={game.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                      {/* Game header row */}
                      <div className="flex items-center justify-between px-4 pt-3 pb-2">
                        <p className="text-xs text-gray-400">{formatKickoff(game.kickoff_time)}</p>
                        {/* Best Pick star button */}
                        <button
                          type="button"
                          onClick={() => toggleBestPick(game.id)}
                          disabled={starDisabled}
                          title={
                            !canStar
                              ? 'Pick a team first'
                              : isStarred
                              ? 'Remove best pick'
                              : bestPicks.size >= MAX_BEST_PICKS
                              ? 'Already selected 3 best picks'
                              : 'Mark as best pick'
                          }
                          className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full border transition font-medium
                            ${isStarred
                              ? 'bg-amber-50 border-amber-300 text-amber-600'
                              : starDisabled
                              ? 'border-gray-100 text-gray-300 cursor-not-allowed'
                              : 'border-gray-200 text-gray-400 hover:border-amber-300 hover:text-amber-500'
                            }`}
                        >
                          <span>{isStarred ? '⭐' : '☆'}</span>
                          <span>Best Pick</span>
                        </button>
                      </div>

                      {/* Team buttons */}
                      <div className="grid grid-cols-2 gap-2 px-3 pb-3">
                        {/* Away */}
                        <button
                          type="button"
                          onClick={() => handlePickChange(game.id, game.away_team)}
                          className={`flex items-center gap-3 py-3 px-4 rounded-lg border-2 transition text-left
                            ${pickedTeam === game.away_team
                              ? 'border-blue-600 bg-blue-600 text-white'
                              : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50'
                            }`}
                        >
                          <img
                            src={away.logo}
                            alt={game.away_team}
                            className="w-8 h-8 object-contain flex-shrink-0"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                          <div className="min-w-0">
                            <p className="text-xs opacity-70 leading-tight truncate">{away.city}</p>
                            <p className="font-semibold text-sm leading-tight truncate">{away.name}</p>
                            <p className={`text-xs mt-0.5 ${pickedTeam === game.away_team ? 'opacity-70' : 'text-gray-400'}`}>Away</p>
                          </div>
                        </button>

                        {/* Home */}
                        <button
                          type="button"
                          onClick={() => handlePickChange(game.id, game.home_team)}
                          className={`flex items-center gap-3 py-3 px-4 rounded-lg border-2 transition text-left
                            ${pickedTeam === game.home_team
                              ? 'border-blue-600 bg-blue-600 text-white'
                              : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50'
                            }`}
                        >
                          <img
                            src={home.logo}
                            alt={game.home_team}
                            className="w-8 h-8 object-contain flex-shrink-0"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                          <div className="min-w-0">
                            <p className="text-xs opacity-70 leading-tight truncate">{home.city}</p>
                            <p className="font-semibold text-sm leading-tight truncate">{home.name}</p>
                            <p className={`text-xs mt-0.5 ${pickedTeam === game.home_team ? 'opacity-70' : 'text-gray-400'}`}>Home</p>
                          </div>
                        </button>
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

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {submitting ? 'Saving...' : 'Save Picks'}
          </button>
        </form>
      </main>
    </div>
  )
}
