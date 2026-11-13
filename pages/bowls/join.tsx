import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { useBowlAuth } from '@/lib/bowls/auth'
import { BOWL_NAME } from '@/lib/bowls/constants'

/**
 * Where a shared join link lands (/bowls/join?c=…): no sign-in needed.
 *
 * Someone new types their name and email and gets the same "set your
 * password" email an invite sends. Someone already signed in — an NFL player
 * or a past bowl player — joins with one tap. A wrong or old link, or one
 * opened after picks lock, says so.
 */
type Info = { season: number; label: string; open: boolean }

export default function BowlJoin() {
  const router = useRouter()
  const { loading: authLoading, account, player, nflProfile, token } = useBowlAuth()
  const code = typeof router.query.c === 'string' ? router.query.c : ''
  const [info, setInfo] = useState<Info | null>(null)
  const [bad, setBad] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ outcome: string; message: string } | null>(null)

  useEffect(() => {
    if (!router.isReady) return
    if (!code) { setBad("This join link is missing its code. Ask Michael for the link again."); return }
    fetch(`/api/bowls/join-link?c=${encodeURIComponent(code)}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setInfo(j) })
      .catch(err => setBad(err instanceof Error && err.message ? err.message : "This join link doesn't work."))
  }, [router.isReady, code])

  const signUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      const res = await fetch('/api/bowls/join-link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ c: code, name: name.trim(), email: email.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not join')
      setDone(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join')
    } finally {
      setBusy(false)
    }
  }

  // Signed in already, as someone the bowl app knows: one tap.
  const joinSignedIn = async () => {
    setError(''); setBusy(true)
    try {
      const res = await fetch('/api/bowls/join', { method: 'POST', headers: { Authorization: `Bearer ${await token()}` } })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not join')
      router.replace('/bowls')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join')
      setBusy(false)
    }
  }

  const input = 'w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/50 focus:border-yellow-500/30 transition'
  const gold = 'w-full press bg-gradient-to-b from-yellow-400 to-yellow-600 text-zinc-950 font-semibold py-3 rounded-xl hover:brightness-110 disabled:opacity-50 transition shadow-lg shadow-yellow-600/20'
  const known = !!account && (!!player || !!nflProfile)

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4 py-10 relative overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-yellow-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[400px] h-[400px] bg-zinc-500/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md relative z-10 animate-fade-in">
        <div className="text-center mb-8">
          <img src="/logos/cfp-trophy.svg" alt="" className="mx-auto h-20 w-auto mb-5 drop-shadow-[0_8px_24px_rgba(202,138,4,0.25)]" />
          <h1 className="text-2xl font-bold text-white">{info ? `You're invited to the ${info.label} ${BOWL_NAME}` : BOWL_NAME}</h1>
          <p className="text-zinc-400 mt-1.5 text-sm">Pick a winner for every bowl game, plus the College Football Playoff.</p>
        </div>

        <div className="glass-card rounded-2xl p-7" data-join-state={bad ? 'bad' : !info ? 'loading' : !info.open ? 'closed' : done ? 'done' : known ? 'signed-in' : 'form'}>
          {bad ? (
            <p className="text-sm text-zinc-300 text-center">{bad}</p>
          ) : !info || authLoading ? (
            <div className="space-y-3"><div className="skeleton h-11 rounded-xl" /><div className="skeleton h-11 rounded-xl" /></div>
          ) : !info.open ? (
            <p className="text-sm text-zinc-300 text-center">This year&apos;s picks are already locked, so joining is closed.</p>
          ) : done ? (
            <div className="space-y-4 animate-slide-up">
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded-xl text-sm">{done.message}</div>
              {done.outcome === 'added' && (
                <Link href="/bowls/login" className={`block text-center ${gold}`}>Sign in</Link>
              )}
            </div>
          ) : known ? (
            <div className="space-y-4">
              {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm">{error}</div>}
              <p className="text-sm text-zinc-300">You&apos;re signed in as <strong className="text-white">{player?.name ?? nflProfile?.name ?? account?.email}</strong>.</p>
              <button type="button" onClick={joinSignedIn} disabled={busy} className={gold}>
                {busy ? 'Joining…' : `Join the ${info.label} Bowl Pick'em`}
              </button>
            </div>
          ) : (
            <form onSubmit={signUp} className="space-y-4">
              {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm animate-slide-up">{error}</div>}
              <div>
                <label htmlFor="join-name" className="block text-sm font-medium text-zinc-300 mb-1.5">Your name</label>
                <input id="join-name" value={name} onChange={e => setName(e.target.value)} className={input} placeholder="First and last name" required maxLength={60} autoComplete="name" />
              </div>
              <div>
                <label htmlFor="join-email" className="block text-sm font-medium text-zinc-300 mb-1.5">Email address</label>
                <input id="join-email" type="email" value={email} onChange={e => setEmail(e.target.value)} className={input} placeholder="you@example.com" required autoComplete="email" />
              </div>
              <button type="submit" disabled={busy || !name.trim() || !email.trim()} className={gold}>
                {busy ? 'Joining…' : 'Join'}
              </button>
              <p className="text-xs text-zinc-500 text-center leading-relaxed">
                We&apos;ll email you a link to set your password. All picks are due at the first kickoff.
              </p>
            </form>
          )}
        </div>
        {info?.open && !known && !done && !bad && (
          <p className="text-center text-sm text-zinc-500 mt-6">
            Already play NFL picks with us?{' '}
            <Link href="/bowls/login" className="text-yellow-400 hover:text-yellow-300 font-medium">Sign in</Link> and tap Join.
          </p>
        )}
      </div>
    </div>
  )
}
