import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '@/lib/supabase'
import { useBowlAuth } from '@/lib/bowls/auth'
import { BOWL_NAME, bowlSeasonLabel } from '@/lib/bowls/constants'
import { useToast } from '@/components/Toast'
import BowlHeader, { BowlAvatar } from '@/components/bowls/BowlHeader'
import BowlRules from '@/components/bowls/BowlRules'
import { countdown, lockText } from '@/lib/bowls/format'
import { LeaderboardCard } from '@/components/bowls/LeaderboardCard'
import TodaysGames from '@/components/bowls/TodaysGames'
import { useBowlLive } from '@/lib/bowls/useBowlLive'
import { useBoard } from '@/components/bowls/board'

interface Season { season: number; status: 'setup' | 'open' | 'locked' | 'complete' }
interface RosterPlayer { id: string; name: string; avatar_url: string | null }
interface PlayerProgress { id: string; picked: number; best5: number; hasTotal: boolean; complete: boolean }
interface SeasonStatus {
  status: Season['status']
  lockAt: string | null
  totalGames: number
  players: PlayerProgress[]
  /** Sample teams are on: My Picks has a preview anyone can try. */
  preview?: boolean
}

/**
 * Bowl Pick'em home.
 *
 * For a player: where this year's pick'em stands and who's in. For an NFL
 * player who hasn't joined: a one-tap join. For anyone else signed in: a note
 * to ask for an invite.
 */
