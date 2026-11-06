import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useBowlAuth } from '@/lib/bowls/auth'
import type { BowlGame, Phase } from '@/lib/bowls/sheet'
import type { PickMap } from '@/lib/bowls/bracket'
import type { Standing } from '@/lib/bowls/scoring'
import { countdown, lockText } from '@/lib/bowls/format'
import { useToast } from '@/components/Toast'
import { BowlAvatar } from '@/components/bowls/BowlHeader'

/* Shared by All Picks and Standings: the data, and a few small pieces. */

export interface BoardPlayer { id: string; name: string; avatar_url: string | null }
export interface Board {
  season: number
  status: 'setup' | 'open' | 'locked' | 'complete'
  lockAt: string | null
  pulledAt: string | null
  hidden: boolean
  games?: BowlGame[]
  players?: BoardPlayer[]
  picks?: Record<string, PickMap>
  best5?: Record<string, string[]>
  titleTotals?: Record<string, number | null>
  standings?: Standing[]
  decided?: number
  total?: number
  titleActual?: number | null
}

export function useBoard() {
  const { account, token } = useBowlAuth()
  const [board, setBoard] = useState<Board | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/bowls/board', { headers: { Authorization: `Bearer ${await token()}` } })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load the picks')
      setBoard(json)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the picks')
    }
  }, [token])
  useEffect(() => { if (account) load() }, [account, load])
  return { board, error, reload: load }
}

export const pts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
export const firstName = (name: string) => name.split(' ')[0]

/** "After 23 of 48 games · results as of Dec 20, 9:41 PM" */
export function ResultsLine({ board }: { board: Board }) {
  const when = board.pulledAt
    ? new Date(board.pulledAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null
  return (
    <p className="text-xs text-zinc-500">
      {board.decided ? `After ${board.decided} of ${board.total} games` : `${board.total} games · none final yet`}
      {when && ` · results as of ${when}`}
    </p>
  )
}

/** For the bowl admin: bring in the latest scores. Results only change when someone taps this. */
export function UpdateResults({ onDone }: { onDone: () => void }) {
  const { isAdmin, token } = useBowlAuth()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (!isAdmin) return null
  const pull = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/bowls/admin/sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ action: 'pull' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not reach ESPN')
      const finals = json.result?.finals?.length ?? 0
      toast.show(finals ? `${finals} new ${finals === 1 ? 'final' : 'finals'} from ESPN` : 'Up to date with ESPN', 'success')
      onDone()
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Could not reach ESPN', 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <button onClick={pull} disabled={busy}
      className="press shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-b from-yellow-400 to-yellow-600 text-zinc-950 hover:brightness-110 disabled:opacity-50 transition">
      <span aria-hidden="true">↻</span>{busy ? 'Updating…' : 'Update results'}
    </button>
  )
}

/** Before the first kickoff: nobody sees anyone's picks. */
export function HiddenUntilLock({ board, what }: { board: Board; what: string }) {
  const left = board.lockAt ? countdown(board.lockAt) : null
  return (
    <div className="relative overflow-hidden rounded-2xl border border-yellow-600/25 bg-gradient-to-br from-zinc-800/80 via-zinc-900 to-zinc-950 p-6 text-center">
      <img src="/logos/cfp-trophy.svg" alt="" aria-hidden="true" className="pointer-events-none absolute -right-6 -bottom-8 h-44 w-auto opacity-[0.10]" />
      <p className="text-3xl mb-2" aria-hidden="true">🔒</p>
      <p className="relative text-white font-semibold">{what} show up at the first kickoff</p>
      <p className="relative text-sm text-zinc-400 mt-2">
        {board.status === 'setup'
          ? 'Picks open once the College Football Playoff field is set.'
          : <>Until then nobody can see anyone else&apos;s picks. They lock {board.lockAt ? <strong className="text-zinc-200">{lockText(board.lockAt)}</strong> : 'at the first kickoff'}{left ? ` — ${left} from now` : ''}.</>}
      </p>
      <Link href="/bowls/picks" className="relative press inline-block mt-4 px-5 py-2.5 rounded-xl bg-gradient-to-b from-yellow-400 to-yellow-600 text-zinc-950 text-sm font-bold hover:brightness-110 transition">
        Go to My Picks
      </Link>
    </div>
  )
}

/** A player in a pick list: photo, first name, ★ for a Best 5 pick. */
export function PlayerChip({ player, star, me }: { player: BoardPlayer; star?: boolean; me?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 pl-0.5 pr-2 py-0.5 rounded-full text-[11px] font-medium border ${me ? 'bg-yellow-500/10 border-yellow-500/40 text-yellow-200' : 'bg-white/[0.04] border-white/[0.06] text-zinc-300'}`}>
      <BowlAvatar name={player.name} url={player.avatar_url} size={18} />
      {firstName(player.name)}
      {star && <span className="text-yellow-400" title="Best 5">★</span>}
    </span>
  )
}

export const PHASE_FILTERS: { key: 'all' | Phase; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'little', label: 'Little Ones' },
  { key: 'between', label: 'In Betweeners' },
  { key: 'big', label: 'Big Ones' },
  { key: 'playoff', label: 'Playoff' },
  { key: 'semi', label: 'Semis' },
  { key: 'title', label: 'Champion' },
]

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { key: T; label: string }[]; onChange: (v: T) => void; label: string
}) {
  return (
    <div role="tablist" aria-label={label} className="flex p-0.5 rounded-full bg-white/[0.05] border border-white/[0.08]">
      {options.map(o => (
        <button key={o.key} role="tab" aria-selected={value === o.key} onClick={() => onChange(o.key)}
          className={`flex-1 px-3 py-1.5 rounded-full text-[13px] font-semibold whitespace-nowrap transition ${value === o.key ? 'bg-gradient-to-b from-yellow-400 to-yellow-600 text-zinc-950' : 'text-zinc-400 hover:text-white'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Chips<T extends string>({ value, options, onChange, label }: {
  value: T; options: { key: T; label: string; count?: number }[]; onChange: (v: T) => void; label: string
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4">
      {options.map(o => (
        <button key={o.key} aria-pressed={value === o.key} onClick={() => onChange(o.key)}
          className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition ${value === o.key ? 'bg-white/[0.12] border-white/[0.2] text-white' : 'border-white/[0.06] text-zinc-400 hover:text-zinc-200'}`}>
          {o.label}{o.count !== undefined && <span className="text-zinc-500 ml-1">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}
