import { useEffect, useMemo, useRef, useState } from 'react'
import { inLiveWindow, type BowlLive, type BowlLiveBoard, type Side } from '@/lib/bowls/live'
import type { BowlGame } from '@/lib/bowls/sheet'

/*
 * Live bowl scores for the games on a page, keyed by our game id.
 *
 * Polls /api/bowls/live every 30 seconds, but only while one of the page's
 * games could be on — from shortly before a kickoff until its result is in —
 * and only while the page is on screen. A day with no games makes no requests.
 *
 * `onRefresh` is called every few minutes while games are on, so a page can
 * reload its own data and pick up results as the results job records them.
 */

const POLL_MS = 30_000
const REFRESH_MS = 3 * 60_000

export interface BowlLiveScores {
  byGameId: Map<string, BowlLive>
  /** Any game in progress right now. */
  anyLive: boolean
  updatedAt: Date | null
}

export function useBowlLive(games: BowlGame[] | undefined, onRefresh?: () => void): BowlLiveScores {
  const [board, setBoard] = useState<BowlLiveBoard | null>(null)
  // Re-checked every minute, so polling starts on its own at kickoff.
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  const active = !!games?.some(g => inLiveWindow(g, tick))
  const refresh = useRef(onRefresh)
  refresh.current = onRefresh

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastRefresh = Date.now()
    const poll = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const res = await fetch('/api/bowls/live')
          if (res.ok && !cancelled) setBoard(await res.json())
        } catch { /* offline — keep the last board */ }
        if (Date.now() - lastRefresh >= REFRESH_MS) { lastRefresh = Date.now(); refresh.current?.() }
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS)
    }
    // Coming back to the app shouldn't wait out the rest of a 30s timer.
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || cancelled) return
      if (timer) clearTimeout(timer)
      poll()
    }
    poll()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active])

  return useMemo(() => {
    const byGameId = new Map(Object.entries(board?.games ?? {}))
    return {
      byGameId,
      anyLive: Array.from(byGameId.values()).some(l => l.state === 'in'),
      updatedAt: board ? new Date(board.fetchedAt) : null,
    }
  }, [board])
}

/* ── big plays ───────────────────────────────────────────────────── */

export type PlayKind = 'touchdown' | 'field_goal' | 'safety' | 'turnover'

export interface PlayEvent {
  kind: PlayKind
  /** ESPN's side that scored, or that took the ball away. */
  side: Side
  detail: string | null
  /** Unique per event, so a repeat still re-animates. */
  key: string
}

const SHOW_MS = 7_000
const TURNOVER = /intercept|fumble recovery \(opponent\)|fumble return|blocked .*(punt|field goal)|muffed/i

function scoringKind(delta: number, playType: string | null): PlayKind | null {
  if (delta >= 6) return 'touchdown'
  if (delta >= 3) return 'field_goal'
  if (delta === 2) return playType && /two-point|2pt|conversion/i.test(playType) ? null : 'safety'
  return null
}

/**
 * Touchdowns, field goals, safeties and turnovers, noticed as the feed updates
 * (as on the NFL side): scores from the change in score between two updates,
 * turnovers from the last play. Each shows for a few seconds. Nothing fires on
 * the first update after opening a page — there's nothing to compare it to.
 */
export function useBowlPlays(byGameId: Map<string, BowlLive>): Map<string, PlayEvent> {
  const prev = useRef(new Map<string, BowlLive>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const [events, setEvents] = useState<Map<string, PlayEvent>>(new Map())

  useEffect(() => {
    const found = new Map<string, PlayEvent>()
    byGameId.forEach((g, id) => {
      const p = prev.current.get(id)
      prev.current.set(id, g)
      if (!p || g.state === 'pre' || p.state === 'pre') return
      const stamp = `${id}-${g.lastPlayId ?? ''}-${g.awayScore}-${g.homeScore}`
      const dAway = (g.awayScore ?? 0) - (p.awayScore ?? 0)
      const dHome = (g.homeScore ?? 0) - (p.homeScore ?? 0)
      const scorer: { side: Side; delta: number } = dAway > dHome ? { side: 'away', delta: dAway } : { side: 'home', delta: dHome }
      const kind = scorer.delta > 0 ? scoringKind(scorer.delta, g.lastPlayType) : null
      if (kind) {
        found.set(id, { kind, side: scorer.side, detail: kind === 'touchdown' && g.lastPlayType && TURNOVER.test(g.lastPlayType) ? g.lastPlayType : null, key: stamp })
        return
      }
      const newPlay = !!g.lastPlayId && g.lastPlayId !== p.lastPlayId
      if (newPlay && g.lastPlayType && TURNOVER.test(g.lastPlayType) && g.possession) {
        found.set(id, { kind: 'turnover', side: g.possession, detail: g.lastPlayType, key: stamp })
      }
    })
    if (!found.size) return
    setEvents(cur => {
      const next = new Map(cur)
      found.forEach((e, id) => next.set(id, e))
      return next
    })
    found.forEach((e, id) => {
      const old = timers.current.get(id)
      if (old) clearTimeout(old)
      timers.current.set(id, setTimeout(() => {
        setEvents(cur => {
          if (cur.get(id)?.key !== e.key) return cur
          const next = new Map(cur)
          next.delete(id)
          return next
        })
      }, SHOW_MS))
    })
  }, [byGameId])

  useEffect(() => () => { timers.current.forEach(t => clearTimeout(t)) }, [])
  return events
}
