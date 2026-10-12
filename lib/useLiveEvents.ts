import { useEffect, useRef, useState } from 'react'
import type { LiveGame } from '@/lib/liveScores'

/*
 * Big plays, noticed as the live feed updates: touchdowns, field goals,
 * safeties and turnovers. Each lasts a few seconds so a card can flash it.
 *
 * Scores are read from the score change between two updates rather than from
 * the last play: updates are 30 seconds apart, and by the next one the last
 * play is often the extra point or the kickoff, not the touchdown itself. The
 * change in score is still there. Turnovers don't move the score, so those
 * come from the last play's type — which means one can be missed if another
 * play has already happened by the next update.
 *
 * Nothing fires on the first update after opening a page: there's nothing to
 * compare it to, and announcing every score so far as if it just happened
 * would be noise.
 */

export type PlayKind = 'touchdown' | 'field_goal' | 'safety' | 'turnover'

export interface PlayEvent {
  kind: PlayKind
  /** The team that scored, or that took the ball away. */
  team: string
  /** ESPN's play type, when it adds something ("Interception Return"). */
  detail: string | null
  /** Unique per event, so a repeat of the same kind still re-animates. */
  key: string
}

const SHOW_MS = 7_000
const TURNOVER = /intercept|fumble recovery \(opponent\)|fumble return|blocked .*(punt|field goal)|muffed/i

/** What a jump in one team's score most likely was. */
function scoringKind(delta: number, playType: string | null): PlayKind | null {
  if (delta >= 6) return 'touchdown'          // 6, or 7/8 with the try already in
  if (delta >= 3) return 'field_goal'         // 3 (4–5 only if two things happened)
  if (delta === 2) return playType && /two-point|2pt|conversion/i.test(playType) ? null : 'safety'
  return null                                 // 1: the extra point after a TD we already flashed
}

export function useLiveEvents(byGameId: Map<string, LiveGame>): Map<string, PlayEvent> {
  const prev = useRef(new Map<string, LiveGame>())
  const [events, setEvents] = useState<Map<string, PlayEvent>>(new Map())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const found = new Map<string, PlayEvent>()
    byGameId.forEach((g, id) => {
      const p = prev.current.get(id)
      prev.current.set(id, g)
      if (!p || g.state === 'pre' || p.state === 'pre') return

      const stamp = `${id}-${g.lastPlayId ?? ''}-${g.awayScore}-${g.homeScore}`
      const dAway = (g.awayScore ?? 0) - (p.awayScore ?? 0)
      const dHome = (g.homeScore ?? 0) - (p.homeScore ?? 0)
      const scorer = dAway > dHome ? { team: g.away, delta: dAway } : { team: g.home, delta: dHome }
      const kind = scorer.delta > 0 ? scoringKind(scorer.delta, g.lastPlayType) : null
      if (kind) {
        found.set(id, {
          kind,
          team: scorer.team,
          // A pick-six or fumble return is still a touchdown first; say how.
          detail: kind === 'touchdown' && g.lastPlayType && TURNOVER.test(g.lastPlayType) ? g.lastPlayType : null,
          key: stamp,
        })
        return
      }
      const newPlay = !!g.lastPlayId && g.lastPlayId !== p.lastPlayId
      if (newPlay && g.lastPlayType && TURNOVER.test(g.lastPlayType) && g.possession) {
        found.set(id, { kind: 'turnover', team: g.possession, detail: g.lastPlayType, key: stamp })
      }
    })
    if (found.size === 0) return

    setEvents(cur => {
      const next = new Map(cur)
      found.forEach((e, id) => next.set(id, e))
      return next
    })
    found.forEach((e, id) => {
      const t = timers.current.get(id)
      if (t) clearTimeout(t)
      timers.current.set(id, setTimeout(() => {
        setEvents(cur => {
          if (cur.get(id)?.key !== e.key) return cur
          const next = new Map(cur)
          next.delete(id)
          return next
        })
        timers.current.delete(id)
      }, SHOW_MS))
    })
  }, [byGameId])

  useEffect(() => {
    const t = timers.current
    return () => t.forEach(clearTimeout)
  }, [])

  return events
}
