import { useCallback, useEffect, useState } from 'react'
import { isStandalone } from '@/lib/pushClient'

/**
 * A one-time ask, on iPhone and iPad only, to reinstall the Home Screen app so
 * it picks up the Football Picks name and icon.
 *
 * iOS copies an app's name and icon when it's added to the Home Screen and
 * never refreshes them; Android and desktop browsers update on their own. So
 * this only ever shows inside an installed app (standalone) on iOS.
 *
 * Telling an old install from a new one: each Home Screen app on iOS has its
 * own storage, and someone who has just added it hasn't signed in there yet.
 * So the first time this runs in an installed app —
 *   - already signed in → it was installed before the change: ask, once;
 *   - not signed in yet → a fresh install with the new icon: remember that and
 *     never ask.
 * The ask shows the new icon, so anyone it reaches by mistake can see they're
 * already up to date.
 */

export const REINSTALL_CLOSED_EVENT = 'app:reinstall-closed'
const SEEN_KEY = 'football-picks-icon'

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function hasSavedSignIn(): boolean {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && /^sb-.+-auth-token$/.test(k) && localStorage.getItem(k)) return true
  }
  return false
}

/** Will this visit open with the reinstall ask? (Same test the component uses.) */
export function reinstallPromptWillShow(): boolean {
  if (typeof window === 'undefined' || !isIOS() || !isStandalone()) return false
  try {
    return !localStorage.getItem(SEEN_KEY) && hasSavedSignIn()
  } catch {
    return false
  }
}

const TONES = {
  nfl: {
    sheet: 'bg-[#1a1d23] border-white/[0.08]',
    text: 'text-slate-300', muted: 'text-slate-400', faint: 'text-slate-500',
    step: 'bg-white/[0.08] text-slate-300',
    primary: 'text-white bg-blue-600 hover:bg-blue-500',
    link: 'bg-white/[0.04] border-white/[0.08] text-slate-300',
  },
  bowls: {
    sheet: 'bg-zinc-900 border-white/[0.08]',
    text: 'text-zinc-300', muted: 'text-zinc-400', faint: 'text-zinc-500',
    step: 'bg-white/[0.08] text-zinc-300',
    primary: 'text-zinc-950 bg-gradient-to-b from-yellow-400 to-yellow-600 hover:brightness-110',
    link: 'bg-white/[0.04] border-white/[0.08] text-zinc-300',
  },
}

export default function ReinstallPrompt({ tone = 'nfl' }: { tone?: 'nfl' | 'bowls' }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const t = TONES[tone]
  const startPath = tone === 'bowls' ? '/bowls' : '/picks'

  useEffect(() => {
    if (!isIOS() || !isStandalone()) return
    try {
      if (localStorage.getItem(SEEN_KEY)) return
      if (!hasSavedSignIn()) {
        // Added to the Home Screen after the change: it already has the new icon.
        localStorage.setItem(SEEN_KEY, 'new-install')
        return
      }
    } catch {
      return
    }
    const timer = window.setTimeout(() => setOpen(true), 1500)
    return () => window.clearTimeout(timer)
  }, [])

  const close = useCallback(() => {
    try { localStorage.setItem(SEEN_KEY, 'asked') } catch { /* private mode */ }
    setOpen(false)
    window.dispatchEvent(new Event(REINSTALL_CLOSED_EVENT))
  }, [])

  if (!open) return null

  const link = `${window.location.origin}${startPath}`
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      // Clipboard refused: the link is on screen to copy by hand.
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />
      <div role="dialog" aria-label="Update the app on your Home Screen"
        className={`relative w-full sm:max-w-sm border rounded-t-2xl sm:rounded-2xl shadow-2xl shadow-black/50 animate-slide-up safe-bottom safe-x max-h-[88vh] overflow-y-auto ${t.sheet}`}>
        <div className="p-5">
          <div className="flex items-start gap-3 mb-4">
            <div className="shrink-0 flex flex-col items-center gap-1 w-16">
              <img src="/icons/app-180.png" alt="The new Football Picks icon" className="w-14 h-14 rounded-[14px]" />
              <span className="text-[10px] text-white/80 leading-none">Football Picks</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-white font-semibold leading-tight">Update the app on your Home Screen</p>
              <p className={`text-[13px] leading-snug mt-1 ${t.muted}`}>
                It&apos;s now <strong className="text-white">Football Picks</strong>, with this new icon. iPhones don&apos;t
                update apps saved to the Home Screen, so it takes a quick reinstall.
              </p>
            </div>
            <button onClick={close} aria-label="Close" className={`shrink-0 -mt-1 -mr-1 p-1 hover:text-white transition ${t.faint}`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <ol className="space-y-2.5 mb-4">
            {[
              'Copy the link below, open Safari, and paste it into the address bar.',
              'Tap Share (the square with an arrow), then “Add to Home Screen”, then “Add”.',
              'Open the new Football Picks icon and sign in. If you use notifications, turn them back on when it asks.',
              'Press and hold the old icon and remove it from your Home Screen.',
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className={`shrink-0 w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center mt-0.5 ${t.step}`}>{i + 1}</span>
                <span className={`text-[13px] leading-snug ${t.text}`}>{step}</span>
              </li>
            ))}
          </ol>

          <div className={`flex items-center gap-2 mb-3 pl-3 pr-1 py-1 rounded-xl border ${t.link}`}>
            <span className="flex-1 min-w-0 truncate text-[13px] select-all">{link}</span>
            <button onClick={copy} className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${t.primary}`}>
              {copied ? 'Copied ✓' : 'Copy link'}
            </button>
          </div>
          <p className={`text-[11px] mb-4 ${t.faint}`}>
            If the icon you tapped already looks like the one above, you&apos;re all set.
          </p>

          <button onClick={close} className={`w-full py-2.5 text-sm font-semibold rounded-xl transition ${t.primary}`}>
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
