import Link from 'next/link'
import { useRouter } from 'next/router'
import { useAuth } from '@/lib/auth'
import { CURRENT_SEASON, ADMIN_EMAIL } from '@/lib/constants'

const baseTabs = [
  { label: 'My Picks', icon: '🏈', href: '/picks' },
  { label: 'All Picks', icon: '📋', href: '/all-picks' },
  { label: 'Standings', icon: '🏆', href: '/standings' },
  { label: 'Sheets', icon: '📊', href: '/spreadsheets' },
]

export default function Nav() {
  const router = useRouter()
  const { user, signOut } = useAuth()

  const isAdmin = user?.email === ADMIN_EMAIL
  const isManager = user?.is_manager === true
  const tabs = isAdmin || isManager
    ? [...baseTabs, { label: 'Admin', icon: '🔧', href: '/admin' }]
    : baseTabs

  const handleSignOut = async () => {
    await signOut()
    router.push('/login')
  }

  return (
    <>
      {/* Top bar — branding + sign out */}
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-surface/80 backdrop-blur-xl">
        <div className="max-w-3xl mx-auto px-4">
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

          {/* Desktop pill tabs — hidden on mobile */}
          <div className="hidden sm:flex gap-1 pb-3">
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

      {/* Mobile bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 sm:hidden border-t border-white/[0.08] bg-surface/95 backdrop-blur-xl safe-bottom">
        <div className="flex justify-around items-center px-1 pt-1.5 pb-1">
          {tabs.map(tab => {
            const isActive = router.pathname === tab.href
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition-all min-w-0 flex-1 ${
                  isActive
                    ? 'text-blue-400'
                    : 'text-slate-500 active:text-slate-300'
                }`}
              >
                <span className={`text-lg leading-none ${isActive ? 'scale-110' : ''} transition-transform`}>{tab.icon}</span>
                <span className={`text-[10px] font-medium truncate w-full text-center ${isActive ? 'text-blue-400' : ''}`}>{tab.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}
