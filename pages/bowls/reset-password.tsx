import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '@/lib/supabase'
import { useBowlAuth } from '@/lib/bowls/auth'
import { BOWL_NAME } from '@/lib/bowls/constants'

/**
 * Choose a password from a Bowl Pick'em email — a new player's invite
 * (?invite=1) or a reset. Same verification as the NFL's page: the emailed
 * link carries a hashed token that's spent here from JavaScript, so a mail
 * scanner following the link can't use it up first.
 */
export default function BowlResetPassword() {
  const router = useRouter()
  const { refresh } = useBowlAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'done' | 'error'>('loading')
  const [error, setError] = useState('')
  const [isInvite, setIsInvite] = useState(false)

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams(window.location.search)
    const invite = params.get('invite') === '1'
    setIsInvite(invite)
    const spent = invite
      ? 'This invite link has already been used or has expired. Ask Michael to resend your invite.'
      : 'This reset link has already been used or has expired. Request a new one from the sign-in page.'

    ;(async () => {
      const tokenHash = params.get('token_hash')
      if (!tokenHash) {
        const { data: { session } } = await supabase.auth.getSession()
        if (!cancelled) {
          if (session) setStatus('ready')
          else { setError(spent); setStatus('error') }
        }
        return
      }
      const { error: otpError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
      if (cancelled) return
      if (otpError) { setError(/expired|invalid|already/i.test(otpError.message) ? spent : otpError.message); setStatus('error') }
      else setStatus('ready')
    })()
    return () => { cancelled = true }
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setStatus('saving')
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      setStatus('done')
      await refresh()
      setTimeout(() => router.replace('/bowls'), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update password')
      setStatus('ready')
    }
  }

  const input = 'w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/50 focus:border-yellow-500/30 transition'

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-yellow-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="w-full max-w-md relative z-10 animate-fade-in">
        <div className="text-center mb-8">
          <img src="/logos/cfp-trophy.svg" alt="" className="mx-auto h-20 w-auto mb-5 drop-shadow-[0_8px_24px_rgba(202,138,4,0.25)]" />
          <h1 className="text-2xl font-bold text-white">{isInvite ? 'Welcome!' : 'Reset password'}</h1>
          <p className="text-zinc-400 mt-1.5 text-sm">{BOWL_NAME}</p>
        </div>

        <div className="glass-card rounded-2xl p-8">
          {status === 'loading' && <p className="text-center text-sm text-zinc-400 py-4">{isInvite ? 'Checking your invite…' : 'Checking your link…'}</p>}
          {status === 'error' && (
            <div className="text-center py-2">
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm">{error}</div>
              <button onClick={() => router.push('/bowls/login')} className="text-sm text-yellow-400 hover:text-yellow-300 transition">Back to sign in</button>
            </div>
          )}
          {status === 'done' && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-sm text-center">
              {isInvite ? "You're all set! Taking you to the Bowl Pick'em…" : 'Password updated! Taking you in…'}
            </div>
          )}
          {(status === 'ready' || status === 'saving') && (
            <form onSubmit={submit} className="space-y-5">
              {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm">{error}</div>}
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">{isInvite ? 'Choose a password' : 'New password'}</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} className={input} placeholder="At least 6 characters" required minLength={6} />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">Confirm password</label>
                <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} className={input} placeholder="Re-enter password" required />
              </div>
              <button type="submit" disabled={status === 'saving'}
                className="w-full press bg-gradient-to-b from-yellow-400 to-yellow-600 text-zinc-950 font-semibold py-3 rounded-xl hover:brightness-110 disabled:opacity-50 transition">
                {status === 'saving' ? 'Saving…' : isInvite ? 'Create my account' : 'Update password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
