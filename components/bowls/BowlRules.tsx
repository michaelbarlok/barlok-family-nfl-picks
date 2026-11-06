import { PHASE_TONE } from '@/components/bowls/ui'
import type { Phase } from '@/lib/bowls/sheet'

/**
 * How the Bowl Pick'em works — the family's rules, so a new player knows
 * what they've joined before picks open.
 */
export default function BowlRules() {
  const phases: { key: Phase; name: string; points: string }[] = [
    { key: 'little', name: 'Phase 1 · The Little Ones', points: '1 point per win' },
    { key: 'between', name: 'Phase 2 · In Betweeners', points: '1.5 points per win' },
    { key: 'big', name: 'Phase 3 · The Big Ones', points: '2 points per win' },
    { key: 'playoff', name: 'Phase 4 · The Playoff', points: '3 points per win' },
    { key: 'semi', name: 'Semifinals', points: '3 points each' },
    { key: 'title', name: 'National Champion', points: '3 points' },
  ]
  return (
    <div className="glass-card rounded-2xl p-4">
      <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-3">How it works</p>
      <div className="space-y-1.5 mb-4">
        {phases.map(p => (
          <div key={p.key} className="flex items-center gap-2.5 text-sm">
            <span className={`w-2 h-2 rounded-full shrink-0 ${PHASE_TONE[p.key].dot}`} />
            <span className="flex-1 text-zinc-200">{p.name}</span>
            <span className="text-zinc-400 tabular-nums text-xs">{p.points}</span>
          </div>
        ))}
      </div>
      <ul className="space-y-1.5 text-[13px] text-zinc-400 leading-snug list-disc pl-4 marker:text-zinc-600">
        <li>Pick a winner for every game. <strong className="text-zinc-200">All picks are due at the first kickoff</strong> — no changes after.</li>
        <li>The playoff is your own bracket: your quarterfinal picks come from who you picked in the first round, and so on up to your champion.</li>
        <li>No penalty for a wrong pick.</li>
        <li>Star your <strong className="text-zinc-200">Best 5</strong> — any five games you&apos;ve picked; empty spots count as losses, like Best 3 — and guess the total points in the title game.</li>
        <li>Ties are broken by Best 5 record, then semifinal picks, then the closest title-game total (on an equal miss, the guess under wins).</li>
        <li>Everyone&apos;s picks show up in All Picks once the first game kicks off.</li>
        <li>A canceled or postponed bowl is removed from the pick&apos;em.</li>
      </ul>
    </div>
  )
}
