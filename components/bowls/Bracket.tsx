import { useMemo } from 'react'
import { indexGames, optionsFor } from '@/lib/bowls/bracket'
import { bracketRounds, playoffSummary } from '@/lib/bowls/bracketView'
import { eliminated, isDecided, pickState, teamDirectory, type PickState } from '@/lib/bowls/scoring'
import type { BowlGame, BowlTeam } from '@/lib/bowls/sheet'
import { BowlAvatar } from '@/components/bowls/BowlHeader'
import { TeamLogo } from '@/components/bowls/ui'
import { firstName, type Board } from '@/components/bowls/board'

/**
 * All Picks › Bracket: one player's College Football Playoff bracket, round by
 * round, next to what's happened — right picks lit up, wrong ones crossed out,
 * and picks on a team that's already out marked busted. Above it, how
 * everyone's champion pick is doing.
 */
export function BracketView({ board, me, selected, onSelect }: { board: Board; me?: string; selected?: string; onSelect: (id: string) => void }) {
  const games = useMemo(() => board.games ?? [], [board])
  const rounds = useMemo(() => bracketRounds(games), [games])
  const standings = board.standings ?? []
  const look = useMemo(() => ({ byId: indexGames(games), out: eliminated(games), teams: teamDirectory(games) }), [games])
  const summary = useMemo(() => playoffSummary(games, board.picks ?? {}, standings.map(s => s.id)), [games, board.picks, standings])
  if (!rounds.length) return <p className="text-sm text-zinc-500 px-1 py-6 text-center">The playoff isn&apos;t on the sheet yet.</p>

  const id = selected && standings.some(s => s.id === selected) ? selected : (me && standings.some(s => s.id === me) ? me : standings[0]?.id)
  const who = standings.find(s => s.id === id)
  const picks = (id && board.picks?.[id]) || {}
  const nameOf = new Map(standings.map(s => [s.id, firstName(s.name)]))

  return (
    <div className="space-y-3">
      {/* Champion picks across the pick'em. */}
      <section className="glass-card rounded-2xl p-4" aria-label="Champion picks">
        <p className="text-sm font-bold text-white">
          {summary.decided
            ? <>Called the champion: <span className="text-yellow-400 tabular-nums">{summary.called} of {summary.total}</span></>
            : <>Champion still alive for <span className="text-yellow-400 tabular-nums">{summary.alive} of {summary.total}</span></>}
        </p>
        <p className="text-[11px] text-zinc-500 mt-0.5">
          {summary.perfect === 1 ? '1 bracket is' : `${summary.perfect} brackets are`} still perfect — every playoff pick right so far.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {summary.champions.map(c => (
            <span key={c.team.id} title={c.players.map(p => nameOf.get(p)).join(', ')}
              className={`inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full border text-[11px] ${c.state === 'out' ? 'border-white/[0.06] text-zinc-500 line-through' : c.state === 'won' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-yellow-500/30 bg-yellow-500/[0.08] text-yellow-100'}`}>
              <TeamLogo team={c.team} size={16} />{c.team.name}<span className="tabular-nums font-semibold">{c.players.length}</span>
            </span>
          ))}
        </div>
      </section>

      {/* Whose bracket. */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1" role="tablist" aria-label="Player">
        {standings.map(p => (
          <button key={p.id} role="tab" aria-selected={p.id === id} onClick={() => onSelect(p.id)}
            className={`shrink-0 flex flex-col items-center gap-1 w-14 py-1.5 rounded-xl transition ${p.id === id ? 'bg-yellow-500/15 ring-1 ring-yellow-500/50' : 'hover:bg-white/[0.04]'}`}>
            <BowlAvatar name={p.name} url={p.avatar_url} size={34} />
            <span className={`text-[10px] truncate max-w-[52px] ${p.id === id ? 'text-yellow-300 font-semibold' : 'text-zinc-400'}`}>{firstName(p.name)}</span>
          </button>
        ))}
      </div>

      {who && <p className="text-sm font-semibold text-white px-1">{who.id === me ? 'Your' : `${firstName(who.name)}'s`} bracket</p>}

      {/* The bracket: a column a round, scrolling sideways on a phone. */}
      <div className="overflow-x-auto -mx-4 px-4 pb-2" aria-label="Bracket" role="region">
        <div className="grid gap-3 min-w-[640px]" style={{ gridTemplateColumns: `repeat(${rounds.length}, minmax(0, 1fr))` }}>
          {rounds.map(r => (
            <div key={r.key} className="flex flex-col">
              <p data-round={r.key} className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider px-1 mb-2">{r.label}</p>
              <div className="flex-1 flex flex-col justify-around gap-3">
                {r.games.map(g => <BracketGame key={g.id} game={g} picks={picks} look={look} />)}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-zinc-500 px-1">
        Each game shows the matchup this bracket had. <span className="text-emerald-300">✓</span> right · <span className="text-red-300">✗</span> wrong · <span className="line-through">busted</span>: that team was already out.
      </p>
    </div>
  )
}

const ROW: Record<PickState | 'none', string> = {
  won: 'bg-emerald-500/15 text-emerald-100 font-semibold',
  lost: 'bg-red-500/10 text-red-200 line-through',
  dead: 'bg-white/[0.02] text-zinc-500 line-through',
  pending: 'bg-yellow-500/10 text-yellow-100 font-semibold',
  none: 'text-zinc-300',
}

function BracketGame({ game: g, picks, look }: {
  game: BowlGame
  picks: Record<string, string>
  look: { byId: Map<string, BowlGame>; out: Set<string>; teams: Map<string, BowlTeam> }
}) {
  const [a, h] = optionsFor(g, look.byId, picks)
  const pick = picks[g.id]
  const st = pick ? pickState(g, pick, look.out) : null
  const decided = isDecided(g)
  const winner = decided ? [g.away, g.home].find(t => t?.id === g.winner_team_id) ?? look.teams.get(g.winner_team_id!) ?? null : null
  const row = (t: BowlTeam | null, i: number) => {
    const mine = !!t && t.id === pick
    return (
      <div key={i} className={`flex items-center gap-1.5 px-2 py-1.5 min-w-0 text-xs ${mine ? ROW[st ?? 'none'] : 'text-zinc-400'}`}>
        {t ? <TeamLogo team={t} size={16} /> : <span className="w-4 h-4 rounded-full bg-white/[0.06] shrink-0" />}
        <span className="truncate flex-1">{t?.name ?? 'TBD'}</span>
        {mine && st === 'won' && <span className="shrink-0 text-emerald-300 no-underline">✓</span>}
        {mine && st === 'lost' && <span className="shrink-0 text-red-300">✗</span>}
        {mine && st === 'dead' && <span className="shrink-0 text-[9px] font-bold uppercase text-red-300/80">busted</span>}
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-white/[0.08] bg-zinc-900/80 overflow-hidden" data-bracket-game={g.id} data-state={st ?? 'none'}>
      <p className="px-2 pt-1.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-500 truncate">{g.name.replace(/^CFP (First Round|Quarterfinal|Semifinal) · /, '')}</p>
      <div className="divide-y divide-white/[0.04]">{[a, h].map(row)}</div>
      {decided && winner && winner.id !== pick && (
        <p className="px-2 py-1 text-[10px] text-zinc-500 border-t border-white/[0.04] truncate">Won by {winner.name}</p>
      )}
    </div>
  )
}
