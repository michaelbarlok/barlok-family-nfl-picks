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

interface ThreeBest {
  pick_1: string
  pick_2: string
  pick_3: string
  [key: string]: string
}

const CURRENT_WEEK = 1
const CURRENT_SEASON = 2025

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
  const [threeBest, setThreeBest] = useState<ThreeBest>({
    pick_1: '',
    pick_2: '',
    pick_3: '',
  })
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
        }

        const { data: threeBestData } = await supabase
          .from('three_best')
          .select('*')
          .eq('user_id', user.id)
          .eq('week', CURRENT_WEEK)
          .eq('season', CURRENT_SEASON)
          .single()

        if (threeBestData) {
          setThreeBest({
            pick_1: threeBestData.pick_1,
            pick_2: threeBestData.pick_2,
            pick_3: threeBestData.pick_3,
          })
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
  }

  const handleThreeBestChange = (index: number, team: string) => {
    setThreeBest(prev => ({ ...prev, [`pick_${index}`]: team.toUpperCase() }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return

    setSubmitting(true)
    setError('')
    setSuccess('')

    try {
      for (const gameId in picks) {
        await supabase.from('picks').upsert({
          user_id: user.id,
          game_id: gameId,
          picked_team: picks[gameId],
          week: CURRENT_WEEK,
          season: CURRENT_SEASON,
        })
      }

      await supabase.from('three_best').upsert({
        user_id: user.id,
        week: CURRENT_WEEK,
        season: CURRENT_SEASON,
        pick_1: threeBest.pick_1,
        pick_2: threeBest.pick_2,
        pick_3: threeBest.pick_3,
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
      {/* Top nav */}
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
            <button
              onClick={handleSignOut}
              className="text-sm text-gray-400 hover:text-gray-700 transition"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* Progress bar */}
        {totalGames > 0 && (
          <div className="mb-6">
            <div className="flex justify-between text-xs text-gray-500 mb-1.5">
              <span>{pickedCount} of {totalGames} games picked</span>
              <span>{totalGames - pickedCount} remaining</span>
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
          {/* Games */}
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
                {games.map(game => (
                  <div
                    key={game.id}
                    className="bg-white rounded-xl border border-gray-200 p-4"
                  >
                    <p className="text-xs text-gray-400 mb-3">{formatKickoff(game.kickoff_time)}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {/* Away team */}
                      <button
                        type="button"
                        onClick={() => handlePickChange(game.id, game.away_team)}
                        className={`py-3 px-4 rounded-lg border-2 text-sm font-semibold transition text-center ${
                          picks[game.id] === game.away_team
                            ? 'border-blue-600 bg-blue-600 text-white'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50'
                        }`}
                      >
                        {game.away_team}
                        <span className="block text-xs font-normal opacity-70 mt-0.5">Away</span>
                      </button>
                      {/* Home team */}
                      <button
                        type="button"
                        onClick={() => handlePickChange(game.id, game.home_team)}
                        className={`py-3 px-4 rounded-lg border-2 text-sm font-semibold transition text-center ${
                          picks[game.id] === game.home_team
                            ? 'border-blue-600 bg-blue-600 text-white'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50'
                        }`}
                      >
                        {game.home_team}
                        <span className="block text-xs font-normal opacity-70 mt-0.5">Home</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 3 Best Picks */}
          <div className="mb-6">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
              3 Best Picks
            </h2>
            <p className="text-xs text-gray-400 mb-3">Your most confident picks — used as a tiebreaker</p>
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                    {i}
                  </span>
                  <input
                    type="text"
                    value={threeBest[`pick_${i}`]}
                    onChange={(e) => handleThreeBestChange(i, e.target.value)}
                    placeholder="Team abbreviation (e.g. KC)"
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm uppercase placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                    maxLength={3}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Submit */}
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
