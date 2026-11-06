/*
 * Dates and times on the bowl pages. Like the NFL side, times show in the
 * viewer's own time zone with its abbreviation. A game ESPN hasn't given a
 * time yet shows its date in Eastern time (ESPN stores those as midnight
 * Eastern, which would be the day before out west).
 */

export function kickoffText(iso: string | null, timeTbd = false): string {
  if (!iso) return 'Date TBD'
  const d = new Date(iso)
  if (timeTbd) {
    return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' })} · Time TBD`
  }
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
  return `${day} · ${time}`
}

/** "Sat, Dec 12 at 12:00 PM EST" */
export function lockText(iso: string): string {
  const d = new Date(iso)
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
  return `${day} at ${time}`
}

/** "5d 3h", "3h 12m", "12m" — or null once it's passed. */
export function countdown(iso: string, now = Date.now()): string | null {
  const ms = Date.parse(iso) - now
  if (ms <= 0) return null
  const m = Math.floor(ms / 60000)
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${mm}m`
  return `${Math.max(1, mm)}m`
}

export function pointsText(points: number): string {
  return `${points} ${points === 1 ? 'point' : 'points'} per win`
}
