import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useSeason } from '@/lib/season'
import { MAX_BEST_PICKS } from '@/lib/constants'
import { getTeam } from '@/lib/nflTeams'
import { parseUTC, computeLockTime, formatKickoff } from '@/lib/lockTime'
import { graceExpiry, formatGraceRemaining, GRACE_PERIOD_MINUTES } from '@/lib/pickGrace'
import Nav, { type PickStatus } from '@/components/Nav'
import WeekNavigator from '@/components/WeekNavigator'

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
  winning_team?: string | null
  away_score?: number | null
  home_score?: number | null
}

interface UserPick {
  [gameId: string]: string
}

/** 1d 04:47:51 under a day becomes 04:47:51 — compact enough for one line on any phone. */
function formatCountdown(ms: number): string {
  const days = Math.floor(ms / 86_400_000)
  const hours = Math.floor((ms / 3_600_000) % 24)
  const minutes = Math.floor((ms / 60_000) % 60)
  const seconds = Math.floor((ms / 1000) % 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${days > 0 ? `${days}d ` : ''}${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

/** Proof a tap reached the database — 'selected' and 'saved' look identical otherwise. */
function SaveIndicator({ state }: { state: 'idle' | 'saving' | 'saved' }) {
  if (state === 'saving') return <span className="text-slate-500">Saving…</span>
  if (state === 'saved') {
    return (
      <span className="flex items-center gap-1 text-emerald-400 animate-fade-in">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        Saved
      </span>
    )
  }
  return null
}

// Skeleton loading component
function PicksSkeleton() {
  return (
    <div className="min-h-screen bg-surface">
      <div className="sticky top-0 z-10 border-b border-white/[0.06] bg-surface/80 backdrop-blur-xl safe-top">
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
  const { season } = useSeason()
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
  const [availableWeeks, setAvailableWeeks] = useState<number[]>([])
  const [justPicked, setJustPicked] = useState<string | null>(null) // gameId:team key for animation
  // Admin-granted extension for THIS player and week, if any.
  const [graceUntil, setGraceUntil] = useState<Date | null>(null)
  // Write feedback. Picks save on click, so the only thing missing was proof
  // it reached the database — 'selected' and 'saved' looked identical before.
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const savedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pickAnimTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The status card, watched so a slim copy can pin under the header once it
  // scrolls out of view. State rather than a ref: the card mounts after load.
  const [statusEl, setStatusEl] = useState<HTMLDivElement | null>(null)
  const [statusOffscreen, setStatusOffscreen] = useState(false)

  useEffect(() => {
    if (!statusEl || typeof IntersectionObserver === 'undefined') { setStatusOffscreen(false); return }
    const headerH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 0
    const io = new IntersectionObserver(
      ([entry]) => {
        // Only once it's gone off the *top* — not while it's below the fold.
        setStatusOffscreen(!entry.isIntersecting && entry.boundingClientRect.top < headerH)
      },
      { rootMargin: `-${headerH}px 0px 0px 0px` },
    )
    io.observe(statusEl)
    return () => io.disconnect()
  }, [statusEl])

  // Tick every second for live countdown — paused when tab hidden to save battery
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (interval) return
      setNow(new Date())
      interval = setInterval(() => setNow(new Date()), 1_000)
    }
    const stop = () => {
      if (interval) { clearInterval(interval); interval = null }
    }
    const handleVisibility = () => {
      if (document.hidden) stop()
      else start()
    }
    start()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
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

  // Detect current week and available weeks
  useEffect(() => {
    const detectWeek = async () => {
      if (!user) return
      const { data } = await supabase
        .from('games').select('week')
        .eq('season', season)
        .order('week')
      if (data && data.length > 0) {
        const weeks = [...new Set(data.map(g => g.week))].sort((a, b) => a - b)
        setAvailableWeeks(weeks)
        setCurrentWeek(weeks[weeks.length - 1])
      } else {
        setDataLoading(false)
      }
    }
    detectWeek()
  }, [user, season])

  // The effective user ID for picks: self or managed player
  const effectiveUserId = activePlayerId ?? user?.id

  const refreshGrace = useCallback(async (userId: string, week: number) => {
    const { data } = await supabase
      .from('pick_grace').select('expires_at')
      .eq('user_id', userId).eq('week', week).eq('season', season)
      .maybeSingle()
    setGraceUntil(graceExpiry(data))
  }, [season])

  const loadPicksForUser = useCallback(async (userId: string, week: number) => {
    try {
      const { data: picksData } = await supabase
        .from('picks').select('*')
        .eq('user_id', userId).eq('week', week).eq('season', season)

      const picksMap: UserPick = {}
      picksData?.forEach(p => { picksMap[p.game_id] = p.picked_team })
      setPicks(picksMap)

      await refreshGrace(userId, week)

      const { data: threeBestData } = await supabase
        .from('three_best').select('*')
        .eq('user_id', userId).eq('week', week).eq('season', season)
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
  }, [refreshGrace, season])

  useEffect(() => {
    const fetchData = async () => {
      if (!user || currentWeek === null) return
      try {
        const { data: gamesData } = await supabase
          .from('games').select('*')
          .eq('week', currentWeek).eq('season', season)
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
  }, [user, currentWeek, effectiveUserId, loadPicksForUser, season])

  const lockTime = computeLockTime(games)
  const weekLocked = lockTime ? now >= lockTime : false
  // An admin can reopen one player's picks after the week locks. `now` ticks
  // every second, so the window closes on its own without a refresh.
  const graceActive = !!graceUntil && now < graceUntil
  const isLocked = weekLocked && !graceActive

  // Watch for an admin opening a window while this page is already sitting on
  // the locked screen. Only polls when locked and not already in a window, so
  // it stops the moment either changes.
  useEffect(() => {
    if (!weekLocked || graceActive || !effectiveUserId || currentWeek === null) return
    const id = setInterval(() => { refreshGrace(effectiveUserId, currentWeek) }, 15_000)
    return () => clearInterval(id)
  }, [weekLocked, graceActive, effectiveUserId, currentWeek, refreshGrace])

  const getToken = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? ''
  }

  // Flash "Saved" briefly after a successful write, and clear any pending
  // flash first so rapid picking doesn't leave a stale timer running.
  const markSaved = () => {
    if (savedTimeout.current) clearTimeout(savedTimeout.current)
    setSaveState('saved')
    savedTimeout.current = setTimeout(() => setSaveState('idle'), 1800)
  }

  useEffect(() => () => { if (savedTimeout.current) clearTimeout(savedTimeout.current) }, [])

  // Save a single game pick to the DB immediately
  const savePick = async (gameId: string, team: string) => {
    if (!user || currentWeek === null) return
    setSaveState('saving')
    try {
      if (activePlayerId) {
        const token = await getToken()
        const res = await fetch('/api/proxy-picks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ playerId: activePlayerId, week: currentWeek, season: season, gameId, pickedTeam: team }),
        })
        if (!res.ok) { const json = await res.json(); throw new Error(json.error ?? 'Failed') }
      } else {
        const { error } = await supabase.from('picks').upsert({
          user_id: user.id, game_id: gameId, picked_team: team, week: currentWeek, season: season,
        }, { onConflict: 'user_id,game_id' })
        if (error) throw error
      }
      markSaved()
    } catch (err) {
      setSaveState('idle')
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
      setError('Best picks must be different teams')
      return
    }
    const threeBest = { pick_1: bestTeams[0] ?? '', pick_2: bestTeams[1] ?? '', pick_3: bestTeams[2] ?? '' }
    try {
      if (activePlayerId) {
        const token = await getToken()
        const res = await fetch('/api/proxy-picks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ playerId: activePlayerId, week: currentWeek, season: season, threeBest }),
        })
        if (!res.ok) { const json = await res.json(); throw new Error(json.error ?? 'Failed') }
      } else {
        const { error } = await supabase.from('three_best').upsert({
          user_id: user.id, week: currentWeek, season: season, ...threeBest,
        }, { onConflict: 'user_id,week,season' })
        if (error) throw error
      }
      markSaved()
    } catch (err) {
      setSaveState('idle')
      setError(err instanceof Error ? err.message : 'Failed to save best picks')
    }
  }

  const handlePickChange = (gameId: string, team: string) => {
    if (isLocked) return
    // Trigger pick animation
    if (pickAnimTimeout.current) clearTimeout(pickAnimTimeout.current)
    setJustPicked(`${gameId}:${team}`)
    pickAnimTimeout.current = setTimeout(() => setJustPicked(null), 400)

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
  const allDone = totalGames > 0 && pickedCount >= totalGames && bestPicks.size >= MAX_BEST_PICKS
  const activePlayer = managedPlayers.find(p => p.id === activePlayerId) ?? null
  // The badge in the nav is about *your* card. While picking for someone you
  // manage, leave it to Nav to work out your own rather than showing theirs.
  const navStatus: PickStatus | undefined = activePlayerId
    ? undefined
    : !isLocked && totalGames > 0
      ? { unpicked: Math.max(0, totalGames - pickedCount), bestNeeded: bestPicks.size < MAX_BEST_PICKS }
      : { unpicked: 0, bestNeeded: false }

  // During an admin-granted extension the clock that matters is the grace
  // window, not the (already passed) weekly lock.
  const deadline = graceActive ? graceUntil : lockTime
  const msLeft = deadline ? Math.max(0, deadline.getTime() - now.getTime()) : 0
  const urgent = msLeft < 2 * 60 * 60 * 1000          // under 2 hours
  const closeToLock = msLeft < 24 * 60 * 60 * 1000    // under a day
  const countdown = formatCountdown(msLeft)
  const showMiniStatus = statusOffscreen && !isLocked && totalGames > 0 && !!deadline

  return (
    <div className="min-h-screen bg-surface pb-page">
      <Nav pickStatus={navStatus} containerClassName="max-w-3xl lg:max-w-5xl" />

      <main className="max-w-3xl lg:max-w-5xl mx-auto px-4 pt-6 animate-fade-in">
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

        {/* Week navigator */}
        <WeekNavigator
          selectedWeek={currentWeek}
          onWeekChange={(week) => { setCurrentWeek(week); setDataLoading(true) }}
          availableWeeks={availableWeeks}
        />

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

        {/* Grace period banner — the week is locked, but this player was given
            extra time, so show the clock they are actually racing. */}
        {graceActive && graceUntil && (
          <div className="mb-5 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-start gap-3 animate-slide-up">
            <span className="text-xl">⏳</span>
            <div className="flex-1">
              <p className="font-semibold text-emerald-400 text-sm">
                Extra time to submit &mdash; {formatGraceRemaining(graceUntil, now)} left
              </p>
              <p className="text-emerald-400/70 text-xs mt-0.5">
                Picks for this week already locked, but an admin reopened yours. Get them in before the timer runs out.
              </p>
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
                {graceUntil
                  ? `Your extra ${GRACE_PERIOD_MINUTES} minutes ran out. Ask Michael to reopen them if you still need to submit.`
                  : `The deadline of ${lockTime ? formatKickoff(lockTime.toISOString()) : ''} has passed.`}
              </p>
            </div>
          </div>
        )}

        {/* Status — deadline, progress and what's left, in one card. This used
            to be a countdown card, a progress bar and two warning banners
            stacked up, which pushed the first game below the fold on a phone
            and said "14 unpicked" three different ways. */}
        {!isLocked && totalGames > 0 && deadline && (
          <div
            ref={setStatusEl}
            className={`mb-5 glass-card rounded-2xl p-4 transition-colors ${
              allDone ? 'border-emerald-500/30' : urgent ? 'border-red-500/30' : ''
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className={`flex items-center gap-1.5 text-xs ${urgent ? 'text-red-400' : 'text-amber-400'}`}>
                <span className="animate-pulse-glow">{urgent ? '🚨' : '⏰'}</span>
                <span>{graceActive ? 'Extra time ends' : 'Locks'} {formatKickoff(deadline.toISOString())}</span>
              </span>
              <span
                className={`font-mono font-bold text-sm tabular-nums ${urgent ? 'text-red-400' : 'text-amber-400'}`}
                aria-label="Time until lock"
              >
                {countdown}
              </span>
            </div>

            <div className="w-full bg-white/[0.06] rounded-full h-2 overflow-hidden mt-3">
              <div
                className={`h-2 rounded-full transition-all duration-500 ease-out ${allDone ? 'bg-emerald-500' : 'progress-gradient'}`}
                style={{ width: `${(pickedCount / totalGames) * 100}%` }}
              />
            </div>

            <div className="flex justify-between items-center text-xs text-slate-400 mt-2">
              <span className="flex items-center gap-2">
                {allDone
                  ? <span className="text-emerald-400 font-medium">✓ All {totalGames} picked</span>
                  : <span>{pickedCount} of {totalGames} picked</span>}
                <SaveIndicator state={saveState} />
              </span>
              <span className={bestPicks.size === MAX_BEST_PICKS ? 'text-amber-400 font-medium' : ''}>
                ⭐ {bestPicks.size}/{MAX_BEST_PICKS} Best
              </span>
            </div>

            {/* Best 3 is a rule worth knowing, but in red from the first visit
                it read as an error before you'd done anything. It speaks up
                once your games are in, or when the clock is getting short. */}
            {bestPicks.size < MAX_BEST_PICKS && (pickedCount === totalGames || closeToLock) && (
              <p className="mt-3 text-[11px] text-red-400 leading-snug">
                ⭐ Star {MAX_BEST_PICKS - bestPicks.size} more Best {MAX_BEST_PICKS - bestPicks.size === 1 ? 'Pick' : 'Picks'} —
                any left empty at lock counts as a <strong>loss</strong> on your Best 3 record.
              </p>
            )}
            {urgent && pickedCount < totalGames && (
              <p className="mt-2 text-[11px] text-red-400 leading-snug">
                {totalGames - pickedCount} {totalGames - pickedCount === 1 ? 'game is' : 'games are'} still unpicked —
                anything empty at lock counts as a loss.
              </p>
            )}
          </div>
        )}

        {/* Pinned mini version once the card above scrolls away, so by game 10
            you still know how many are left and how long you've got. */}
        {showMiniStatus && (
          <div
            className="fixed left-0 right-0 z-20 border-b border-white/[0.06] bg-surface/90 backdrop-blur-xl animate-fade-in safe-x"
            style={{ top: 'var(--header-h, 0px)' }}
          >
            <div className="max-w-3xl lg:max-w-5xl mx-auto px-4 py-2">
              <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5">
                <span className="flex items-center gap-2">
                  {allDone
                    ? <span className="text-emerald-400 font-medium">✓ All set</span>
                    : <span><span className="text-white font-semibold">{pickedCount}</span>/{totalGames} picked</span>}
                  <span className={bestPicks.size === MAX_BEST_PICKS ? 'text-amber-400' : ''}>⭐ {bestPicks.size}/{MAX_BEST_PICKS}</span>
                  <SaveIndicator state={saveState} />
                </span>
                <span className={`font-mono tabular-nums ${urgent ? 'text-red-400' : 'text-amber-400'}`}>⏰ {countdown}</span>
              </div>
              <div className="w-full bg-white/[0.06] rounded-full h-1 overflow-hidden">
                <div
                  className={`h-1 rounded-full transition-all duration-500 ${allDone ? 'bg-emerald-500' : 'progress-gradient'}`}
                  style={{ width: `${(pickedCount / totalGames) * 100}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm animate-slide-up">{error}</div>
        )}

        <div>
          <div className="mb-6">
            {/* Week record summary (when any games decided) */}
            {isLocked && games.some(g => g.winning_team) && (() => {
              const decided = games.filter(g => g.winning_team)
              let w = 0, l = 0, t = 0
              decided.forEach(g => {
                const isTie = g.winning_team === 'TIE'
                const p = picks[g.id]
                if (!p) { if (isTie) t++; else l++; }
                else if (isTie) t++
                else if (p === g.winning_team) w++
                else l++
              })
              const total = decided.length
              const allDecided = total === games.length
              return (
                <div className="glass-card rounded-2xl p-4 mb-4 animate-slide-up">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        {allDecided ? 'Final Record' : `Results (${total}/${games.length} games)`}
                      </p>
                      <p className="text-xl font-bold">
                        <span className="text-emerald-400">{w}</span>
                        <span className="text-slate-500 mx-1">&ndash;</span>
                        <span className="text-red-400">{l}</span>
                        {t > 0 && <><span className="text-slate-500 mx-1">&ndash;</span><span className="text-slate-400">{t}</span></>}
                      </p>
                    </div>
                    {allDecided && w > 0 && l === 0 && t === 0 && (
                      <span className="text-2xl">🏆</span>
                    )}
                  </div>
                </div>
              )
            })()}

            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
              Week {currentWeek} Games
            </h2>

            {games.length === 0 ? (
              <div className="glass-card rounded-2xl p-10 text-center">
                <p className="text-3xl mb-3">📅</p>
                <p className="text-slate-400 text-sm">No games available yet. Check back soon!</p>
              </div>
            ) : (
              // Two columns on a wide screen: one long column of 16 cards was
              // most of the scrolling, with the sides of the page empty.
              <div className="grid gap-3 lg:grid-cols-2">
                {games.map((game, gameIdx) => {
                  const away = getTeam(game.away_team)
                  const home = getTeam(game.home_team)
                  const pickedTeam = picks[game.id]
                  const isStarred = bestPicks.has(game.id)
                  const canStar = !!pickedTeam && !isLocked
                  const starDisabled = !canStar || (!isStarred && bestPicks.size >= MAX_BEST_PICKS)

                  // Post-lock result info
                  const decided = !!game.winning_team
                  const isTie = game.winning_team === 'TIE'
                  const pickedCorrectly = decided && pickedTeam ? (isTie ? null : pickedTeam === game.winning_team) : null
                  const hasScore = game.away_score != null && game.home_score != null

                  // Card border color based on result
                  const resultRing = decided && pickedTeam
                    ? pickedCorrectly === true ? 'ring-1 ring-emerald-500/40' : pickedCorrectly === false ? 'ring-1 ring-red-500/30' : 'ring-1 ring-slate-400/20'
                    : decided && !pickedTeam ? 'ring-1 ring-red-500/20' : ''

                  // Pick result styling helper
                  const getTeamBtnClass = (team: string) => {
                    const isPicked = pickedTeam === team
                    const isWinner = decided && game.winning_team === team
                    const animClass = justPicked === `${game.id}:${team}` ? 'animate-pick-pop' : ''
                    // Post-lock decided game
                    if (decided && isLocked) {
                      if (isPicked && pickedCorrectly === true) return `${animClass} border-emerald-500/50 bg-emerald-500/10 text-white`
                      if (isPicked && pickedCorrectly === false) return `${animClass} border-red-500/40 bg-red-500/10 text-white`
                      if (isPicked && isTie) return `${animClass} border-slate-400/30 bg-slate-500/10 text-slate-300`
                      if (isWinner) return `${animClass} border-white/[0.08] bg-white/[0.03] text-slate-400 cursor-default`
                      return `${animClass} border-white/[0.03] bg-white/[0.02] text-slate-500 cursor-default`
                    }
                    // Locked but not decided
                    if (isLocked) {
                      return `${animClass} ${isPicked ? 'border-blue-500/60 bg-blue-500/15 text-white glow-blue' : 'border-white/[0.03] bg-white/[0.02] text-slate-500 cursor-default'}`
                    }
                    // Not locked
                    return `${animClass} ${isPicked ? 'border-blue-500/60 bg-blue-500/15 text-white glow-blue' : 'border-white/[0.06] bg-white/[0.02] text-slate-300 hover:border-blue-500/30 hover:bg-blue-500/5'}`
                  }

                  // Result indicator icon for picked team
                  const getResultIcon = (team: string) => {
                    if (!decided || !isLocked || pickedTeam !== team) {
                      if (pickedTeam === team) return <span className={`ml-auto text-blue-400 text-sm ${justPicked === `${game.id}:${team}` ? 'animate-check-in' : ''}`}>✓</span>
                      return null
                    }
                    if (isTie) return <span className="ml-auto text-slate-400 text-sm font-bold">=</span>
                    if (pickedCorrectly === true) return <span className="ml-auto text-emerald-400 text-sm font-bold">✓</span>
                    if (pickedCorrectly === false) return <span className="ml-auto text-red-400 text-sm font-bold">✗</span>
                    return null
                  }

                  return (
                    <div
                      key={game.id}
                      className={`glass-card rounded-2xl overflow-hidden transition-all duration-300 animate-slide-up ${
                        isStarred && !decided ? 'ring-1 ring-amber-500/30' : resultRing
                      } ${isLocked && !decided ? 'opacity-80' : ''}`}
                      style={{ animationDelay: `${gameIdx * 30}ms` }}
                    >
                      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="text-xs text-slate-500">{formatKickoff(game.kickoff_time)}</p>
                          {/* Score badge when game is decided */}
                          {decided && hasScore && (
                            <span className="text-[11px] font-mono font-bold text-slate-300 bg-white/[0.06] px-1.5 py-0.5 rounded">
                              {game.away_score}&ndash;{game.home_score}
                              {isTie && <span className="text-slate-500 ml-1 font-sans text-[10px]">TIE</span>}
                            </span>
                          )}
                        </div>
                        {!isLocked && (
                          <button
                            type="button"
                            onClick={() => toggleBestPick(game.id)}
                            disabled={starDisabled}
                            title={!canStar ? 'Pick a team first' : isStarred ? 'Remove best pick' : bestPicks.size >= MAX_BEST_PICKS ? 'Already selected 3' : 'Mark as best pick'}
                            className={`press shrink-0 whitespace-nowrap flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-all font-medium ${
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

                      {/* minmax(0,1fr), not 1fr: a plain 1fr column won't shrink below
                          its content, so a long name ("Commanders") pushed the
                          home button out past the card's right edge on a phone.
                          Under 380px (iPhone SE) the logos drop out too — at
                          that width they left room for about four letters. */}
                      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-0 px-3 pb-3 items-center">
                        {/* Away team */}
                        <button
                          type="button"
                          onClick={() => handlePickChange(game.id, game.away_team)}
                          disabled={isLocked}
                          className={`press min-w-0 flex items-center gap-2.5 sm:gap-3 py-3 px-3 sm:px-4 rounded-xl border-2 transition-all text-left ${getTeamBtnClass(game.away_team)}`}
                        >
                          <img
                            src={away.logo} alt={game.away_team}
                            loading="lazy" decoding="async"
                            className={`max-[379px]:hidden w-8 h-8 sm:w-10 sm:h-10 object-contain flex-shrink-0 transition-all duration-300 ${
                              pickedTeam === game.away_team ? 'scale-110' : ''
                            } ${isLocked && pickedTeam !== game.away_team && !decided ? 'opacity-30' : ''}`}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                          <div className="min-w-0">
                            <p className="text-[11px] opacity-50 leading-tight truncate">{away.city}</p>
                            <p className="font-semibold text-sm leading-tight truncate">{away.name}</p>
                            <p className={`text-[11px] mt-0.5 ${pickedTeam === game.away_team ? 'text-blue-300/70' : 'text-slate-500'}`}>Away</p>
                          </div>
                          {getResultIcon(game.away_team)}
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
                          className={`press min-w-0 flex items-center gap-2.5 sm:gap-3 py-3 px-3 sm:px-4 rounded-xl border-2 transition-all text-left ${getTeamBtnClass(game.home_team)}`}
                        >
                          <img
                            src={home.logo} alt={game.home_team}
                            loading="lazy" decoding="async"
                            className={`max-[379px]:hidden w-8 h-8 sm:w-10 sm:h-10 object-contain flex-shrink-0 transition-all duration-300 ${
                              pickedTeam === game.home_team ? 'scale-110' : ''
                            } ${isLocked && pickedTeam !== game.home_team && !decided ? 'opacity-30' : ''}`}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                          <div className="min-w-0">
                            <p className="text-[11px] opacity-50 leading-tight truncate">{home.city}</p>
                            <p className="font-semibold text-sm leading-tight truncate">{home.name}</p>
                            <p className={`text-[11px] mt-0.5 ${pickedTeam === game.home_team ? 'text-blue-300/70' : 'text-slate-500'}`}>Home</p>
                          </div>
                          {getResultIcon(game.home_team)}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Done — the moment you finish, at the spot you finish it. */}
          {allDone && !isLocked && (
            <div className="mb-5 p-4 bg-emerald-500/10 border border-emerald-500/25 rounded-2xl animate-slide-up">
              <p className="text-sm font-semibold text-emerald-400">
                ✓ All set for Week {currentWeek}{activePlayer ? ` — ${activePlayer.name}` : ''}
              </p>
              <p className="text-xs text-emerald-400/70 mt-0.5">
                Every pick is saved. You can still change anything until {deadline ? formatKickoff(deadline.toISOString()) : 'lock'}.
              </p>
              <div className="flex gap-2 mt-3">
                <Link href="/talk" className="press flex-1 text-center text-xs font-semibold text-white bg-white/[0.08] hover:bg-white/[0.12] rounded-xl py-2.5 transition">
                  💩 Talk
                </Link>
                <Link href="/standings" className="press flex-1 text-center text-xs font-semibold text-white bg-white/[0.08] hover:bg-white/[0.12] rounded-xl py-2.5 transition">
                  🏆 Standings
                </Link>
              </div>
            </div>
          )}

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
                      <img src={t.logo} alt={team} loading="lazy" decoding="async" className="w-5 h-5 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
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
