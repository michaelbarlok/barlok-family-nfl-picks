import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * NFL ⇄ Bowls, for people who play both pick'ems. One tap goes to the other
 * app's home. Only ever rendered for someone in both — see NflBowlsToggle and
 * the bowl header.
 */
export function LeagueSwitch({ current, className = '' }: { current: 'nfl' | 'bowls'; className?: string }) {
  // On a phone each side is its app's own mark (🏈 / 🏆) so the header title
  // keeps its one line; from tablet width up they're spelled out.
  const item = (on: boolean, tone: string) =>
    `px-2 sm:px-2.5 py-1 rounded-full transition ${on ? `${tone} text-white shadow-sm` : 'text-slate-400 hover:text-slate-200 grayscale-[60%] opacity-80 hover:opacity-100 sm:grayscale-0 sm:opacity-100'}`
  return (
    <div role="group" aria-label="Switch pick'em" className={`flex items-center p-0.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-[13px] sm:text-[11px] font-semibold leading-none shrink-0 ${className}`}>
      <Link href="/" aria-label="NFL" title="NFL Picks" aria-current={current === 'nfl' ? 'page' : undefined} className={item(current === 'nfl', 'bg-blue-600')}>
        <span className="sm:hidden" aria-hidden="true">🏈</span><span className="hidden sm:inline">NFL</span>
      </Link>
      <Link href="/bowls" aria-label="Bowls" title="Bowl Pick'em" aria-current={current === 'bowls' ? 'page' : undefined} className={item(current === 'bowls', 'bg-amber-600')}>
        <span className="sm:hidden" aria-hidden="true">🏆</span><span className="hidden sm:inline">Bowls</span>
      </Link>
    </div>
  )
}

/**
 * The switch in the NFL header — for NFL players who are also bowl players,
 * and nobody else. For everyone else this renders nothing at all, so the NFL
 * header is exactly what it was.
 *
 * Membership is remembered on the device so the switch doesn't pop in a beat
 * after the header on every page. If the bowl tables don't exist yet, the
 * lookup fails quietly and nothing shows.
 */
export function NflBowlsToggle({ userId, className = '' }: { userId: string; className?: string }) {
  const key = `bowls-member:${userId}`
  const [member, setMember] = useState(() => {
    try { return typeof window !== 'undefined' && window.localStorage.getItem(key) === '1' } catch { return false }
  })

  useEffect(() => {
    let cancelled = false
    supabase.from('bowl_players').select('id').eq('id', userId).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error) return
        const yes = !!data
        setMember(yes)
        try { window.localStorage.setItem(key, yes ? '1' : '0') } catch {}
      })
    return () => { cancelled = true }
  }, [userId, key])

  return member ? <LeagueSwitch current="nfl" className={className} /> : null
}
