import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { CURRENT_SEASON } from '@/lib/constants'
import Nav from '@/components/Nav'

interface ManagedPlayer {
  id: string
  name: string
}

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

function parseUTC(iso: string): Date {
  // Supabase returns timestamps like "2025-09-12 00:15:00" or "2025-09-12T00:15:00+00:00".
  // Normalize space to T, then check for offset indicators after the T.
  const normalized = iso.replace(' ', 'T')
  const timepart = normalized.split('T')[1] || ''
  const hasOffset = timepart.includes('Z') || timepart.includes('+') || timepart.includes('-')
  return new Date(hasOffset ? normalized : normalized + 'Z')
}

function formatKickoff(iso: string) {
  const d = parseUTC(iso)
  return d.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    timeZone: 'America/New_York',
  })
}

// Lock time = earliest kickoff of the week
function computeLockTime(games: Game[]): Date | null {
  if (games.length === 0) return null
  const kickoffs = games.map(g => parseUTC(g.kickoff_time))
  return new Date(Math.min(...kickoffs.map(d => d.getTime())))
}

// Skeleton loading component
function PicksSkeleton() {
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
        <div className="skeleton h-10 w-full rounded-xl mb-5" />
        <div className="skeleton h-3 w-32 rounded mb-4" />
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="glass-card rounded-2xl p-4">
              <div className="skeleton h-3 w-40 rounded mb-3" />
              <div className="grid grid-cols-2 gap-3">
                <div className="skeleton h-[72px] rounded-xl" />
                <div className="skeleton h-[72px] rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}

export default function PicksPage() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const [currentWeek, setCurrentWeek] = useState<number | null>(null)
  const [games, setGames] = useState<Game[]>([])
  const [picks, setPicks] = useState<UserPick>({})
  const [bestPicks, setBestPicks] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [dataLoading, setDataLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [now, setNow] = useState(new Date())
  const [managedPlayers, setManagedPlayers] = useState<ManagedPlayer[]>([])
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null) // null = self

  // Keep clock ticking so lock state stays live
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 10_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!loading && !user) router.push('/login')
  }, [user, loading, router])

  // Fetch managed players
  useEffect(() => {
    const fetchManaged = async () => {
      if (!user) return
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token ?? ''
        const res = await fetch('/api/managed-players', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const json = await res.json()
        if (res.ok && json.players?.length > 0) {
          setManagedPlayers(json.players)
        }
      } catch (err) {
        console.error('Failed to fetch managed players:', err)
      }
    }
    fetchManaged()
  }, [user])

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

  // The effective user ID for picks: self or managed player
  const effectiveUserId = activePlayerId ?? user?.id

  const loadPicksForUser = useCallback(async (userId: string, week: number) => {
    try {
      const { data: picksData } = await supabase
        .from('picks').select('*')
        .eq('user_id', userId).eq('week', week).eq('season', CURRENT_SEASON)

      const picksMap: UserPick = {}
      picksData?.forEach(p => { picksMap[p.game_id] = p.picked_team })
      setPicks(picksMap)

      const { data: threeBestData } = await supabase
        .from('three_best').select('*')
        .eq('user_id', userId).eq('week', week).eq('season', CURRENT_SEASON)
        .single()

      if (threeBestData) {
        const bestTeams = new Set([threeBestData.pick_1, threeBestData.pick_2, threeBestData.pick_3].filter(Boolean))
        const bestGameIds = new Set<string>()
        picksData?.forEach(p => { if (bestTeams.has(p.picked_team)) bestGameIds.add(p.game_id) })
        setBestPicks(bestGameIds)
      } else {
        setBestPicks(new Set())
      }
    } catch (err) {
      console.error('Error fetching picks:', err)
    }
  }, [])

  useEffect(() => {
    const fetchData = async () => {
      if (!user || currentWeek === null) return
      try {
        const { data: gamesData } = await supabase
          .from('games').select('*')
          .eq('week', currentWeek).eq('season', CURRENT_SEASON)
          .order('kickoff_time')

        if (gamesData) setGames(gamesData)

        if (gamesData && effectiveUserId) {
          await loadPicksForUser(effectiveUserId, currentWeek)
        }
      } catch (err) {
        console.error('Error fetching data:', err)
        setLoadError('Failed to load picks. Please refresh the page.')
      } finally {
        setDataLoading(false)
      }
    }
    fetchData()
  }, [user, currentWeek, effectiveUserId, loadPicksForUser])

  const lockTime = computeLockTime(games)
  const isLocked = lockTime ? now >= lockTime : false

  const getToken = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? ''
  }

  // Save a single game pick to the DB immediately
  const savePick = async (gameId: string, team: string) => {
    if (!user || currentWeek === null) return
    try {
      if (activePlayerId) {
        const token = await getToken()
        const res = await fetch('/api/proxy-picks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ playerId: activePlayerId, week: currentWeek, season: CURRENT_SEASON, gameId, pickedTeam: team }),
        })
        if (!res.ok) { const json = await res.json(); throw new Error(json.error ?? 'Failed') }
      } else {
        const { error } = await supabase.from('picks').upsert({
          user_id: user.id, game_id: gameId, picked_team: team, week: currentWeek, season: CURRENT_SEASON,
        }, { onConflict: 'user_id,game_id' })
        if (error) throw error
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save pick')
    }
  }

  // Save best picks to the DB immediately
  const saveBestPicks = async (bestGameIds: Set<string>, picksOverride?: UserPick) => {
    if (!user || currentWeek === null) return
    const currentPicks = picksOverride ?? picks
    const bestTeams = Array.from(bestGameIds).map(gid => currentPicks[gid] ?? '').filter(Boolean)
    // Validate no duplicate teams in best picks
    if (bestTeams.length > 0 && new Set(bestTeams).size !== bestTeams.length) {
      setError('Best picks must be 3 different teams')
      return
    }
    const threeBest = { pick_1: bestTeams[0] ?? '', pick_2: bestTeams[1] ?? '', pick_3: bestTeams[2] ?? '' }
    try {
      if (activePlayerId) {
        const token = await getToken()
        const res = await fetch('/api/proxy-picks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ playerId: activePlayerId, week: currentWeek, season: CURRENT_SEASON, threeBest }),
        })
        if (!res.ok) { const json = await res.json(); throw new Error(json.error ?? 'Failed') }
      } else {
        const { error } = await supabase.from('three_best').upsert({
          user_id: user.id, week: currentWeek, season: CURRENT_SEASON, ...threeBest,
        }, { onConflict: 'user_id,week,season' })
        if (error) throw error
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save best picks')
    }
  }

  const handlePickChange = (gameId: string, team: string) => {
    if (isLocked) return
    setPicks(prev => {
      const next = { ...prev, [gameId]: team }
      // If this game is a best pick, re-save best picks with new team name
      if (bestPicks.has(gameId)) {
        saveBestPicks(bestPicks, next)
      }
      return next
    })
    savePick(gameId, team)
  }

  const toggleBestPick = (gameId: string) => {
    if (isLocked || !picks[gameId]) return
    setBestPicks(prev => {
      const next = new Set(prev)
      if (next.has(gameId)) { next.delete(gameId) }
      else if (next.size < MAX_BEST_PICKS) { next.add(gameId) }
      saveBestPicks(next)
      return next
    })
  }


  if (loading || dataLoading) return <PicksSkeleton />
  if (!user) return null

  const pickedCount = Object.keys(picks).length
  const totalGames = games.length

  return (
    <div className="min-h-screen bg-surface">
      <Nav />

      <main className="max-w-3xl mx-auto px-4 py-6 pb-24 animate-fade-in">
        {/* Managed player tabs */}
        {managedPlayers.length > 0 && (
          <div className="mb-5">
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              <button
                onClick={() => { setActivePlayerId(null); setPicks({}); setBestPicks(new Set()); setError('') }}
                className={`press flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-full transition-all whitespace-nowrap ${
                  activePlayerId === null
                    ? 'bg-white/[0.10] text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                }`}
              >
                My Picks
              </button>
              {managedPlayers.map(mp => (
                <button
                  key={mp.id}
                  onClick={() => { setActivePlayerId(mp.id); setPicks({}); setBestPicks(new Set()); setError('') }}
                  className={`press flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-full transition-all whitespace-nowrap ${
                    activePlayerId === mp.id
                      ? 'bg-indigo-500/20 text-indigo-300 shadow-sm ring-1 ring-indigo-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                  }`}
                >
                  <span className="text-xs">👤</span>
                  {mp.name}
                </button>
              ))}
            </div>
            {activePlayerId && (
              <div className="mt-2 p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl flex items-center gap-2 text-xs text-indigo-300">
                <span>👤</span>
                <span>Picking for <strong>{managedPlayers.find(p => p.id === activePlayerId)?.name}</strong></span>
              </div>
            )}
          </div>
        )}

        {/* ── MY PICKS VIEW ── */}
        <>

        {/* Load error */}
        {loadError && (
          <div className="mb-5 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-start gap-3 animate-slide-up">
            <span className="text-xl mt-0.5">⚠️</span>
            <div className="flex-1">
              <p className="font-semibold text-red-400 text-sm">{loadError}</p>
              <button onClick={() => window.location.reload()} className="text-red-400/70 text-xs underline mt-1 hover:text-red-300">Reload page</button>
            </div>
          </div>
        )}

        {/* Lock banner */}
        {isLocked && (
          <div className="mb-5 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-start gap-3">
            <span className="text-xl">🔒</span>
            <div>
              <p className="font-semibold text-red-400 text-sm">Picks are locked</p>
              <p className="text-red-400/70 text-xs mt-0.5">
                The deadline of {lockTime ? formatKickoff(lockTime.toISOString()) : ''} has passed.
              </p>
            </div>
          </div>
        )}

        {/* Lock countdown */}
        {!isLocked && lockTime && (
          <div className="mb-5 p-3 glass-card rounded-2xl flex items-center gap-2.5 text-amber-400 text-xs">
            <span className="animate-pulse-glow">⏰</span>
            <span>Picks lock at <strong>{formatKickoff(lockTime.toISOString())}</strong> — Thursday 8:15 PM ET</span>
          </div>
        )}

        {/* Progress */}
        {totalGames > 0 && (
          <div className="mb-5">
            <div className="flex justify-between text-xs text-slate-400 mb-2">
              <span>{pickedCount} of {totalGames} games picked</span>
              <span className={bestPicks.size === MAX_BEST_PICKS ? 'text-amber-400 font-medium' : ''}>
                ⭐ {bestPicks.size}/{MAX_BEST_PICKS} best picks
              </span>
            </div>
            <div className="w-full bg-white/[0.06] rounded-full h-2 overflow-hidden">
              <div
                className="progress-gradient h-2 rounded-full transition-all duration-500 ease-out"
                style={{ width: totalGames > 0 ? `${(pickedCount / totalGames) * 100}%` : '0%' }}
              />
            </div>
          </div>
        )}

        {/* Unpicked games warning */}
        {!isLocked && totalGames > 0 && pickedCount < totalGames && (
          <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center gap-2.5 text-amber-400 text-xs">
            <span>⚠️</span>
            <span>You have <strong>{totalGames - pickedCount} unpicked {totalGames - pickedCount === 1 ? 'game' : 'games'}</strong> remaining</span>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm animate-slide-up">{error}</div>
        )}

        <div>
          <div className="mb-6">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
              Week {currentWeek} Games
            </h2>

            {games.length === 0 ? (
              <div className="glass-card rounded-2xl p-10 text-center">
                <p className="text-3xl mb-3">📅</p>
                <p className="text-slate-400 text-sm">No games available yet. Check back soon!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {games.map((game, gameIdx) => {
                  const away = getTeam(game.away_team)
                  const home = getTeam(game.home_team)
                  const pickedTeam = picks[game.id]
                  const isStarred = bestPicks.has(game.id)
                  const canStar = !!pickedTeam && !isLocked
                  const starDisabled = !canStar || (!isStarred && bestPicks.size >= MAX_BEST_PICKS)

                  return (
                    <div
                      key={game.id}
                      className={`glass-card rounded-2xl overflow-hidden transition-all duration-300 animate-slide-up ${
                        isStarred ? 'ring-1 ring-amber-500/30' : ''
                      } ${isLocked ? 'opacity-80' : ''}`}
                      style={{ animationDelay: `${gameIdx * 30}ms` }}
                    >
                      <div className="flex items-center justify-between px-4 pt-3 pb-2">
                        <p className="text-xs text-slate-500">{formatKickoff(game.kickoff_time)}</p>
                        {!isLocked && (
                          <button
                            type="button"
                            onClick={() => toggleBestPick(game.id)}
                            disabled={starDisabled}
                            title={!canStar ? 'Pick a team first' : isStarred ? 'Remove best pick' : bestPicks.size >= MAX_BEST_PICKS ? 'Already selected 3' : 'Mark as best pick'}
                            className={`press flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-all font-medium ${
                              isStarred ? 'bg-amber-500/15 border-amber-500/30 text-amber-400 glow-amber'
                              : starDisabled ? 'border-white/[0.04] text-slate-600 cursor-not-allowed'
                              : 'border-white/[0.08] text-slate-400 hover:border-amber-500/30 hover:text-amber-400'
                            }`}
                          >
                            <span className={isStarred ? 'transition-transform scale-110' : ''}>{isStarred ? '⭐' : '☆'}</span>
                            <span>Best Pick</span>
                          </button>
                        )}
                        {isLocked && isStarred && (
                          <span className="text-xs text-amber-400 font-medium">⭐ Best Pick</span>
                        )}
                      </div>

                      <div className="grid grid-cols-[1fr_auto_1fr] gap-0 px-3 pb-3 items-center">
                        {/* Away team */}
                        <button
                          type="button"
                          onClick={() => handlePickChange(game.id, game.away_team)}
                          disabled={isLocked}
                          className={`press flex items-center gap-3 py-3 px-4 rounded-xl border-2 transition-all text-left ${
                            pickedTeam === game.away_team
                              ? 'border-blue-500/60 bg-blue-500/15 text-white glow-blue'
                              : isLocked
                              ? 'border-white/[0.03] bg-white/[0.02] text-slate-500 cursor-default'
                              : 'border-white/[0.06] bg-white/[0.02] text-slate-300 hover:border-blue-500/30 hover:bg-blue-500/5'
                          }`}
                        >
                          <img
                            src={away.logo} alt={game.away_team}
                            className={`w-10 h-10 object-contain flex-shrink-0 ${isLocked && pickedTeam !== game.away_team ? 'opacity-30' : ''}`}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                          <div className="min-w-0">
                            <p className="text-[11px] opacity-50 leading-tight truncate">{away.city}</p>
                            <p className="font-semibold text-sm leading-tight truncate">{away.name}</p>
                            <p className={`text-[11px] mt-0.5 ${pickedTeam === game.away_team ? 'text-blue-300/70' : 'text-slate-500'}`}>Away</p>
                          </div>
                          {pickedTeam === game.away_team && (
                            <span className="ml-auto text-blue-400 text-sm">✓</span>
                          )}
                        </button>

                        {/* VS divider */}
                        <div className="flex items-center justify-center px-2">
                          <span className="text-[10px] font-bold text-slate-600 uppercase">@</span>
                        </div>

                        {/* Home team */}
                        <button
                          type="button"
                          onClick={() => handlePickChange(game.id, game.home_team)}
                          disabled={isLocked}
                          className={`press flex items-center gap-3 py-3 px-4 rounded-xl border-2 transition-all text-left ${
                            pickedTeam === game.home_team
                              ? 'border-blue-500/60 bg-blue-500/15 text-white glow-blue'
                              : isLocked
                              ? 'border-white/[0.03] bg-white/[0.02] text-slate-500 cursor-default'
                              : 'border-white/[0.06] bg-white/[0.02] text-slate-300 hover:border-blue-500/30 hover:bg-blue-500/5'
                          }`}
                        >
                          <img
                            src={home.logo} alt={game.home_team}
                            className={`w-10 h-10 object-contain flex-shrink-0 ${isLocked && pickedTeam !== game.home_team ? 'opacity-30' : ''}`}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                          <div className="min-w-0">
                            <p className="text-[11px] opacity-50 leading-tight truncate">{home.city}</p>
                            <p className="font-semibold text-sm leading-tight truncate">{home.name}</p>
                            <p className={`text-[11px] mt-0.5 ${pickedTeam === game.home_team ? 'text-blue-300/70' : 'text-slate-500'}`}>Home</p>
                          </div>
                          {pickedTeam === game.home_team && (
                            <span className="ml-auto text-blue-400 text-sm">✓</span>
                          )}
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
            <div className="mb-5 bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4">
              <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-2">
                ⭐ {activePlayerId ? `${managedPlayers.find(p => p.id === activePlayerId)?.name}'s` : 'Your'} Best Picks
              </p>
              <div className="flex flex-wrap gap-2">
                {Array.from(bestPicks).map(gameId => {
                  const team = picks[gameId]
                  const t = getTeam(team)
                  return (
                    <div key={gameId} className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5">
                      <img src={t.logo} alt={team} className="w-5 h-5 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                      <span className="text-sm font-semibold text-amber-200">{t.city} {t.name}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        </>
      </main>

    </div>
  )
}