export default function BowlHome() {
  const router = useRouter()
  const { loading, account, player, nflProfile, isAdmin, setupMissing, refresh, token, signOut } = useBowlAuth()
  const toast = useToast()
  const [season, setSeason] = useState<Season | null>(null)
  const [roster, setRoster] = useState<RosterPlayer[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState('')
  // Where the sheet stands and everyone's progress — counts only. Missing until
  // the sheet tables exist, and the page works without it.
  const [sheet, setSheet] = useState<SeasonStatus | null>(null)
  const { board, reload: reloadBoard } = useBoard()
  // Today's games, live: polls only while one of them could be on.
  const live = useBowlLive(board && !board.hidden && !board.demo ? board.games : undefined, reloadBoard)

  useEffect(() => {
    if (!loading && !account) router.replace('/bowls/login')
  }, [loading, account, router])

  const loadSeason = useCallback(async () => {
    const { data: s } = await supabase.from('bowl_seasons').select('season, status').eq('is_current', true).maybeSingle()
    setSeason((s as Season | null) ?? null)
    if (s) {
      const { data: entries } = await supabase.from('bowl_entries').select('player_id').eq('season', (s as Season).season)
      const ids = (entries ?? []).map(e => e.player_id as string)
      const { data: players } = ids.length
        ? await supabase.from('bowl_players').select('id, name, avatar_url').in('id', ids)
        : { data: [] as RosterPlayer[] }
      setRoster(((players ?? []) as RosterPlayer[]).sort((a, b) => a.name.localeCompare(b.name)))
    }
    try {
      const res = await fetch('/api/bowls/status', { headers: { Authorization: `Bearer ${await token()}` } })
      if (res.ok) setSheet(await res.json())
    } catch { /* counts are extra */ }
    setDataLoading(false)
  }, [token])

  useEffect(() => { if (account) loadSeason() }, [account, loadSeason])

  const join = async () => {
    setJoining(true)
    setJoinError('')
    try {
      const res = await fetch('/api/bowls/join', { method: 'POST', headers: { Authorization: `Bearer ${await token()}` } })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not join')
      await refresh()
      await loadSeason()
      toast.show("You're in! 🏆", 'success')
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Could not join')
    } finally {
      setJoining(false)
    }
  }

  if (loading || !account || (dataLoading && !setupMissing)) {
    return (
      <div className="min-h-screen bg-zinc-950">
        <BowlHeader />
        <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
          <div className="skeleton h-32 rounded-2xl" />
          <div className="skeleton h-48 rounded-2xl" />
        </main>
      </div>
    )
  }

  const label = season ? bowlSeasonLabel(season.season) : ''
  const inSeason = !!player && roster.some(r => r.id === player.id)
  // The clock locks the sheet at the first kickoff, so the server's word wins.
  const status = sheet?.status ?? season?.status
  const canJoin = status === 'setup' || status === 'open'
  const progressOf = new Map((sheet?.players ?? []).map(p => [p.id, p]))
  const mine = player ? progressOf.get(player.id) : undefined
  const sheetOut = !!sheet && sheet.status !== 'setup' && sheet.totalGames > 0
  const doneCount = (sheet?.players ?? []).filter(p => p.complete).length
  // (Not the admin's made-up preview board: the home page stays as it is.)
  const leaders = inSeason && board?.hidden === false && !board.demo && board.standings ? board : null

  return (
    <div className="min-h-screen bg-zinc-950 pb-12">
      <BowlHeader subtitle={label ? `${label} season` : undefined} />
      <main className="max-w-3xl mx-auto px-4 py-5 space-y-4 animate-fade-in">
        {setupMissing ? (
          <div className="glass-card rounded-2xl p-6 text-center">
            <p className="text-3xl mb-2">🛠️</p>
            <p className="text-white font-medium">The Bowl Pick&apos;em isn&apos;t set up yet</p>
            {isAdmin && (
              <p className="text-xs text-zinc-400 mt-2">Run supabase/migrations/20_bowl_pickem.sql in the Supabase SQL editor.</p>
            )}
          </div>
        ) : !inSeason ? (
          <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-zinc-800/90 via-zinc-900 to-zinc-950 border border-yellow-600/25 p-5 shadow-lg shadow-black/40">
            <img src="/logos/cfp-trophy.svg" alt="" aria-hidden="true" className="pointer-events-none absolute -right-4 -bottom-6 h-40 w-auto opacity-[0.12]" />
            <p className="relative text-yellow-500 text-xs font-semibold uppercase tracking-wider">{label} season</p>
            <h1 className="relative text-2xl font-bold text-white mt-0.5">{BOWL_NAME}</h1>
            {player || nflProfile ? (
              canJoin ? (
                <>
                  <p className="relative text-zinc-300 text-sm mt-2">
                    Pick every bowl game and the College Football Playoff. Join now — picks open once the playoff field is set.
                  </p>
                  {joinError && <p className="mt-3 text-sm bg-black/20 rounded-lg px-3 py-2 text-white">{joinError}</p>}
                  <button
                    onClick={join}
                    disabled={joining}
                    className="press mt-4 w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-b from-yellow-400 to-yellow-600 text-zinc-950 font-bold text-sm hover:brightness-110 disabled:opacity-60 transition"
                  >
                    {joining ? 'Joining…' : `Join the ${label} Bowl Pick'em`}
                  </button>
                </>
              ) : (
                <p className="relative text-zinc-300 text-sm mt-2">This year&apos;s picks are locked, so joining is closed.</p>
              )
            ) : (
              <>
                <p className="relative text-zinc-300 text-sm mt-2">
                  {account.email} isn&apos;t in the Bowl Pick&apos;em yet. Ask Michael for an invite.
                </p>
                <button
                  onClick={async () => { await signOut(); router.replace('/bowls/login') }}
                  className="press mt-4 px-5 py-2.5 rounded-xl bg-black/20 text-white font-semibold text-sm hover:bg-black/30 transition"
                >
                  Sign out
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-zinc-800/90 via-zinc-900 to-zinc-950 border border-yellow-600/25 p-5 shadow-lg shadow-black/40">
            <img src="/logos/cfp-trophy.svg" alt="" aria-hidden="true" className="pointer-events-none absolute -right-4 -bottom-6 h-40 w-auto opacity-[0.12]" />
            <p className="relative text-yellow-500 text-xs font-semibold uppercase tracking-wider">{label} season</p>
            <h1 className="relative text-2xl font-bold text-white mt-0.5">You&apos;re in, {player!.name.split(' ')[0]}!</h1>
            <p className="relative text-zinc-300 text-sm mt-2">
              {status === 'setup'
                ? 'Picks open once the College Football Playoff field is set on Selection Sunday. All picks are due at the first kickoff.'
                : status === 'open'
                  ? sheet?.lockAt ? <>Picks are open — due <strong>{lockText(sheet.lockAt)}</strong>{countdown(sheet.lockAt) ? ` (${countdown(sheet.lockAt)} to go)` : ''}.</> : 'Picks are open — they’re due at the first kickoff.'
                  : status === 'locked'
                    ? `Picks are locked${sheet?.lockAt ? ` — they were due ${lockText(sheet.lockAt)}` : ''}. Games are under way.`
                    : 'This bowl season is complete.'}
            </p>
            {status === 'setup' && sheet?.preview && (
              <>
                <p className="relative text-zinc-300 text-sm mt-2">
                  Until then, try a preview with last season&apos;s matchups — nothing you tap is saved.
                </p>
                <Link href="/bowls/picks"
                  className="relative press inline-block mt-4 w-full sm:w-auto text-center px-6 py-3 rounded-xl bg-gradient-to-b from-yellow-400 to-yellow-600 text-zinc-950 font-bold text-sm hover:brightness-110 transition">
                  Try the preview
                </Link>
              </>
            )}
            {status === 'open' && mine && sheet && (
              <p className="text-white text-sm font-semibold mt-2">
                {mine.complete ? '✓ Your picks are all in.' : `You've made ${mine.picked} of ${sheet.totalGames} picks.`}
              </p>
            )}
            {status === 'open' && (
              <Link href="/bowls/picks"
                className="relative press inline-block mt-4 w-full sm:w-auto text-center px-6 py-3 rounded-xl bg-gradient-to-b from-yellow-400 to-yellow-600 text-zinc-950 font-bold text-sm hover:brightness-110 transition">
                {mine?.complete ? 'Review your picks' : mine?.picked ? 'Finish your picks' : 'Make your picks'}
              </Link>
            )}
            {(status === 'locked' || status === 'complete') && (
              <div className="relative mt-4 flex flex-col sm:flex-row gap-2">
                <Link href="/bowls/all-picks"
                  className="press text-center px-6 py-3 rounded-xl bg-gradient-to-b from-yellow-400 to-yellow-600 text-zinc-950 font-bold text-sm hover:brightness-110 transition">
                  See everyone&apos;s picks
                </Link>
                <Link href="/bowls/standings"
                  className="press text-center px-6 py-3 rounded-xl bg-zinc-800 border border-white/[0.1] text-white font-semibold text-sm hover:bg-zinc-700 transition">
                  Standings
                </Link>
              </div>
            )}
          </div>
        )}

        {leaders && <TodaysGames board={leaders} live={live.byGameId} me={player?.id} />}

        {leaders && <LeaderboardCard board={leaders} me={player?.id} />}

        {!setupMissing && roster.length > 0 && !leaders && (
          <div className="glass-card rounded-2xl p-4">
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-3">
              Who&apos;s in · {roster.length}{sheetOut && ` · ${doneCount} done`}
            </p>
            <div className="flex flex-wrap gap-3">
              {roster.map(p => {
                const prog = progressOf.get(p.id)
                return (
                  <div key={p.id} className="flex flex-col items-center w-14">
                    <span className="relative">
                      <BowlAvatar name={p.name} url={p.avatar_url} size={36} />
                      {sheetOut && prog?.complete && (
                        <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-500 border-2 border-zinc-950 text-[8px] text-white flex items-center justify-center" aria-label="All picks in">✓</span>
                      )}
                    </span>
                    <span className={`text-[10px] mt-1 truncate w-full text-center ${p.id === player?.id ? 'text-yellow-400 font-semibold' : 'text-zinc-400'}`}>
                      {p.name.split(' ')[0]}
                    </span>
                    {sheetOut && !prog?.complete && (
                      <span className="text-[9px] text-zinc-500 tabular-nums">{prog?.picked ?? 0}/{sheet!.totalGames}</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {!setupMissing && <BowlRules />}

        {isAdmin && !setupMissing && (
          <div className="grid sm:grid-cols-2 gap-3">
            <Link href="/bowls/admin/sheet" className="press block glass-card rounded-2xl px-4 py-3 hover:bg-white/[0.04] transition">
              <p className="text-sm font-semibold text-white">🗓️ Games</p>
              <p className="text-xs text-zinc-500 mt-0.5">Pull from ESPN, arrange the phases and bracket, open picks, update results</p>
            </Link>
            <Link href="/bowls/admin" className="press block glass-card rounded-2xl px-4 py-3 hover:bg-white/[0.04] transition">
              <p className="text-sm font-semibold text-white">🔧 Players</p>
              <p className="text-xs text-zinc-500 mt-0.5">Invite players, enter picks someone sent you</p>
            </Link>
          </div>
        )}
      </main>
    </div>
  )
}
