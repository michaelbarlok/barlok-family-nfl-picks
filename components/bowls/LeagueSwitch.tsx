import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * NFL ⇄ Bowls, for people who play both pick'ems. One tap goes to the other
 * app's home. Only ever rendered for someone in both — see NflBowlsToggle and
 * the bowl header.
 */
export function LeagueSwitch({ current, className = '' }: { current: 'nfl' | 'bowls'; className?: string }) {
  // Each side is its league's own logo — the NFL shield and the CFP trophy.
  // On a phone that's all it shows, so the header title keeps its one line;
  // from tablet width up the names are spelled out beside them.
  const base = 'flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full transition'
  const off = 'text-slate-400 hover:text-slate-200 opacity-70 hover:opacity-100 grayscale-[60%] hover:grayscale-0'
  return (
    <div role="group" aria-label="Switch pick'em" className={`flex items-center p-0.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-[11px] font-semibold leading-none shrink-0 ${className}`}>
      <Link href="/" aria-label="NFL" title="NFL Picks" aria-current={current === 'nfl' ? 'page' : undefined}
        className={`${base} ${current === 'nfl' ? 'bg-blue-600 text-white shadow-sm' : off}`}>
        <img src="/logos/nfl.png" alt="" className="w-4 h-4 object-contain" /><span className="hidden sm:inline">NFL</span>
      </Link>
      <Link href="/bowls" aria-label="Bowls" title="Bowl Pick'em" aria-current={current === 'bowls' ? 'page' : undefined}
        className={`${base} ${current === 'bowls' ? 'bg-zinc-800 text-yellow-400 ring-1 ring-yellow-500/50 shadow-sm' : off}`}>
        <img src="/logos/cfp-trophy.svg" alt="" className="w-4 h-4 object-contain" /><span className="hidden sm:inline">Bowls</span>
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
