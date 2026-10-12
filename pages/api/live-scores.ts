import type { NextApiRequest, NextApiResponse } from 'next'
import { parseScoreboard, type LiveScoreboard } from '@/lib/liveScores'

/**
 * GET /api/live-scores?week=6&season=2026
 *
 * Live scores for one week, straight from ESPN's public scoreboard, trimmed to
 * what the app shows. Read-only and nothing private — the same numbers are on
 * every sports site — so it needs no sign-in, which also lets Vercel's edge
 * cache serve it.
 *
 * Two layers of caching keep ESPN from seeing a request per phone: the edge
 * cache (s-maxage) answers most polls outright, and a short in-memory cache
 * covers a warm function that gets several misses at once. Either way ESPN
 * sees a handful of requests a minute however many people are watching.
 */

const FRESH_MS = 15_000
const memo = new Map<string, { at: number; body: LiveScoreboard }>()

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const week = parseInt(String(req.query.week ?? ''), 10)
  const season = parseInt(String(req.query.season ?? ''), 10)
  if (!(week >= 1 && week <= 22) || !(season >= 2000 && season <= 2100)) {
    return res.status(400).json({ error: 'week and season are required' })
  }

  const key = `${season}-${week}`
  const hit = memo.get(key)
  if (hit && Date.now() - hit.at < FRESH_MS) {
    res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=30')
    return res.status(200).json(hit.body)
  }

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`
    const espn = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!espn.ok) throw new Error(`ESPN ${espn.status}`)
    const body: LiveScoreboard = {
      week,
      season,
      games: parseScoreboard(await espn.json()),
      fetchedAt: new Date().toISOString(),
    }
    memo.set(key, { at: Date.now(), body })
    res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=30')
    return res.status(200).json(body)
  } catch (err) {
    console.error('live-scores error:', err)
    // A stale answer beats none mid-game; the client just shows it as older.
    if (hit) return res.status(200).json(hit.body)
    res.setHeader('Cache-Control', 'no-store')
    return res.status(502).json({ error: 'Live scores are unavailable right now' })
  }
}
