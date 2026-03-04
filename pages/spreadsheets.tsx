import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { CURRENT_SEASON } from '@/lib/constants'
import Nav from '@/components/Nav'

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

  if (loading || dataLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-3">📊</div>
          <p className="text-gray-500 text-sm">Loading spreadsheets...</p>
        </div>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />

      <main className="max-w-3xl mx-auto px-4 py-6">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
          {CURRENT_SEASON} Season Spreadsheets
        </h2>

        {availableWeeks.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <p className="text-3xl mb-3">📭</p>
            <p className="text-gray-700 font-medium">No spreadsheets available yet</p>
            <p className="text-gray-400 text-sm mt-1">Spreadsheets will appear here once games are added to the schedule.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Current week highlighted */}
            {availableWeeks.map(week => {
              const isCurrent = week === latestWeek
              const isDownloading = downloading === week

              return (
                <div
                  key={week}
                  className={`bg-white rounded-xl border p-4 flex items-center justify-between ${isCurrent ? 'border-blue-200 ring-1 ring-blue-100' : 'border-gray-200'}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold ${isCurrent ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                      W{week}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">
                        Week {week}
                        {isCurrent && (
                          <span className="ml-2 text-xs font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">Current</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-400">
                        {CURRENT_SEASON} NFL Season · All picks included
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDownload(week)}
                    disabled={isDownloading}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
                      isCurrent
                        ? 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50'
                    }`}
                  >
                    {isDownloading ? (
                      <>
                        <span className="animate-spin">⏳</span>
                        Generating...
                      </>
                    ) : (
                      <>
                        <span>⬇️</span>
                        Download .xlsx
                      </>
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <div className="mt-6 bg-gray-100 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-600 mb-1">📧 Prefer email delivery?</p>
          <p className="text-xs text-gray-500">
            Michael can send the spreadsheet to everyone via email. Reach out to request a copy sent to the group.
          </p>
        </div>
      </main>
    </div>
  )
}
