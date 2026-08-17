import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '@/lib/supabase'
import { CURRENT_SEASON } from '@/lib/constants'

/**
 * Turn Supabase's link failure into something the reader can act on.
 * `otp_expired` covers both "already used" and "too old" — Supabase does not
 * distinguish them, so the copy names both rather than guessing.
 */
function explainLinkError(code: string | null, description: string | null, invite: boolean): string {
  const spent = code === 'otp_expired' || /expired|invalid|already/i.test(description ?? '')
  if (spent) {
    return invite
      ? 'This invite link has already been used or has expired. Ask Michael to resend your invite.'
      : 'This reset link has already been used or has expired. Request a new one from the sign-in page.'
  }
  if (description) return description
  return invite
    ? 'Something went wrong opening your invite. Ask Michael to resend it.'
    : 'Invalid reset link. Request a new one from the sign-in page.'
}

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'done' | 'error'>('loading')
  const [error, setError] = useState('')
  // Invite links land here too (?invite=1). Same flow, different wording — a new
  // player has no account yet, so "reset your password" would make no sense.
  const [isInvite, setIsInvite] = useState(false)

  useEffect(() => {
    let cancelled = false

    const params = new URLSearchParams(window.location.search)
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const invite = params.get('invite') === '1'
    setIsInvite(invite)

    // Listen for the PASSWORD_RECOVERY event (fires when the client processes the hash token)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' && !cancelled) {
        setStatus('ready')
      }
    })

    async function initSession() {
      // Supabase does not throw on a bad link — it redirects here and puts the
      // reason in the URL (query on the PKCE flow, hash on the implicit one).
      // Read it, or every distinct failure looks like the same dead end.
      const errCode = params.get('error_code') ?? hashParams.get('error_code')
      const errDesc = params.get('error_description') ?? hashParams.get('error_description')
      if (errCode || params.get('error') || hashParams.get('error')) {
        if (!cancelled) {
          setError(explainLinkError(errCode, errDesc, invite))
          setStatus('error')
        }
        return
      }

      // Preferred path: the emailed link carries the hashed token and we verify
      // it here. The alternative — linking straight at Supabase's verify
      // endpoint — burns the single-use token on the first GET, which means any
      // scanner or previewer that follows the link consumes it before the
      // person ever clicks. Verifying from JS keeps that from happening.
      const tokenHash = params.get('token_hash')
      if (tokenHash) {
        // `t` names the token type when it isn't implied by the page. magiclink
        // is only here for links sent before resends switched to recovery.
        const t = params.get('t')
        const otpType = t === 'magiclink' ? 'magiclink'
          : t === 'recovery' ? 'recovery'
          : invite ? 'invite' : 'recovery'
        const { error: otpError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: otpType as 'invite' | 'recovery' | 'magiclink',
        })
        if (!cancelled) {
          if (otpError) {
            setError(explainLinkError(null, otpError.message, invite))
            setStatus('error')
          } else {
            setStatus('ready')
          }
        }
        return
      }

      // PKCE flow: Supabase redirects with ?code=... in the query string
      const code = params.get('code')
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
        if (!cancelled) {
          if (exchangeError) {
            setError(explainLinkError(null, null, invite))
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
          setError(explainLinkError(null, null, invite))
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
          <h1 className="text-2xl font-bold text-white">{isInvite ? 'Welcome!' : 'Reset Password'}</h1>
          <p className="text-slate-400 mt-1.5 text-sm">NFL Picks &middot; {CURRENT_SEASON} Season</p>
        </div>

        <div className="glass-card rounded-2xl p-8">
          {status === 'loading' && (
            <div className="text-center py-4">
              <span className="w-6 h-6 border-2 border-slate-500 border-t-slate-300 rounded-full animate-spin inline-block mb-3" />
              <p className="text-sm text-slate-400">{isInvite ? 'Verifying your invite...' : 'Verifying reset link...'}</p>
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
                {isInvite ? "You're all set! Taking you to your picks..." : 'Password updated successfully! Redirecting...'}
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
                    {isInvite ? 'Choose a password' : 'New password'}
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
                    {isInvite ? 'Confirm password' : 'Confirm new password'}
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
                  ) : isInvite ? 'Create my account' : 'Update password'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
