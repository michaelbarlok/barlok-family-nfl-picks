import { useEffect, useMemo, useState } from 'react'
import { getTeam } from '@/lib/nflTeams'
import { shortName } from '@/lib/displayName'
import { leaderOf, type LiveGame } from '@/lib/liveScores'
import FieldStrip from '@/components/FieldStrip'
import PlayFlash from '@/components/PlayFlash'
import type { PlayEvent } from '@/lib/useLiveEvents'

/*
 * All Picks, one card per game: who's on each side, rather than a 15-column
 * table. The table is still a toggle away for anyone who prefers it.
 *
 *   - a split bar, then the players on each side as name chips
 *   - ⭐ on Best 3 picks, your own chip highlighted
 *   - at the final the winning side turns green and the losing side fades;
 *     while a game is on, the live score sits in the header
 *   - small callouts: a lone wolf, a unanimous pick, the week's biggest upset
 *   - "Follow" a player to light up their chips on every card
 */

interface Game {
  id: string
  away_team: string
  home_team: string
  kickoff_time: string
  winning_team: string | null
  away_score: number | null
  home_score: number | null
}

interface Player { id: string; name: string; avatar_url: string | null }

type SortBy = 'kickoff' | 'split' | 'live'

const SHOW_PICKS_KEY = 'allpicks-show-picks'

