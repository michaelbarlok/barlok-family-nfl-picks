import { pushConfigured, sendPush, type PushPayload } from '@/lib/push'

/*
 * Bowl Pick'em push notifications — to devices registered in the bowl's own
 * table, for the kind each device has turned on. The sending itself is the
 * site's shared Web Push (same keys; one registration per phone).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export type PushKind = 'talk' | 'reminders'

export const TALK_MIGRATION_HINT =
  "Bowl Talk and reminders aren't set up yet. Run supabase/migrations/22_bowl_talk_reminders.sql in the Supabase SQL editor."

export function isMissingTalkTables(err: { message?: string } | null | undefined): boolean {
  return !!err?.message && /bowl_(talk_\w+|push_subscriptions|reminder_log)|email_reminders/.test(err.message)
    && /does not exist|schema cache|relation|column/i.test(err.message)
}

interface DeviceRow { endpoint: string; p256dh: string; auth: string; player_id: string }

/** The devices that want this kind of notification, optionally for some players only. */
export async function devicesFor(supabase: Db, kind: PushKind, playerIds?: string[]): Promise<DeviceRow[]> {
  if (!pushConfigured()) return []
  if (playerIds && !playerIds.length) return []
  let q = supabase.from('bowl_push_subscriptions').select('endpoint, p256dh, auth, player_id')
    .eq(kind === 'talk' ? 'talk_enabled' : 'reminders_enabled', true)
  if (playerIds) q = q.in('player_id', playerIds)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as DeviceRow[]
}

/** Send to these devices; forget any the push service says are gone. */
export async function pushTo(supabase: Db, devices: DeviceRow[], payload: PushPayload): Promise<number> {
  if (!devices.length) return 0
  const r = await sendPush(devices, payload)
  if (r.expired.length) await supabase.from('bowl_push_subscriptions').delete().in('endpoint', r.expired)
  return r.sent
}
