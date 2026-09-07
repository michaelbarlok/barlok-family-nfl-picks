import webpush from 'web-push'

/**
 * Web Push delivery.
 *
 * Needs three environment variables:
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY  — also read by the browser when subscribing
 *   VAPID_PRIVATE_KEY             — server only
 *   VAPID_SUBJECT                 — a mailto: or https: URL identifying the sender
 *
 * Generate a pair once with:  npx web-push generate-vapid-keys
 * Changing them invalidates every existing subscription, so everyone would have
 * to turn notifications on again.
 *
 * Nothing here throws if push isn't configured — callers check pushConfigured()
 * and simply skip, so the app works fine without keys.
 */

export function pushConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
}

let configured = false
function configure() {
  if (configured) return
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:barlokmichael@gmail.com',
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  )
  configured = true
}

export interface StoredSubscription {
  endpoint: string
  p256dh: string
  auth: string
}

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

export interface SendResult {
  sent: number
  failed: number
  /** Endpoints the push service says are gone — safe to delete. */
  expired: string[]
}

/**
 * Send one payload to many subscriptions.
 *
 * 404 and 410 mean the subscription is dead — app uninstalled, permission
 * revoked, endpoint rotated. Those are returned so the caller can delete them;
 * anything else counts as transient and the row is left alone.
 */
export async function sendPush(
  subscriptions: StoredSubscription[],
  payload: PushPayload,
): Promise<SendResult> {
  if (!pushConfigured()) return { sent: 0, failed: 0, expired: [] }
  configure()

  const body = JSON.stringify(payload)
  const expired: string[] = []
  let sent = 0
  let failed = 0

  await Promise.all(subscriptions.map(async sub => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        { TTL: 86400 },
      )
      sent++
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) expired.push(sub.endpoint)
      else { failed++; console.error('Push send failed:', status, (err as Error).message) }
    }
  }))

  return { sent, failed, expired }
}
