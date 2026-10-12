import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { AVATAR_ACCEPT, uploadOwnAvatar } from '@/lib/avatarUtils'
import {
  enableDevicePush, getPushState, getTalkEnabled, setTalkEnabled, type PushState,
} from '@/lib/pushClient'
import { INSTALL_CLOSED_EVENT, installPromptWillShow } from '@/components/InstallPrompt'

/**
 * "Finish setting up" — asks for whatever this player is still missing:
 *
 *   📸 a profile photo, if they have none;
 *   🔔 notifications, if this device could deliver them but isn't set to —
 *      💩 Talk is off here, or pick-reminder push is off or has no device.
 *
 * One sheet with a row per missing thing, rather than a prompt each, so a new
 * player sees one ask, not a queue of them.
 *
 * Like the install sheet, it asks on every visit until done. "Not now" is for
 * this page load only; nothing is remembered. The ask stops when the thing is
 * done, not after it has been waved away enough times.
 *
 * Notifications are only offered where a tap can actually turn them on:
 *   - not on an iPhone in Safari ('needs-install') — the install sheet already
 *     covers that, and push there only exists once installed;
 *   - not where the browser has no push ('unsupported');
 *   - not where the person blocked notifications ('denied') — the page can't
 *     re-ask, and nagging about a setting buried in iOS Settings every visit
 *     would just be noise. They can still turn it on from their profile.
 *
 * It never stacks on the install sheet: if that's opening this visit, this
 * waits for it to close.
 */

const SKIP_PATHS = ['/login', '/reset-password']
const DELAY_MS = 4500 // just after the install sheet's 4s, so the page has drawn

type Need = { photo: boolean; notify: boolean }

