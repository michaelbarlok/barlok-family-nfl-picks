import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '@/lib/supabase'
import { useBowlAuth } from '@/lib/bowls/auth'
import { BOWL_NAME, bowlSeasonLabel } from '@/lib/bowls/constants'
import { useToast } from '@/components/Toast'
import BowlHeader, { BowlAvatar } from '@/components/bowls/BowlHeader'
import BowlRules from '@/components/bowls/BowlRules'

interface Season { season: number; status: 'setup' | 'open' | 'locked' | 'complete' }
interface RosterPlayer { id: string; name: string; avatar_url: string | null }

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
    setDataLoading(false)
  }, [])

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
      <div className="min-h-screen bg-surface">
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
  const canJoin = !!season && (season.status === 'setup' || season.status === 'open')

  return (
    <div className="min-h-screen bg-surface pb-12">
      <BowlHeader subtitle={label ? `${label} season` : undefined} />
      <main className="max-w-3xl mx-auto px-4 py-5 space-y-4 animate-fade-in">
        {setupMissing ? (
          <div className="glass-card rounded-2xl p-6 text-center">
            <p className="text-3xl mb-2">🛠️</p>
            <p className="text-white font-medium">The Bowl Pick&apos;em isn&apos;t set up yet</p>
            {isAdmin && (
              <p className="text-xs text-slate-400 mt-2">Run supabase/migrations/20_bowl_pickem.sql in the Supabase SQL editor.</p>
            )}
          </div>
        ) : !inSeason ? (
          <div className="rounded-2xl overflow-hidden bg-gradient-to-br from-amber-600 to-orange-700 p-5 shadow-lg shadow-amber-600/20">
            <p className="text-white/80 text-xs font-semibold uppercase tracking-wider">{label} season</p>
            <h1 className="text-2xl font-bold text-white mt-0.5">{BOWL_NAME}</h1>
            {player || nflProfile ? (
              canJoin ? (
                <>
                  <p className="text-white/85 text-sm mt-2">
                    Pick every bowl game and the College Football Playoff. Join to get the pick sheet when it comes out.
                  </p>
                  {joinError && <p className="mt-3 text-sm bg-black/20 rounded-lg px-3 py-2 text-white">{joinError}</p>}
                  <button
                    onClick={join}
                    disabled={joining}
                    className="press mt-4 w-full sm:w-auto px-6 py-3 rounded-xl bg-white text-orange-700 font-bold text-sm hover:bg-white/90 disabled:opacity-60 transition"
                  >
                    {joining ? 'Joining…' : `Join the ${label} Bowl Pick'em`}
                  </button>
                </>
              ) : (
                <p className="text-white/85 text-sm mt-2">This year&apos;s picks are locked, so joining is closed.</p>
              )
            ) : (
              <>
                <p className="text-white/85 text-sm mt-2">
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
          <div className="rounded-2xl overflow-hidden bg-gradient-to-br from-amber-600 to-orange-700 p-5 shadow-lg shadow-amber-600/20">
            <p className="text-white/80 text-xs font-semibold uppercase tracking-wider">{label} season</p>
            <h1 className="text-2xl font-bold text-white mt-0.5">You&apos;re in, {player!.name.split(' ')[0]}!</h1>
            <p className="text-white/85 text-sm mt-2">
              {season?.status === 'setup'
                ? 'The pick sheet comes out once the College Football Playoff field is set on Selection Sunday. All picks are due at the first kickoff.'
                : season?.status === 'open'
                  ? 'Picks are open — they’re due at the first kickoff.'
                  : season?.status === 'locked'
                    ? 'Picks are locked. Games are under way.'
                    : 'This bowl season is complete.'}
            </p>
          </div>
        )}

        {!setupMissing && roster.length > 0 && (
          <div className="glass-card rounded-2xl p-4">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
              Who&apos;s in · {roster.length}
            </p>
            <div className="flex flex-wrap gap-3">
              {roster.map(p => (
                <div key={p.id} className="flex flex-col items-center w-14">
                  <BowlAvatar name={p.name} url={p.avatar_url} size={36} />
                  <span className={`text-[10px] mt-1 truncate w-full text-center ${p.id === player?.id ? 'text-amber-400 font-semibold' : 'text-slate-400'}`}>
                    {p.name.split(' ')[0]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!setupMissing && <BowlRules />}

        {isAdmin && !setupMissing && (
          <Link href="/bowls/admin" className="press block glass-card rounded-2xl px-4 py-3 hover:bg-white/[0.04] transition">
            <p className="text-sm font-semibold text-white">🔧 Bowl admin</p>
            <p className="text-xs text-slate-500 mt-0.5">Invite players and manage this season</p>
          </Link>
        )}
      </main>
    </div>
  )
}
