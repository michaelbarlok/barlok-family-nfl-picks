import { useEffect, useMemo, useState } from 'react'
import { parseUTC } from '@/lib/lockTime'
import { liveKey, type LiveGame, type LiveScoreboard } from '@/lib/liveScores'

/*
 * Live scores for a week's games, keyed by our game id.
 *
 * Polls /api/live-scores every 30 seconds, but only while a game could be on —
 * from shortly before a kickoff until it has a recorded result (or eight
 * hours have passed) — and only while the page is on screen. A Tuesday visit
 * makes no requests at all.
 */

const POLL_MS = 30_000
const BEFORE_MS = 10 * 60_000        // start a little before kickoff
const WINDOW_MS = 8 * 60 * 60_000    // a game is never live longer than this

interface GameLike {
  id: string
  away_team: string
  home_team: string
  kickoff_time: string
  winning_team?: string | null
}

export interface LiveScores {
  /** Live state per game id; empty when nothing is on. */
  byGameId: Map<string, LiveGame>
  /** When the feed was last read, or null if it hasn't been. */
  updatedAt: Date | null
  /** Any game in progress right now. */
  anyLive: boolean
}

function inWindow(games: GameLike[], now: number): boolean {
  return games.some(g => {
    if (g.winning_team) return false
    const k = parseUTC(g.kickoff_time).getTime()
    return now >= k - BEFORE_MS && now <= k + WINDOW_MS
  })
}

export function useLiveScores(season: number, week: number | null, games: GameLike[]): LiveScores {
  const [board, setBoard] = useState<LiveScoreboard | null>(null)
  // Re-evaluated every minute so polling starts on its own at kickoff.
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const active = week !== null && games.length > 0 && inWindow(games, tick)

  useEffect(() => {
    if (!active || week === null) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let controller: AbortController | null = null

    const poll = async () => {
      if (document.visibilityState === 'visible') {
        controller = new AbortController()
        try {
          const res = await fetch(`/api/live-scores?week=${week}&season=${season}`, { signal: controller.signal })
          if (res.ok && !cancelled) setBoard(await res.json())
        } catch { /* offline or aborted — keep the last board */ }
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
      controller?.abort()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active, season, week])

  return useMemo(() => {
    const byGameId = new Map<string, LiveGame>()
    if (board && board.week === week && board.season === season) {
      const byKey = new Map(board.games.map(g => [liveKey(g.away, g.home), g]))
      for (const g of games) {
        const live = byKey.get(liveKey(g.away_team, g.home_team))
        if (live) byGameId.set(g.id, live)
      }
    }
    return {
      byGameId,
      updatedAt: board ? new Date(board.fetchedAt) : null,
      anyLive: [...byGameId.values()].some(g => g.state === 'in'),
    }
  }, [board, games, week, season])
}
