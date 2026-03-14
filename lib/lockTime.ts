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
