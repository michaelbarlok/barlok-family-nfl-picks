import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import Nav from '@/components/Nav'

const CURRENT_SEASON = 2025

interface User {
  id: string
  name: string
  email: string
}

interface UserStanding {
  user: User
  wins: number
  losses: number
  bestWins: number
  bestLosses: number
  totalPicks: number
}

export default function StandingsPage() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const [standings, setStandings] = useState<UserStanding[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && !user) router.push('/login')
  }, [user, loading, router])

  useEffect(() => {
    const fetchStandings = async () => {
      if (!user) return
      try {
        // Fetch all users, scores, picks, three_best, and games
        const [
          { data: users },
          { data: scores },
          { data: picks },
          { data: threeBests },
          { data: games },
        ] = await Promise.all([
          supabase.from('users').select('*').order('name'),
          supabase.from('scores').select('*').eq('season', CURRENT_SEASON),
          supabase.from('picks').select('*').eq('season', CURRENT_SEASON),
          supabase.from('three_best').select('*').eq('season', CURRENT_SEASON),
          supabase.from('games').select('id, away_team, home_team, week, season').eq('season', CURRENT_SEASON),
        ])

        if (!users) return

        // Build a map of game_id → { away_team, home_team } for resolving 3-best picks
        const gameMap = new Map((games || []).map(g => [g.id, g]))

        // Build a picks map: userId-gameId → picked_team
        const picksMap = new Map((picks || []).map(p => [`${p.user_id}-${p.game_id}`, p.picked_team]))

        // Build scores map: userId-gameId → is_correct
        const scoresMap = new Map((scores || []).map(s => [`${s.user_id}-${s.game_id}`, s.is_correct]))

        // Track last updated from scores
        const scored = (scores || []).filter(s => s.is_correct !== null)
        if (scored.length > 0) {
          setLastUpdated(new Date(Math.max(...scored.map((s: { created_at: string }) => new Date(s.created_at).getTime()))).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
          }))
        }

        const result: UserStanding[] = users.map(u => {
          let wins = 0, losses = 0, bestWins = 0, bestLosses = 0

          // Count overall W/L from scores
          ;(scores || []).forEach(s => {
            if (s.user_id !== u.id) return
            if (s.is_correct === true) wins++
            else if (s.is_correct === false) losses++
          })

          // Count 3-best W/L: for each week, find the 3 best picks and check their scores
          ;(threeBests || []).filter(tb => tb.user_id === u.id).forEach(tb => {
            const bestTeams = [tb.pick_1, tb.pick_2, tb.pick_3].filter(Boolean)
            // Find the game for each best pick in this week/season
            bestTeams.forEach(team => {
              // Find the game where this user picked this team this week
              const game = (games || []).find(g =>
                g.week === tb.week &&
                (g.away_team === team || g.home_team === team) &&
                picksMap.get(`${u.id}-${g.id}`) === team
              )
              if (!game) return
              const isCorrect = scoresMap.get(`${u.id}-${game.id}`)
              if (isCorrect === true) bestWins++
              else if (isCorrect === false) bestLosses++
            })
          })

          const totalPicks = wins + losses

          return { user: u, wins, losses, bestWins, bestLosses, totalPicks }
        })

        // Sort: most wins first, then fewest losses, then best 3 wins
        result.sort((a, b) => {
          if (b.wins !== a.wins) return b.wins - a.wins
          if (a.losses !== b.losses) return a.losses - b.losses
          return b.bestWins - a.bestWins
        })

        setStandings(result)
      } catch (err) {
        console.error('Error fetching standings:', err)
      } finally {
        setDataLoading(false)
      }
    }
    fetchStandings()
  }, [user])

  if (loading || dataLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-3">🏆</div>
          <p className="text-gray-500 text-sm">Loading standings...</p>
        </div>
      </div>
    )
  }

  if (!user) return null

  const hasScores = standings.some(s => s.totalPicks > 0)

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />

      <main className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            2025 Season Standings
          </h2>
          {lastUpdated && (
            <p className="text-xs text-gray-400">Updated {lastUpdated}</p>
          )}
        </div>

        {!hasScores ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <p className="text-3xl mb-3">🏈</p>
            <p className="text-gray-700 font-medium">Season hasn't started yet</p>
            <p className="text-gray-400 text-sm mt-1">Standings will appear here once Week 1 results are recorded.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-12 px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <div className="col-span-1 text-center">#</div>
              <div className="col-span-5">Player</div>
              <div className="col-span-3 text-center">Overall</div>
              <div className="col-span-3 text-center">Best 3</div>
            </div>

            {standings.map((s, idx) => {
              const isMe = s.user.id === user.id
              const winPct = s.totalPicks > 0 ? Math.round((s.wins / s.totalPicks) * 100) : null
              const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null

              return (
                <div
                  key={s.user.id}
                  className={`grid grid-cols-12 px-4 py-3.5 items-center border-b border-gray-100 last:border-0 ${isMe ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                >
                  {/* Rank */}
                  <div className="col-span-1 text-center">
                    {medal ? (
                      <span className="text-base">{medal}</span>
                    ) : (
                      <span className="text-sm text-gray-400 font-medium">{idx + 1}</span>
                    )}
                  </div>

                  {/* Name */}
                  <div className="col-span-5">
                    <p className={`text-sm font-semibold ${isMe ? 'text-blue-700' : 'text-gray-800'}`}>
                      {s.user.name} {isMe && <span className="text-blue-400 font-normal text-xs">(you)</span>}
                    </p>
                    {winPct !== null && (
                      <p className="text-xs text-gray-400 mt-0.5">{winPct}% correct</p>
                    )}
                  </div>

                  {/* Overall W-L */}
                  <div className="col-span-3 text-center">
                    <p className="text-sm font-bold text-gray-800">
                      {s.wins}–{s.losses}
                    </p>
                    {s.totalPicks === 0 && (
                      <p className="text-xs text-gray-300">—</p>
                    )}
                  </div>

                  {/* Best 3 W-L */}
                  <div className="col-span-3 text-center">
                    <p className={`text-sm font-bold ${s.bestWins + s.bestLosses > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
                      {s.bestWins + s.bestLosses > 0 ? `${s.bestWins}–${s.bestLosses}` : '—'}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <p className="text-xs text-gray-400 text-center mt-4">
          Results are updated by Michael after each week's games complete.
        </p>
      </main>
    </div>
  )
}
