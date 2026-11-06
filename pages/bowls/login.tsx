import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { useBowlAuth } from '@/lib/bowls/auth'
import { BOWL_NAME } from '@/lib/bowls/constants'

/**
 * Bowl Pick'em sign-in. Same login as the NFL side for anyone in both; a
 * login that's in neither the bowl pick'em nor the NFL league is turned away
 * here with a pointer to ask for an invite.
 */
export default function BowlLogin() {
  const router = useRouter()
  const { loading: authLoading, account, player, nflProfile, signIn, signOut } = useBowlAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'signin' | 'forgot'>('signin')
  const [resetSent, setResetSent] = useState('')

  // Already signed in as someone the bowl app knows → straight in.
  useEffect(() => {
    if (!authLoading && account && (player || nflProfile)) router.replace('/bowls')
  }, [authLoading, account, player, nflProfile, router])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const who = await signIn(email.trim(), password)
      if (!who.player && !who.nflProfile) {
        await signOut()
        throw new Error("That email isn't in the Bowl Pick'em. Ask Michael for an invite.")
      }
      router.replace('/bowls')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setBusy(false)
    }
  }

  const forgot = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const res = await fetch('/api/bowls/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not send the reset email')
      setResetSent(json.message)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the reset email')
    } finally {
      setBusy(false)
    }
  }

  const input = 'w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/50 focus:border-yellow-500/30 transition'

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-yellow-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[400px] h-[400px] bg-zinc-500/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md relative z-10 animate-fade-in">
        <div className="text-center mb-8">
          <img src="/logos/cfp-trophy.svg" alt="" className="mx-auto h-20 w-auto mb-5 drop-shadow-[0_8px_24px_rgba(202,138,4,0.25)]" />
          <h1 className="text-2xl font-bold text-white">{BOWL_NAME}</h1>
          <p className="text-zinc-400 mt-1.5 text-sm">College football bowl season</p>
        </div>

        <div className="glass-card rounded-2xl p-8">
          {error && <div className="mb-5 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm animate-slide-up">{error}</div>}

          {mode === 'forgot' && resetSent ? (
            <div className="animate-slide-up">
              <div className="mb-5 p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-sm">{resetSent}</div>
              <button type="button" onClick={() => { setMode('signin'); setResetSent('') }}
                className="w-full press bg-white/[0.06] border border-white/[0.08] text-zinc-200 font-semibold py-3 rounded-xl hover:bg-white/[0.10] transition">
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={mode === 'forgot' ? forgot : submit} className="space-y-5">
              {mode === 'forgot' && (
                <p className="text-sm text-zinc-400">Enter your email and we&apos;ll send you a link to choose a new password.</p>
              )}
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">Email address</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={input} placeholder="you@example.com" required />
              </div>
              {mode === 'signin' && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-medium text-zinc-300">Password</label>
                    <button type="button" onClick={() => { setMode('forgot'); setError('') }} className="text-xs text-yellow-400 hover:text-yellow-300 transition">
                      Forgot password?
                    </button>
                  </div>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} className={input} placeholder="••••••••" required />
                </div>
              )}
              <button type="submit" disabled={busy}
                className="w-full press bg-gradient-to-b from-yellow-400 to-yellow-600 text-zinc-950 font-semibold py-3 rounded-xl hover:brightness-110 disabled:opacity-50 transition shadow-lg shadow-yellow-600/20">
                {busy ? (mode === 'forgot' ? 'Sending…' : 'Signing in…') : mode === 'forgot' ? 'Send reset link' : 'Sign in'}
              </button>
              {mode === 'forgot' && (
                <button type="button" onClick={() => { setMode('signin'); setError('') }} className="w-full text-sm text-zinc-400 hover:text-zinc-200 transition">
                  Back to sign in
                </button>
              )}
            </form>
          )}
        </div>
        <p className="text-center text-sm text-zinc-500 mt-6">Not in yet? Ask Michael for an invite.</p>
      </div>
    </div>
  )
}
