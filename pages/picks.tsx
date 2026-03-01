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

export default function PicksPage() {
  const router = useRouter()
  const { user, loading } = useAuth()
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
        // Fetch games for current week
        const { data: gamesData } = await supabase
          .from('games')
          .select('*')
          .eq('week', CURRENT_WEEK)
          .eq('season', CURRENT_SEASON)
          .order('kickoff_time')

        if (gamesData) {
          setGames(gamesData)
        }

        // Fetch user's existing picks
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

        // Fetch three best picks
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
    setPicks(prev => ({
      ...prev,
      [gameId]: team,
    }))
  }

  const handleThreeBestChange = (index: number, team: string) => {
    setThreeBest(prev => ({
      ...prev,
      [`pick_${index}`]: team,
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return

    setSubmitting(true)
    setError('')
    setSuccess('')

    try {
      // Submit picks
      for (const gameId in picks) {
        await supabase.from('picks').upsert({
          user_id: user.id,
          game_id: gameId,
          picked_team: picks[gameId],
          week: CURRENT_WEEK,
          season: CURRENT_SEASON,
        })
      }

      // Submit three best
      await supabase.from('three_best').upsert({
        user_id: user.id,
        week: CURRENT_WEEK,
        season: CURRENT_SEASON,
        pick_1: threeBest.pick_1,
        pick_2: threeBest.pick_2,
        pick_3: threeBest.pick_3,
      })

      setSuccess('Picks submitted successfully!')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit picks')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading || dataLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>Loading...</p>
      </div>
    )
  }

  if (!user) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-2 text-gray-800">
          Barlok Family NFL Picks
        </h1>
        <p className="text-gray-600 mb-8">Welcome, {user.name}!</p>

        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 p-3 bg-green-100 border border-green-400 text-green-700 rounded">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
            <h2 className="text-2xl font-bold mb-6 text-gray-800">
              Week {CURRENT_WEEK} Picks
            </h2>

            {games.length === 0 ? (
              <p className="text-gray-600">No games available for this week yet.</p>
            ) : (
              <div className="space-y-4">
                {games.map(game => (
                  <div key={game.id} className="border-b pb-4">
                    <p className="font-bold mb-2">
                      {game.away_team} @ {game.home_team}
                    </p>
                    <div className="flex gap-4">
                      <label className="flex items-center">
                        <input
                          type="radio"
                          name={`game-${game.id}`}
                          value={game.away_team}
                          checked={picks[game.id] === game.away_team}
                          onChange={(e) => handlePickChange(game.id, e.target.value)}
                          className="mr-2"
                        />
                        {game.away_team}
                      </label>
                      <label className="flex items-center">
                        <input
                          type="radio"
                          name={`game-${game.id}`}
                          value={game.home_team}
                          checked={picks[game.id] === game.home_team}
                          onChange={(e) => handlePickChange(game.id, e.target.value)}
                          className="mr-2"
                        />
                        {game.home_team}
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
            <h2 className="text-2xl font-bold mb-6 text-gray-800">3 Best Picks</h2>
            <p className="text-gray-600 mb-4">
              Select your 3 most confident picks (these are the tiebreaker):
            </p>

            {[1, 2, 3].map(i => (
              <div key={i} className="mb-4">
                <label className="block text-gray-700 font-bold mb-2">
                  Pick {i}
                </label>
                <input
                  type="text"
                  value={threeBest[`pick_${i}`]}
                  onChange={(e) => handleThreeBestChange(i, e.target.value)}
                  placeholder={`e.g., KC, DAL, etc.`}
                  className="w-full px-4 py-2 border border-gray-300 rounded uppercase"
                  maxLength={3}
                />
              </div>
            ))}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit Picks'}
          </button>
        </form>
      </div>
    </div>
  )
}