export default function SetupPrompt() {
  const router = useRouter()
  const { user, updateAvatarUrl } = useAuth()
  const [open, setOpen] = useState(false)
  const [need, setNeed] = useState<Need>({ photo: false, notify: false })
  const [done, setDone] = useState<Need>({ photo: false, notify: false })
  const [busy, setBusy] = useState<'photo' | 'notify' | null>(null)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  // Checked once per page load, like the install sheet.
  const checked = useRef(false)
  const avatarRef = useRef<string | null | undefined>(user?.avatar_url)
  avatarRef.current = user?.avatar_url

  const userId = user?.id
  const onSkippedPage = SKIP_PATHS.includes(router.pathname)

  useEffect(() => {
    if (!userId || onSkippedPage || checked.current) return
    checked.current = true
    let cancelled = false

    const evaluate = async () => {
      const photo = !avatarRef.current
      let notify = false
      const state: PushState = getPushState()
      if (state === 'default') {
        notify = true
      } else if (state === 'granted') {
        const [talkOn, picksPush] = await Promise.all([
          getTalkEnabled().catch(() => true), // unknown → don't nag
          picksPushPref().catch(() => true),
        ])
        notify = !talkOn || !picksPush
      }
      if (cancelled || (!photo && !notify)) return
      setNeed({ photo, notify })
      setOpen(true)
    }

    let timer: number | undefined
    const start = () => { timer = window.setTimeout(() => { evaluate().catch(() => {}) }, DELAY_MS) }
    const afterInstall = () => { timer = window.setTimeout(() => { evaluate().catch(() => {}) }, 800) }

    if (installPromptWillShow()) {
      window.addEventListener(INSTALL_CLOSED_EVENT, afterInstall, { once: true })
    } else {
      start()
    }
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      window.removeEventListener(INSTALL_CLOSED_EVENT, afterInstall)
    }
  }, [userId, onSkippedPage])

  const close = useCallback(() => { setOpen(false); setError('') }, [])

  // Everything asked for is done: say so, then get out of the way.
  const allDone = (!need.photo || done.photo) && (!need.notify || done.notify)
  useEffect(() => {
    if (!open || !allDone) return
    const t = window.setTimeout(close, 1600)
    return () => window.clearTimeout(t)
  }, [open, allDone, close])

  if (!open || !user) return null

  const onPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy('photo')
    setError('')
    try {
      updateAvatarUrl(await uploadOwnAvatar(file))
      setDone(d => ({ ...d, photo: true }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload that photo')
    } finally {
      setBusy(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // Must run straight from the tap: it's the only context a browser will show
  // the permission prompt in.
  const onNotify = async () => {
    setBusy('notify')
    setError('')
    try {
      const { state, ok } = await enableDevicePush()
      if (!ok) {
        setError(state === 'denied'
          ? 'Notifications were blocked. You can turn them on later in your phone or browser settings.'
          : 'Could not turn on notifications on this device.')
        return
      }
      await setTalkEnabled(true)
      // Read fresh rather than from the load: on a device that had never been
      // asked, the preference wasn't looked up then.
      if (!(await picksPushPref().catch(() => true))) await savePicksPush(true)
      setDone(d => ({ ...d, notify: true }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not turn on notifications')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />

      <div
        role="dialog"
        aria-label="Finish setting up"
        className="relative w-full sm:max-w-sm bg-[#1a1d23] border border-white/[0.08] rounded-t-2xl sm:rounded-2xl shadow-2xl shadow-black/50 animate-slide-up safe-bottom safe-x max-h-[85vh] overflow-y-auto"
      >
        <div className="p-5">
          <div className="flex items-start gap-3 mb-4">
            <div className="min-w-0 flex-1">
              <p className="text-white font-semibold leading-tight">
                {allDone ? "You're all set 🎉" : 'Finish setting up'}
              </p>
              <p className="text-[13px] text-slate-400 leading-snug mt-1">
                {allDone ? 'Thanks — that’s everything.' : 'A couple of quick things so you get the most out of the app.'}
              </p>
            </div>
            <button
              onClick={close}
              aria-label="Close"
              className="shrink-0 -mt-1 -mr-1 p-1 text-slate-500 hover:text-slate-300 transition"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="space-y-2.5 mb-4">
            {need.photo && (
              <Row
                icon={user.avatar_url
                  ? <img src={user.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover" />
                  : <span className="text-xl">📸</span>}
                title="Add a profile photo"
                sub="It shows next to your picks, in the standings and in 💩 Talk."
                done={done.photo}
                action={
                  <>
                    <input ref={fileRef} type="file" accept={AVATAR_ACCEPT} className="hidden" onChange={onPhoto} />
                    <RowButton busy={busy === 'photo'} disabled={busy !== null} onClick={() => fileRef.current?.click()}>
                      Add photo
                    </RowButton>
                  </>
                }
              />
            )}
            {need.notify && (
              <Row
                icon={<span className="text-xl">🔔</span>}
                title="Turn on notifications"
                sub="A reminder before picks lock, and new 💩 Talk messages — on this device."
                done={done.notify}
                action={
                  <RowButton busy={busy === 'notify'} disabled={busy !== null} onClick={onNotify}>
                    Turn on
                  </RowButton>
                }
              />
            )}
          </div>

          {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

          {!allDone && (
            <button
              onClick={close}
              className="w-full py-2.5 text-sm font-medium text-slate-400 bg-white/[0.04] border border-white/[0.08] rounded-xl hover:text-slate-200 transition"
            >
              Not now
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ icon, title, sub, done, action }: {
  icon: React.ReactNode
  title: string
  sub: string
  done: boolean
  action: React.ReactNode
}) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border transition ${
      done ? 'bg-emerald-500/10 border-emerald-500/25' : 'bg-white/[0.03] border-white/[0.06]'
    }`}>
      <div className="w-10 h-10 rounded-full bg-white/[0.06] flex items-center justify-center shrink-0 overflow-hidden">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white leading-tight">{title}</p>
        <p className="text-[11px] text-slate-400 leading-snug mt-0.5">{sub}</p>
      </div>
      {done
        ? <span className="shrink-0 text-xs font-semibold text-emerald-400">✓ Done</span>
        : <div className="shrink-0">{action}</div>}
    </div>
  )
}

function RowButton({ children, busy, disabled, onClick }: {
  children: React.ReactNode
  busy: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="press px-3 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-500 disabled:opacity-60 transition whitespace-nowrap"
    >
      {busy ? '…' : children}
    </button>
  )
}

async function authHeader(): Promise<Record<string, string>> {
  const token = (await supabase.auth.getSession()).data.session?.access_token ?? ''
  return { Authorization: `Bearer ${token}` }
}

/** The person-level "pick reminders by push" switch. Missing column → treat as on. */
async function picksPushPref(): Promise<boolean> {
  const res = await fetch('/api/notification-prefs', { headers: await authHeader() })
  if (!res.ok) return true
  const json = await res.json()
  return json.prefs?.notify_picks_push !== false
}

async function savePicksPush(value: boolean): Promise<void> {
  await fetch('/api/notification-prefs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ notify_picks_push: value }),
  })
}
