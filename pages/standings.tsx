import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { CURRENT_SEASON } from '@/lib/constants'
import Nav from '@/components/Nav'

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

// Skeleton loading
function StandingsSkeleton() {
  return (
    <div className="min-h-screen bg-surface">
      <div className="sticky top-0 z-10 border-b border-white/[0.06] bg-surface/80 backdrop-blur-xl">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <div className="skeleton h-5 w-48 rounded-lg mb-3" />
          <div className="flex gap-2">
            <div className="skeleton h-8 w-24 rounded-full" />
            <div className="skeleton h-8 w-24 rounded-full" />
            <div className="skeleton h-8 w-20 rounded-full" />
          </div>
        </div>
      </div>
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
        setLoadError('Failed to load standings. Please refresh the page.')
      } finally {
        setDataLoading(false)
      }
    }
    fetchStandings()
  }, [user])

  if (loading || dataLoading) return <StandingsSkeleton />
  if (!user) return null

  const hasScores = standings.some(s => s.totalPicks > 0)

  const medalColors = [
    { bg: 'from-amber-500/20 to-amber-600/10', border: 'border-amber-500/30', text: 'text-amber-400' },
    { bg: 'from-slate-300/15 to-slate-400/5', border: 'border-slate-400/20', text: 'text-slate-300' },
    { bg: 'from-orange-600/15 to-orange-700/5', border: 'border-orange-600/20', text: 'text-orange-400' },
  ]

  return (
    <div className="min-h-screen bg-surface">
      <Nav />

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
              const podium = idx < 3 ? medalColors[idx] : null

              return (
                <div
                  key={s.user.id}
                  className={`grid grid-cols-12 px-4 py-4 items-center border-b border-white/[0.04] last:border-0 transition-colors animate-slide-up ${
                    isMe
                      ? 'bg-blue-500/10 border-l-2 border-l-blue-500'
                      : podium
                      ? `bg-gradient-to-r ${podium.bg}`
                      : 'hover:bg-white/[0.02]'
                  }`}
                  style={{ animationDelay: `${idx * 50}ms` }}
                >
                  {/* Rank */}
                  <div className="col-span-1 text-center">
                    {medal ? (
                      <span className="text-lg">{medal}</span>
                    ) : (
                      <span className="text-sm text-slate-500 font-medium">{idx + 1}</span>
                    )}
                  </div>

                  {/* Name */}
                  <div className="col-span-5">
                    <p className={`text-sm font-semibold ${isMe ? 'text-blue-400' : 'text-white'}`}>
                      {s.user.name} {isMe && <span className="text-blue-400/60 font-normal text-xs">(you)</span>}
                    </p>
                    {winPct !== null && (
                      <div className="flex items-center gap-2 mt-1">
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

                  {/* Overall W-L */}
                  <div className="col-span-3 text-center">
                    {s.totalPicks > 0 ? (
                      <p className="text-sm font-bold text-white">
                        <span className="text-emerald-400">{s.wins}</span>
                        <span className="text-slate-500 mx-0.5">&ndash;</span>
                        <span className="text-red-400">{s.losses}</span>
                      </p>
                    ) : (
                      <p className="text-sm text-slate-600">&mdash;</p>
                    )}
                  </div>

                  {/* Best 3 W-L */}
                  <div className="col-span-3 text-center">
                    {s.bestWins + s.bestLosses > 0 ? (
                      <p className="text-sm font-bold">
                        <span className="text-amber-400">{s.bestWins}</span>
                        <span className="text-slate-500 mx-0.5">&ndash;</span>
                        <span className="text-amber-600">{s.bestLosses}</span>
                      </p>
                    ) : (
                      <p className="text-sm text-slate-600">&mdash;</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <p className="text-xs text-slate-600 text-center mt-5">
          Results are updated by Michael after each week&apos;s games complete.
        </p>
      </main>
    </div>
  )
}