export default function GamesView({ games, users, pickOf, bestOf, meId, live, events, formatKickoff }: {
  games: Game[]
  users: Player[]
  /** The team a player picked for a game, if any. */
  pickOf: (userId: string, gameId: string) => string | undefined
  /** Teams in a player's Best 3 this week. */
  bestOf: (userId: string) => Set<string> | undefined
  meId: string
  live: Map<string, LiveGame>
  /** Big plays happening right now, for the scoreboard highlight. */
  events: Map<string, PlayEvent>
  formatKickoff: (iso: string) => string
}) {
  const [follow, setFollow] = useState<string | null>(null)
  // Picks on by default; off leaves just the scoreboards. Remembered per device.
  const [showPicks, setShowPicks] = useState(true)
  useEffect(() => {
    try { if (window.localStorage.getItem(SHOW_PICKS_KEY) === '0') setShowPicks(false) } catch { /* private mode */ }
  }, [])
  const toggleShowPicks = () => {
    setShowPicks(v => {
      try { window.localStorage.setItem(SHOW_PICKS_KEY, v ? '0' : '1') } catch { /* private mode */ }
      return !v
    })
  }
  const anyLive = [...live.values()].some(g => g.state === 'in')
  const [sortBy, setSortBy] = useState<SortBy>(anyLive ? 'live' : 'kickoff')

  // Only people who picked something this week — a player who sat the week
  // out would otherwise appear under "no pick" on every single card.
  const players = useMemo(
    () => users.filter(u => games.some(g => pickOf(u.id, g.id))),
    [users, games, pickOf],
  )

  const cards = useMemo(() => games.map((g, i) => {
    const away = players.filter(p => pickOf(p.id, g.id) === g.away_team)
    const home = players.filter(p => pickOf(p.id, g.id) === g.home_team)
    const none = players.filter(p => !pickOf(p.id, g.id))
    const lg = live.get(g.id)
    const finalWinner = g.winning_team ?? (lg?.state === 'post' ? leaderOf(lg) : null)
    return { g, i, away, home, none, lg, finalWinner }
  }), [games, players, pickOf, live])

  // The week's biggest upset: the finished game whose winners were the
  // smallest share of the family (and under half of it).
  const upsetId = useMemo(() => {
    let best: { id: string; share: number } | null = null
    for (const c of cards) {
      if (!c.finalWinner || c.finalWinner === 'TIE') continue
      const total = c.away.length + c.home.length
      if (total < 3) continue
      const right = (c.finalWinner === c.g.away_team ? c.away : c.home).length
      const share = right / total
      if (share < 0.5 && (!best || share < best.share)) best = { id: c.g.id, share }
    }
    return best?.id ?? null
  }, [cards])

  const phase = (c: (typeof cards)[number]) => (c.finalWinner ? 2 : c.lg?.state === 'in' ? 0 : 1)
  const sorted = [...cards].sort((a, b) => {
    if (sortBy === 'live') return phase(a) - phase(b) || a.i - b.i
    if (sortBy === 'split') {
      const gap = (c: (typeof cards)[number]) => Math.abs(c.away.length - c.home.length)
      return gap(a) - gap(b) || a.i - b.i
    }
    return a.i - b.i
  })

  // Following someone else: how often they're on your side this week.
  const agreement = useMemo(() => {
    if (!follow || follow === meId) return null
    let same = 0, both = 0
    for (const g of games) {
      const a = pickOf(follow, g.id), b = pickOf(meId, g.id)
      if (a && b) { both++; if (a === b) same++ }
    }
    return both > 0 ? { same, both } : null
  }, [follow, meId, games, pickOf])

  const followed = players.find(p => p.id === follow)

  return (
    <div>
      {/* Follow a player — only meaningful while picks are showing */}
      {showPicks && (
      <div className="mb-3">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Follow a player</p>
        <div className="-mx-3 px-3 sm:mx-0 sm:px-0 flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
          {[...players].sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : a.name.localeCompare(b.name))).map(p => {
            const on = follow === p.id
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setFollow(on ? null : p.id)}
                aria-pressed={on}
                className={`press shrink-0 flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border text-xs font-medium transition ${
                  on ? 'bg-blue-500/20 border-blue-400/50 text-blue-200' : 'bg-white/[0.03] border-white/[0.08] text-slate-400 hover:text-slate-200'
                }`}
              >
                <Avatar name={p.name} url={p.avatar_url} size={20} />
                {p.id === meId ? 'You' : shortName(p.name)}
              </button>
            )
          })}
        </div>
        {followed && (
          <p className="text-[11px] text-slate-400 mt-1.5">
            Following <span className="text-blue-300 font-medium">{followed.id === meId ? 'you' : shortName(followed.name)}</span>
            {agreement && <> · on your side for {agreement.same} of {agreement.both} games</>}
          </p>
        )}
      </div>
      )}

      {/* Sort, and the picks switch */}
      <div className="flex flex-wrap items-center gap-1 mb-4">
        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mr-1">Sort</span>
        {([['kickoff', 'Kickoff'], ['split', 'Closest split'], ['live', 'Live first']] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setSortBy(k)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition ${
              sortBy === k ? 'bg-white/[0.10] text-white' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          role="switch"
          aria-checked={showPicks}
          onClick={toggleShowPicks}
          className="ml-auto flex items-center gap-2 text-[11px] font-medium text-slate-400 hover:text-slate-200 transition"
        >
          Show picks
          <span className={`relative w-8 h-[18px] rounded-full transition-colors ${showPicks ? 'bg-blue-500' : 'bg-white/[0.12]'}`}>
            <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-all ${showPicks ? 'left-[16px]' : 'left-[2px]'}`} />
          </span>
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sorted.map(c => (
          <GameCard
            key={c.g.id}
            card={c}
            meId={meId}
            follow={follow}
            bestOf={bestOf}
            isUpset={c.g.id === upsetId}
            showPicks={showPicks}
            event={events.get(c.g.id)}
            formatKickoff={formatKickoff}
          />
        ))}
      </div>
    </div>
  )
}

function GameCard({ card, meId, follow, bestOf, isUpset, showPicks, event, formatKickoff }: {
  card: {
    g: Game
    away: Player[]
    home: Player[]
    none: Player[]
    lg: LiveGame | undefined
    finalWinner: string | null
  }
  meId: string
  follow: string | null
  bestOf: (userId: string) => Set<string> | undefined
  isUpset: boolean
  showPicks: boolean
  event: PlayEvent | undefined
  formatKickoff: (iso: string) => string
}) {
  const { g, away, home, none, lg, finalWinner } = card
  // The team whose score just moved gets a one-off bounce.
  const popTeam = event && event.kind !== 'turnover' ? event.team : null
  const total = Math.max(1, away.length + home.length)
  const isLive = lg?.state === 'in'
  const isFinal = !!finalWinner
  const score = (team: string): number | null => {
    if (g.winning_team && g.away_score != null && g.home_score != null) return team === g.away_team ? g.away_score : g.home_score
    if (lg && lg.state !== 'pre') return team === g.away_team ? lg.awayScore : lg.homeScore
    return null
  }
  const liveLeader = isLive && lg ? leaderOf(lg) : null

  // One callout per card, most interesting first.
  const callout = isUpset
    ? `🚨 Upset — only ${(finalWinner === g.away_team ? away : home).length} called it`
    : away.length === 0 || home.length === 0
      ? `🤝 Everyone on ${away.length === 0 ? g.home_team : g.away_team}`
      : away.length === 1 && home.length >= 3
        ? `🐺 Only ${shortName(away[0].name)} took ${g.away_team}`
        : home.length === 1 && away.length >= 3
          ? `🐺 Only ${shortName(home[0].name)} took ${g.home_team}`
          : null

  // ── Scoreboard: one team's logo, code and score ──
  const scoreSide = (team: string, align: 'left' | 'right') => {
    const won = isFinal && finalWinner === team
    const lost = isFinal && finalWinner !== team && finalWinner !== 'TIE'
    const ahead = liveLeader === team
    const sc = score(team)
    const t = getTeam(team)
    return (
      <div className={`flex items-center gap-2 min-w-0 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}>
        <img src={t.logo} alt="" className="w-9 h-9 object-contain shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        <div className="min-w-0">
          <p className={`text-base font-extrabold leading-none ${won ? 'text-emerald-400' : lost ? 'text-slate-500' : 'text-white'}`}>
            {team}
            {isLive && lg?.possession === team && <span className="ml-1 text-xs" title="Has the ball">🏈</span>}
          </p>
          {sc === null && <p className="text-[10px] text-slate-500 leading-tight mt-0.5 truncate">{t.name}</p>}
        </div>
        {sc !== null && (
          <span
            key={popTeam === team ? event?.key : 'still'}
            className={`${align === 'right' ? 'mr-auto' : 'ml-auto'} text-3xl font-black tabular-nums leading-none ${
              won ? 'text-emerald-400' : lost ? 'text-slate-600' : isFinal || ahead ? 'text-white' : 'text-slate-400'
            } ${popTeam === team ? 'score-pop' : ''}`}
          >{sc}</span>
        )}
      </div>
    )
  }

  // ── Picks: who's on one side ──
  const picksSide = (team: string, people: Player[], align: 'left' | 'right') => {
    const won = isFinal && finalWinner === team
    const lost = isFinal && finalWinner !== team && finalWinner !== 'TIE'
    // You first, then whoever you're following, then alphabetical.
    const ordered = [...people].sort((a, b) => {
      const rank = (p: Player) => (p.id === meId ? 0 : p.id === follow ? 1 : 2)
      return rank(a) - rank(b) || a.name.localeCompare(b.name)
    })
    return (
      <div className={`min-w-0 px-3 pt-2 pb-3 transition ${won ? 'bg-emerald-500/[0.06]' : lost ? 'opacity-55' : ''}`}>
        <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${align === 'right' ? 'text-right' : ''} ${won ? 'text-emerald-400/80' : 'text-slate-500'}`}>
          {team}{won ? ' ✓' : ''}
        </p>
        <div className={`flex flex-wrap gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
          {ordered.map(p => {
            const me = p.id === meId
            const followed = p.id === follow
            const starred = bestOf(p.id)?.has(team) ?? false
            return (
              <span
                key={p.id}
                className={`inline-flex items-center gap-1 pl-0.5 pr-2 py-0.5 rounded-full text-[11px] border transition ${
                  me ? 'bg-blue-500/20 border-blue-400/40 text-blue-200 font-semibold'
                    : followed ? 'bg-white/[0.10] border-blue-400/60 text-white font-semibold ring-1 ring-blue-400/40'
                      : follow ? 'bg-white/[0.02] border-white/[0.05] text-slate-500'
                        : 'bg-white/[0.04] border-white/[0.06] text-slate-300'
                }`}
              >
                <Avatar name={p.name} url={p.avatar_url} size={16} />
                {me ? 'You' : shortName(p.name)}
                {starred && <span className="text-[9px]" title="Best 3 pick">⭐</span>}
              </span>
            )
          })}
          {people.length === 0 && <span className="text-[11px] text-slate-600 italic">Nobody</span>}
        </div>
      </div>
    )
  }

  return (
    <div id={`game-${g.id}`} className={`glass-card rounded-2xl overflow-hidden scroll-mt-28 ${
      isLive ? 'border-red-500/30' : isUpset ? 'border-amber-500/30' : ''
    }`}>
      {/* ── Scoreboard ── the game itself, set apart on a darker panel so it
          reads first and never blurs into the list of names below it. */}
      <div className={`relative px-3 pt-2.5 pb-3 ${showPicks ? 'border-b' : ''} ${
        isLive ? 'bg-gradient-to-b from-red-500/[0.10] to-black/30 border-red-500/20' : 'bg-black/25 border-white/[0.08]'
      }`}>
        <PlayFlash event={event} />
        <div className="flex items-center justify-center gap-2 mb-2.5 min-h-[18px]">
          {isLive ? (
            <>
              <span className="flex items-center gap-1.5 text-[11px] font-bold text-red-400">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />LIVE
              </span>
              <span className="text-[11px] font-mono font-semibold text-white">{lg?.label}</span>
              {lg?.redZone && <span className="text-[9px] font-bold text-red-300 bg-red-500/20 px-1.5 py-0.5 rounded-full">RED ZONE</span>}
            </>
          ) : isFinal ? (
            <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
              {lg?.label === 'Final/OT' ? 'Final/OT' : 'Final'}{finalWinner === 'TIE' ? ' · Tie' : ''}
            </span>
          ) : (
            <span className="text-[11px] text-slate-400">{formatKickoff(g.kickoff_time)}</span>
          )}
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          {scoreSide(g.away_team, 'left')}
          <span className="text-[10px] font-bold text-slate-600">{score(g.away_team) !== null ? '–' : '@'}</span>
          {scoreSide(g.home_team, 'right')}
        </div>

        {isLive && lg && (
          <div className="mt-3">
            <FieldStrip game={lg} />
            {lg.lastPlay && <p className="text-[10px] text-slate-400 leading-snug mt-1 line-clamp-2">Last play: {lg.lastPlay}</p>}
          </div>
        )}
      </div>

      {/* ── Picks ── */}
      {showPicks && (<>
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.15em] shrink-0">Picks</p>
        <div className="flex-1 flex h-1 rounded-full overflow-hidden bg-white/[0.06]">
          <div className={finalWinner === g.away_team ? 'bg-emerald-500/70' : 'bg-blue-500/60'} style={{ width: `${(away.length / total) * 100}%` }} />
          <div className={finalWinner === g.home_team ? 'bg-emerald-500/70' : 'bg-indigo-400/40'} style={{ width: `${(home.length / total) * 100}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-2 divide-x divide-white/[0.06]">
        {picksSide(g.away_team, away, 'left')}
        {picksSide(g.home_team, home, 'right')}
      </div>

      {(callout || none.length > 0) && (
        <div className="px-3 py-2 border-t border-white/[0.04] flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          {callout && <span className="text-[11px] text-amber-400/90">{callout}</span>}
          {none.length > 0 && (
            <span className="text-[10px] text-slate-600 ml-auto">No pick: {none.map(p => (p.id === meId ? 'You' : shortName(p.name))).join(', ')}</span>
          )}
        </div>
      )}
      </>)}
    </div>
  )
}

function Avatar({ name, url, size }: { name: string; url: string | null; size: number }) {
  if (url) {
    return <img src={url} alt="" loading="lazy" decoding="async" className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />
  }
  return (
    <span
      className="rounded-full bg-gradient-to-br from-slate-600 to-slate-700 text-slate-200 font-bold flex items-center justify-center shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  )
}
