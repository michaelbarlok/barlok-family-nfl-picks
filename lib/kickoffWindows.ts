import { parseUTC } from '@/lib/lockTime'

/**
 * The NFL week's kickoff windows — Thursday Night, Sunday Early, Sunday Late,
 * Sunday Night, Monday Night, and whatever else the schedule has (Saturday,
 * a Christmas Wednesday, a morning game abroad) — in Eastern time, which is
 * how the league schedules them.
 *
 * For display only: the order of games and everything about picks stay as
 * they are.
 */

export interface KickoffWindow<T> { key: string; label: string; short: string; games: T[] }

export function kickoffWindowOf(iso: string): { key: string; label: string; short: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'long', hour: 'numeric', hourCycle: 'h23',
  }).formatToParts(parseUTC(iso))
  const day = parts.find(p => p.type === 'weekday')?.value ?? ''
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? 0) % 24
  if (day === 'Sunday') {
    if (hour < 12) return { key: 'sun-morning', label: 'Sunday Morning', short: 'Sun AM' }
    if (hour < 16) return { key: 'sun-early', label: 'Sunday Early', short: 'Sun Early' }
    if (hour < 19) return { key: 'sun-late', label: 'Sunday Late', short: 'Sun Late' }
    return { key: 'sun-night', label: 'Sunday Night', short: 'SNF' }
  }
  const night = hour >= 19
  if (day === 'Thursday' && night) return { key: 'thu-night', label: 'Thursday Night', short: 'TNF' }
  if (day === 'Monday' && night) return { key: 'mon-night', label: 'Monday Night', short: 'MNF' }
  const short = day.slice(0, 3)
  return night
    ? { key: `${short.toLowerCase()}-night`, label: `${day} Night`, short: `${short} Night` }
    : { key: short.toLowerCase(), label: day, short }
}

/** Games grouped into their kickoff windows, keeping the order they came in. */
export function groupByKickoffWindow<T extends { kickoff_time: string }>(games: T[]): KickoffWindow<T>[] {
  const out: KickoffWindow<T>[] = []
  const byKey = new Map<string, KickoffWindow<T>>()
  for (const g of games) {
    const w = kickoffWindowOf(g.kickoff_time)
    let group = byKey.get(w.key)
    if (!group) { group = { ...w, games: [] }; byKey.set(w.key, group); out.push(group) }
    group.games.push(g)
  }
  return out
}
