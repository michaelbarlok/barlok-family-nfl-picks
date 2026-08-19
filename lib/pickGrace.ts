import { parseUTC } from '@/lib/lockTime'

/** How long a player gets to finish picks once an admin reopens them. */
export const GRACE_PERIOD_MINUTES = 20

export interface PickGraceRow {
  user_id: string
  week: number
  season: number
  expires_at: string
}

// Minimal shape so this works with both the browser and service-role clients.
interface SupabaseQueryClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any
}

/**
 * When does this grant run out? Null if there is no grant or it has passed.
 *
 * expires_at is an absolute instant, so an expired row simply stops counting —
 * nothing has to clean it up, and the row stays as a record of who was given
 * extra time and when.
 */
export function graceExpiry(
  row: { expires_at: string } | null | undefined,
  now: Date = new Date(),
): Date | null {
  if (!row?.expires_at) return null
  const expires = parseUTC(row.expires_at)
  return now < expires ? expires : null
}

/**
 * Look up a player's active grace window for one week.
 * Returns the expiry instant, or null if they are locked like everyone else.
 */
export async function getActiveGrace(
  supabase: SupabaseQueryClient,
  userId: string,
  week: number,
  season: number,
): Promise<Date | null> {
  const { data } = await supabase
    .from('pick_grace')
    .select('expires_at')
    .eq('user_id', userId)
    .eq('week', week)
    .eq('season', season)
    .maybeSingle()

  return graceExpiry(data as { expires_at: string } | null)
}

/** Countdown label for a grace window, e.g. "18:42". */
export function formatGraceRemaining(expiresAt: Date, now: Date = new Date()): string {
  const ms = Math.max(0, expiresAt.getTime() - now.getTime())
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
