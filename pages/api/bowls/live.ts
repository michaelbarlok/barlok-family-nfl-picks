import type { NextApiRequest, NextApiResponse } from 'next'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { loadSeason } from '@/lib/bowls/season'
import { onSheet } from '@/lib/bowls/sheet'
import { easternDate, espnFetch, fetchDateEvents, fetchSeasonEvents, type Fetcher } from '@/lib/bowls/espn'
import { inLiveWindow, parseLiveEvent, type BowlLive, type BowlLiveBoard } from '@/lib/bowls/live'

/**
 * GET /api/bowls/live — the bowl games on right now (or about to be), live
 * from ESPN: score, clock, possession, field position, last play.
 *
 * Display only, like the NFL's /api/live-scores: nothing is written, and
 * results still come from the results job. Nothing private either — game ids
 * and the same numbers every sports site shows — so it needs no sign-in and
 * Vercel's edge cache can answer most polls. A short in-memory cache covers a
 * warm function that gets several misses at once, so ESPN sees a handful of
 * requests a minute however many people are watching.
 *
 * When no game is on it answers from the database alone and asks ESPN nothing.
 */

const FRESH_MS = 15_000
let memo: { at: number; body: BowlLiveBoard } | null = null
const fetcher: Fetcher = espnFetch

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  if (memo && Date.now() - memo.at < FRESH_MS) {
    res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=30')
    return res.status(200).json(memo.body)
  }

  try {
    const loaded = await loadSeason(getAdminClient())
    const now = Date.now()
    const on = (loaded?.games ?? []).filter(g => onSheet(g) && inLiveWindow(g, now))
    if (!loaded || !on.length) {
      const body: BowlLiveBoard = { games: {}, fetchedAt: new Date().toISOString() }
      memo = { at: now, body }
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=60')
      return res.status(200).json(body)
    }

    // The bowl season in one request; a game ESPN files elsewhere (Army–Navy)
    // is looked up on its own day.
    const byEspn = new Map<string, BowlLive>()
    for (const e of await fetchSeasonEvents(loaded.state.season, fetcher)) {
      const l = parseLiveEvent(e)
      if (l) byEspn.set(l.espnId, l)
    }
    const missing = on.filter(g => !byEspn.has(g.espn_id))
    for (const date of Array.from(new Set(missing.map(g => easternDate(g.kickoff_time!))))) {
      for (const e of await fetchDateEvents(date, fetcher)) {
        const l = parseLiveEvent(e)
        if (l && !byEspn.has(l.espnId)) byEspn.set(l.espnId, l)
      }
    }

    const games: Record<string, BowlLive> = {}
    for (const g of on) {
      const l = byEspn.get(g.espn_id)
      if (l) games[g.id] = l
    }
    const body: BowlLiveBoard = { games, fetchedAt: new Date().toISOString() }
    memo = { at: Date.now(), body }
    res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=30')
    return res.status(200).json(body)
  } catch (err) {
    console.error('bowls/live error:', err)
    // A slightly old answer beats none mid-game; the page shows it as such.
    if (memo) return res.status(200).json(memo.body)
    res.setHeader('Cache-Control', 'no-store')
    return res.status(502).json({ error: 'Live scores are unavailable right now' })
  }
}
