import Link from 'next/link'
import { useRouter } from 'next/router'
import { useState, useRef, useEffect } from 'react'
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
  const { user, signOut, resetPassword } = useAuth()
  const [showMenu, setShowMenu] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [resetStatus, setResetStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const menuRef = useRef<HTMLDivElement>(null)

  const isAdmin = user?.email === ADMIN_EMAIL
  const isManager = user?.is_manager === true
  const tabs = isAdmin || isManager
    ? [...baseTabs, { label: 'Admin', icon: '🔧', href: '/admin' }]
    : baseTabs

  const handleSignOut = async () => {
    setShowMenu(false)
    await signOut()
    router.push('/login')
  }

  const handleResetPassword = async () => {
    if (!user?.email) return
    setResetStatus('sending')
    try {
      await resetPassword(user.email)
      setResetStatus('sent')
    } catch {
      setResetStatus('error')
    }
  }

  // Close menu on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }
    if (showMenu) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showMenu])

  // Reset status when profile panel closes
  useEffect(() => {
    if (!showProfile) setResetStatus('idle')
  }, [showProfile])

  return (
    <>
      {/* Top bar — branding + settings */}
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
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setShowMenu(prev => !prev)}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.04] transition"
                >
                  <span className="text-sm text-slate-400 hidden sm:inline">{user.name}</span>
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center border border-white/[0.08]">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-300">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </div>
                </button>

                {/* Dropdown menu */}
                {showMenu && (
                  <div className="absolute right-0 top-full mt-1.5 w-48 bg-[#1a1d23] border border-white/[0.08] rounded-xl shadow-2xl shadow-black/40 overflow-hidden animate-fade-in z-50">
                    <button
                      onClick={() => { setShowMenu(false); setShowProfile(true) }}
                      className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-slate-300 hover:bg-white/[0.06] transition text-left"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                      Profile
                    </button>
                    <div className="border-t border-white/[0.06]" />
                    <button
                      onClick={handleSignOut}
                      className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-red-400 hover:bg-white/[0.06] transition text-left"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400/70">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                      </svg>
                      Sign out
                    </button>
                  </div>
                )}
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

      {/* Profile modal */}
      {showProfile && user && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowProfile(false)} />
          <div className="relative w-full max-w-sm bg-[#1a1d23] border border-white/[0.08] rounded-2xl shadow-2xl shadow-black/40 animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h2 className="text-base font-semibold text-white">Profile</h2>
              <button
                onClick={() => setShowProfile(false)}
                className="text-slate-500 hover:text-slate-300 transition p-1"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* User info */}
            <div className="px-5 pb-4">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-blue-500/20">
                  {user.name?.charAt(0).toUpperCase() || '?'}
                </div>
                <div className="min-w-0">
                  <p className="text-white font-semibold truncate">{user.name}</p>
                  <p className="text-sm text-slate-400 truncate">{user.email}</p>
                </div>
              </div>

              <div className="space-y-3 mb-5">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Name</span>
                  <span className="text-slate-300">{user.name}</span>
                </div>
                <div className="border-t border-white/[0.06]" />
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Email</span>
                  <span className="text-slate-300 truncate ml-4">{user.email}</span>
                </div>
                <div className="border-t border-white/[0.06]" />
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Role</span>
                  <span className="text-slate-300">
                    {user.email === ADMIN_EMAIL ? 'Admin' : user.is_manager ? 'Manager' : 'Player'}
                  </span>
                </div>
              </div>

              {/* Reset password */}
              <div className="border-t border-white/[0.06] pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Security</p>
                {resetStatus === 'sent' ? (
                  <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-sm text-emerald-400">
                    Password reset link sent to {user.email}. Check your inbox.
                  </div>
                ) : resetStatus === 'error' ? (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
                    Failed to send reset email. Try again later.
                  </div>
                ) : (
                  <button
                    onClick={handleResetPassword}
                    disabled={resetStatus === 'sending'}
                    className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-slate-300 bg-white/[0.04] border border-white/[0.08] rounded-xl hover:bg-white/[0.06] hover:border-white/[0.12] disabled:opacity-50 transition"
                  >
                    {resetStatus === 'sending' ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-slate-500 border-t-slate-300 rounded-full animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                        Reset password
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

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
