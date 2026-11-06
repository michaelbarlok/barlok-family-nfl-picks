/**
 * How the Bowl Pick'em works — the rules from the family's pick sheet, so a
 * new player knows what they've joined before the sheet comes out.
 */
export default function BowlRules() {
  const phases: { name: string; points: string; tone: string }[] = [
    { name: 'Phase 1 · The Little Ones', points: '1 point per win', tone: 'bg-lime-500' },
    { name: 'Phase 2 · In Betweeners', points: '1.5 points per win', tone: 'bg-yellow-400' },
    { name: 'Phase 3 · The Big Ones', points: '2 points per win', tone: 'bg-amber-500' },
    { name: 'Phase 4 · The Playoff', points: '3 points per win', tone: 'bg-red-500' },
  ]
  return (
    <div className="glass-card rounded-2xl p-4">
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-3">How it works</p>
      <div className="space-y-1.5 mb-4">
        {phases.map(p => (
          <div key={p.name} className="flex items-center gap-2.5 text-sm">
            <span className={`w-2 h-2 rounded-full shrink-0 ${p.tone}`} />
            <span className="flex-1 text-slate-200">{p.name}</span>
            <span className="text-slate-400 tabular-nums text-xs">{p.points}</span>
          </div>
        ))}
      </div>
      <ul className="space-y-1.5 text-[13px] text-slate-400 leading-snug list-disc pl-4 marker:text-slate-600">
        <li>Pick a winner for every game on the sheet. <strong className="text-slate-200">All picks are due at the first kickoff</strong> — no changes after.</li>
        <li>The playoff is your own bracket: your quarterfinal picks come from who you picked in the first round, and so on.</li>
        <li>Semifinal picks are 3 points each, and the national champion is 3 more. No penalty for a wrong pick.</li>
        <li>Choose your <strong className="text-slate-200">Best 5</strong> — any five games — and guess the total points in the title game.</li>
        <li>Ties are broken by Best 5 record, then semifinal picks, then the closest title-game total (on an equal miss, the guess under wins).</li>
        <li>A canceled or postponed bowl is removed from the pick&apos;em.</li>
      </ul>
    </div>
  )
}
