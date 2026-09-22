import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useSeason } from '@/lib/season'
import { fetchAllRows } from '@/lib/fetchAll'
import { buildDigest, type Digest, type DigestPlayer } from '@/lib/weeklyDigest'
import { shortName } from '@/lib/displayName'
import Nav from '@/components/Nav'

interface Player { id: string; name: string; avatar_url: string | null }

const record = (t: { wins: number; losses: number; ties: number }) =>
  `${t.wins}-${t.losses}${t.ties > 0 ? `-${t.ties}` : ''}`

const nameList = (list: { name: string }[] | string[]) => {
  const flat = list.map(x => (typeof x === 'string' ? x : x.name))
  return flat.length <= 1 ? flat.join('') : `${flat.slice(0, -1).join(', ')} and ${flat[flat.length - 1]}`
}

/**
 * The full weekly recap, opened from the card in 💩 Talk (or linked from an
 * email). It's a real in-app page, so a tap from the thread stays inside the
 * PWA and "Back to Talk" returns without a reload.
 *
 * Content is buildDigest() run in the browser — the same function the email and
 * the admin preview use — so all three always say the same thing.
 */
export default function RecapPage() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const { season: liveSeason } = useSeason()

  const season = router.query.season ? parseInt(String(router.query.season)) : liveSeason
  const weekParam = router.query.week ? parseInt(String(router.query.week)) : null

  const [digest, setDigest] = useState<Digest | null>(null)
  const [avatars, setAvatars] = useState<Map<string, string | null>>(new Map())
  const [dataLoading, setDataLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!loading && !user) router.push('/login')
  }, [user, loading, router])

  const load = useCallback(async () => {
    if (!season) return
    setDataLoading(true)
    try {
      const [{ data: users }, { data: games }, picks, { data: threeBests }] = await Promise.all([
        supabase.from('users').select('id, name, avatar_url').order('name'),
        supabase.from('games').select('id, week, away_team, home_team, winning_team').eq('season', season),
        fetchAllRows<{ user_id: string; game_id: string; picked_team: string; week: number }>((from, to) =>
          supabase.from('picks').select('user_id, game_id, picked_team, week')
            .eq('season', season).order('id').range(from, to)),
        supabase.from('three_best').select('user_id, week, pick_1, pick_2, pick_3').eq('season', season),
      ])

      const roster = (users ?? []) as Player[]
      setAvatars(new Map(roster.map(u => [u.id, u.avatar_url])))

      // Default to the newest finished week, so the page stands alone if opened
      // without a week.
      const decided = (games ?? []).filter(g => g.winning_team)
      const complete = [...new Set(decided.map(g => g.week))].filter(w =>
        (games ?? []).filter(g => g.week === w).every(g => g.winning_team))
      const week = weekParam ?? (complete.length ? Math.max(...complete) : null)

      if (!week) { setDigest(null); setError('No week has finished yet.'); return }

      setDigest(buildDigest({
        week, season,
        users: roster.map(u => ({ id: u.id, name: u.name })),
        games: games ?? [],
        picks,
        threeBests: threeBests ?? [],
      }))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the recap')
    } finally {
      setDataLoading(false)
    }
  }, [season, weekParam])

  // /recap is statically prerendered, so on a direct open (a reload, the PWA
  // reopening it, a link from an email or push) router.query is empty on the
  // first render. Wait for it, or the page would load the default week first
  // and then load again once `week` arrives.
  //
  // Keyed on the user's id rather than the user object, so replacing that
  // object (an avatar change, say) doesn't refetch the whole season.
  const userId = user?.id
  useEffect(() => { if (userId && router.isReady) load() }, [userId, router.isReady, load])

  const Avatar = ({ id, name, size = 'w-8 h-8' }: { id: string; name: string; size?: string }) => {
    const url = avatars.get(id)
    return url
      ? <img src={url} alt="" className={`${size} rounded-full object-cover border border-white/[0.08]`} />
      : <span className={`${size} rounded-full bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center text-xs font-bold text-white`}>{name.charAt(0)}</span>
  }

  if (loading || dataLoading) {
    return (
      <div className="min-h-screen bg-surface pb-20">
        <Nav />
        <main className="max-w-2xl mx-auto px-4 py-6">
          <div className="skeleton h-6 w-40 rounded mb-4" />
          <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-16 rounded-2xl" />)}</div>
        </main>
      </div>
    )
  }
  if (!user) return null

  return (
    <div className="min-h-screen bg-surface pb-20">
      <Nav />
      <main className="max-w-2xl mx-auto px-4 py-6 animate-fade-in">
        <Link href="/talk" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition mb-4">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          Back to Talk
        </Link>

        {!digest ? (
          <div className="glass-card rounded-2xl p-10 text-center">
            <p className="text-4xl mb-3">🏈</p>
            <p className="text-white font-medium">{error || 'No recap yet'}</p>
          </div>
        ) : (
          <>
            {/* Banner */}
            <div className="rounded-2xl overflow-hidden mb-5 bg-gradient-to-br from-blue-600 to-indigo-700 p-5 shadow-lg shadow-blue-600/20">
              <p className="text-white/80 text-xs font-semibold uppercase tracking-wider">{digest.season} Season</p>
              <h1 className="text-2xl font-bold text-white mt-0.5">🏆 Week {digest.week} Recap</h1>
              <p className="text-white/70 text-sm mt-1">
                {digest.gamesInWeek} games · {digest.weeksRemaining} week{digest.weeksRemaining === 1 ? '' : 's'} to go
                {!digest.complete && ` · ${digest.gamesDecided}/${digest.gamesInWeek} scored`}
              </p>
            </div>

            {/* Highlights */}
            <div className="space-y-2.5 mb-6">
              {digest.leaders.length > 0 && (
                <Highlight emoji="🥇" title={digest.leaders.length > 1 ? `${nameList(digest.leaders)} tied for the week` : `${digest.leaders[0].name} won the week`}
                  sub={`${record(digest.leaders[0].week)} on the week`} players={digest.leaders} Avatar={Avatar} />
              )}
              {digest.perfect.length > 0 && (
                <Highlight emoji="🏆" title={`Perfect week — ${nameList(digest.perfect)}`} sub="Every single game. Not one miss." players={digest.perfect} Avatar={Avatar} />
              )}
              {digest.bestThreeSweeps.length > 0 && (
                <Highlight emoji="⭐" title={`Best 3 swept — ${nameList(digest.bestThreeSweeps)}`} sub="Three out of three on the picks that count double." players={digest.bestThreeSweeps} Avatar={Avatar} />
              )}
              {digest.climbers.length > 0 && (
                <Highlight emoji="📈" title={`Biggest climb — ${nameList(digest.climbers)}`} sub={`Up ${digest.climbers[0].rankChange} place${digest.climbers[0].rankChange === 1 ? '' : 's'} in the standings.`} players={digest.climbers} Avatar={Avatar} />
              )}
              {digest.upset && (
                <Highlight emoji="🔮"
                  title={digest.upset.calledBy.length === 0 ? 'Nobody saw it coming' : `Called it — ${nameList(digest.upset.calledBy)}`}
                  sub={digest.upset.calledBy.length === 0
                    ? `${digest.upset.winner} beat the whole league in ${digest.upset.away} @ ${digest.upset.home}.`
                    : `${digest.upset.winner} won ${digest.upset.away} @ ${digest.upset.home} — ${digest.upset.calledBy.length} of ${digest.upset.outOf} saw it.`} />
              )}
            </div>

            {/* Everyone's week */}
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Everyone&apos;s week</p>
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-3 px-4 py-2 border-b border-white/[0.06] text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                <span>#</span><span>Player</span><span className="text-center">Week</span><span className="text-center">Best 3</span><span className="text-center">Move</span>
              </div>
              {digest.players.map((p, i) => (
                <div key={p.id} className={`grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-3 px-4 py-2.5 items-center ${i % 2 ? '' : 'bg-white/[0.02]'}`}>
                  <span className="text-xs text-slate-500 w-8">{p.isTied ? 'T-' : ''}{p.rank}</span>
                  <span className="flex items-center gap-2 min-w-0">
                    <Avatar id={p.id} name={p.name} size="w-7 h-7" />
                    <span className="text-sm font-medium text-white truncate">{shortName(p.name)}{p.perfect ? ' 🏆' : ''}</span>
                  </span>
                  <span className="text-sm text-slate-200 text-center tabular-nums">{record(p.week)}</span>
                  <span className="text-xs text-amber-400/90 text-center tabular-nums">{record(p.best3)}</span>
                  <span className="text-xs text-center tabular-nums">
                    {p.rankChange === null || p.rankChange === 0
                      ? <span className="text-slate-600">–</span>
                      : p.rankChange > 0 ? <span className="text-emerald-400">▲{p.rankChange}</span>
                      : <span className="text-red-400">▼{Math.abs(p.rankChange)}</span>}
                  </span>
                </div>
              ))}
            </div>

            <Link href="/standings" className="mt-5 block text-center py-2.5 bg-white/[0.06] hover:bg-white/[0.10] rounded-xl text-sm font-medium text-slate-300 transition">
              Full season standings →
            </Link>
          </>
        )}
      </main>
    </div>
  )
}

function Highlight({ emoji, title, sub, players, Avatar }: {
  emoji: string
  title: string
  sub: string
  players?: DigestPlayer[]
  Avatar?: (props: { id: string; name: string; size?: string }) => JSX.Element
}) {
  return (
    <div className="glass-card rounded-2xl p-4 flex items-start gap-3">
      <span className="text-2xl leading-none shrink-0">{emoji}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
      </div>
      {players && Avatar && players.length <= 3 && (
        <div className="flex -space-x-2 shrink-0">
          {players.map(p => <Avatar key={p.id} id={p.id} name={p.name} size="w-8 h-8" />)}
        </div>
      )}
    </div>
  )
}
