import { getPushState, type PushState } from '@/lib/pushClient'

/*
 * Browser side of the Bowl Pick'em's push notifications.
 *
 * A phone has one push registration for the whole site — the same one the NFL
 * side uses — so this never unsubscribes it (that would silence NFL Talk and
 * reminders too). Turning bowl notifications off only changes the bowl's own
 * row for this device.
 *
 * The permission prompt only appears from a click, so turning something on
 * goes through `enable`, called from the switch itself.
 */

export type { PushState }
export { getPushState }

export interface BowlDevice { talk: boolean; reminders: boolean }
export interface BowlNotifications { emailReminders: boolean; device: BowlDevice | null; pushReady: boolean }

const LAST_ENDPOINT = 'bowl-push-endpoint'

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const buffer = new ArrayBuffer(raw.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** This browser's existing registration, without asking for anything. */
async function existing(): Promise<PushSubscription | null> {
  if (getPushState() !== 'granted') return null
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

/** Ask (from a click) and register. Reuses the site's registration if there is one. */
async function subscribe(): Promise<{ state: PushState; sub: PushSubscription | null }> {
  let state = getPushState()
  if (state === 'default') {
    const answer = await Notification.requestPermission()
    state = answer === 'granted' ? 'granted' : answer === 'denied' ? 'denied' : 'default'
  }
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (state !== 'granted' || !publicKey) return { state, sub: null }
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) ??
    await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) })
  return { state, sub }
}

function remember(endpoint: string) {
  try { localStorage.setItem(LAST_ENDPOINT, endpoint) } catch { /* private mode */ }
}
function remembered(): string | null {
  try { return localStorage.getItem(LAST_ENDPOINT) } catch { return null }
}

async function post(token: string, body: Record<string, unknown>): Promise<BowlNotifications> {
  const res = await fetch('/api/bowls/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? 'Could not save the setting')
  return json as BowlNotifications
}

/** The player's email setting and this device's push settings. */
export async function loadBowlNotifications(token: string): Promise<BowlNotifications> {
  const sub = await existing().catch(() => null)
  const qs = sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : ''
  const res = await fetch(`/api/bowls/notifications${qs}`, { headers: { Authorization: `Bearer ${token}` } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? 'Could not load your settings')
  return json as BowlNotifications
}

export async function setEmailReminders(token: string, on: boolean): Promise<BowlNotifications> {
  return post(token, { emailReminders: on })
}

/**
 * Turn one kind of bowl push on or off for this device. Turning one on may
 * show the browser's permission prompt, so call it straight from the click.
 */
export async function setBowlPush(token: string, kind: keyof BowlDevice, on: boolean): Promise<{ state: PushState; prefs: BowlNotifications | null }> {
  const flag = kind === 'talk' ? 'talkEnabled' : 'remindersEnabled'
  if (!on) {
    const sub = await existing()
    if (!sub) return { state: getPushState(), prefs: null }
    return { state: getPushState(), prefs: await post(token, { endpoint: sub.endpoint, keys: sub.toJSON().keys, [flag]: false }) }
  }
  const { state, sub } = await subscribe()
  if (!sub) return { state, prefs: null }
  remember(sub.endpoint)
  return { state, prefs: await post(token, { endpoint: sub.endpoint, keys: sub.toJSON().keys, [flag]: true }) }
}

/**
 * On load: keep this device's bowl row pointed at the browser's current
 * registration (they rotate now and then). Only touches a device that already
 * has bowl notifications — it never signs one up.
 */
export async function refreshBowlDevice(token: string): Promise<void> {
  const sub = await existing()
  if (!sub) return
  const previous = remembered()
  await post(token, { endpoint: sub.endpoint, keys: sub.toJSON().keys, refreshOnly: true, previous: previous && previous !== sub.endpoint ? previous : undefined })
  remember(sub.endpoint)
}
