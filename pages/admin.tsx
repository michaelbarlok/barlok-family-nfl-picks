import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import Nav from '@/components/Nav'

const ADMIN_EMAIL = 'barlokmichael@gmail.com'
const CURRENT_SEASON = 2025

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

interface Game {
  id: string
  away_team: string
  home_team: string
  kickoff_time: string
  week: number
  season: number
  winning_team: string | null
}

export default function AdminPage() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const [availableWeeks, setAvailableWeeks] = useState<number[]>([])
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null)
  const [games, setGames] = useState<Game[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [settingResult, setSettingResult] = useState<string | null>(null)
  const [syncMessage, setSyncMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Auth guard — must be logged in as admin
  useEffect(() => {
    if (!loading) {
      if (!user) { router.push('/login'); return }
      if (user.email !== ADMIN_EMAIL) { router.push('/picks'); return }
    }
  }, [user, loading, router])

  // Load available weeks
  useEffect(() => {
    const fetchWeeks = async () => {
      const { data } = await supabase
        .from('games').select('week').eq('season', CURRENT_SEASON).order('week')
      if (data) {
        const weeks = [...new Set(data.map(g => g.week))].sort((a, b) => a - b)
        setAvailableWeeks(weeks)
        if (weeks.length > 0) setSelectedWeek(weeks[weeks.length - 1]) // default to latest
      }
      setDataLoading(false)
    }
    if (user?.email === ADMIN_EMAIL) fetchWeeks()
  }, [user])

  // Load games for selected week
  const loadGames = useCallback(async () => {
    if (!selectedWeek) return
    const { data } = await supabase
      .from('games').select('*')
      .eq('week', selectedWeek).eq('season', CURRENT_SEASON)
      .order('kickoff_time')
    if (data) setGames(data)
  }, [selectedWeek])

  useEffect(() => { loadGames() }, [loadGames])

  const getToken = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? ''
  }

  // Sync results from ESPN for selected week
  const handleSync = async () => {
    if (!selectedWeek) return
    setSyncing(true)
    setSyncMessage(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/update-scores?week=${selectedWeek}&season=${CURRENT_SEASON}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Sync failed')
      setSyncMessage({ type: 'success', text: json.message ?? 'Sync complete.' })
      await loadGames()
    } catch (err) {
      setSyncMessage({ type: 'error', text: err instanceof Error ? err.message : 'Sync failed' })
    } finally {
      setSyncing(false)
    }
  }

  // Manually set a game winner
  const handleSetResult = async (game: Game, winningTeam: string) => {
    setSettingResult(game.id)
    setSyncMessage(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/set-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ gameId: game.id, winningTeam, week: game.week, season: game.season }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to set result')
      setSyncMessage({ type: 'success', text: `Set ${winningTeam} as winner — ${json.updated} scores updated.` })
      await loadGames()
    } catch (err) {
      setSyncMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed' })
    } finally {
      setSettingResult(null)
    }
  }

  if (loading || dataLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center"><div className="text-4xl mb-3">🔧</div>
          <p className="text-gray-500 text-sm">Loading admin panel...</p>
        </div>
      </div>
    )
  }

  if (!user || user.email !== ADMIN_EMAIL) return null

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />

      <main className="max-w-3xl mx-auto px-4 py-6">
        {/* Admin badge */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Admin Dashboard</h1>
            <p className="text-xs text-gray-400 mt-0.5">Results management — visible only to you</p>
          </div>
          <span className="text-xs font-semibold bg-red-100 text-red-700 px-2.5 py-1 rounded-full border border-red-200">
            🔐 Admin Only
          </span>
        </div>

        {/* Sync message */}
        {syncMessage && (
          <div className={`mb-4 p-3 rounded-lg text-sm border ${
            syncMessage.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-700'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}>
            {syncMessage.type === 'success' ? '✓ ' : '✗ '}{syncMessage.text}
          </div>
        )}

        {/* Week selector */}
        {availableWeeks.length > 0 && (
          <div className="mb-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Select Week</p>
            <div className="flex flex-wrap gap-2">
              {availableWeeks.map(w => (
                <button
                  key={w}
                  onClick={() => setSelectedWeek(w)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${
                    selectedWeek === w
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300'
                  }`}
                >
                  Week {w}
                </button>
              ))}
            </div>
          </div>
        )}

        {selectedWeek && (
          <>
            {/* Sync button */}
            <div className="flex items-center gap-3 mb-5 p-4 bg-white rounded-xl border border-gray-200">
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-800">Sync Week {selectedWeek} from ESPN</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Pulls completed game results automatically and updates all scores.
                </p>
              </div>
              <button
                onClick={handleSync}
                disabled={syncing}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition whitespace-nowrap"
              >
                {syncing ? (
                  <><span className="animate-spin inline-block">⏳</span> Syncing...</>
                ) : (
                  <><span>🔄</span> Sync from ESPN</>
                )}
              </button>
            </div>

            {/* Games list */}
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Week {selectedWeek} Games — Manual Override
            </p>

            {games.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                <p className="text-gray-400 text-sm">No games found for Week {selectedWeek}.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {games.map(game => {
                  const away = getTeam(game.away_team)
                  const home = getTeam(game.home_team)
                  const winner = game.winning_team
                  const isSettingThis = settingResult === game.id
                  const kickedOff = new Date(game.kickoff_time) < new Date()

                  return (
                    <div key={game.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                      <div className="flex items-center justify-between px-4 pt-3 pb-2">
                        <p className="text-xs text-gray-400">{formatKickoff(game.kickoff_time)}</p>
                        <div className="flex items-center gap-2">
                          {winner ? (
                            <span className="text-xs font-semibold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                              ✓ {winner} won
                            </span>
                          ) : kickedOff ? (
                            <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                              Pending result
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-full">
                              Not started
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 px-3 pb-3">
                        {[
                          { abbr: game.away_team, info: away, label: 'Away' },
                          { abbr: game.home_team, info: home, label: 'Home' },
                        ].map(({ abbr, info, label }) => {
                          const isWinner = winner === abbr
                          return (
                            <button
                              key={abbr}
                              type="button"
                              onClick={() => handleSetResult(game, abbr)}
                              disabled={isSettingThis}
                              className={`flex items-center gap-3 py-3 px-4 rounded-lg border-2 transition text-left ${
                                isWinner
                                  ? 'border-green-500 bg-green-500 text-white'
                                  : winner && !isWinner
                                  ? 'border-gray-100 bg-gray-50 text-gray-300'
                                  : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50'
                              } disabled:cursor-wait`}
                            >
                              <img
                                src={info.logo} alt={abbr}
                                className={`w-8 h-8 object-contain flex-shrink-0 ${winner && !isWinner ? 'opacity-30' : ''}`}
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                              />
                              <div className="min-w-0">
                                <p className="text-xs opacity-70 leading-tight truncate">{info.city}</p>
                                <p className="font-semibold text-sm leading-tight truncate">{info.name}</p>
                                <p className={`text-xs mt-0.5 ${isWinner ? 'opacity-70' : 'text-gray-400'}`}>{label}</p>
                              </div>
                              {isWinner && <span className="ml-auto text-sm">✓</span>}
                            </button>
                          )
                        })}
                      </div>

                      {isSettingThis && (
                        <div className="px-4 pb-3 text-xs text-gray-400">Updating scores...</div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {availableWeeks.length === 0 && !dataLoading && (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <p className="text-gray-400 text-sm">No games found. Add games to the database first.</p>
          </div>
        )}
      </main>
    </div>
  )
}
