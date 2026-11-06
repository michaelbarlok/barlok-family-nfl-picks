import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { useBowlAuth } from '@/lib/bowls/auth'
import { BOWL_SHORT_NAME } from '@/lib/bowls/constants'
import { LeagueSwitch } from '@/components/bowls/LeagueSwitch'
import { refreshBowlDevice } from '@/lib/bowls/pushClient'

// Once per visit: keep this device's bowl notifications pointed at its current registration.
let deviceRefreshed = false

export function BowlAvatar({ name, url, size = 32 }: { name: string; url?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false)
  if (url && !broken) {
    return (
      <img src={url} alt="" onError={() => setBroken(true)}
        className="rounded-full object-cover border border-white/[0.08] shrink-0" style={{ width: size, height: size }} />
    )
  }
  return (
    <div className="rounded-full flex items-center justify-center font-bold border border-white/[0.08] shrink-0 bg-gradient-to-br from-yellow-500 to-yellow-700 text-zinc-950"
      style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

/**
 * The Bowl Pick'em's header: its own name and trophy mark, the NFL ⇄ Bowls
 * switch for people in both, an account menu and the page tabs. A page can
 * pin a bar of its own underneath (`children`) — My Picks keeps its progress
 * there.
 */
export default function BowlHeader({ subtitle, children }: { subtitle?: string; children?: React.ReactNode }) {
  const router = useRouter()
  const { player, account, nflProfile, isAdmin, signOut, token } = useBowlAuth()
  const [unread, setUnread] = useState(0)
  const onTalk = router.pathname === '/bowls/talk'

  // Bowl Talk's unread count, for the tab. Checked now and then, and whenever
  // the app comes back to the front.
  useEffect(() => {
    if (!player || onTalk) { setUnread(0); return }
    let cancelled = false
    const check = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const res = await fetch('/api/bowls/talk?unread=1', { headers: { Authorization: `Bearer ${await token()}` } })
        if (res.ok && !cancelled) setUnread((await res.json()).unread ?? 0)
      } catch { /* the badge is extra */ }
    }
    check()
    const id = setInterval(check, 60000)
    document.addEventListener('visibilitychange', check)
    return () => { cancelled = true; clearInterval(id); document.removeEventListener('visibilitychange', check) }
  }, [player, onTalk, token])
  useEffect(() => {
    if (!player || deviceRefreshed) return
    deviceRefreshed = true
    token().then(refreshBowlDevice).catch(() => { /* best effort */ })
  }, [player, token])

  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const name = player?.name ?? nflProfile?.name ?? account?.email ?? ''
  const tabs = [
    { href: '/bowls', label: 'Home' },
    { href: '/bowls/picks', label: 'My Picks' },
    { href: '/bowls/all-picks', label: 'All Picks' },
    { href: '/bowls/standings', label: 'Standings' },
    { href: '/bowls/talk', label: 'Talk' },
    ...(isAdmin ? [{ href: '/bowls/admin', label: 'Admin' }] : []),
  ]
  const active = (href: string) => href === '/bowls/admin' ? router.pathname.startsWith('/bowls/admin') : router.pathname === href

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-zinc-950/80 backdrop-blur-xl safe-top">
      <div className="max-w-3xl mx-auto px-4">
        <div className="flex items-center justify-between gap-2 py-3">
          <Link href="/bowls" className="flex items-center gap-2.5 min-w-0">
            <img src="/logos/cfp-trophy.svg" alt="" className="w-7 h-8 object-contain shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold text-white text-sm leading-tight truncate">{BOWL_SHORT_NAME}</p>
              {subtitle && <p className="text-[11px] text-zinc-500 truncate">{subtitle}</p>}
            </div>
          </Link>

          {player && nflProfile && <LeagueSwitch current="bowls" className="ml-auto" />}

          {account && (
            <div className="relative shrink-0" ref={menuRef}>
              <button onClick={() => setOpen(o => !o)} aria-label="Account" className="flex items-center gap-2 px-1.5 py-1 rounded-lg hover:bg-white/[0.04] transition">
                <span className="text-sm text-zinc-400 hidden sm:inline">{name}</span>
                <BowlAvatar name={name || '?'} url={player?.avatar_url} />
              </button>
              {open && (
                <div className="absolute right-0 top-full mt-1.5 w-48 bg-zinc-900 border border-white/[0.08] rounded-xl shadow-2xl shadow-black/40 overflow-hidden animate-fade-in z-50">
                  {isAdmin && (
                    <>
                      <Link href="/bowls/admin/sheet" onClick={() => setOpen(false)} className="block px-4 py-2.5 text-sm text-zinc-300 hover:bg-white/[0.06] transition">
                        Admin · Games
                      </Link>
                      <Link href="/bowls/admin" onClick={() => setOpen(false)} className="block px-4 py-2.5 text-sm text-zinc-300 hover:bg-white/[0.06] transition">
                        Admin · Players
                      </Link>
                    </>
                  )}
                  {player && (
                    <Link href="/bowls/settings" onClick={() => setOpen(false)} className="block px-4 py-2.5 text-sm text-zinc-300 hover:bg-white/[0.06] transition">
                      Notifications
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
        {(player || isAdmin) && (
          <nav aria-label="Bowl Pick'em" className="flex items-center gap-1 pb-2 -mt-1 overflow-x-auto no-scrollbar">
            {tabs.map(t => {
              const on = active(t.href)
              return (
                <Link key={t.href} href={t.href} aria-current={on ? 'page' : undefined}
                  className={`shrink-0 h-8 flex items-center px-3 text-[13px] font-medium rounded-full whitespace-nowrap transition ${on ? 'bg-white/[0.10] text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'}`}>
                  {t.label}
                  {t.href === '/bowls/talk' && unread > 0 && (
                    <span className="ml-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-yellow-500 text-zinc-950 text-[10px] font-bold flex items-center justify-center" aria-label={`${unread} unread`}>
                      {unread > 9 ? '9+' : unread}
                    </span>
                  )}
                </Link>
              )
            })}
          </nav>
        )}
      </div>
      {children}
    </header>
  )
}
