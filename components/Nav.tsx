import Link from 'next/link'
import { useRouter } from 'next/router'
import { useAuth } from '@/lib/auth'
import { CURRENT_SEASON } from '@/lib/constants'

const tabs = [
  { label: 'My Picks', icon: '🏈', href: '/picks' },
  { label: 'Standings', icon: '🏆', href: '/standings' },
  { label: 'Sheets', icon: '📊', href: '/spreadsheets' },
]

export default function Nav() {
  const router = useRouter()
  const { user, signOut } = useAuth()

  const handleSignOut = async () => {
    await signOut()
    router.push('/login')
  }

  return (
    <header className="sticky top-0 z-10 border-b border-white/[0.06] bg-surface/80 backdrop-blur-xl">
      <div className="max-w-3xl mx-auto px-4">
        {/* Top bar */}
        <div className="flex items-center justify-between py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <span className="text-sm">🏈</span>
            </div>
            <div>
              <p className="font-semibold text-white text-sm leading-tight">Barlok Family NFL Picks</p>
              <p className="text-[11px] text-slate-500">{CURRENT_SEASON} Season</p>
            </div>
          </div>
          {user && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-400 hidden sm:inline">{user.name}</span>
              <button
                onClick={handleSignOut}
                className="text-xs text-slate-500 hover:text-slate-300 transition px-2.5 py-1.5 rounded-lg hover:bg-white/[0.04]"
              >
                Sign out
              </button>
            </div>
          )}
        </div>

        {/* Pill tab bar */}
        <div className="flex gap-1 pb-3">
          {tabs.map(tab => {
            const isActive = router.pathname === tab.href
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-full transition-all ${
                  isActive
                    ? 'bg-white/[0.10] text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                }`}
              >
                <span className="text-xs">{tab.icon}</span>
                {tab.label}
              </Link>
            )
          })}
        </div>
      </div>
    </header>
  )
}
