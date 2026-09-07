import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  getPushState, getTalkEnabled, setTalkEnabled, enableDevicePush, type PushState,
} from '@/lib/pushClient'

interface Prefs {
  notify_picks_email: boolean
  notify_picks_push: boolean
  email_recipient: boolean
}

/**
 * A player's own notification switches, for the profile panel.
 *
 * Two different scopes live here on purpose, and the labels say which is which:
 * pick reminders and the weekly spreadsheet are per person and follow you to
 * any device, while 💩 Talk is per browser — a phone on the sofa and a laptop
 * at work reasonably want different answers for a chat thread.
 *
 * Push has states a checkbox can't express. iOS only exposes Web Push to an
 * installed PWA, and a denied permission can never be re-requested by the page
 * — only the person can undo it in settings. Both are said plainly rather than
 * offering a switch that would silently do nothing.
 */
export default function NotificationSettings() {
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [pushState, setPushState] = useState<PushState>('unsupported')
  const [talkOn, setTalkOn] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const token = async () => (await supabase.auth.getSession()).data.session?.access_token ?? ''

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notification-prefs', {
        headers: { Authorization: `Bearer ${await token()}` },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load your settings')
      setPrefs(json.prefs)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your settings')
    } finally {
      setLoading(false)
    }
    setPushState(getPushState())
    getTalkEnabled().then(setTalkOn).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  const savePref = async (key: keyof Prefs, value: boolean) => {
    setBusy(key)
    setError('')
    const previous = prefs
    setPrefs(p => (p ? { ...p, [key]: value } : p)) // optimistic — these are switches, not forms
    try {
      const res = await fetch('/api/notification-prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ [key]: value }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not save')
      setPrefs(json.prefs)
    } catch (err) {
      setPrefs(previous)
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusy(null)
    }
  }

  const togglePicksPush = async (value: boolean) => {
    // Turning it on needs a subscribed device, and the permission prompt only
    // appears from a click — which is this one.
    if (value) {
      setBusy('notify_picks_push')
      const { state, ok } = await enableDevicePush()
      setPushState(state)
      setBusy(null)
      if (!ok) {
        setError(state === 'denied'
          ? 'Notifications are blocked for this site. Turn them back on in your browser or phone settings.'
          : 'Could not register this device for push.')
        return
      }
    }
    await savePref('notify_picks_push', value)
  }

  const toggleTalk = async (value: boolean) => {
    setBusy('talk')
    setError('')
    try {
      const { state, enabled } = await setTalkEnabled(value)
      setPushState(state)
      setTalkOn(enabled)
      if (value && !enabled) {
        setError(state === 'denied'
          ? 'Notifications are blocked for this site. Turn them back on in your browser or phone settings.'
          : 'Could not turn on notifications for this device.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusy(null)
    }
  }

  const pushBlocked = pushState !== 'granted' && pushState !== 'default'

  return (
    <div className="border-t border-white/[0.06] pt-4">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Notifications</p>

      {error && (
        <div className="mb-3 p-2.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-[11px]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="skeleton h-24 rounded-lg" />
      ) : (
        <div className="space-y-0.5">
          <Row
            label="Pick reminders by email"
            hint="When an admin nudges the players who haven't finished a week."
            checked={prefs?.notify_picks_email !== false}
            busy={busy === 'notify_picks_email'}
            onChange={v => savePref('notify_picks_email', v)}
          />
          <Row
            label="Pick reminders by push"
            hint={
              pushState === 'needs-install'
                ? 'Add the app to your Home Screen first — Safari tabs can’t receive notifications.'
                : pushState === 'denied'
                  ? 'Blocked in your browser or phone settings.'
                  : pushState === 'unsupported'
                    ? 'This browser doesn’t support notifications.'
                    : 'Same reminder, straight to this device.'
            }
            checked={prefs?.notify_picks_push !== false && pushState === 'granted'}
            disabled={pushBlocked}
            busy={busy === 'notify_picks_push'}
            onChange={togglePicksPush}
          />
          <Row
            label="💩 Talk on this device"
            hint="Every new message in the thread. Set per browser, not per person."
            checked={talkOn}
            disabled={pushBlocked}
            busy={busy === 'talk'}
            onChange={toggleTalk}
          />
          <Row
            label="Weekly picks spreadsheet"
            hint="The emailed sheet of everyone's picks for the week."
            checked={prefs?.email_recipient === true}
            busy={busy === 'email_recipient'}
            onChange={v => savePref('email_recipient', v)}
          />
        </div>
      )}
    </div>
  )
}

function Row({ label, hint, checked, disabled, busy, onChange }: {
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  busy?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className="w-full flex items-start gap-3 py-2 text-left disabled:opacity-50 group"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-slate-200 group-hover:text-white transition">{label}</span>
        <span className="block text-[11px] text-slate-500 leading-snug">{hint}</span>
      </span>
      <span
        className={`shrink-0 mt-0.5 w-9 h-5 rounded-full p-0.5 transition-colors ${
          checked ? 'bg-blue-600' : 'bg-white/[0.10]'
        }`}
      >
        <span
          className={`block w-4 h-4 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-4' : ''
          } ${busy ? 'opacity-50' : ''}`}
        />
      </span>
    </button>
  )
}
