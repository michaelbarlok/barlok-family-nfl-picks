import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CURRENT_SEASON } from '@/lib/constants'

interface WeekNavigatorProps {
  selectedWeek: number | null
  onWeekChange: (week: number) => void
  /** Optional: externally provided weeks list (skips internal fetch) */
  availableWeeks?: number[]
}

export default function WeekNavigator({ selectedWeek, onWeekChange, availableWeeks: externalWeeks }: WeekNavigatorProps) {
  const [internalWeeks, setInternalWeeks] = useState<number[]>([])
  const weeks = externalWeeks ?? internalWeeks

  useEffect(() => {
    if (externalWeeks) return
    const fetchWeeks = async () => {
      const { data } = await supabase
        .from('games').select('week')
        .eq('season', CURRENT_SEASON)
        .order('week')
      if (data) {
        setInternalWeeks([...new Set(data.map(g => g.week))].sort((a, b) => a - b))
      }
    }
    fetchWeeks()
  }, [externalWeeks])

  if (weeks.length === 0 || selectedWeek === null) return null

  const currentIdx = weeks.indexOf(selectedWeek)
  const hasPrev = currentIdx > 0
  const hasNext = currentIdx < weeks.length - 1

  return (
    <div className="flex items-center gap-2 mb-5">
      <button
        onClick={() => hasPrev && onWeekChange(weeks[currentIdx - 1])}
        disabled={!hasPrev}
        className="press w-9 h-9 flex items-center justify-center rounded-xl bg-white/[0.06] text-slate-400 hover:bg-white/[0.10] disabled:opacity-30 disabled:cursor-not-allowed transition"
        aria-label="Previous week"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
      </button>

      <div className="flex-1 overflow-x-auto">
        <div className="flex gap-1.5 justify-center">
          {weeks.map(week => (
            <button
              key={week}
              onClick={() => onWeekChange(week)}
              className={`press px-3.5 py-2 text-sm font-medium rounded-full transition-all whitespace-nowrap ${
                selectedWeek === week
                  ? 'bg-white/[0.10] text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              Wk {week}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={() => hasNext && onWeekChange(weeks[currentIdx + 1])}
        disabled={!hasNext}
        className="press w-9 h-9 flex items-center justify-center rounded-xl bg-white/[0.06] text-slate-400 hover:bg-white/[0.10] disabled:opacity-30 disabled:cursor-not-allowed transition"
        aria-label="Next week"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
      </button>
    </div>
  )
}
