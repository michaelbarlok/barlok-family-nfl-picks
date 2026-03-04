import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { CURRENT_SEASON, ADMIN_EMAIL } from '@/lib/constants'
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

interface UserRow {
  id: string
  name: string
  email: string
}

interface PickMap {
  [gameId: string]: string | null
}

interface ThreeBestMap {
  pick_1: string
  pick_2: string
  pick_3: string
}

export default function AdminPage() {
  const router = useRouter()
  const { user, loading } = useAuth()

  // Shared state
  const [activeTab, setActiveTab] = useState<'results' | 'override'>('results')
  const [availableWeeks, setAvailableWeeks] = useState<number[]>([])
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null)
  const [games, setGames] = useState<Game[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Results tab state
  const [syncing, setSyncing] = useState(false)
  const [emailing, setEmailing] = useState(false)
  const [settingResult, setSettingResult] = useState<string | null>(null)
  const [customMessage, setCustomMessage] = useState('')

  // Override tab state
  const [users, setUsers] = useState<UserRow[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [overridePicks, setOverridePicks] = useState<PickMap>({})
  const [overrideThreeBest, setOverrideThreeBest] = useState<ThreeBestMap>({ pick_1: '', pick_2: '', pick_3: '' })
  const [savingOverride, setSavingOverride] = useState(false)
  const [loadingUserPicks, setLoadingUserPicks] = useState(false)

  // Auth guard
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
        const weeks = [...new Set(data.map((g: { week: number }) => g.week))].sort((a, b) => a - b)
        setAvailableWeeks(weeks)
        if (weeks.length > 0) setSelectedWeek(weeks[weeks.length - 1])
      }
      setDataLoading(false)
    }
    if (user?.email === ADMIN_EMAIL) fetchWeeks()
  }, [user])

  // Load users for override tab
  useEffect(() => {
    const fetchUsers = async () => {
      const { data } = await supabase.from('users').select('id, name, email').order('name')
      if (data) setUsers(data)
    }
    if (user?.email === ADMIN_EMAIL) fetchUsers()
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

  // Load selected user's picks for selected week
  useEffect(() => {
    if (!selectedUserId || !selectedWeek) return
    const fetchUserPicks = async () => {
      setLoadingUserPicks(true)
      // Load picks
      const { data: picks } = await supabase
        .from('picks').select('game_id, picked_team')
        .eq('user_id', selectedUserId).eq('week', selectedWeek).eq('season', CURRENT_SEASON)
      const pickMap: PickMap = {}
      for (const p of picks ?? []) {
        pickMap[p.game_id] = p.picked_team
      }
      setOverridePicks(pickMap)

      // Load three best
      const { data: tb } = await supabase
        .from('three_best').select('pick_1, pick_2, pick_3')
        .eq('user_id', selectedUserId).eq('week', selectedWeek).eq('season', CURRENT_SEASON)
        .maybeSingle()
      setOverrideThreeBest({
        pick_1: tb?.pick_1 ?? '',
        pick_2: tb?.pick_2 ?? '',
        pick_3: tb?.pick_3 ?? '',
      })
      setLoadingUserPicks(false)
    }
    fetchUserPicks()
  }, [selectedUserId, selectedWeek])

  const getToken = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? ''
  }

  // Sync results from ESPN
  const handleSync = async () => {
    if (!selectedWeek) return
    setSyncing(true)
    setMessage(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/update-scores?week=${selectedWeek}&season=${CURRENT_SEASON}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Sync failed')
      setMessage({ type: 'success', text: json.message ?? 'Sync complete.' })
      await loadGames()
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Sync failed' })
    } finally {
      setSyncing(false)
    }
  }

  // Email spreadsheet manually
  const handleEmail = async () => {
    if (!selectedWeek) return
    setEmailing(true)
    setMessage(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/send-weekly-email?week=${selectedWeek}&season=${CURRENT_SEASON}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ customMessage: customMessage.trim() || undefined }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Email failed')
      setMessage({ type: 'success', text: json.message ?? 'Email sent!' })
      setCustomMessage('')
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Email failed' })
    } finally {
      setEmailing(false)
    }
  }

  // Manually set a game winner
  const handleSetResult = async (game: Game, winningTeam: string) => {
    setSettingResult(game.id)
    setMessage(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/set-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ gameId: game.id, winningTeam, week: game.week, season: game.season }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to set result')
      setMessage({ type: 'success', text: `Set ${winningTeam} as winner — ${json.updated} scores updated.` })
      await loadGames()
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed' })
    } finally {
      setSettingResult(null)
    }
  }

  // Override a single pick for a user
  const handleOverridePick = async (gameId: string, pickedTeam: string | null) => {
    if (!selectedUserId || !selectedWeek) return
    const token = await getToken()
    const res = await fetch('/api/admin-override-pick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        userId: selectedUserId,
        week: selectedWeek,
        season: CURRENT_SEASON,
        gameId,
        pickedTeam,
      }),
    })
    const json = await res.json()
    if (!res.ok) {
      setMessage({ type: 'error', text: json.error ?? 'Failed to override pick' })
      return
    }
    // Update local state
    setOverridePicks(prev => ({ ...prev, [gameId]: pickedTeam }))
    setMessage({ type: 'success', text: pickedTeam ? `Pick updated to ${pickedTeam}.` : 'Pick cleared.' })
  }

  // Save three best overrides
  const handleSaveThreeBest = async () => {
    if (!selectedUserId || !selectedWeek) return
    setSavingOverride(true)
    setMessage(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/admin-override-pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          userId: selectedUserId,
          week: selectedWeek,
          season: CURRENT_SEASON,
          threeBest: overrideThreeBest,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to save')
      setMessage({ type: 'success', text: 'Best 3 picks saved.' })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed' })
    } finally {
      setSavingOverride(false)
    }
  }

  if (loading || dataLoading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-3">🔧</div>
          <p className="text-slate-400 text-sm">Loading admin panel...</p>
        </div>
      </div>
    )
  }

  if (!user || user.email !== ADMIN_EMAIL) return null

  const selectedUser = users.find(u => u.id === selectedUserId)

  return (
    <div className="min-h-screen bg-surface">
      <Nav />

      <main className="max-w-3xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-lg font-bold text-white">Admin Dashboard</h1>
            <p className="text-xs text-slate-500 mt-0.5">Visible only to you</p>
          </div>
          <span className="text-xs font-semibold bg-red-500/15 text-red-400 px-2.5 py-1 rounded-full border border-red-500/20">
            🔐 Admin Only
          </span>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 mb-5 bg-white/[0.04] p-1 rounded-xl">
          {[
            { key: 'results', label: '🏆 Game Results' },
            { key: 'override', label: '✏️ Override Picks' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key as 'results' | 'override'); setMessage(null) }}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition ${
                activeTab === tab.key
                  ? 'bg-white/[0.10] text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Message banner */}
        {message && (
          <div className={`mb-4 p-3 rounded-xl text-sm border animate-slide-up ${
            message.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : 'bg-red-500/10 border-red-500/20 text-red-400'
          }`}>
            {message.type === 'success' ? '✓ ' : '✗ '}{message.text}
          </div>
        )}

        {/* Week selector (shared) */}
        {availableWeeks.length > 0 && (
          <div className="mb-5">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Select Week</p>
            <div className="flex flex-wrap gap-2">
              {availableWeeks.map(w => (
                <button
                  key={w}
                  onClick={() => setSelectedWeek(w)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${
                    selectedWeek === w
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white/[0.04] text-slate-300 border-white/[0.08] hover:border-blue-500/30'
                  }`}
                >
                  Week {w}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── GAME RESULTS TAB ── */}
        {activeTab === 'results' && selectedWeek && (
          <>
            {/* Action buttons row */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="p-4 glass-card rounded-xl">
                <p className="text-sm font-semibold text-slate-200 mb-1">Sync from ESPN</p>
                <p className="text-xs text-slate-500 mb-3">Pull completed game results & update all scores.</p>
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
                >
                  {syncing ? <><span className="animate-spin">⏳</span> Syncing...</> : <><span>🔄</span> Sync Week {selectedWeek}</>}
                </button>
              </div>

              <div className="p-4 glass-card rounded-xl">
                <p className="text-sm font-semibold text-slate-200 mb-1">Email Spreadsheet</p>
                <p className="text-xs text-slate-500 mb-3">Send Week {selectedWeek} picks sheet to all players.</p>
                <textarea
                  value={customMessage}
                  onChange={e => setCustomMessage(e.target.value)}
                  placeholder="Add an optional message to include in the email..."
                  rows={3}
                  className="w-full px-3 py-2 text-sm bg-white/[0.04] border border-white/[0.08] rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 mb-3 resize-none"
                />
                <button
                  onClick={handleEmail}
                  disabled={emailing}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition"
                >
                  {emailing ? <><span className="animate-spin">⏳</span> Sending...</> : <><span>📧</span> Email Now</>}
                </button>
              </div>
            </div>

            {/* Games list */}
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
              Week {selectedWeek} — Set Winners
            </p>

            {games.length === 0 ? (
              <div className="glass-card rounded-xl p-8 text-center">
                <p className="text-slate-500 text-sm">No games found for Week {selectedWeek}.</p>
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
                    <div key={game.id} className="glass-card rounded-xl overflow-hidden">
                      <div className="flex items-center justify-between px-4 pt-3 pb-2">
                        <p className="text-xs text-slate-500">{formatKickoff(game.kickoff_time)}</p>
                        <div className="flex items-center gap-2">
                          {winner ? (
                            <span className="text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                              ✓ {winner} won
                            </span>
                          ) : kickedOff ? (
                            <span className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                              Pending result
                            </span>
                          ) : (
                            <span className="text-xs text-slate-500 bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded-full">
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
                                  ? 'border-emerald-500/60 bg-emerald-500/15 text-white glow-green'
                                  : winner && !isWinner
                                  ? 'border-white/[0.03] bg-white/[0.02] text-slate-600'
                                  : 'border-white/[0.06] bg-white/[0.02] text-slate-300 hover:border-blue-500/30 hover:bg-blue-500/5'
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
                                <p className={`text-xs mt-0.5 ${isWinner ? 'opacity-70' : 'text-slate-500'}`}>{label}</p>
                              </div>
                              {isWinner && <span className="ml-auto text-sm">✓</span>}
                            </button>
                          )
                        })}
                      </div>

                      {isSettingThis && (
                        <div className="px-4 pb-3 text-xs text-slate-500">Updating scores...</div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* ── OVERRIDE PICKS TAB ── */}
        {activeTab === 'override' && selectedWeek && (
          <>
            {/* User selector */}
            <div className="mb-5">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Select Player</p>
              <div className="flex flex-wrap gap-2">
                {users.map(u => (
                  <button
                    key={u.id}
                    onClick={() => { setSelectedUserId(u.id); setMessage(null) }}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${
                      selectedUserId === u.id
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white/[0.04] text-slate-300 border-white/[0.08] hover:border-indigo-500/30'
                    }`}
                  >
                    {u.name}
                  </button>
                ))}
              </div>
            </div>

            {!selectedUserId && (
              <div className="glass-card rounded-xl p-8 text-center">
                <p className="text-slate-500 text-sm">Select a player above to view and override their picks.</p>
              </div>
            )}

            {selectedUserId && (
              <>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  {selectedUser?.name}&apos;s Week {selectedWeek} Picks — Click to change
                </p>

                {loadingUserPicks ? (
                  <div className="glass-card rounded-xl p-8 text-center">
                    <p className="text-slate-500 text-sm">Loading picks...</p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2 mb-5">
                      {games.map(game => {
                        const away = getTeam(game.away_team)
                        const home = getTeam(game.home_team)
                        const currentPick = overridePicks[game.id] ?? null

                        return (
                          <div key={game.id} className="glass-card rounded-xl overflow-hidden">
                            <div className="flex items-center justify-between px-4 pt-3 pb-2">
                              <p className="text-xs text-slate-500">{formatKickoff(game.kickoff_time)}</p>
                              {currentPick ? (
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-semibold text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full">
                                    Picked: {currentPick}
                                  </span>
                                  <button
                                    onClick={() => handleOverridePick(game.id, null)}
                                    className="text-xs text-red-400 hover:text-red-600 transition"
                                    title="Clear pick"
                                  >
                                    ✕ Clear
                                  </button>
                                </div>
                              ) : (
                                <span className="text-xs text-slate-500 bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded-full">
                                  No pick
                                </span>
                              )}
                            </div>

                            <div className="grid grid-cols-2 gap-2 px-3 pb-3">
                              {[
                                { abbr: game.away_team, info: away, label: 'Away' },
                                { abbr: game.home_team, info: home, label: 'Home' },
                              ].map(({ abbr, info, label }) => {
                                const isPicked = currentPick === abbr
                                return (
                                  <button
                                    key={abbr}
                                    type="button"
                                    onClick={() => handleOverridePick(game.id, abbr)}
                                    className={`flex items-center gap-3 py-3 px-4 rounded-lg border-2 transition text-left ${
                                      isPicked
                                        ? 'border-blue-500/60 bg-blue-500/15 text-white glow-blue'
                                        : currentPick && !isPicked
                                        ? 'border-white/[0.03] bg-white/[0.02] text-slate-600'
                                        : 'border-white/[0.06] bg-white/[0.02] text-slate-300 hover:border-blue-500/30 hover:bg-blue-500/5'
                                    }`}
                                  >
                                    <img
                                      src={info.logo} alt={abbr}
                                      className={`w-8 h-8 object-contain flex-shrink-0 ${currentPick && !isPicked ? 'opacity-30' : ''}`}
                                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                                    />
                                    <div className="min-w-0">
                                      <p className="text-xs opacity-70 leading-tight truncate">{info.city}</p>
                                      <p className="font-semibold text-sm leading-tight truncate">{info.name}</p>
                                      <p className={`text-xs mt-0.5 ${isPicked ? 'opacity-70' : 'text-slate-500'}`}>{label}</p>
                                    </div>
                                    {isPicked && <span className="ml-auto text-sm">✓</span>}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {/* Three Best override */}
                    <div className="glass-card rounded-xl p-4">
                      <p className="text-sm font-semibold text-slate-200 mb-1">Override Best 3 Picks</p>
                      <p className="text-xs text-slate-500 mb-3">
                        Enter team abbreviations (e.g. KC, BUF, PHI). Leave blank to clear.
                      </p>
                      <div className="grid grid-cols-3 gap-3 mb-4">
                        {(['pick_1', 'pick_2', 'pick_3'] as const).map((key, i) => (
                          <div key={key}>
                            <label className="block text-xs font-semibold text-slate-400 mb-1">Best #{i + 1}</label>
                            <input
                              type="text"
                              value={overrideThreeBest[key]}
                              onChange={e => setOverrideThreeBest(prev => ({ ...prev, [key]: e.target.value.toUpperCase() }))}
                              maxLength={3}
                              placeholder="e.g. KC"
                              className="w-full px-3 py-2 text-sm bg-white/[0.04] border border-white/[0.08] rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 font-mono uppercase"
                            />
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={handleSaveThreeBest}
                        disabled={savingOverride}
                        className="w-full py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition"
                      >
                        {savingOverride ? 'Saving...' : 'Save Best 3 Picks'}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {availableWeeks.length === 0 && !dataLoading && (
          <div className="glass-card rounded-xl p-10 text-center">
            <p className="text-slate-500 text-sm">No games found. Add games to the database first.</p>
          </div>
        )}
      </main>
    </div>
  )
}
