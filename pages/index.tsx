import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useSeason } from '@/lib/season'
import { MAX_BEST_PICKS, ADMIN_EMAIL } from '@/lib/constants'
import { computeLockTime, formatKickoff, parseUTC } from '@/lib/lockTime'
import { assignRanks, computeRecords, recordSort, type UserRecord } from '@/lib/computeStandings'
import { fetchAllRows } from '@/lib/fetchAll'
import { shortName } from '@/lib/displayName'
import { getTeam } from '@/lib/nflTeams'
import { mergeChampions, type Champion } from '@/lib/champions'
import { useTalkUnread } from '@/lib/useTalkUnread'
import Nav from '@/components/Nav'
import SaveSeasonButton from '@/components/SaveSeasonButton'

/*
 * Home is the one screen that should answer "what's going on?" without a tap:
 * where this week stands (your picks, then everyone's), where you stand, what
 * the family is saying, and a way into every other page.
 *
 * Nearly all of it comes from the one season-wide load below — the same
 * picks, games and Best 3 rows Home already needed for your record — so the
 * extra sections cost no extra round trips. The three that do need something
 * else (who's in before lock, the latest Talk message, the admin to-do list)
 * load separately and fill in when ready, so they never hold the page up.
 */

interface SeasonPick {
  user_id: string
  game_id: string
  picked_team: string
  week: number
}

interface WeekGame {
  id: string
  week: number
  away_team: string
  home_team: string
  kickoff_time: string
  winning_team: string | null
  away_score: number | null
  home_score: number | null
}

interface ManagedPlayerSummary {
  id: string
  name: string
  avatar_url?: string | null
  pickedCount: number
  totalGames: number
  bestPickCount: number
  complete: boolean
}

interface StandingRow {
  userId: string
  name: string
  avatar_url: string | null
  rank: number
  isTied: boolean
  wins: number
  losses: number
  ties: number
  /** Places gained (+) or lost (−) with the latest finished week; null before there are two. */
  rankChange: number | null
  isYou: boolean
}

interface SplitRow {
  game: WeekGame
  awayCount: number
  homeCount: number
  myPick: string | null
}

interface DashboardData {
  users: { id: string; name: string; avatar_url: string | null }[]
  // Your season
  record: UserRecord
  rank: number
  isTied: boolean
  rankChange: number | null
  totalPlayers: number
  // This week (the newest loaded week)
  currentWeek: number | null
  weekGames: WeekGame[]
  myWeekPicks: Record<string, string>
  myBestTeams: string[]
  lockTime: Date | null
  /** Whether the week was locked when this data loaded — before that, RLS only returned your own picks. */
  lockedAtLoad: boolean
  weekRank: number | null
  weekPlayers: number
  // The finished week before this one
  prevWeek: number | null
  prevWeekRank: number | null
  // Everyone
  standings: StandingRow[]
  splits: SplitRow[]
  /** Newest week with every game decided — the one a recap is about. */
  recapWeek: number | null
  latestChampion: Champion | null
  managedPlayers: ManagedPlayerSummary[]
}

interface WhoIsIn {
  week: number
  totalGames: number
  players: { id: string; name: string; pickCount: number; bestCount: number; complete: boolean }[]
}

interface TalkLatest {
  author_name: string
  user_id: string | null
  body: string | null
  image_url: string | null
  recap_week?: number | null
  created_at: string
}

interface AdminTodo {
  recapWeek: number | null
  recapPosted: boolean
}

// ── helpers ─────────────────────────────────────────────────────────────────

const recordText = (w: number, l: number, t: number) => `${w}–${l}${t > 0 ? `–${t}` : ''}`

const placeText = (rank: number, tied: boolean) => `${tied ? 'T-' : '#'}${rank}`

const medal = (rank: number) => ['🥇', '🥈', '🥉'][rank - 1] ?? null

/** Ties share the better place: one more than the number who did strictly better. */
function weekRankOf(records: Map<string, UserRecord>, userIds: string[], week: number, me: string): number | null {
  const rows = userIds
    .map(uid => ({ uid, wr: records.get(uid)?.weekRecords.get(week) }))
    .filter(x => !!x.wr) as { uid: string; wr: { wins: number; losses: number } }[]
  const mine = rows.find(r => r.uid === me)
  if (!mine) return null
  return 1 + rows.filter(r => r.wr.wins > mine.wr.wins || (r.wr.wins === mine.wr.wins && r.wr.losses < mine.wr.losses)).length
}

