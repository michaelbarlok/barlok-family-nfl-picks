import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { useBowlAuth } from '@/lib/bowls/auth'
import BowlHeader from '@/components/bowls/BowlHeader'
import {
  getPushState, loadBowlNotifications, setBowlPush, setEmailReminders,
  type BowlNotifications, type PushState,
} from '@/lib/bowls/pushClient'

/**
 * Bowl Pick'em notifications — the bowl's own switches, separate from the
 * NFL's. Reminder emails follow the person; push is per device, so a phone
 * and a laptop can choose differently.
 *
 * Push has states a switch can't show: iPhones only allow it once the app is
 * on the Home Screen, and a blocked site can only be unblocked in settings.
 * Those are said plainly instead of offering a switch that does nothing.
 */
export default function BowlSettings() {
  const router = useRouter()
  const { loading, account, player, token } = useBowlAuth()
  const [prefs, setPrefs] = useState<BowlNotifications | null>(null)
  const [pushState, setPushState] = useState<PushState>('unsupported')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => { if (!loading && !account) router.replace('/bowls/login') }, [loading, account, router])

  const load = useCallback(async () => {
    setPushState(getPushState())
    try {
      setPrefs(await loadBowlNotifications(await token()))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your settings')
    }
  }, [token])

  useEffect(() => { if (player) load() }, [player, load])

  const flash = (text: string) => { setSaved(text); setTimeout(() => setSaved(s => (s === text ? '' : s)), 2500) }

  const toggleEmail = async (on: boolean) => {
    if (!prefs) return
    const before = prefs
    setBusy('email'); setError('')
    setPrefs({ ...prefs, emailReminders: on })
    try {
      setPrefs(await setEmailReminders(await token(), on))
      flash(on ? 'Reminder emails on' : 'Reminder emails off')
    } catch (err) {
      setPrefs(before)
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally { setBusy(null) }
  }

  const togglePush = async (kind: 'talk' | 'reminders', on: boolean) => {
    setBusy(kind); setError('')
    try {
      const { state, prefs: next } = await setBowlPush(await token(), kind, on)
      setPushState(state)
      if (next) {
        setPrefs(next)
        flash(`${kind === 'talk' ? 'Bowl Talk' : 'Pick reminder'} notifications ${on ? 'on' : 'off'} for this device`)
      } else if (on) {
        setError(state === 'denied'
          ? 'Notifications are blocked for this site. Turn them back on in your browser or phone settings.'
          : 'Could not turn on notifications for this device.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally { setBusy(null) }
  }

  const pushHint = pushState === 'needs-install'
    ? 'On iPhone and iPad, add this app to your Home Screen first (Share → Add to Home Screen), then open it from there.'
    : pushState === 'denied'
      ? 'Notifications are blocked for this site. Turn them back on in your browser or phone settings, then come back here.'
      : pushState === 'unsupported'
        ? 'This browser can’t receive notifications.'
        : prefs && !prefs.pushReady
          ? 'Push notifications aren’t set up on the site yet.'
          : null
  const pushUsable = !pushHint

  return (
    <div className="min-h-screen bg-zinc-950 pb-16">
      <BowlHeader subtitle="Notifications" />
      <main className="max-w-3xl mx-auto px-4 py-5 space-y-4 animate-fade-in">
        <div>
          <h1 className="text-xl font-bold text-white">Notifications</h1>
          <p className="text-sm text-zinc-500 mt-1">For the Bowl Pick&apos;em only — your NFL settings don&apos;t change.</p>
        </div>

        {!loading && account && !player && (
          <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/60 p-5 text-sm text-zinc-400">
            Join the Bowl Pick&apos;em to get its reminders. <Link href="/bowls" className="text-yellow-400 hover:text-yellow-300">Go to the home page</Link>
          </div>
        )}

        {error && <div role="alert" className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm">{error}</div>}
        {saved && <div role="status" className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-sm">{saved}</div>}

        {player && !prefs && !error && <div className="skeleton h-48 rounded-2xl" />}

        {player && prefs && (
          <>
            <section aria-labelledby="email-h" className="rounded-2xl border border-white/[0.06] bg-zinc-900/60 overflow-hidden">
              <h2 id="email-h" className="px-4 pt-4 pb-1 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Email</h2>
              <Row
                label="Pick reminders by email"
                hint="When picks open, and before they lock if yours aren’t finished. Players who are done get nothing."
                checked={prefs.emailReminders}
                busy={busy === 'email'}
                onChange={toggleEmail}
              />
            </section>

            <section aria-labelledby="push-h" className="rounded-2xl border border-white/[0.06] bg-zinc-900/60 overflow-hidden">
              <h2 id="push-h" className="px-4 pt-4 pb-1 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Push · this device</h2>
              {pushHint && <p className="px-4 pb-2 text-[13px] text-amber-300/90">{pushHint}</p>}
              <Row
                label="Pick reminders"
                hint="The same reminders, straight to this device."
                checked={pushUsable && !!prefs.device?.reminders}
                disabled={!pushUsable}
                busy={busy === 'reminders'}
                onChange={v => togglePush('reminders', v)}
              />
              <Row
                label="Bowl Talk"
                hint="New messages in Bowl Talk, and when someone tags or replies to you."
                checked={pushUsable && !!prefs.device?.talk}
                disabled={!pushUsable}
                busy={busy === 'talk'}
                onChange={v => togglePush('talk', v)}
              />
            </section>
          </>
        )}
      </main>
    </div>
  )
}

function Row({ label, hint, checked, onChange, busy, disabled }: {
  label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; busy?: boolean; disabled?: boolean
}) {
  return (
    <label className={`flex items-start justify-between gap-4 px-4 py-3.5 border-t border-white/[0.04] first:border-t-0 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-zinc-100">{label}</span>
        <span className="block text-xs text-zinc-500 mt-0.5 leading-snug">{hint}</span>
      </span>
      <span className="relative shrink-0 mt-0.5">
        <input type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled || busy}
          onChange={e => onChange(e.target.checked)} aria-label={label} />
        <span className={`block w-11 h-6 rounded-full transition ${checked ? 'bg-gradient-to-r from-yellow-400 to-yellow-600' : 'bg-zinc-700'} peer-focus-visible:ring-2 peer-focus-visible:ring-yellow-400/60 ${busy ? 'animate-pulse' : ''}`} />
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </span>
    </label>
  )
}
