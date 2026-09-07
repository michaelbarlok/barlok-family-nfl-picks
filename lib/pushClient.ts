import { supabase } from '@/lib/supabase'

/**
 * Browser side of Web Push.
 *
 * Platform facts that shape the UI:
 *   - Permission can only be requested from a user gesture, so this hangs off a
 *     button rather than firing on load.
 *   - On iOS, Web Push exists ONLY once the app is on the Home Screen. In a
 *     Safari tab the APIs are simply absent, so the UI has to say "install
 *     first" rather than offer a button that would do nothing.
 *   - A denied permission cannot be re-requested by the page. Only the user can
 *     undo it in browser or OS settings.
 */

export type PushState = 'unsupported' | 'needs-install' | 'default' | 'granted' | 'denied'

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function getPushState(): PushState {
  if (typeof window === 'undefined') return 'unsupported'
  const hasApis = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (!hasApis) return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  return 'default'
}

// VAPID keys travel as base64url; PushManager wants raw bytes, backed by a real
// ArrayBuffer so the type matches BufferSource exactly.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const buffer = new ArrayBuffer(raw.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

async function save(sub: PushSubscription, talkEnabled?: boolean) {
  const json = sub.toJSON()
  const token = (await supabase.auth.getSession()).data.session?.access_token ?? ''
  const res = await fetch('/api/push-subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, talkEnabled }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not save the setting')
  return (await res.json()).talkEnabled as boolean
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!publicKey || getPushState() !== 'granted') return null
  const registration = await navigator.serviceWorker.ready
  return (await registration.pushManager.getSubscription()) ??
    await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
}

/** Is this device currently set to receive Talk notifications? */
export async function getTalkEnabled(): Promise<boolean> {
  if (getPushState() !== 'granted') return false
  const registration = await navigator.serviceWorker.ready
  const sub = await registration.pushManager.getSubscription()
  if (!sub) return false
  const { data } = await supabase
    .from('push_subscriptions').select('talk_enabled').eq('endpoint', sub.endpoint).maybeSingle()
  return data?.talk_enabled === true
}

/**
 * Turn Talk notifications on or off for this device.
 * Must be called from a click when permission has not yet been granted.
 */
export async function setTalkEnabled(enabled: boolean): Promise<{ state: PushState; enabled: boolean }> {
  let state = getPushState()

  if (enabled && state === 'default') {
    const permission = await Notification.requestPermission()
    state = permission === 'granted' ? 'granted' : permission === 'denied' ? 'denied' : 'default'
  }
  if (state !== 'granted') return { state, enabled: false }

  const sub = await currentSubscription()
  if (!sub) return { state, enabled: false }
  return { state, enabled: await save(sub, enabled) }
}

/**
 * Register this browser for push, asking for permission if it hasn't been
 * answered yet. Must be called from a click, because that is the only context
 * a browser will show the permission prompt in.
 *
 * Separate from setTalkEnabled because not every push preference is a Talk
 * preference: pick reminders are a per-person setting stored on `users`, but
 * they still need a subscribed device to arrive on, and this is that step.
 */
export async function enableDevicePush(): Promise<{ state: PushState; ok: boolean }> {
  let state = getPushState()
  if (state === 'default') {
    const permission = await Notification.requestPermission()
    state = permission === 'granted' ? 'granted' : permission === 'denied' ? 'denied' : 'default'
  }
  if (state !== 'granted') return { state, ok: false }

  const sub = await currentSubscription()
  if (!sub) return { state, ok: false }
  // No talkEnabled: registering a device says nothing about the thread.
  await save(sub)
  return { state, ok: true }
}

/**
 * Keep an already-permitted device registered.
 *
 * Cheap and safe on load: the browser returns the same endpoint each time and
 * the server upserts on it, which is what survives an endpoint rotation. It
 * deliberately does not pass talkEnabled, so it never overwrites the choice.
 */
export async function refreshSubscription(): Promise<void> {
  const sub = await currentSubscription()
  if (sub) await save(sub)
}