function formatCountdown(ms: number): string {
  const days = Math.floor(ms / 86_400_000)
  const hours = Math.floor((ms / 3_600_000) % 24)
  const minutes = Math.floor((ms / 60_000) % 60)
  const seconds = Math.floor((ms / 1000) % 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${days > 0 ? `${days}d ` : ''}${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

function timeAgo(iso: string, now: Date): string {
  const s = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86_400)}d ago`
}

function Avatar({ name, url, size = 28, you = false }: { name: string; url?: string | null; size?: number; you?: boolean }) {
  if (url) {
    return (
      <img
        src={url} alt="" loading="lazy" decoding="async"
        className="rounded-full object-cover border border-white/[0.08] shrink-0"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className={`rounded-full flex items-center justify-center font-bold border border-white/[0.08] shrink-0 ${
        you ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white' : 'bg-gradient-to-br from-slate-600 to-slate-700 text-slate-300'
      }`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

function SectionHeader({ title, href, linkText }: { title: string; href?: string; linkText?: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{title}</p>
      {href && (
        <Link href={href} className="text-[11px] font-semibold text-blue-400 hover:text-blue-300 transition">
          {linkText} →
        </Link>
      )}
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-surface pb-page">
      <Nav containerClassName="max-w-3xl lg:max-w-6xl" />
      <main className="max-w-3xl lg:max-w-6xl mx-auto px-4 py-6">
        <div className="skeleton h-6 w-48 rounded mb-6" />
        <div className="lg:grid lg:grid-cols-2 lg:gap-6">
          <div>
            <div className="skeleton h-56 rounded-2xl mb-5" />
            <div className="skeleton h-40 rounded-2xl mb-5" />
          </div>
          <div>
            <div className="skeleton h-48 rounded-2xl mb-5" />
            <div className="skeleton h-28 rounded-2xl mb-5" />
          </div>
        </div>
      </main>
    </div>
  )
}

// ── page ────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter()
  const { user, loading, configError } = useAuth()
  const { season } = useSeason()
  const [data, setData] = useState<DashboardData | null>(null)
  const [dataLoading, setDataLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [now, setNow] = useState(new Date())
  // Bumped to reload when the week locks while Home is open: other people's
  // picks only become readable at lock, so the "everyone's picks" view needs
  // a fresh load to have anything to show.
  const [reloadKey, setReloadKey] = useState(0)
  const [whoIsIn, setWhoIsIn] = useState<WhoIsIn | null>(null)
  const [talkLatest, setTalkLatest] = useState<TalkLatest | null>(null)
  const [adminTodo, setAdminTodo] = useState<AdminTodo | null>(null)

  const isAdmin = !!user && (user.email === ADMIN_EMAIL || user.is_admin === true)
  const isManager = user?.is_manager === true
  const unreadTalk = useTalkUnread(user?.id)

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

  useEffect(() => {
    const fetchDashboard = async () => {
      if (!user) return
      try {
        const loadedAt = new Date()
        const [
          { data: users },
          allPicks,
          { data: allGames },
          { data: threeBests },
          { data: seasonRows },
        ] = await Promise.all([
          supabase.from('users').select('id, name, avatar_url').order('name'),
          // Paged — a full season of picks exceeds PostgREST's row cap.
          fetchAllRows<SeasonPick>((from, to) =>
            supabase.from('picks').select('user_id, game_id, picked_team, week')
              .eq('season', season).order('id').range(from, to)),
          supabase.from('games').select('id, week, away_team, home_team, kickoff_time, winning_team, away_score, home_score').eq('season', season).order('kickoff_time'),
          supabase.from('three_best').select('user_id, week, pick_1, pick_2, pick_3').eq('season', season),
          // For the Champions tile. A missing table is just "no saved seasons".
          supabase.from('seasons').select('season, champion_name, champion_record').not('completed_at', 'is', null),
        ])

        if (!users || !allGames) {
          setLoadError('Could not load your dashboard. Check your connection and try again.')
          setDataLoading(false)
          return
        }

        const games = allGames as WeekGame[]
        const userIds = users.map(u => u.id)
        const best = threeBests ?? []

        // Per-user records via the shared module
        const records = computeRecords({ userIds, games, picks: allPicks, threeBests: best })

        // Rank everyone, with shared places for ties (same as the Standings page)
        const ranked = userIds
          .map(uid => ({ uid, r: records.get(uid)! }))
          .sort((a, b) => recordSort(a.r, b.r))
        const ranks = assignRanks(ranked, x => x.r)
        const myIdx = ranked.findIndex(x => x.uid === user.id)
        const myRecord = records.get(user.id)!

        // Movement since last week: the same table without the latest finished
        // week. Only meaningful once there are two finished weeks to compare.
        const decidedWeeks = [...new Set(games.filter(g => g.winning_team).map(g => g.week))].sort((a, b) => a - b)
        const prevRankOf = new Map<string, number>()
        if (decidedWeeks.length >= 2) {
          const latest = decidedWeeks[decidedWeeks.length - 1]
          const prev = ranked.map(({ uid, r }) => {
            const lw = r.weekRecords.get(latest)
            return {
              uid,
              r: {
                ...r,
                wins: r.wins - (lw?.wins ?? 0),
                losses: r.losses - (lw?.losses ?? 0),
                ties: r.ties - (lw?.ties ?? 0),
                bestWins: r.bestWins - (lw?.bestWins ?? 0),
                bestLosses: r.bestLosses - (lw?.bestLosses ?? 0),
                bestTies: r.bestTies - (lw?.bestTies ?? 0),
              },
            }
          }).sort((a, b) => recordSort(a.r, b.r))
          assignRanks(prev, x => x.r).forEach((rk, i) => prevRankOf.set(prev[i].uid, rk.rank))
        }

        const standings: StandingRow[] = ranked
          .map(({ uid, r }, i) => {
            const u = users.find(x => x.id === uid)
            const prev = prevRankOf.get(uid)
            return {
              userId: uid,
              name: u?.name ?? 'Unknown',
              avatar_url: u?.avatar_url ?? null,
              rank: ranks[i].rank,
              isTied: ranks[i].isTied,
              wins: r.wins, losses: r.losses, ties: r.ties,
              rankChange: prev != null ? prev - ranks[i].rank : null,
              isYou: uid === user.id,
            }
          })
          .filter(s => s.wins + s.losses + s.ties > 0)

        // This week = the newest loaded week
        const currentWeek = games.length > 0 ? Math.max(...games.map(g => g.week)) : null
        const weekGames = currentWeek ? games.filter(g => g.week === currentWeek) : []
        const lockTime = computeLockTime(weekGames)
        const lockedAtLoad = lockTime ? loadedAt >= lockTime : false

        const myWeekPicks: Record<string, string> = {}
        allPicks.filter(p => p.user_id === user.id && p.week === currentWeek)
          .forEach(p => { myWeekPicks[p.game_id] = p.picked_team })
        const myBestRow = best.find(tb => tb.user_id === user.id && tb.week === currentWeek)
        const myBestTeams = myBestRow ? [myBestRow.pick_1, myBestRow.pick_2, myBestRow.pick_3].filter(Boolean) as string[] : []

        // How the family split on each game. Before lock RLS returns only your
        // own rows, so this is only built from a post-lock load.
        const weekPicks = allPicks.filter(p => p.week === currentWeek)
        const splits: SplitRow[] = lockedAtLoad
          ? weekGames.map(g => {
            const forGame = weekPicks.filter(p => p.game_id === g.id)
            return {
              game: g,
              awayCount: forGame.filter(p => p.picked_team === g.away_team).length,
              homeCount: forGame.filter(p => p.picked_team === g.home_team).length,
              myPick: myWeekPicks[g.id] ?? null,
            }
          })
          : []

        // Finished weeks — every game decided
        const completeWeeks = [...new Set(games.map(g => g.week))]
          .filter(w => games.filter(g => g.week === w).every(g => !!g.winning_team))
          .sort((a, b) => a - b)
        const recapWeek = completeWeeks.length > 0 ? completeWeeks[completeWeeks.length - 1] : null
        const prevWeek = [...completeWeeks].reverse().find(w => currentWeek === null || w < currentWeek) ?? null

        const champions = mergeChampions(seasonRows ?? [])
        const latestChampion = [...champions].reverse().find(c => !!c.winner) ?? null

        // Managed players: load any players where I'm a manager
        let managedPlayers: ManagedPlayerSummary[] = []
        try {
          const { data: { session } } = await supabase.auth.getSession()
          const token = session?.access_token ?? ''
          const res = await fetch('/api/managed-players', {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (res.ok) {
            const json = await res.json()
            const players: Array<{ id: string; name: string }> = json.players ?? []
            const totalGamesThisWeek = weekGames.length
            managedPlayers = players.map(p => {
              const playerPicks = allPicks.filter(pk => pk.user_id === p.id && pk.week === currentWeek)
              const playerBest = best.find(tb => tb.user_id === p.id && tb.week === currentWeek)
              const playerBestCount = playerBest ? [playerBest.pick_1, playerBest.pick_2, playerBest.pick_3].filter(Boolean).length : 0
              const u = users.find(u => u.id === p.id)
              return {
                id: p.id,
                name: p.name,
                avatar_url: u?.avatar_url,
                pickedCount: playerPicks.length,
                totalGames: totalGamesThisWeek,
                bestPickCount: playerBestCount,
                complete: playerPicks.length >= totalGamesThisWeek && playerBestCount >= MAX_BEST_PICKS,
              }
            })
          }
        } catch (err) {
          console.error('Managed players fetch error:', err)
        }

        setData({
          users: users.map(u => ({ id: u.id, name: u.name, avatar_url: u.avatar_url ?? null })),
          record: myRecord,
          rank: myIdx >= 0 ? ranks[myIdx].rank : ranked.length,
          isTied: myIdx >= 0 ? ranks[myIdx].isTied : false,
          rankChange: standings.find(s => s.isYou)?.rankChange ?? null,
          totalPlayers: standings.length,
          currentWeek,
          weekGames,
          myWeekPicks,
          myBestTeams,
          lockTime,
          lockedAtLoad,
          weekRank: currentWeek !== null ? weekRankOf(records, userIds, currentWeek, user.id) : null,
          weekPlayers: new Set(weekPicks.map(p => p.user_id)).size,
          prevWeek,
          prevWeekRank: prevWeek !== null ? weekRankOf(records, userIds, prevWeek, user.id) : null,
          standings,
          splits,
          recapWeek,
          latestChampion,
          managedPlayers,
        })
      } catch (err) {
        console.error('Dashboard error:', err)
        setLoadError('Could not load your dashboard. Check your connection and try again.')
      } finally {
        setDataLoading(false)
      }
    }
    fetchDashboard()
  }, [user, season, reloadKey])

  const isLocked = !!data?.lockTime && now >= data.lockTime

  // The week locked while Home was open — reload so everyone's picks appear.
  useEffect(() => {
    if (data && isLocked && !data.lockedAtLoad) setReloadKey(k => k + 1)
  }, [data, isLocked])

  // Who's in, before lock. Counts only — never a picked team — from the same
  // endpoint All Picks uses, since RLS hides other people's picks until lock.
  const statusWeek = data?.currentWeek ?? null
  const statusLocked = data?.lockedAtLoad ?? true
  const statusGames = data?.weekGames.length ?? 0
  useEffect(() => {
    if (!user || statusWeek === null || statusLocked) { setWhoIsIn(null); return }
    let cancelled = false
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/pick-status?week=${statusWeek}&season=${season}`, {
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      if (!res.ok) return
      const json = await res.json()
      if (cancelled) return
      const totalGames: number = json.totalGames ?? statusGames
      setWhoIsIn({
        week: statusWeek,
        totalGames,
        // Derive "complete" from the counts rather than trusting a flag, so
        // the card and the admin to-do can't drift from what's shown.
        players: (json.players ?? []).map((p: { id: string; name: string; pickCount: number; bestCount: number }) => ({
          ...p,
          complete: totalGames > 0 && p.pickCount >= totalGames && p.bestCount >= MAX_BEST_PICKS,
        })),
      })
    })().catch(() => {})
    return () => { cancelled = true }
  }, [user, statusWeek, statusLocked, statusGames, season])

  // The newest Talk message, for the preview. '*' so it works whichever Talk
  // migrations have run.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    const load = async () => {
      const { data: rows } = await supabase
        .from('talk_messages').select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
      if (!cancelled) setTalkLatest((rows?.[0] as TalkLatest | undefined) ?? null)
    }
    load().catch(() => {})
    const channel = supabase
      .channel(`home-talk-latest-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'talk_messages' }, () => { load().catch(() => {}) })
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(channel) }
  }, [user])

  // Admin to-do: has the latest recap gone out? The admin-only recap endpoint
  // already knows; a failure (e.g. migration 17 not run) just hides the item.
  useEffect(() => {
    if (!isAdmin) { setAdminTodo(null); return }
    let cancelled = false
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/weekly-digest?season=${season}`, {
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      if (!res.ok) return
      const json = await res.json()
      if (!cancelled) setAdminTodo({ recapWeek: json.week ?? null, recapPosted: !!json.talkPostedAt })
    })().catch(() => {})
    return () => { cancelled = true }
  }, [isAdmin, season])

  if (configError) {
    return (
      <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
        <h1>Configuration Error</h1>
        <p>The app is missing required Supabase environment variables.</p>
        <p>Please check that <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> are set.</p>
      </div>
    )
  }

  if (loading || (dataLoading && !data)) return <DashboardSkeleton />
  if (!user) return null

  // Anything that leaves us without data is an error, not a load still in
  // flight. Falling back to the skeleton here left the home screen shimmering
  // forever on a network blip, with nothing to read and nothing to click.
  if (!data) {
    return (
      <div className="min-h-screen bg-surface pb-page">
        <Nav />
        <main className="max-w-3xl mx-auto px-4 py-6 animate-fade-in">
          <div className="glass-card rounded-2xl p-8 text-center">
            <p className="text-3xl mb-3">⚠️</p>
            <p className="text-white font-medium">{loadError || 'Something went wrong loading your dashboard.'}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-500 transition"
            >
              Try again
            </button>
          </div>
        </main>
      </div>
    )
  }

  const d = data
  const totalGames = d.weekGames.length
  const pickedCount = d.weekGames.filter(g => d.myWeekPicks[g.id]).length
  const bestCount = d.myBestTeams.length
  const weekDone = totalGames > 0 && d.weekGames.every(g => !!g.winning_team)
  const weekState: 'none' | 'open' | 'live' | 'final' =
    totalGames === 0 ? 'none' : !isLocked ? 'open' : weekDone ? 'final' : 'live'

  const navStatus = weekState === 'open'
    ? { unpicked: Math.max(0, totalGames - pickedCount), bestNeeded: bestCount < MAX_BEST_PICKS }
    : { unpicked: 0, bestNeeded: false }

  const thisWeekRecord = d.currentWeek !== null ? d.record.weekRecords.get(d.currentWeek) : undefined
  const prevWeekRecord = d.prevWeek !== null ? d.record.weekRecords.get(d.prevWeek) : undefined

  // Admin to-do items, only the ones that need doing
  const owing = whoIsIn ? whoIsIn.players.filter(p => !p.complete) : []
  const awaitingResult = d.weekGames.filter(g => !g.winning_team && parseUTC(g.kickoff_time).getTime() + 3.5 * 3600_000 < now.getTime())
  const todo: { text: string; tone: 'amber' | 'emerald' }[] = []
  if (isAdmin) {
    if (weekState === 'open' && whoIsIn) {
      todo.push(owing.length > 0
        ? { text: `${owing.length} ${owing.length === 1 ? 'player owes' : 'players owe'} Week ${d.currentWeek} picks`, tone: 'amber' }
        : { text: `Everyone's in for Week ${d.currentWeek}`, tone: 'emerald' })
    }
    if (awaitingResult.length > 0) {
      todo.push({ text: `${awaitingResult.length} ${awaitingResult.length === 1 ? 'game needs' : 'games need'} a result synced`, tone: 'amber' })
    }
    if (adminTodo?.recapWeek && !adminTodo.recapPosted) {
      todo.push({ text: `Week ${adminTodo.recapWeek} recap not posted to Talk`, tone: 'amber' })
    }
  }

  const container = 'max-w-3xl lg:max-w-6xl'

  return (
    <div className="min-h-screen bg-surface pb-page">
      <Nav pickStatus={navStatus} containerClassName={container} />

      <main className={`${container} mx-auto px-4 py-6 animate-fade-in`}>
        {isAdmin && <SaveSeasonButton />}
        {/* The season is already under the app name in the header. */}
        <h1 className="text-lg font-bold text-white mb-5">
          Hey, {shortName(user.name)}
        </h1>

        {/* ── ADMIN TO-DO ── */}
        {todo.length > 0 && (
          <Link
            href="/admin"
            className="press mb-5 glass-card rounded-2xl px-4 py-3 flex items-center gap-3 hover:bg-white/[0.04] transition animate-slide-up"
          >
            <span className="text-lg">🔧</span>
            <div className="flex-1 min-w-0 space-y-0.5">
              {todo.map(t => (
                <p key={t.text} className={`text-xs ${t.tone === 'amber' ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {t.tone === 'amber' ? '•' : '✓'} {t.text}
                </p>
              ))}
            </div>
            <span className="text-[11px] font-semibold text-blue-400 shrink-0">Open Admin →</span>
          </Link>
        )}

        <div className="lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start">
          {/* ───────────── LEFT: this week ───────────── */}
          <div>
            {weekState !== 'none' && d.currentWeek !== null && (
              <ThisWeekCard
                week={d.currentWeek}
                season={season}
                state={weekState}
                games={d.weekGames}
                myPicks={d.myWeekPicks}
                myBestTeams={d.myBestTeams}
                pickedCount={pickedCount}
                bestCount={bestCount}
                lockTime={d.lockTime}
                now={now}
                weekRecord={thisWeekRecord}
                weekRank={d.weekRank}
                weekPlayers={d.weekPlayers}
              />
            )}

            {/* ── MANAGED PLAYERS (only if you manage anyone) ── */}
            {d.managedPlayers.length > 0 && d.currentWeek !== null && (
              <div className="mb-5 animate-slide-up" style={{ animationDelay: '60ms' }}>
                <SectionHeader title="Players you manage" href="/picks" linkText="Make picks" />
                <div className="glass-card rounded-2xl overflow-hidden">
                  {d.managedPlayers.map(mp => (
                    <div
                      key={mp.id}
                      className={`flex items-center gap-3 px-4 py-3 border-b border-white/[0.04] last:border-0 ${
                        !mp.complete && !isLocked ? 'bg-amber-500/5' : ''
                      }`}
                    >
                      <Avatar name={mp.name} url={mp.avatar_url} size={32} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{mp.name}</p>
                        <p className="text-[11px] text-slate-500">
                          {mp.totalGames > 0 ? (
                            <>
                              {mp.pickedCount}/{mp.totalGames} picks
                              {mp.bestPickCount >= MAX_BEST_PICKS
                                ? <span className="text-amber-400 ml-1.5">⭐ Best 3 set</span>
                                : <span className="text-slate-500 ml-1.5">⭐ {mp.bestPickCount}/{MAX_BEST_PICKS}</span>}
                            </>
                          ) : 'No games yet'}
                        </p>
                      </div>
                      {mp.totalGames > 0 && (
                        mp.complete ? (
                          <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">Ready</span>
                        ) : isLocked ? (
                          <span className="text-[10px] font-semibold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">Locked</span>
                        ) : (
                          <span className="text-[10px] font-semibold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">Incomplete</span>
                        )
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── EVERYONE'S PICKS ── */}
            {weekState === 'open' && whoIsIn && whoIsIn.players.length > 0 && (
              <WhoIsInCard whoIsIn={whoIsIn} users={d.users} meId={user.id} />
            )}
            {(weekState === 'live' || weekState === 'final') && d.splits.length > 0 && (
              <SplitsCard week={d.currentWeek!} splits={d.splits} players={d.weekPlayers} />
            )}
          </div>

          {/* ───────────── RIGHT: you and the family ───────────── */}
          <div>
            {d.standings.length > 0 && (
              <StandingsCard standings={d.standings} />
            )}

            <YouCard
              record={d.record}
              rank={d.rank}
              isTied={d.isTied}
              rankChange={d.rankChange}
              totalPlayers={d.totalPlayers}
              prevWeek={d.prevWeek}
              prevWeekRecord={prevWeekRecord}
              prevWeekRank={d.prevWeekRank}
            />

            <TalkCard latest={talkLatest} unread={unreadTalk} now={now} meId={user.id} />
          </div>
        </div>

        {/* ── EVERYTHING ELSE ── */}
        <div className="mt-1 animate-slide-up" style={{ animationDelay: '200ms' }}>
          <SectionHeader title="Everything" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <Tile href="/all-picks" icon="📋" title="All Picks"
              sub={weekState === 'open' ? `Who's in for Week ${d.currentWeek}` : d.currentWeek !== null ? `Week ${d.currentWeek} picks` : 'Every pick, every week'} />
            <Tile href="/standings" icon="🏆" title="Standings"
              sub={d.standings.some(s => s.isYou) ? `You're ${placeText(d.rank, d.isTied)} of ${d.totalPlayers}` : 'The season table'} />
            <Tile href="/talk" icon="💩" title="Talk"
              sub={unreadTalk > 0 ? `${unreadTalk > 9 ? '9+' : unreadTalk} new` : 'Family chat'}
              badge={unreadTalk} />
            {d.recapWeek !== null ? (
              <Tile href={`/recap?season=${season}&week=${d.recapWeek}`} icon="📰" title="Recap" sub={`Week ${d.recapWeek}`} />
            ) : (
              <Tile icon="📰" title="Recap" sub="After Week 1 finishes" disabled />
            )}
            <Tile href="/spreadsheets" icon="📊" title="Sheets" sub="Weekly spreadsheets" />
            <Tile href="/champions" icon="👑" title="Champions"
              sub={d.latestChampion ? `${d.latestChampion.year}: ${d.latestChampion.winner}` : 'Every winner since 1996'} />
            {(isAdmin || isManager) && (
              // Seventh tile: full width on a phone rather than alone in half a row.
              <Tile href="/admin" icon="🔧" title="Admin" sub={isAdmin ? 'Results, players, recaps' : 'Your players'} className="col-span-2 sm:col-span-1" />
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

// ── sections ────────────────────────────────────────────────────────────────

function PickChip({ team, result, star, empty }: {
  team?: string
  result: 'win' | 'loss' | 'tie' | null
  star: boolean
  empty?: boolean
}) {
  if (empty || !team) {
    return (
      <span
        className="w-8 h-8 rounded-full border border-dashed border-white/[0.15] flex items-center justify-center text-[10px] text-slate-600"
        title="Not picked"
      >
        ?
      </span>
    )
  }
  const t = getTeam(team)
  const ring = result === 'win' ? 'ring-2 ring-emerald-500/70 bg-emerald-500/10'
    : result === 'loss' ? 'ring-2 ring-red-500/60 bg-red-500/10'
      : result === 'tie' ? 'ring-2 ring-slate-400/50'
        : 'ring-1 ring-white/[0.10] bg-white/[0.04]'
  return (
    <span className={`relative w-8 h-8 rounded-full flex items-center justify-center ${ring}`} title={`${t.city} ${t.name}`}>
      <img
        src={t.logo} alt={team} loading="lazy" decoding="async"
        className="w-6 h-6 object-contain"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
      />
      {star && <span className="absolute -top-1.5 -right-1.5 text-[11px] leading-none">⭐</span>}
      {result === 'loss' && <span className="absolute -bottom-1 -right-1 text-[9px] font-bold text-red-400 leading-none">✗</span>}
    </span>
  )
}

function ThisWeekCard(props: {
  week: number
  season: number
  state: 'open' | 'live' | 'final'
  games: WeekGame[]
  myPicks: Record<string, string>
  myBestTeams: string[]
  pickedCount: number
  bestCount: number
  lockTime: Date | null
  now: Date
  weekRecord: { wins: number; losses: number; ties: number } | undefined
  weekRank: number | null
  weekPlayers: number
}) {
  const { week, season, state, games, myPicks, myBestTeams, pickedCount, bestCount, lockTime, now, weekRecord, weekRank, weekPlayers } = props
  const total = games.length
  const msLeft = lockTime ? Math.max(0, lockTime.getTime() - now.getTime()) : 0
  const urgent = msLeft < 2 * 3600_000
  const allIn = pickedCount >= total && bestCount >= MAX_BEST_PICKS
  const decided = games.filter(g => g.winning_team).length

  const resultOf = (g: WeekGame): 'win' | 'loss' | 'tie' | null => {
    if (!g.winning_team || state === 'open') return null
    if (g.winning_team === 'TIE') return 'tie'
    const pick = myPicks[g.id]
    return pick === g.winning_team ? 'win' : 'loss'
  }

  const badge = state === 'open'
    ? <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">Open</span>
    : state === 'live'
      ? <span className="text-[10px] font-semibold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">In progress · {decided}/{total} final</span>
      : <span className="text-[10px] font-semibold text-slate-300 bg-white/[0.06] px-2 py-0.5 rounded-full">Final</span>

  return (
    <div className={`mb-5 glass-card rounded-2xl p-4 animate-slide-up ${
      state === 'open' && !allIn ? 'border-amber-500/20' : state === 'open' && allIn ? 'border-emerald-500/25' : ''
    }`}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Week {week}</p>
        {badge}
      </div>

      {state === 'open' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-3">
            <span className={`text-xs ${urgent ? 'text-red-400' : 'text-amber-400'}`}>
              {urgent ? '🚨' : '⏰'} Locks {lockTime ? formatKickoff(lockTime.toISOString()) : ''}
            </span>
            <span className={`font-mono font-bold text-sm tabular-nums ${urgent ? 'text-red-400' : 'text-amber-400'}`}>
              {formatCountdown(msLeft)}
            </span>
          </div>
          <div className="w-full bg-white/[0.06] rounded-full h-2 overflow-hidden">
            <div
              className={`h-2 rounded-full transition-all duration-500 ${allIn ? 'bg-emerald-500' : 'progress-gradient'}`}
              style={{ width: `${total > 0 ? (pickedCount / total) * 100 : 0}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-slate-400 mt-2 mb-3">
            <span>{allIn ? <span className="text-emerald-400 font-medium">✓ All {total} picked</span> : `${pickedCount} of ${total} picked`}</span>
            <span className={bestCount >= MAX_BEST_PICKS ? 'text-amber-400 font-medium' : ''}>⭐ {bestCount}/{MAX_BEST_PICKS} Best</span>
          </div>
        </>
      )}

      {state !== 'open' && (
        <div className="flex items-end justify-between mb-3">
          <div>
            <p className="text-2xl font-bold">
              <span className="text-emerald-400">{weekRecord?.wins ?? 0}</span>
              <span className="text-slate-500 mx-1">–</span>
              <span className="text-red-400">{weekRecord?.losses ?? 0}</span>
              {(weekRecord?.ties ?? 0) > 0 && <><span className="text-slate-500 mx-1">–</span><span className="text-slate-400">{weekRecord!.ties}</span></>}
            </p>
            <p className="text-[11px] text-slate-500">{state === 'live' ? 'so far this week' : 'your week'}</p>
          </div>
          {weekRank !== null && (
            <p className="text-xs text-slate-400 text-right">
              {state === 'live' ? 'Currently ' : ''}<span className="text-white font-semibold">#{weekRank}</span>
              <span className="text-slate-500"> of {weekPlayers}</span>
              <span className="block text-[10px] text-slate-500">this week</span>
            </p>
          )}
        </div>
      )}

      {/* Your picks at a glance — a logo per game, ⭐ on Best 3, and once games
          finish a green or red ring for how each one went. */}
      <div className="flex flex-wrap gap-1.5 mb-4" aria-label="Your picks this week">
        {games.map(g => {
          const pick = myPicks[g.id]
          return (
            <PickChip
              key={g.id}
              team={pick}
              empty={!pick}
              star={!!pick && myBestTeams.includes(pick)}
              result={pick || g.winning_team ? resultOf(g) : null}
            />
          )
        })}
      </div>

      {state === 'open' ? (
        <Link
          href="/picks"
          className={`press block text-center text-sm font-semibold rounded-xl py-3 transition ${
            allIn
              ? 'bg-white/[0.08] text-white hover:bg-white/[0.12]'
              : 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/20 hover:brightness-110'
          }`}
        >
          {allIn ? 'Review your picks' : pickedCount === 0 ? `Make your Week ${week} picks` : 'Finish your picks'}
        </Link>
      ) : state === 'final' ? (
        <div className="grid grid-cols-2 gap-2">
          <Link href={`/recap?season=${season}&week=${week}`} className="press text-center text-sm font-semibold rounded-xl py-3 bg-blue-600 text-white hover:bg-blue-500 transition">
            📰 Week {week} Recap
          </Link>
          <Link href="/all-picks" className="press text-center text-sm font-semibold rounded-xl py-3 bg-white/[0.08] text-white hover:bg-white/[0.12] transition">
            Everyone&apos;s picks
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Link href="/picks" className="press text-center text-sm font-semibold rounded-xl py-3 bg-white/[0.08] text-white hover:bg-white/[0.12] transition">
            Your picks
          </Link>
          <Link href="/all-picks" className="press text-center text-sm font-semibold rounded-xl py-3 bg-white/[0.08] text-white hover:bg-white/[0.12] transition">
            Everyone&apos;s picks
          </Link>
        </div>
      )}
    </div>
  )
}

function WhoIsInCard({ whoIsIn, users, meId }: {
  whoIsIn: WhoIsIn
  users: { id: string; name: string; avatar_url: string | null }[]
  meId: string
}) {
  const done = whoIsIn.players.filter(p => p.complete).length
  // Finished first, then partway, then not started — names alphabetical within.
  const order = (p: WhoIsIn['players'][number]) => (p.complete ? 0 : p.pickCount > 0 ? 1 : 2)
  const players = [...whoIsIn.players].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name))
  return (
    <div className="mb-5 animate-slide-up" style={{ animationDelay: '80ms' }}>
      <SectionHeader title={`Who's in · Week ${whoIsIn.week}`} href="/all-picks" linkText="Details" />
      <div className="glass-card rounded-2xl p-4">
        <p className="text-sm text-white font-medium mb-3">
          <span className="text-emerald-400">{done}</span> of {whoIsIn.players.length} have their picks in
        </p>
        <div className="flex flex-wrap gap-2">
          {players.map(p => {
            const u = users.find(x => x.id === p.id)
            const ring = p.complete ? 'ring-emerald-500/70' : p.pickCount > 0 ? 'ring-amber-500/60' : 'ring-white/[0.08] opacity-50'
            return (
              <div key={p.id} className="flex flex-col items-center w-11" title={`${p.name}: ${p.pickCount}/${whoIsIn.totalGames} · ⭐ ${p.bestCount}/${MAX_BEST_PICKS}`}>
                <span className={`rounded-full ring-2 ${ring}`}>
                  <Avatar name={p.name} url={u?.avatar_url} size={32} you={p.id === meId} />
                </span>
                <span className="text-[9px] text-slate-500 truncate w-full text-center mt-1">{shortName(p.name)}</span>
              </div>
            )
          })}
        </div>
        <p className="text-[10px] text-slate-600 mt-3">
          <span className="text-emerald-500">●</span> all in · <span className="text-amber-500">●</span> partway · picks stay hidden until lock
        </p>
      </div>
    </div>
  )
}

function SplitsCard({ week, splits, players }: { week: number; splits: SplitRow[]; players: number }) {
  // Lead with where you went against the crowd, then the closest calls.
  const share = (s: SplitRow) => {
    const total = s.awayCount + s.homeCount
    if (!s.myPick || total === 0) return 1
    return (s.myPick === s.game.away_team ? s.awayCount : s.homeCount) / total
  }
  const closeness = (s: SplitRow) => Math.abs(s.awayCount - s.homeCount)
  const contrarian = splits.filter(s => share(s) < 0.5).sort((a, b) => share(a) - share(b))
  const rest = splits.filter(s => !contrarian.includes(s)).sort((a, b) => closeness(a) - closeness(b))
  const shown = [...contrarian, ...rest].slice(0, 4)

  return (
    <div className="mb-5 animate-slide-up" style={{ animationDelay: '80ms' }}>
      <SectionHeader title={`Everyone's picks · Week ${week}`} href="/all-picks" linkText="See all" />
      <div className="glass-card rounded-2xl overflow-hidden">
        {shown.map(s => {
          const total = Math.max(1, s.awayCount + s.homeCount)
          const g = s.game
          const lonely = share(s) < 0.5
          const side = (team: string, count: number, align: 'left' | 'right') => {
            const mine = s.myPick === team
            const won = g.winning_team === team
            return (
              <div className={`flex items-center gap-1.5 min-w-0 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}>
                <img src={getTeam(team).logo} alt="" className="w-5 h-5 object-contain shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                <span className={`text-xs font-semibold ${won ? 'text-emerald-400' : 'text-slate-300'}`}>{team}{won ? ' ✓' : ''}</span>
                <span className="text-[11px] text-slate-500 tabular-nums">{count}</span>
                {mine && <span className="text-[9px] font-bold text-blue-300 bg-blue-500/15 px-1.5 py-0.5 rounded-full">YOU</span>}
              </div>
            )
          }
          return (
            <div key={g.id} className="px-4 py-3 border-b border-white/[0.04] last:border-0">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                {side(g.away_team, s.awayCount, 'left')}
                {side(g.home_team, s.homeCount, 'right')}
              </div>
              <div className="flex h-1.5 rounded-full overflow-hidden bg-white/[0.06]">
                <div className="bg-blue-500/70" style={{ width: `${(s.awayCount / total) * 100}%` }} />
                <div className="bg-indigo-400/40" style={{ width: `${(s.homeCount / total) * 100}%` }} />
              </div>
              {lonely && (
                <p className="text-[10px] text-amber-400/80 mt-1.5">
                  You went against the crowd{(s.myPick === g.away_team ? s.awayCount : s.homeCount) > 1
                    ? ` with ${(s.myPick === g.away_team ? s.awayCount : s.homeCount) - 1} other${(s.myPick === g.away_team ? s.awayCount : s.homeCount) - 1 === 1 ? '' : 's'}`
                    : ' — the only one'}
                </p>
              )}
            </div>
          )
        })}
        <p className="px-4 py-2.5 text-[10px] text-slate-600 border-t border-white/[0.04]">
          {players} {players === 1 ? 'player' : 'players'} picked · showing {shown.length} of {splits.length} games
        </p>
      </div>
    </div>
  )
}

function StandingsCard({ standings }: { standings: StandingRow[] }) {
  // Top 3, then you and the player either side of you — so you can see who
  // you're chasing and who's chasing you, wherever you are in the table.
  const meIdx = standings.findIndex(s => s.isYou)
  const show = new Set<number>([0, 1, 2].filter(i => i < standings.length))
  if (meIdx >= 0) [meIdx - 1, meIdx, meIdx + 1].forEach(i => { if (i >= 0 && i < standings.length) show.add(i) })
  const idxs = [...show].sort((a, b) => a - b)

  return (
    <div className="mb-5 animate-slide-up" style={{ animationDelay: '40ms' }}>
      <SectionHeader title="Standings" href="/standings" linkText="Full table" />
      <div className="glass-card rounded-2xl overflow-hidden">
        {idxs.map((i, n) => {
          const s = standings[i]
          const gap = n > 0 && i - idxs[n - 1] > 1
          return (
            <div key={s.userId}>
              {gap && (
                <div className="px-4 py-1 text-center text-[10px] text-slate-600 border-b border-white/[0.04] tracking-[0.3em]">• • •</div>
              )}
              <div className={`flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.04] ${s.isYou ? 'bg-blue-500/10' : ''}`}>
                <span className="w-8 text-center shrink-0">
                  {medal(s.rank)
                    ? <span className="text-base">{medal(s.rank)}</span>
                    : <span className="text-xs text-slate-500 font-medium tabular-nums">{placeText(s.rank, s.isTied)}</span>}
                </span>
                <Avatar name={s.name} url={s.avatar_url} size={28} you={s.isYou} />
                <p className={`flex-1 min-w-0 text-sm font-medium truncate ${s.isYou ? 'text-blue-400' : 'text-white'}`}>
                  {shortName(s.name)}{s.isYou ? ' (you)' : ''}
                </p>
                {s.rankChange !== null && s.rankChange !== 0 && (
                  <span className={`text-[10px] font-bold tabular-nums ${s.rankChange > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {s.rankChange > 0 ? '▲' : '▼'}{Math.abs(s.rankChange)}
                  </span>
                )}
                <p className="text-sm font-bold tabular-nums">
                  <span className="text-emerald-400">{s.wins}</span>
                  <span className="text-slate-500 mx-0.5">–</span>
                  <span className="text-red-400">{s.losses}</span>
                  {s.ties > 0 && <><span className="text-slate-500 mx-0.5">–</span><span className="text-slate-400">{s.ties}</span></>}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function YouCard(props: {
  record: UserRecord
  rank: number
  isTied: boolean
  rankChange: number | null
  totalPlayers: number
  prevWeek: number | null
  prevWeekRecord: { wins: number; losses: number; ties: number } | undefined
  prevWeekRank: number | null
}) {
  const { record: r, rank, isTied, rankChange, totalPlayers, prevWeek, prevWeekRecord, prevWeekRank } = props
  const played = r.wins + r.losses + r.ties
  const winPct = played > 0 ? Math.round((r.wins / played) * 100) : null

  return (
    <div className="mb-5 glass-card rounded-2xl p-4 animate-slide-up" style={{ animationDelay: '80ms' }}>
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Your season</p>
      {played === 0 ? (
        <p className="text-sm text-slate-500">No results yet — your record starts once Week 1 games are scored.</p>
      ) : (
        <>
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-2xl font-bold leading-none">
                <span className="text-emerald-400">{r.wins}</span>
                <span className="text-slate-500 mx-1">–</span>
                <span className="text-red-400">{r.losses}</span>
                {r.ties > 0 && <><span className="text-slate-500 mx-1">–</span><span className="text-slate-400">{r.ties}</span></>}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">{winPct}% picked right</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-white leading-none">
                {medal(rank) ?? placeText(rank, isTied)}
                {rankChange !== null && rankChange !== 0 && (
                  <span className={`ml-1.5 text-xs font-bold ${rankChange > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {rankChange > 0 ? '▲' : '▼'}{Math.abs(rankChange)}
                  </span>
                )}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">{isTied ? 'tied, ' : ''}of {totalPlayers}</p>
            </div>
          </div>
          <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden mt-3">
            <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full" style={{ width: `${winPct}%` }} />
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-white/[0.06] text-xs">
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Best 3</p>
              <p className="font-semibold">
                <span className="text-amber-400">{r.bestWins}</span>
                <span className="text-slate-500 mx-0.5">–</span>
                <span className="text-amber-600">{r.bestLosses}</span>
                {r.bestTies > 0 && <><span className="text-slate-500 mx-0.5">–</span><span className="text-slate-400">{r.bestTies}</span></>}
              </p>
            </div>
            {prevWeek !== null && prevWeekRecord && (
              <div className="text-right">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Week {prevWeek}</p>
                <p className="font-semibold text-slate-300">
                  {recordText(prevWeekRecord.wins, prevWeekRecord.losses, prevWeekRecord.ties)}
                  {prevWeekRank !== null && <span className="text-slate-500 font-normal"> · #{prevWeekRank}</span>}
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function TalkCard({ latest, unread, now, meId }: { latest: TalkLatest | null; unread: number; now: Date; meId: string }) {
  const preview = !latest ? null
    : latest.recap_week != null ? `📰 Week ${latest.recap_week} Recap`
      : latest.body?.trim() ? latest.body.trim()
        : latest.image_url ? '📷 Photo' : ''
  return (
    <Link
      href="/talk"
      className="press mb-5 glass-card rounded-2xl p-4 flex items-start gap-3 hover:bg-white/[0.04] transition animate-slide-up"
      style={{ animationDelay: '120ms' }}
    >
      <span className="text-2xl leading-none mt-0.5">💩</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-white">Talk</p>
          {unread > 0 && (
            <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
          {latest && <span className="ml-auto text-[10px] text-slate-600 shrink-0">{timeAgo(latest.created_at, now)}</span>}
        </div>
        {latest && preview ? (
          <p className="text-xs text-slate-400 truncate mt-0.5">
            <span className="text-slate-300 font-medium">{latest.user_id === meId ? 'You' : shortName(latest.author_name)}:</span> {preview}
          </p>
        ) : (
          <p className="text-xs text-slate-500 mt-0.5">One thread for the whole family. Say something!</p>
        )}
      </div>
    </Link>
  )
}

function Tile({ href, icon, title, sub, badge = 0, disabled = false, className = '' }: {
  href?: string
  icon: string
  title: string
  sub: string
  badge?: number
  disabled?: boolean
  className?: string
}) {
  const body = (
    <>
      <span className="relative text-2xl leading-none">
        {icon}
        {badge > 0 && (
          <span className="absolute -top-1.5 -right-3 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white border-2 border-surface">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </span>
      <span className="mt-2 text-sm font-semibold text-white">{title}</span>
      <span className="text-[11px] text-slate-500 truncate w-full">{sub}</span>
    </>
  )
  const cls = `glass-card rounded-2xl p-4 flex flex-col items-start min-w-0 transition ${className}`
  if (disabled || !href) return <div className={`${cls} opacity-50`}>{body}</div>
  return <Link href={href} className={`press ${cls} hover:bg-white/[0.06]`}>{body}</Link>
}
