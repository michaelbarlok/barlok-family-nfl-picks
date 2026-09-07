import { useCallback, useEffect, useState } from 'react'
import { isStandalone } from '@/lib/pushClient'

/**
 * Nudge mobile visitors to install the app.
 *
 * Worth doing beyond the convenience: on iOS, Web Push exists ONLY for an
 * installed PWA, so anyone reading this in a Safari tab can never receive a
 * pick reminder or a 💩 Talk alert no matter what they turn on.
 *
 * The two platforms are genuinely different, not just cosmetically:
 *   - Chrome on Android fires `beforeinstallprompt`, which can be stashed and
 *     replayed later from a click to show the real OS install dialog. It fires
 *     once per page load and only when the site meets the install criteria.
 *   - iOS has no equivalent API at all. Nothing the page does can trigger the
 *     install sheet, so the only honest thing to offer is instructions.
 * So "Install" means two different things here, and the button says which.
 */

const DISMISS_KEY = 'nfl-install-dismissed'
const DISMISS_DAYS = 14
/** Fire this on window to reopen the sheet after someone dismissed it. */
export const SHOW_INSTALL_EVENT = 'nfl:show-install'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

declare global {
  interface Window { __deferredInstallPrompt?: BeforeInstallPromptEvent | null }
}

type Platform = 'ios' | 'android' | 'other'

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent
  const iOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (iOS) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'other'
}

/** Phone or tablet, not a desktop browser someone narrowed the window on. */
function isHandheld(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 900
}

function dismissedRecently(): boolean {
  try {
    const at = window.localStorage.getItem(DISMISS_KEY)
    if (!at) return false
    return Date.now() - Number(at) < DISMISS_DAYS * 86400_000
  } catch {
    return false // private mode and blocked storage both just mean "ask again"
  }
}

export default function InstallPrompt() {
  const [open, setOpen] = useState(false)
  const [showSteps, setShowSteps] = useState(false)
  const [platform, setPlatform] = useState<Platform>('other')
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)

  const close = useCallback((remember: boolean) => {
    setOpen(false)
    setShowSteps(false)
    if (!remember) return
    try { window.localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* fine */ }
  }, [])

  useEffect(() => {
    setPlatform(detectPlatform())
    // Usually already here: the event fires as soon as the page qualifies,
    // which can be before this component hydrates, so _document parks it.
    if (window.__deferredInstallPrompt) setDeferred(window.__deferredInstallPrompt)

    const onBeforeInstall = (e: Event) => {
      // Without this Chrome shows its own mini-infobar instead, and the event
      // can no longer be replayed from our button.
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setDeferred(null)
      close(false)
      try { window.localStorage.removeItem(DISMISS_KEY) } catch { /* fine */ }
    }
    // Opened deliberately from the profile panel — ignores the dismissal.
    const onAsk = () => { setShowSteps(false); setOpen(true) }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    window.addEventListener(SHOW_INSTALL_EVENT, onAsk)

    // Held back a few seconds: arriving to a modal before the page has drawn
    // reads as an ad, not an offer.
    const timer = window.setTimeout(() => {
      if (isHandheld() && !isStandalone() && !dismissedRecently()) setOpen(true)
    }, 4000)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
      window.removeEventListener(SHOW_INSTALL_EVENT, onAsk)
      window.clearTimeout(timer)
    }
  }, [close])

  if (!open) return null

  const install = async () => {
    if (deferred) {
      await deferred.prompt()
      const { outcome } = await deferred.userChoice
      setDeferred(null) // the event is single-use
      window.__deferredInstallPrompt = null
      close(outcome === 'dismissed')
      return
    }
    // No API to call — iOS always, and Android when Chrome didn't offer the
    // event (already installed elsewhere, an unsupported browser, or criteria
    // not met). Show the manual route rather than a button that does nothing.
    setShowSteps(true)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => close(true)} />

      <div className="relative w-full sm:max-w-sm bg-[#1a1d23] border border-white/[0.08] rounded-t-2xl sm:rounded-2xl shadow-2xl shadow-black/50 animate-slide-up safe-bottom safe-x max-h-[85vh] overflow-y-auto">
        <div className="p-5">
          <div className="flex items-start gap-3 mb-4">
            <img src="/icons/icon-192.svg" alt="" className="w-12 h-12 rounded-xl shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-white font-semibold leading-tight">Add to your Home Screen</p>
              <p className="text-[13px] text-slate-400 leading-snug mt-1">
                Opens full screen, remembers you, and it&apos;s the only way to get pick
                reminders on your phone.
              </p>
            </div>
            <button
              onClick={() => close(true)}
              aria-label="Close"
              className="shrink-0 -mt-1 -mr-1 p-1 text-slate-500 hover:text-slate-300 transition"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {showSteps ? (
            <>
              <ol className="space-y-2.5 mb-4">
                {(platform === 'ios' ? IOS_STEPS : ANDROID_STEPS).map((step, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-white/[0.08] text-[11px] font-bold text-slate-300 flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-[13px] text-slate-300 leading-snug">{step}</span>
                  </li>
                ))}
              </ol>
              {platform === 'ios' && (
                <p className="text-[11px] text-slate-500 mb-4">
                  iPhone has no one-tap install — Apple only allows this from the Share menu.
                </p>
              )}
              <button
                onClick={() => close(true)}
                className="w-full py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-500 transition"
              >
                Got it
              </button>
            </>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => close(true)}
                className="flex-1 py-2.5 text-sm font-medium text-slate-400 bg-white/[0.04] border border-white/[0.08] rounded-xl hover:text-slate-200 transition"
              >
                Not now
              </button>
              <button
                onClick={install}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-500 transition"
              >
                {deferred ? 'Install' : 'Show me how'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const IOS_STEPS = [
  'Tap the Share button — the square with an arrow pointing up. It’s at the bottom of the screen in Safari, or next to the address bar in Chrome.',
  'Scroll down the list and tap "Add to Home Screen".',
  'Tap "Add" in the top right.',
]

const ANDROID_STEPS = [
  'Tap the ⋮ menu in the top right of your browser.',
  'Tap "Install app", or "Add to Home screen" if you don’t see it.',
  'Confirm, and the icon lands on your home screen.',
]
