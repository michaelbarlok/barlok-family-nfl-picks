import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { CURRENT_SEASON } from '@/lib/constants'
import Nav from '@/components/Nav'

function SheetsSkeleton() {
  return (
    <div className="min-h-screen bg-surface">
      <div className="sticky top-0 z-10 border-b border-white/[0.06] bg-surface/80 backdrop-blur-xl">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <div className="skeleton h-5 w-48 rounded-lg mb-3" />
          <div className="flex gap-2">
            <div className="skeleton h-8 w-24 rounded-full" />
            <div className="skeleton h-8 w-24 rounded-full" />
            <div className="skeleton h-8 w-20 rounded-full" />
          </div>
        </div>
      </div>
      <main className="max-w-3xl mx-auto px-4 py-6">
        <div className="skeleton h-4 w-48 rounded mb-4" />
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="glass-card rounded-2xl p-5">
              <div className="skeleton h-12 w-full rounded-xl" />
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}

export default function SpreadsheetsPage() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const [availableWeeks, setAvailableWeeks] = useState<number[]>([])
  const [latestWeek, setLatestWeek] = useState<number | null>(null)
  const [dataLoading, setDataLoading] = useState(true)
  const [downloading, setDownloading] = useState<number | null>(null)

  useEffect(() => {
    if (!loading && !user) router.push('/login')
  }, [user, loading, router])

  useEffect(() => {
    const fetchWeeks = async () => {
      if (!user) return
      try {
        const { data } = await supabase
          .from('games')
          .select('week')
          .eq('season', CURRENT_SEASON)
          .order('week')

        if (data) {
          const weeks = [...new Set(data.map(g => g.week))].sort((a, b) => a - b)
          setAvailableWeeks(weeks)
          if (weeks.length > 0) setLatestWeek(weeks[weeks.length - 1])
        }
      } catch (err) {
        console.error('Error fetching weeks:', err)
      } finally {
        setDataLoading(false)
      }
    }
    fetchWeeks()
  }, [user])

  const handleDownload = async (week: number) => {
    setDownloading(week)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token ?? ''
      const url = `/api/download-picks?week=${week}&season=${CURRENT_SEASON}`
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error('Download failed')
      const blob = await response.blob()
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `Week_${week}_Picks_${CURRENT_SEASON}.xlsx`
      link.click()
      URL.revokeObjectURL(link.href)
    } catch (err) {
      console.error('Download error:', err)
    } finally {
      setDownloading(null)
    }
  }

  if (loading || dataLoading) return <SheetsSkeleton />
  if (!user) return null

  return (
    <div className="min-h-screen bg-surface">
      <Nav />

      <main className="max-w-3xl mx-auto px-4 py-6 animate-fade-in">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">
          {CURRENT_SEASON} Season Spreadsheets
        </h2>

        {availableWeeks.length === 0 ? (
          <div className="glass-card rounded-2xl p-12 text-center">
            <p className="text-3xl mb-3">📭</p>
            <p className="text-white font-medium">No spreadsheets available yet</p>
            <p className="text-slate-500 text-sm mt-1.5">Spreadsheets will appear here once games are added to the schedule.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {availableWeeks.map((week, idx) => {
              const isCurrent = week === latestWeek
              const isDownloading = downloading === week

              return (
                <div
                  key={week}
                  className={`glass-card rounded-2xl p-4 flex items-center justify-between transition-all animate-slide-up ${
                    isCurrent ? 'ring-1 ring-blue-500/30' : ''
                  }`}
                  style={{ animationDelay: `${idx * 50}ms` }}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-sm font-bold ${
                      isCurrent
                        ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-500/20'
                        : 'bg-white/[0.06] text-slate-400'
                    }`}>
                      W{week}
                    </div>
                    <div>
                      <p className="font-semibold text-white text-sm">
                        Week {week}
                        {isCurrent && (
                          <span className="ml-2 text-[11px] font-medium text-blue-400 bg-blue-500/15 px-2 py-0.5 rounded-full">Current</span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {CURRENT_SEASON} NFL Season
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDownload(week)}
                    disabled={isDownloading}
                    className={`press flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      isCurrent
                        ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-500 hover:to-indigo-500 shadow-lg shadow-blue-600/20 disabled:opacity-50'
                        : 'bg-white/[0.06] text-slate-300 hover:bg-white/[0.10] disabled:opacity-50'
                    }`}
                  >
                    {isDownloading ? (
                      <>
                        <span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                          <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" fill="rgba(34,197,94,0.15)" />
                          <path d="M5 5L8 8M8 8L11 5M8 8L5 11M8 8L11 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                        Download
                      </>
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <div className="mt-6 glass-card rounded-2xl p-4">
          <p className="text-xs font-semibold text-slate-300 mb-1">📧 Prefer email delivery?</p>
          <p className="text-xs text-slate-500">
            Michael can send the spreadsheet to everyone via email. Reach out to request a copy sent to the group.
          </p>
        </div>
      </main>
    </div>
  )
}
