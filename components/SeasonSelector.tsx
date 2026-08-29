import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useSeason } from '@/lib/season'

export interface SeasonRow {
  season: number
  completed_at: string | null
  champion_name: string | null
}

/**
 * Switch between the live season and finished ones.
 *
 * Renders nothing until there is more than one season to choose from, so it
 * stays invisible for the first year rather than being an empty control.
 */
export default function SeasonSelector({
  value,
  onChange,
  onSeasonsLoaded,
}: {
  value: number
  onChange: (season: number) => void
  onSeasonsLoaded?: (rows: SeasonRow[]) => void
}) {
  const { season: liveSeason } = useSeason()
  const [seasons, setSeasons] = useState<SeasonRow[]>([])

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('seasons')
        .select('season, completed_at, champion_name')
        .order('season', { ascending: false })
      const rows = data ?? []
      setSeasons(rows)
      onSeasonsLoaded?.(rows)
    }
    load().catch(() => {}) // table not created yet — selector simply stays hidden
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (seasons.length < 2) return null

  return (
    <div className="flex items-center gap-2 mb-4 overflow-x-auto no-scrollbar">
      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider shrink-0">Season</span>
      {seasons.map(s => {
        const isActive = s.season === value
        const isLive = s.season === liveSeason
        return (
          <button
            key={s.season}
            onClick={() => onChange(s.season)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition ${
              isActive
                ? 'bg-white/[0.12] text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
            }`}
            title={s.champion_name ? `Won by ${s.champion_name}` : undefined}
          >
            {s.season}
            {isLive && <span className="ml-1.5 text-[9px] text-emerald-400">LIVE</span>}
          </button>
        )
      })}
    </div>
  )
}
