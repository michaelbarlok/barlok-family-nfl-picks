import { useState } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/lib/auth'
import { CURRENT_SEASON } from '@/lib/constants'

export default function LoginPage() {
  const router = useRouter()
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'signin' | 'forgot'>('signin')
  const [resetSent, setResetSent] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await signIn(email, password)
      router.push('/picks')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setResetSent('')
    setLoading(true)

    try {
      const res = await fetch('/api/request-password-reset', {
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
      setLoading(false)
    }
  }

  const switchMode = (next: 'signin' | 'forgot') => {
    setMode(next)
    setError('')
    setResetSent('')
    setPassword('')
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4 relative overflow-hidden">
      {/* Subtle green field tint */}
      <div className="absolute inset-0 bg-green-950/30 pointer-events-none" />

      {/* Background gradient orbs */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-blue-600/15 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[400px] h-[400px] bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Football field yard lines + hash marks */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.045]"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="none"
      >
        {/* Side borders */}
        <line x1="4%" y1="0" x2="4%" y2="100%" stroke="white" strokeWidth="1.5" />
        <line x1="96%" y1="0" x2="96%" y2="100%" stroke="white" strokeWidth="1.5" />
        {/* End zone lines */}
        <line x1="0" y1="8%" x2="100%" y2="8%" stroke="white" strokeWidth="1.5" />
        <line x1="0" y1="92%" x2="100%" y2="92%" stroke="white" strokeWidth="1.5" />
        {/* Yard lines */}
        {[18, 27, 36, 45, 54, 63, 72, 81].map(pct => (
          <line key={pct} x1="4%" y1={`${pct}%`} x2="96%" y2={`${pct}%`} stroke="white" strokeWidth="1" />
        ))}
        {/* 50-yard line (slightly bolder) */}
        <line x1="4%" y1="50%" x2="96%" y2="50%" stroke="white" strokeWidth="1.8" />
        {/* Hash marks — left side */}
        {[18, 27, 36, 45, 54, 63, 72, 81].map(pct => (
          <g key={`lh-${pct}`}>
            <line x1="32%" y1={`${pct - 1.5}%`} x2="32%" y2={`${pct + 1.5}%`} stroke="white" strokeWidth="1" />
          </g>
        ))}
        {/* Hash marks — right side */}
        {[18, 27, 36, 45, 54, 63, 72, 81].map(pct => (
          <g key={`rh-${pct}`}>
            <line x1="68%" y1={`${pct - 1.5}%`} x2="68%" y2={`${pct + 1.5}%`} stroke="white" strokeWidth="1" />
          </g>
        ))}
      </svg>

      <div className="w-full max-w-md relative z-10 animate-fade-in">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl mb-5 shadow-lg shadow-blue-500/25">
            <span className="text-3xl">🏈</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Barlok Family</h1>
          <p className="text-slate-400 mt-1.5 text-sm">NFL Picks &middot; {CURRENT_SEASON} Season</p>
        </div>

        {/* Card */}
        <div className="glass-card rounded-2xl p-8">
          {error && (
            <div className="mb-5 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm animate-slide-up">
              {error}
            </div>
          )}

          {mode === 'forgot' && resetSent ? (
            <div className="animate-slide-up">
              <div className="mb-5 p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-sm">
                {resetSent}
              </div>
              <p className="text-xs text-slate-500 mb-5">
                The link works once and expires in 24 hours.
              </p>
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="w-full press bg-white/[0.06] border border-white/[0.08] text-slate-200 font-semibold py-3 rounded-xl hover:bg-white/[0.10] transition"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={mode === 'forgot' ? handleForgot : handleSubmit} className="space-y-5">
              {mode === 'forgot' && (
                <p className="text-sm text-slate-400">
                  Enter your email and we&apos;ll send you a link to choose a new password.
                </p>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Email address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/30 transition"
                  placeholder="you@example.com"
                  required
                />
              </div>

              {mode === 'signin' && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-medium text-slate-300">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => switchMode('forgot')}
                      className="text-xs text-blue-400 hover:text-blue-300 transition"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/30 transition"
                    placeholder="••••••••"
                    required
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full press bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold py-3 rounded-xl hover:from-blue-500 hover:to-indigo-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:ring-offset-2 focus:ring-offset-surface disabled:opacity-50 disabled:cursor-not-allowed transition shadow-lg shadow-blue-600/20"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {mode === 'forgot' ? 'Sending...' : 'Signing in...'}
                  </span>
                ) : mode === 'forgot' ? 'Send reset link' : 'Sign in'}
              </button>

              {mode === 'forgot' && (
                <button
                  type="button"
                  onClick={() => switchMode('signin')}
                  className="w-full text-sm text-slate-400 hover:text-slate-200 transition"
                >
                  Back to sign in
                </button>
              )}
            </form>
          )}
        </div>

        <p className="text-center text-sm text-slate-500 mt-6">
          New member? Contact Michael for access.
        </p>
      </div>
    </div>
  )
}
