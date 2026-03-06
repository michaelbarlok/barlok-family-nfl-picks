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

function parseUTC(iso: string): Date {
  const normalized = iso.replace(' ', 'T')
  const timepart = normalized.split('T')[1] || ''
  const hasOffset = timepart.includes('Z') || timepart.includes('+') || timepart.includes('-')
  return new Date(hasOffset ? normalized : normalized + 'Z')
}

function computeLockTime(games: Game[]): Date | null {
  if (games.length === 0) return null
  const kickoffs = games.map(g => parseUTC(g.kickoff_time))
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

function formatKickoff(iso: string) {
  const d = parseUTC(iso)
  return d.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    timeZone: 'America/New_York',
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


export default function AdminPage() {
  const router = useRouter()
  const { user, loading } = useAuth()

  const isAdmin = user?.email === ADMIN_EMAIL || (user as any)?.is_admin === true
  const isManager = (user as any)?.is_manager === true
  const hasAccess = isAdmin || isManager

  // Shared state
  const [activeTab, setActiveTab] = useState<'results' | 'override' | 'players'>('players')
  const [availableWeeks, setAvailableWeeks] = useState<number[]>([])
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null)
  const [games, setGames] = useState<Game[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Results tab state
  const [syncingSchedule, setSyncingSchedule] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [emailing, setEmailing] = useState(false)
  const [settingResult, setSettingResult] = useState<string | null>(null)
  const [customMessage, setCustomMessage] = useState('')
  const [emailRecipientOverrides, setEmailRecipientOverrides] = useState<Record<string, boolean>>({})

  // Override tab state
  const [users, setUsers] = useState<UserRow[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [overridePicks, setOverridePicks] = useState<PickMap>({})
  const [overrideBestGames, setOverrideBestGames] = useState<Set<string>>(new Set())
  const [savingOverride, setSavingOverride] = useState(false)
  const [loadingUserPicks, setLoadingUserPicks] = useState(false)

  // Manage Players tab state
  interface ManagedPlayer { id: string; name: string }
  interface ManagerLink { manager_id: string; player_id: string }
  interface FullUser { id: string; name: string; email: string | null; is_manager: boolean; is_managed: boolean; is_admin?: boolean; email_recipient?: boolean; last_sign_in_at: string | null }
  const [sendingResetFor, setSendingResetFor] = useState<string | null>(null)
  const [managedPlayers, setManagedPlayers] = useState<ManagedPlayer[]>([])
  const [managerLinks, setManagerLinks] = useState<ManagerLink[]>([])
  const [allUsers, setAllUsers] = useState<FullUser[]>([])
  const [newPlayerName, setNewPlayerName] = useState('')
  const [newPlayerManagers, setNewPlayerManagers] = useState<Set<string>>(new Set())
  const [creatingPlayer, setCreatingPlayer] = useState(false)
  const [playersLoading, setPlayersLoading] = useState(false)
  const [editingNameId, setEditingNameId] = useState<string | null>(null)
  const [editingNameValue, setEditingNameValue] = useState('')

  // Auth guard — allow admin and managers
  useEffect(() => {
    if (!loading) {
      if (!user) { router.push('/login'); return }
      if (!isAdmin && !isManager) { router.push('/picks'); return }
      if (isAdmin) setActiveTab('results')
    }
  }, [user, loading, router, isAdmin, isManager])

  // Load available weeks
  useEffect(() => {
    const fetchWeeks = async () => {
      const { data } = await supabase
        .from('games').select('week').eq('season', CURRENT_SEASON).order('week')
      if (data) {
        const weeks = [...new Set(data.map((g: { week: number }) => g.week))].sort((a, b) => a - b)
        setAvailableWeeks(weeks)
        setSelectedWeek(weeks.length > 0 ? weeks[weeks.length - 1] : 1)
      } else {
        setSelectedWeek(1)
      }
      setDataLoading(false)
    }
    if (hasAccess) fetchWeeks()
  }, [user, hasAccess])

  // Load users for override tab
  useEffect(() => {
    const fetchUsers = async () => {
      const { data } = await supabase.from('users').select('id, name, email').order('name')
      if (data) setUsers(data)
    }
    if (isAdmin) fetchUsers()
  }, [user, isAdmin])

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

      // Load three best — convert team abbreviations to game IDs
      const { data: tb } = await supabase
        .from('three_best').select('pick_1, pick_2, pick_3')
        .eq('user_id', selectedUserId).eq('week', selectedWeek).eq('season', CURRENT_SEASON)
        .maybeSingle()
      const bestGameIds = new Set<string>()
      if (tb) {
        const bestTeams = [tb.pick_1, tb.pick_2, tb.pick_3].filter(Boolean)
        bestTeams.forEach(team => {
          const gameId = Object.entries(pickMap).find(([, picked]) => picked === team)?.[0]
          if (gameId) bestGameIds.add(gameId)
        })
      }
      setOverrideBestGames(bestGameIds)
      setLoadingUserPicks(false)
    }
    fetchUserPicks()
  }, [selectedUserId, selectedWeek])

  const getToken = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? ''
  }

  // Load managed players data for admin tab
  const loadManagedPlayersData = useCallback(async () => {
    setPlayersLoading(true)
    try {
      const token = await getToken()
      const res = await fetch('/api/managed-players?all=true', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json()
      if (res.ok) {
        setManagedPlayers(json.managedPlayers ?? [])
        setManagerLinks(json.managerLinks ?? [])
        setAllUsers(json.users ?? [])
      }
    } catch (err) {
      console.error('Failed to load managed players:', err)
    } finally {
      setPlayersLoading(false)
    }
  }, [])

  useEffect(() => {
    if ((activeTab === 'players' || activeTab === 'results') && hasAccess) {
      loadManagedPlayersData()
    }
  }, [activeTab, user, loadManagedPlayersData])

  // Create a managed player
  const handleCreateManagedPlayer = async () => {
    if (!newPlayerName.trim()) return
    setCreatingPlayer(true)
    setMessage(null)
    try {
      const token = await getToken()
      const managerIds = Array.from(newPlayerManagers)
      const res = await fetch('/api/managed-players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: newPlayerName.trim(), managerIds }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to create player')
      setMessage({ type: 'success', text: `Created "${newPlayerName.trim()}" as a managed player.` })
      setNewPlayerName('')
      setNewPlayerManagers(new Set())
      await loadManagedPlayersData()
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed' })
    } finally {
      setCreatingPlayer(false)
    }
  }

  // Delete a managed player
  const handleDeleteManagedPlayer = async (playerId: string, playerName: string) => {
    if (!confirm(`Delete "${playerName}"? This will remove all their picks and scores.`)) return
    setMessage(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/managed-players', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ playerId }),
      })
      if (!res.ok) throw new Error('Failed to delete player')
      setMessage({ type: 'success', text: `Deleted "${playerName}".` })
      await loadManagedPlayersData()
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed' })
    }
  }

  // Toggle manager status
  const handleToggleManager = async (userId: string, isManager: boolean) => {
    setMessage(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/managed-players', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'toggle_manager', userId, isManager }),
      })
      if (!res.ok) throw new Error('Failed to update')
      await loadManagedPlayersData()
      setMessage({ type: 'success', text: isManager ? 'Manager status granted.' : 'Manager status revoked.' })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed' })
    }
  }

  // Toggle admin status
  const handleToggleAdmin = async (userId: string, newAdminStatus: boolean) => {
    setMessage(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/managed-players', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'toggle_admin', userId, isAdmin: newAdminStatus }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to update')
      await loadManagedPlayersData()
      setMessage({ type: 'success', text: newAdminStatus ? 'Admin status granted.' : 'Admin status revoked.' })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed' })
    }
  }

  // Send password reset email to a user
  const handleSendResetEmail = async (email: string) => {
    setSendingResetFor(email)
    setMessage(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/managed-players', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'send_reset_email', email }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to send reset email')
      setMessage({ type: 'success', text: `Password reset email sent to ${email}.` })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to send reset email' })
    } finally {
      setSendingResetFor(null)
    }
  }

  // Toggle email recipient flag on a user (persisted)
  const handleToggleEmailRecipient = async (userId: string, emailRecipient: boolean) => {
    setMessage(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/managed-players', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'toggle_email_recipient', userId, emailRecipient }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to update')
      await loadManagedPlayersData()
      setMessage({ type: 'success', text: emailRecipient ? 'Added to email recipients.' : 'Removed from email recipients.' })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed' })
    }
  }

  // Add a manager to a managed player
  const handleAddManager = async (playerId: string, managerId: string) => {
    setMessage(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/managed-players', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'add_manager', playerId, managerId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to add manager')
      await loadManagedPlayersData()
      setMessage({ type: 'success', text: 'Manager added.' })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed' })
    }
  }

  // Remove a manager from a managed player
  const handleRemoveManager = async (playerId: string, managerId: string) => {
    setMessage(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/managed-players', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'remove_manager', playerId, managerId }),
      })
      if (!res.ok) throw new Error('Failed to remove manager')
      await loadManagedPlayersData()
      setMessage({ type: 'success', text: 'Manager removed.' })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed' })
    }
  }

  // Rename a user
  const handleRenameUser = async (userId: string) => {
    if (!editingNameValue.trim()) return
    setMessage(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/managed-players', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'rename_user', userId, newName: editingNameValue.trim() }),
      })
      if (!res.ok) throw new Error('Failed to rename user')
      setEditingNameId(null)
      setEditingNameValue('')
      await loadManagedPlayersData()
      setMessage({ type: 'success', text: 'Name updated.' })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed' })
    }
  }

  // Sync schedule from ESPN (load games for a week)
  const handleSyncSchedule = async () => {
    if (!selectedWeek) return
    setSyncingSchedule(true)
    setMessage(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/sync-schedule?week=${selectedWeek}&season=${CURRENT_SEASON}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Sync schedule failed')
      setMessage({ type: 'success', text: json.message ?? 'Schedule synced.' })
      await loadGames()
      // Refresh available weeks
      const { data } = await supabase
        .from('games').select('week').eq('season', CURRENT_SEASON).order('week')
      if (data) {
        const weeks = [...new Set(data.map((g: { week: number }) => g.week))].sort((a, b) => a - b)
        setAvailableWeeks(weeks)
      }
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Sync schedule failed' })
    } finally {
      setSyncingSchedule(false)
    }
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
    // Build recipient list: use overrides if any, otherwise use users with email_recipient flag
    const emailUsers = allUsers.filter(u => u.email && !u.is_managed)
    const recipients = emailUsers
      .filter(u => {
        if (u.id in emailRecipientOverrides) return emailRecipientOverrides[u.id]
        return u.email_recipient === true
      })
      .map(u => u.email!)
    if (recipients.length === 0) {
      setMessage({ type: 'error', text: 'No recipients selected. Toggle at least one user below.' })
      return
    }
    setEmailing(true)
    setMessage(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/send-weekly-email?week=${selectedWeek}&season=${CURRENT_SEASON}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          customMessage: customMessage.trim() || undefined,
          recipients,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Email failed')
      setMessage({ type: 'success', text: json.message ?? 'Email sent!' })
      setCustomMessage('')
      setEmailRecipientOverrides({})
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
      setMessage({ type: 'success', text: winningTeam === 'TIE' ? `Set as tie — ${json.updated} scores updated.` : `Set ${winningTeam} as winner — ${json.updated} scores updated.` })
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

  // Save three best to the API
  const saveBestPicks = async (bestGameIds: Set<string>) => {
    if (!selectedUserId || !selectedWeek) return
    setSavingOverride(true)
    try {
      const bestTeams = Array.from(bestGameIds).map(gid => overridePicks[gid] ?? '')
      const token = await getToken()
      const res = await fetch('/api/admin-override-pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          userId: selectedUserId,
          week: selectedWeek,
          season: CURRENT_SEASON,
          threeBest: { pick_1: bestTeams[0] ?? '', pick_2: bestTeams[1] ?? '', pick_3: bestTeams[2] ?? '' },
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

  // Toggle a game as a best pick — auto-saves when exactly 3 are selected
  const toggleBestGame = (gameId: string) => {
    setOverrideBestGames(prev => {
      const next = new Set(prev)
      if (next.has(gameId)) next.delete(gameId)
      else if (next.size < 3) next.add(gameId)
      if (next.size === 3) saveBestPicks(next)
      return next
    })
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

  if (!user || (!isAdmin && !isManager)) return null

  const selectedUser = users.find(u => u.id === selectedUserId)

  return (
    <div className="min-h-screen bg-surface">
      <Nav />

      <main className="max-w-3xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-lg font-bold text-white">Admin Dashboard</h1>
            <p className="text-xs text-slate-500 mt-0.5">Visible to admins &amp; managers</p>
          </div>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
            isAdmin
              ? 'bg-red-500/15 text-red-400 border-red-500/20'
              : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
          }`}>
            {isAdmin ? '🔐 Admin' : '👤 Manager'}
          </span>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 mb-5 bg-white/[0.04] p-1 rounded-xl">
          {[
            ...(isAdmin ? [
              { key: 'results', label: '🏆 Results' },
              { key: 'override', label: '✏️ Override' },
            ] : []),
            { key: 'players', label: '👥 Players' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key as 'results' | 'override' | 'players'); setMessage(null) }}
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

        {/* Week selector (shared) — show all 18 weeks so new weeks can be synced */}
        <div className="mb-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Select Week</p>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 18 }, (_, i) => i + 1).map(w => (
              <button
                key={w}
                onClick={() => setSelectedWeek(w)}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${
                  selectedWeek === w
                    ? 'bg-blue-600 text-white border-blue-600'
                    : availableWeeks.includes(w)
                      ? 'bg-white/[0.04] text-slate-300 border-white/[0.08] hover:border-blue-500/30'
                      : 'bg-white/[0.02] text-slate-500 border-white/[0.05] hover:border-blue-500/30'
                }`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>

        {/* ── GAME RESULTS TAB ── */}
        {activeTab === 'results' && selectedWeek && (
          <>
            {/* Action buttons row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
              <div className="p-4 glass-card rounded-xl">
                <p className="text-sm font-semibold text-slate-200 mb-1">Sync Schedule</p>
                <p className="text-xs text-slate-500 mb-3">Pull Week {selectedWeek} games & times from ESPN.</p>
                <button
                  onClick={handleSyncSchedule}
                  disabled={syncingSchedule}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition"
                >
                  {syncingSchedule ? <><span className="animate-spin">⏳</span> Syncing...</> : <><span>📅</span> Load Games</>}
                </button>
              </div>

              <div className="p-4 glass-card rounded-xl">
                <p className="text-sm font-semibold text-slate-200 mb-1">Sync Results</p>
                <p className="text-xs text-slate-500 mb-3">Pull completed game results & update all scores.</p>
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
                >
                  {syncing ? <><span className="animate-spin">⏳</span> Syncing...</> : <><span>🔄</span> Sync Week {selectedWeek}</>}
                </button>
              </div>

            </div>

            {/* Email Spreadsheet — full width with recipient selection */}
            <div className="p-4 glass-card rounded-xl mb-5">
              <p className="text-sm font-semibold text-slate-200 mb-1">Email Spreadsheet</p>
              <p className="text-xs text-slate-500 mb-3">Send Week {selectedWeek} picks sheet to selected recipients.</p>

              {/* Recipient toggles */}
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Recipients</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {allUsers.filter(u => u.email && !u.is_managed).map(u => {
                  const isSelected = u.id in emailRecipientOverrides
                    ? emailRecipientOverrides[u.id]
                    : u.email_recipient === true
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setEmailRecipientOverrides(prev => ({ ...prev, [u.id]: !isSelected }))}
                      className={`press text-xs font-medium px-3 py-1.5 rounded-full border transition ${
                        isSelected
                          ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-400'
                          : 'bg-white/[0.04] border-white/[0.08] text-slate-500 hover:border-indigo-500/30'
                      }`}
                    >
                      {isSelected ? '✓ ' : ''}{u.name}
                    </button>
                  )
                })}
              </div>
              <div className="flex gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => {
                    const overrides: Record<string, boolean> = {}
                    allUsers.filter(u => u.email && !u.is_managed).forEach(u => { overrides[u.id] = true })
                    setEmailRecipientOverrides(overrides)
                  }}
                  className="text-xs text-slate-500 hover:text-blue-400 transition"
                >
                  Select all
                </button>
                <span className="text-xs text-slate-600">·</span>
                <button
                  type="button"
                  onClick={() => {
                    const overrides: Record<string, boolean> = {}
                    allUsers.filter(u => u.email && !u.is_managed).forEach(u => { overrides[u.id] = false })
                    setEmailRecipientOverrides(overrides)
                  }}
                  className="text-xs text-slate-500 hover:text-blue-400 transition"
                >
                  Select none
                </button>
                <span className="text-xs text-slate-600">·</span>
                <button
                  type="button"
                  onClick={async () => {
                    // Save current selection as defaults
                    const emailUsers = allUsers.filter(u => u.email && !u.is_managed)
                    for (const u of emailUsers) {
                      const shouldReceive = u.id in emailRecipientOverrides ? emailRecipientOverrides[u.id] : u.email_recipient === true
                      if (shouldReceive !== (u.email_recipient === true)) {
                        await handleToggleEmailRecipient(u.id, shouldReceive)
                      }
                    }
                    setEmailRecipientOverrides({})
                    setMessage({ type: 'success', text: 'Default recipients saved.' })
                  }}
                  className="text-xs text-slate-500 hover:text-emerald-400 transition"
                >
                  Save as default
                </button>
              </div>

              <textarea
                value={customMessage}
                onChange={e => setCustomMessage(e.target.value)}
                placeholder="Add an optional message to include in the email..."
                rows={2}
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
                  const kickedOff = parseUTC(game.kickoff_time) < new Date()

                  return (
                    <div key={game.id} className="glass-card rounded-xl overflow-hidden">
                      <div className="flex items-center justify-between px-4 pt-3 pb-2">
                        <p className="text-xs text-slate-500">{formatKickoff(game.kickoff_time)}</p>
                        <div className="flex items-center gap-2">
                          {winner === 'TIE' ? (
                            <span className="text-xs font-semibold text-slate-300 bg-slate-500/10 border border-slate-500/20 px-2 py-0.5 rounded-full">
                              Tie
                            </span>
                          ) : winner ? (
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

                      <div className="grid grid-cols-2 gap-2 px-3 pb-1">
                        {[
                          { abbr: game.away_team, info: away, label: 'Away' },
                          { abbr: game.home_team, info: home, label: 'Home' },
                        ].map(({ abbr, info, label }) => {
                          const isWinner = winner === abbr
                          const isTie = winner === 'TIE'
                          return (
                            <button
                              key={abbr}
                              type="button"
                              onClick={() => handleSetResult(game, abbr)}
                              disabled={isSettingThis}
                              className={`flex items-center gap-3 py-3 px-4 rounded-lg border-2 transition text-left ${
                                isWinner
                                  ? 'border-emerald-500/60 bg-emerald-500/15 text-white glow-green'
                                  : isTie
                                  ? 'border-slate-500/30 bg-slate-500/10 text-slate-400'
                                  : winner && !isWinner
                                  ? 'border-white/[0.03] bg-white/[0.02] text-slate-600'
                                  : 'border-white/[0.06] bg-white/[0.02] text-slate-300 hover:border-blue-500/30 hover:bg-blue-500/5'
                              } disabled:cursor-wait`}
                            >
                              <img
                                src={info.logo} alt={abbr}
                                className={`w-8 h-8 object-contain flex-shrink-0 ${winner && !isWinner && !isTie ? 'opacity-30' : ''}`}
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
                      <div className="px-3 pb-3">
                        <button
                          type="button"
                          onClick={() => handleSetResult(game, 'TIE')}
                          disabled={isSettingThis}
                          className={`w-full py-2 rounded-lg border-2 text-xs font-semibold transition ${
                            winner === 'TIE'
                              ? 'border-slate-400/60 bg-slate-500/15 text-white'
                              : 'border-white/[0.06] bg-white/[0.02] text-slate-500 hover:border-slate-400/30 hover:bg-slate-500/5'
                          } disabled:cursor-wait`}
                        >
                          {winner === 'TIE' ? '✓ Tie' : 'Set as Tie'}
                        </button>
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
        {activeTab === 'override' && selectedWeek && (() => {
          const weekLockTime = computeLockTime(games)
          const weekLocked = weekLockTime ? new Date() >= weekLockTime : false
          return !weekLocked ? (
            <div className="glass-card rounded-xl p-8 text-center">
              <p className="text-3xl mb-3">🔒</p>
              <p className="text-white font-medium">Picks not yet locked</p>
              <p className="text-slate-500 text-sm mt-1.5">
                Override is available after picks lock{weekLockTime
                  ? ` on ${weekLockTime.toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: 'America/New_York' })}`
                  : ''}.
              </p>
            </div>
          ) : (
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
                    {/* Best picks counter */}
                    <div className="mb-3">
                      <p className={`text-xs font-medium ${overrideBestGames.size === 3 ? 'text-amber-400' : 'text-slate-500'}`}>
                        ⭐ {overrideBestGames.size}/3 best picks {savingOverride ? '— saving...' : overrideBestGames.size === 3 ? '— saved' : ''}
                      </p>
                    </div>

                    <div className="space-y-2 mb-5">
                      {games.map(game => {
                        const away = getTeam(game.away_team)
                        const home = getTeam(game.home_team)
                        const currentPick = overridePicks[game.id] ?? null
                        const isStarred = overrideBestGames.has(game.id)
                        const canStar = !!currentPick
                        const starDisabled = !canStar || (!isStarred && overrideBestGames.size >= 3)

                        return (
                          <div key={game.id} className={`glass-card rounded-xl overflow-hidden ${isStarred ? 'ring-1 ring-amber-500/30' : ''}`}>
                            <div className="flex items-center justify-between px-4 pt-3 pb-2">
                              <p className="text-xs text-slate-500">{formatKickoff(game.kickoff_time)}</p>
                              <div className="flex items-center gap-2">
                                {currentPick ? (
                                  <>
                                    <span className="text-xs font-semibold text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full">
                                      Picked: {currentPick}
                                    </span>
                                    <button
                                      onClick={() => {
                                        handleOverridePick(game.id, null)
                                        setOverrideBestGames(prev => { const next = new Set(prev); next.delete(game.id); return next })
                                      }}
                                      className="text-xs text-red-400 hover:text-red-600 transition"
                                      title="Clear pick"
                                    >
                                      ✕ Clear
                                    </button>
                                  </>
                                ) : (
                                  <span className="text-xs text-slate-500 bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded-full">
                                    No pick
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 px-3 pb-1">
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
                            {/* Star / Best Pick toggle */}
                            {currentPick && (
                              <div className="px-3 pb-3">
                                <button
                                  type="button"
                                  onClick={() => toggleBestGame(game.id)}
                                  disabled={starDisabled}
                                  className={`w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border text-xs font-medium transition ${
                                    isStarred
                                      ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                                      : starDisabled
                                      ? 'border-white/[0.04] text-slate-600 cursor-not-allowed'
                                      : 'border-white/[0.06] text-slate-400 hover:border-amber-500/30 hover:text-amber-400'
                                  }`}
                                >
                                  <span>{isStarred ? '⭐' : '☆'}</span>
                                  <span>{isStarred ? 'Best Pick' : 'Mark as Best Pick'}</span>
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </>
            )}
          </>
          )
        })()}

        {/* ── MANAGE PLAYERS TAB ── */}
        {activeTab === 'players' && (
          <>
            {playersLoading ? (
              <div className="glass-card rounded-xl p-8 text-center">
                <p className="text-slate-400 text-sm">Loading player data...</p>
              </div>
            ) : (
              <>
                {/* Create managed player */}
                <div className="glass-card rounded-xl p-4 mb-5">
                  <p className="text-sm font-semibold text-slate-200 mb-1">Create Managed Player</p>
                  <p className="text-xs text-slate-500 mb-3">
                    Add a player who doesn&apos;t need their own account. Someone else will pick for them.
                  </p>
                  <div className="mb-3">
                    <input
                      type="text"
                      value={newPlayerName}
                      onChange={e => setNewPlayerName(e.target.value)}
                      placeholder="Player name (e.g. Grandpa Joe)"
                      className="w-full px-3 py-2 text-sm bg-white/[0.04] border border-white/[0.08] rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    />
                  </div>
                  <p className="text-xs text-slate-500 mb-2">Assign manager(s):</p>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {allUsers.filter(u => !u.is_managed).map(u => {
                      const selected = newPlayerManagers.has(u.id)
                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => {
                            setNewPlayerManagers(prev => {
                              const next = new Set(prev)
                              if (next.has(u.id)) next.delete(u.id)
                              else next.add(u.id)
                              return next
                            })
                          }}
                          className={`press text-xs font-medium px-3 py-1.5 rounded-full border transition ${
                            selected
                              ? 'bg-blue-500/15 border-blue-500/30 text-blue-400'
                              : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:border-blue-500/30'
                          }`}
                        >
                          {selected ? '✓ ' : ''}{u.name}
                        </button>
                      )
                    })}
                  </div>
                  <button
                    onClick={handleCreateManagedPlayer}
                    disabled={creatingPlayer || !newPlayerName.trim() || newPlayerManagers.size === 0}
                    className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
                  >
                    {creatingPlayer ? 'Creating...' : 'Create Player'}
                  </button>
                </div>

                {/* User roles & access */}
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  User Roles &amp; Access
                </p>
                <p className="text-xs text-slate-600 mb-3">
                  Admins have full access. Assign pickers to let someone make picks on another user&apos;s behalf.
                </p>
                <div className="glass-card rounded-xl overflow-hidden mb-5">
                  {allUsers.filter(u => !u.is_managed).length === 0 ? (
                    <div className="p-6 text-center text-slate-500 text-sm">No users found.</div>
                  ) : (
                    allUsers.filter(u => !u.is_managed).map((u, idx) => {
                      const isSuperAdmin = u.email === ADMIN_EMAIL
                      return (
                        <div
                          key={u.id}
                          className={`px-4 py-3 ${idx > 0 ? 'border-t border-white/[0.04]' : ''}`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              {editingNameId === u.id ? (
                                <form onSubmit={e => { e.preventDefault(); handleRenameUser(u.id) }} className="flex items-center gap-2">
                                  <input
                                    autoFocus
                                    value={editingNameValue}
                                    onChange={e => setEditingNameValue(e.target.value)}
                                    className="text-sm font-medium text-white bg-white/[0.06] border border-white/[0.12] rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500/30 w-40"
                                  />
                                  <button type="submit" className="text-xs text-emerald-400 hover:text-emerald-300">Save</button>
                                  <button type="button" onClick={() => setEditingNameId(null)} className="text-xs text-slate-500 hover:text-slate-300">Cancel</button>
                                </form>
                              ) : (
                                <p className="text-sm font-medium text-white">
                                  {u.name}
                                  {isAdmin && (
                                    <button
                                      onClick={() => { setEditingNameId(u.id); setEditingNameValue(u.name) }}
                                      className="text-xs text-slate-500 hover:text-blue-400 transition ml-2"
                                    >
                                      Edit
                                    </button>
                                  )}
                                </p>
                              )}
                              <p className="text-xs text-slate-500">{u.email ?? 'No email'}</p>
                              {u.email && (
                                <p className="text-xs text-slate-600 mt-0.5">
                                  Last Active: {u.last_sign_in_at
                                    ? new Date(u.last_sign_in_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
                                    : 'Never'}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {/* Admin toggle */}
                              {isSuperAdmin ? (
                                <span className="text-xs font-medium px-3 py-1.5 rounded-full border bg-red-500/15 border-red-500/30 text-red-400">
                                  Owner
                                </span>
                              ) : (
                                <button
                                  onClick={() => handleToggleAdmin(u.id, !u.is_admin)}
                                  className={`press text-xs font-medium px-3 py-1.5 rounded-full border transition ${
                                    u.is_admin
                                      ? 'bg-red-500/15 border-red-500/30 text-red-400'
                                      : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:border-red-500/30'
                                  }`}
                                >
                                  {u.is_admin ? '✓ Admin' : 'Admin'}
                                </button>
                              )}
                              {/* Manager toggle */}
                              <button
                                onClick={() => handleToggleManager(u.id, !u.is_manager)}
                                className={`press text-xs font-medium px-3 py-1.5 rounded-full border transition ${
                                  u.is_manager
                                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                                    : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:border-blue-500/30'
                                }`}
                              >
                                {u.is_manager ? '✓ Manager' : 'Manager'}
                              </button>
                            </div>
                          </div>
                          {/* Reset password button */}
                          {u.email && (
                            <div className="mt-2">
                              <button
                                onClick={() => handleSendResetEmail(u.email!)}
                                disabled={sendingResetFor === u.email}
                                className="text-xs text-slate-500 hover:text-blue-400 transition disabled:opacity-50"
                              >
                                {sendingResetFor === u.email ? 'Sending...' : 'Send password reset email'}
                              </button>
                            </div>
                          )}
                          {/* Picker assignment — who can make picks for this user */}
                          {(() => {
                            const pickerLinks = managerLinks.filter(l => l.player_id === u.id)
                            const pickers = pickerLinks.map(l => allUsers.find(au => au.id === l.manager_id)).filter(Boolean) as FullUser[]
                            const availablePickers = allUsers.filter(au => !au.is_managed && au.id !== u.id && !pickerLinks.some(l => l.manager_id === au.id))
                            return (
                              <div className="mt-2 flex items-center gap-2 flex-wrap">
                                <span className="text-xs text-slate-600">Pickers:</span>
                                {pickers.map(p => (
                                  <span key={p.id} className="inline-flex items-center gap-1 text-xs bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2 py-1 rounded-full font-medium">
                                    {p.name}
                                    <button
                                      onClick={() => handleRemoveManager(u.id, p.id)}
                                      className="text-blue-400/60 hover:text-red-400 transition ml-0.5"
                                      title={`Remove ${p.name} as picker`}
                                    >
                                      &times;
                                    </button>
                                  </span>
                                ))}
                                {pickers.length === 0 && (
                                  <span className="text-xs text-slate-600 italic">Self only</span>
                                )}
                                {availablePickers.length > 0 && (
                                  <select
                                    value=""
                                    onChange={e => { if (e.target.value) handleAddManager(u.id, e.target.value) }}
                                    className="text-xs bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                                  >
                                    <option value="">+ Add picker</option>
                                    {availablePickers.map(au => (
                                      <option key={au.id} value={au.id}>{au.name}</option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            )
                          })()}
                        </div>
                      )
                    })
                  )}
                </div>

                {/* Managed players list */}
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  Managed Players ({managedPlayers.length})
                </p>
                {managedPlayers.length === 0 ? (
                  <div className="glass-card rounded-xl p-8 text-center">
                    <p className="text-3xl mb-2">👥</p>
                    <p className="text-slate-400 text-sm">No managed players yet. Create one above.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {managedPlayers.map(player => {
                      const links = managerLinks.filter(l => l.player_id === player.id)
                      const managers = links.map(l => allUsers.find(u => u.id === l.manager_id)).filter(Boolean) as FullUser[]
                      const availableManagers = allUsers.filter(u => !u.is_managed && !links.some(l => l.manager_id === u.id))

                      return (
                        <div key={player.id} className="glass-card rounded-xl p-4">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <span className="text-xs bg-indigo-500/15 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded-full font-medium shrink-0">
                                Managed
                              </span>
                              {editingNameId === player.id ? (
                                <form onSubmit={e => { e.preventDefault(); handleRenameUser(player.id) }} className="flex items-center gap-2">
                                  <input
                                    autoFocus
                                    value={editingNameValue}
                                    onChange={e => setEditingNameValue(e.target.value)}
                                    className="text-sm font-semibold text-white bg-white/[0.06] border border-white/[0.12] rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500/30 w-40"
                                  />
                                  <button type="submit" className="text-xs text-emerald-400 hover:text-emerald-300">Save</button>
                                  <button type="button" onClick={() => setEditingNameId(null)} className="text-xs text-slate-500 hover:text-slate-300">Cancel</button>
                                </form>
                              ) : (
                                <p className="text-sm font-semibold text-white">
                                  {player.name}
                                  <button
                                    onClick={() => { setEditingNameId(player.id); setEditingNameValue(player.name) }}
                                    className="text-xs text-slate-500 hover:text-blue-400 transition ml-2 font-medium"
                                  >
                                    Edit
                                  </button>
                                </p>
                              )}
                            </div>
                            <button
                              onClick={() => handleDeleteManagedPlayer(player.id, player.name)}
                              className="text-xs text-red-400 hover:text-red-300 transition px-2 py-1 shrink-0"
                            >
                              Delete
                            </button>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-slate-500">Managed by:</span>
                            {managers.map(m => (
                              <span key={m.id} className="inline-flex items-center gap-1 text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-1 rounded-full font-medium">
                                {m.name}
                                <button
                                  onClick={() => handleRemoveManager(player.id, m.id)}
                                  className="text-emerald-400/60 hover:text-red-400 transition ml-0.5"
                                  title={`Remove ${m.name} as manager`}
                                >
                                  &times;
                                </button>
                              </span>
                            ))}
                            {managers.length === 0 && (
                              <span className="text-xs text-amber-400">No managers assigned</span>
                            )}
                            {availableManagers.length > 0 && (
                              <select
                                value=""
                                onChange={e => { if (e.target.value) handleAddManager(player.id, e.target.value) }}
                                className="text-xs bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                              >
                                <option value="">+ Add manager</option>
                                {availableManagers.map(u => (
                                  <option key={u.id} value={u.id}>{u.name}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {activeTab !== 'players' && availableWeeks.length === 0 && !dataLoading && (
          <div className="glass-card rounded-xl p-10 text-center">
            <p className="text-slate-500 text-sm">No games found. Add games to the database first.</p>
          </div>
        )}
      </main>
    </div>
  )
}
