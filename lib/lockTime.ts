import { CURRENT_SEASON } from '@/lib/constants'

// Use a minimal interface for the Supabase client to avoid generic type mismatches
interface SupabaseQueryClient {
  from(table: string): any
}

/**
 * Parse a Supabase timestamp as UTC.
 * Handles both ISO 8601 and Supabase's space-separated format.
 */
export function parseUTC(iso: string): Date {
  const normalized = iso.replace(' ', 'T')
  const timepart = normalized.split('T')[1] || ''
  const hasOffset = timepart.includes('Z') || timepart.includes('+') || timepart.includes('-')
  return new Date(hasOffset ? normalized : normalized + 'Z')
}

/**
 * Format a kickoff time for on-screen display.
 *
 * No `timeZone` is passed, deliberately: the browser formats in whatever zone
 * the device is currently set to. Open the app in New York and kickoffs read
 * ET; open it that evening in California and the same kickoffs read PT. There
 * is nothing to configure and nothing to keep in sync — the device is already
 * the source of truth. `timeZoneName` prints the abbreviation so it is always
 * clear which zone you are looking at.
 *
 * Server-side callers must NOT use this. There is no device on the server, so
 * Node would format in the server's own zone (UTC on Vercel) and quietly show
 * everyone the wrong time. Emails and the Excel export state Eastern
 * explicitly, as the league's shared reference.
 */
export function formatKickoff(iso: string): string {
  const d = parseUTC(iso)
  return d.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  })
}

/**
 * Longer form used by the deadline banners. Same device-zone rule as
 * formatKickoff — browser only.
 */
export function formatLockTime(date: Date): string {
  return date.toLocaleString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  })
}

/**
 * Compute the lock time for a set of games.
 * Lock time = earliest kickoff of the week.
 */
export function computeLockTime(games: { kickoff_time: string }[]): Date | null {
  if (games.length === 0) return null
  const kickoffs = games.map(g => parseUTC(g.kickoff_time))
  return new Date(Math.min(...kickoffs.map(d => d.getTime())))
}

/**
 * Get the lock time for a specific week from the database.
 * Returns null if no games found.
 */
export async function getWeekLockTime(
  supabase: SupabaseQueryClient,
  week: number,
  season: number = CURRENT_SEASON,
): Promise<Date | null> {
  const { data } = await supabase
    .from('games')
    .select('kickoff_time')
    .eq('week', week)
    .eq('season', season)
    .order('kickoff_time', { ascending: true })
    .limit(1)

  if (!data || data.length === 0) return null
  return parseUTC((data[0] as any).kickoff_time)
}

/**
 * Detect the upcoming week: the next week whose lock time hasn't passed yet.
 */
export async function detectUpcomingWeek(
  supabase: SupabaseQueryClient,
  season: number = CURRENT_SEASON,
): Promise<{ week: number; lockTime: Date; games: any[] } | null> {
  const { data: allGames } = await supabase
    .from('games')
    .select('id, week, kickoff_time')
    .eq('season', season)
    .order('week')

  if (!allGames || allGames.length === 0) return null

  const weekSet = new Set<number>(allGames.map((g: any) => g.week))
  const weeks = [...weekSet].sort((a, b) => a - b)
  const now = new Date()

  for (const week of weeks) {
    const weekGames = allGames.filter((g: any) => g.week === week)
    const lockTime = computeLockTime(weekGames)
    if (lockTime && now < lockTime) {
      return { week, lockTime, games: weekGames }
    }
  }

  return null
}

/**
 * Get the current time components in Eastern Time.
 * Handles EDT/EST automatically via the IANA timezone database.
 *
 * Intentionally fixed to Eastern and NOT device-local: this is scheduling
 * logic, not display. Cron handlers use it to check "is it 1am ET?" so a job
 * fires once at a known hour regardless of where anyone happens to be.
 */
export function getCurrentET(): { hour: number; dayOfWeek: number } {
  const now = new Date()
  const etString = now.toLocaleString('en-US', { timeZone: 'America/New_York' })
  const etDate = new Date(etString)
  return {
    hour: etDate.getHours(),
    dayOfWeek: etDate.getDay(), // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  }
}
