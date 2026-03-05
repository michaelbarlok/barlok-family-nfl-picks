import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '@/lib/supabase'
import { CURRENT_SEASON } from '@/lib/constants'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'done' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    // Listen for the PASSWORD_RECOVERY event (fires when the client processes the hash token)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' && !cancelled) {
        setStatus('ready')
      }
    })

    async function initSession() {
      // PKCE flow: Supabase redirects with ?code=... in the query string
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
        if (!cancelled) {
          if (exchangeError) {
            setError('Invalid or expired reset link. Please request a new one from your profile.')
            setStatus('error')
          } else {
            setStatus('ready')
          }
        }
        return
      }

      // Implicit flow: tokens are in the URL hash — the client may have already
      // processed them before this component mounted, so check for an existing session
      const hash = window.location.hash
      if (hash && (hash.includes('access_token') || hash.includes('type=recovery'))) {
        // Give the Supabase client a moment to process the hash
        await new Promise(resolve => setTimeout(resolve, 500))
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (!cancelled) {
        if (session) {
          setStatus('ready')
        } else {
          setError('Invalid or expired reset link. Please request a new one from your profile.')
          setStatus('error')
        }
      }
    }

    initSession()

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setStatus('saving')
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      setStatus('done')
      setTimeout(() => router.push('/picks'), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update password')
      setStatus('ready')
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-blue-600/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[400px] h-[400px] bg-indigo-600/15 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md relative z-10 animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl mb-5 shadow-lg shadow-blue-500/25">
            <span className="text-3xl">🏈</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Reset Password</h1>
          <p className="text-slate-400 mt-1.5 text-sm">NFL Picks &middot; {CURRENT_SEASON} Season</p>
        </div>

        <div className="glass-card rounded-2xl p-8">
          {status === 'loading' && (
            <div className="text-center py-4">
              <span className="w-6 h-6 border-2 border-slate-500 border-t-slate-300 rounded-full animate-spin inline-block mb-3" />
              <p className="text-sm text-slate-400">Verifying reset link...</p>
            </div>
          )}

          {status === 'error' && (
            <div className="text-center py-4">
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm">
                {error}
              </div>
              <button
                onClick={() => router.push('/login')}
                className="text-sm text-blue-400 hover:text-blue-300 transition"
              >
                Back to sign in
              </button>
            </div>
          )}

          {status === 'done' && (
            <div className="text-center py-4">
              <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-sm">
                Password updated successfully! Redirecting...
              </div>
            </div>
          )}

          {(status === 'ready' || status === 'saving') && (
            <>
              {error && (
                <div className="mb-5 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm animate-slide-up">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">
                    New password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/30 transition"
                    placeholder="At least 6 characters"
                    required
                    minLength={6}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">
                    Confirm new password
                  </label>
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/30 transition"
                    placeholder="Re-enter password"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={status === 'saving'}
                  className="w-full press bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold py-3 rounded-xl hover:from-blue-500 hover:to-indigo-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:ring-offset-2 focus:ring-offset-surface disabled:opacity-50 disabled:cursor-not-allowed transition shadow-lg shadow-blue-600/20"
                >
                  {status === 'saving' ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Updating...
                    </span>
                  ) : 'Update password'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
