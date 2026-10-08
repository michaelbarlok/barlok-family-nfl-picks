import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { computeLockTime } from '@/lib/lockTime'

/*
 * Whether the newest loaded week's picks have locked.
 *
 * "Newest loaded week" is the same rule My Picks and Home use for the current
 * week, so this flips back to false on its own when an admin loads the next
 * week's games — no separate "advance" step to keep in sync.
 *
 * Nav mounts fresh on every page, so the lock time is cached per season at
 * module level: moving between pages reads it synchronously instead of
 * refetching and flashing the wrong tab for a moment.
 */

const TTL_MS = 5 * 60_000
const cache = new Map<number, { lockTime: Date | null; fetchedAt: number }>()
const inflight = new Map<number, Promise<Date | null>>()

async function fetchLockTime(season: number): Promise<Date | null> {
  const { data } = await supabase
    .from('games').select('week, kickoff_time')
    .eq('season', season)
  if (!data || data.length === 0) return null
  const week = Math.max(...data.map(g => g.week))
  return computeLockTime(data.filter(g => g.week === week))
}

function loadLockTime(season: number, force = false): Promise<Date | null> {
  const hit = cache.get(season)
  if (!force && hit && Date.now() - hit.fetchedAt < TTL_MS) return Promise.resolve(hit.lockTime)
  const pending = inflight.get(season)
  if (pending) return pending
  const p = fetchLockTime(season)
    .then(lockTime => {
      cache.set(season, { lockTime, fetchedAt: Date.now() })
      return lockTime
    })
    .finally(() => inflight.delete(season))
  inflight.set(season, p)
  return p
}

const isPast = (lockTime: Date | null) => !!lockTime && Date.now() >= lockTime.getTime()

// Mounted hooks, so a refresh can reach a Nav that's already on screen.
const listeners = new Set<(season: number, lockTime: Date | null) => void>()

/**
 * Re-read the current week after games change — the admin calls this after
 * loading a new week, so their own nav swaps back to Standings straight away
 * rather than on the next five-minute refresh.
 */
export function refreshCurrentWeekLock(season: number): void {
  loadLockTime(season, true)
    .then(lockTime => listeners.forEach(fn => fn(season, lockTime)))
    .catch(() => {})
}

/** null until known (first visit only — later pages read the cache). */
export function useCurrentWeekLocked(season: number, enabled = true): boolean | null {
  const [locked, setLocked] = useState<boolean | null>(() => {
    const hit = cache.get(season)
    return hit ? isPast(hit.lockTime) : null
  })

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const apply = (lockTime: Date | null) => {
      if (cancelled) return
      setLocked(isPast(lockTime))
      // Flip at the moment of lock, for anyone sitting on a page when it hits.
      if (timer) { clearTimeout(timer); timer = null }
      if (lockTime && !isPast(lockTime)) {
        const ms = lockTime.getTime() - Date.now()
        if (ms < 2 ** 31 - 1) timer = setTimeout(() => setLocked(true), ms + 500)
      }
    }

    loadLockTime(season).then(apply).catch(() => {})
    const onRefresh = (s: number, lockTime: Date | null) => { if (s === season) apply(lockTime) }
    listeners.add(onRefresh)

    // The installed app resumes rather than reloads, so a week loaded while it
    // was in the background is picked up when it comes back.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const hit = cache.get(season)
      const stale = !hit || Date.now() - hit.fetchedAt >= TTL_MS
      loadLockTime(season, stale).then(apply).catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      listeners.delete(onRefresh)
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [season, enabled])

  return locked
}
