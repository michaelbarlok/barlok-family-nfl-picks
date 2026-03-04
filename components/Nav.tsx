import Link from 'next/link'
import { useRouter } from 'next/router'
import { useAuth } from '@/lib/auth'
import { CURRENT_SEASON } from '@/lib/constants'

const tabs = [
  { label: '🏈 My Picks', href: '/picks' },
  { label: '🏆 Standings', href: '/standings' },
  { label: '📊 Spreadsheets', href: '/spreadsheets' },
]

export default function Nav() {
  const router = useRouter()
  const { user, signOut } = useAuth()

  const handleSignOut = async () => {
    await signOut()
    router.push('/login')
  }

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div className="max-w-3xl mx-auto px-4">
        {/* Top bar */}
        <div className="flex items-center justify-between py-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🏈</span>
            <div>
              <p className="font-semibold text-gray-900 text-sm leading-tight">Barlok Family NFL Picks</p>
              <p className="text-xs text-gray-400">{CURRENT_SEASON} Season</p>
            </div>
          </div>
          {user && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500 hidden sm:inline">Hi, {user.name}</span>
              <button
                onClick={handleSignOut}
                className="text-sm text-gray-400 hover:text-gray-700 transition"
              >
                Sign out
              </button>
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 -mb-px">
          {tabs.map(tab => {
            const isActive = router.pathname === tab.href
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </Link>
            )
          })}
        </div>
      </div>
    </header>
  )
}
