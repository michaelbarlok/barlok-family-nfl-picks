import Link from 'next/link'
import { useRouter } from 'next/router'

/** Players | Games — the two bowl admin pages. */
export default function AdminTabs() {
  const router = useRouter()
  const tabs = [
    { href: '/bowls/admin', label: 'Players' },
    { href: '/bowls/admin/sheet', label: 'Games' },
  ]
  return (
    <div role="tablist" aria-label="Bowl admin" className="inline-flex p-0.5 rounded-full bg-white/[0.05] border border-white/[0.08]">
      {tabs.map(t => {
        const on = router.pathname === t.href
        return (
          <Link key={t.href} href={t.href} role="tab" aria-selected={on}
            className={`px-4 py-1.5 rounded-full text-[13px] font-semibold transition ${on ? 'bg-gradient-to-b from-yellow-400 to-yellow-600 text-zinc-950' : 'text-zinc-400 hover:text-white'}`}>
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}
