import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import Nav from '@/components/Nav'
import { historicChampions, mergeChampions, type Champion } from '@/lib/champions'


export default function ChampionsPage() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const [champions, setChampions] = useState<Champion[]>(historicChampions)

  useEffect(() => {
    if (!loading && !user) router.push('/login')
  }, [user, loading, router])

  useEffect(() => {
    if (!user) return
    const load = async () => {
      const { data } = await supabase
        .from('seasons')
        .select('season, champion_name, champion_record')
        .not('completed_at', 'is', null)
        .order('season')
      if (!data) return // table not created yet — the historic list stands alone

      setChampions(mergeChampions(data))
    }
    load().catch(err => console.error('Failed to load champions:', err))
  }, [user])

  if (loading) {
    return (
      <div className="min-h-screen bg-surface pb-page">
        <Nav />
        <main className="max-w-3xl mx-auto px-4 py-6">
          <div className="skeleton h-4 w-40 rounded mb-5" />
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="skeleton h-10 w-full" />
            {[...Array(8)].map((_, i) => (
              <div key={i} className="px-4 py-4 border-t border-white/[0.04]">
                <div className="skeleton h-5 w-full rounded" />
              </div>
            ))}
          </div>
        </main>
      </div>
    )
  }

  if (!user) return null

  // Count titles per winner
  const titleCounts: Record<string, number> = {}
  champions.forEach(c => {
    if (c.winner) {
      titleCounts[c.winner] = (titleCounts[c.winner] || 0) + 1
    }
  })

  const sortedWinners = Object.entries(titleCounts)
    .sort((a, b) => b[1] - a[1])

  return (
    <div className="min-h-screen bg-surface pb-page">
      <Nav />

      <main className="max-w-3xl mx-auto px-4 py-6 animate-fade-in">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-5">
          All-Time Champions
        </h2>

        {/* Title count summary */}
        <div className="glass-card rounded-2xl p-4 mb-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Titles Won</p>
          <div className="flex flex-wrap gap-2">
            {sortedWinners.map(([name, count]) => (
              <span
                key={name}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-sm"
              >
                <span className="text-white font-semibold">{name}</span>
                <span className="text-amber-400 font-bold">{count}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Champions table */}
        <div className="glass-card rounded-2xl overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-12 px-4 py-3 bg-white/[0.03] border-b border-white/[0.06] text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <div className="col-span-2 text-center">Year</div>
            <div className="col-span-5">Champion</div>
            <div className="col-span-5 text-center">Record</div>
          </div>

          {/* Rows - newest first */}
          {[...champions].reverse().map((c, idx) => (
            <div
              key={c.year}
              className={`grid grid-cols-12 px-4 py-3.5 items-center border-b border-white/[0.04] last:border-0 transition-colors hover:bg-white/[0.02] animate-slide-up ${
                idx === 0 ? 'bg-amber-500/10' : ''
              }`}
              style={{ animationDelay: `${idx * 30}ms` }}
            >
              <div className="col-span-2 text-center">
                <span className={`text-sm font-bold ${idx === 0 ? 'text-amber-400' : 'text-slate-400'}`}>
                  {c.year}
                </span>
              </div>
              <div className="col-span-5">
                {c.winner ? (
                  <div className="flex items-center gap-2">
                    {idx === 0 && <span className="text-lg">👑</span>}
                    <span className={`text-sm font-semibold ${idx === 0 ? 'text-amber-400' : 'text-white'}`}>
                      {c.winner}
                    </span>
                  </div>
                ) : (
                  <span className="text-sm text-slate-600 italic">No contest</span>
                )}
              </div>
              <div className="col-span-5 text-center">
                {c.record ? (
                  <span className={`text-sm font-medium ${idx === 0 ? 'text-amber-300' : 'text-slate-300'}`}>
                    {c.record}
                  </span>
                ) : (
                  <span className="text-sm text-slate-600">&mdash;</span>
                )}
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-600 text-center mt-5">
          {champions.filter(c => c.winner).length} seasons of Barlok Family NFL Picks
        </p>
      </main>
    </div>
  )
}
