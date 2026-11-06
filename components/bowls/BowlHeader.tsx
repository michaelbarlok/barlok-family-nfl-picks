import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { useBowlAuth } from '@/lib/bowls/auth'
import { BOWL_SHORT_NAME } from '@/lib/bowls/constants'
import { LeagueSwitch } from '@/components/bowls/LeagueSwitch'

export function BowlAvatar({ name, url, size = 32 }: { name: string; url?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false)
  if (url && !broken) {
    return (
      <img src={url} alt="" onError={() => setBroken(true)}
        className="rounded-full object-cover border border-white/[0.08] shrink-0" style={{ width: size, height: size }} />
    )
  }
  return (
    <div className="rounded-full flex items-center justify-center font-bold border border-white/[0.08] shrink-0 bg-gradient-to-br from-amber-600 to-orange-700 text-white"
      style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

/**
 * The Bowl Pick'em's header: its own name and trophy mark, the NFL ⇄ Bowls
 * switch for people in both, and an account menu.
 */
export default function BowlHeader({ subtitle }: { subtitle?: string }) {
  const router = useRouter()
  const { player, account, nflProfile, isAdmin, signOut } = useBowlAuth()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const name = player?.name ?? nflProfile?.name ?? account?.email ?? ''

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-surface/80 backdrop-blur-xl safe-top">
      <div className="max-w-3xl mx-auto px-4">
        <div className="flex items-center justify-between gap-2 py-3">
          <Link href="/bowls" className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20 shrink-0">
              <span className="text-sm">🏆</span>
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-white text-sm leading-tight truncate">{BOWL_SHORT_NAME}</p>
              {subtitle && <p className="text-[11px] text-slate-500 truncate">{subtitle}</p>}
            </div>
          </Link>

          {player && nflProfile && <LeagueSwitch current="bowls" className="ml-auto" />}

          {account && (
            <div className="relative shrink-0" ref={menuRef}>
              <button onClick={() => setOpen(o => !o)} aria-label="Account" className="flex items-center gap-2 px-1.5 py-1 rounded-lg hover:bg-white/[0.04] transition">
                <span className="text-sm text-slate-400 hidden sm:inline">{name}</span>
                <BowlAvatar name={name || '?'} url={player?.avatar_url} />
              </button>
              {open && (
                <div className="absolute right-0 top-full mt-1.5 w-48 bg-[#1a1d23] border border-white/[0.08] rounded-xl shadow-2xl shadow-black/40 overflow-hidden animate-fade-in z-50">
                  {isAdmin && (
                    <Link href="/bowls/admin" onClick={() => setOpen(false)} className="block px-4 py-2.5 text-sm text-slate-300 hover:bg-white/[0.06] transition">
                      Bowl admin
                    </Link>
                  )}
                  <button
                    onClick={async () => { setOpen(false); await signOut(); router.push('/bowls/login') }}
                    className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-white/[0.06] transition border-t border-white/[0.06]"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
