import type { NextApiRequest, NextApiResponse } from 'next'
import { parseGiphy } from '@/lib/gifs'

/*
 * GIFs for the 💩 Talk picker, from GIPHY.
 *
 *   GET ?status=1        → { configured } — whether to show the GIF button
 *   GET ?q=…&offset=…    → search; no q is trending
 *
 * Proxied rather than called from the browser so the key stays on the server,
 * and so Vercel's edge can cache the answers: trending for 30 minutes, a search
 * for a day. GIPHY's starter keys allow 100 calls an hour, and the whole family
 * searching "touchdown" should cost one of them.
 *
 * Results are trimmed to what the picker needs (lib/gifs.ts), so moving to
 * another provider — Tenor's API closed in 2026 — means changing this file.
 *
 * With GIPHY_API_KEY unset the button stays hidden and nothing breaks.
 */

const PAGE = 24
// Family league: nothing past PG-13.
const RATING = 'pg-13'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const key = process.env.GIPHY_API_KEY

  if (req.query.status) {
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
    return res.status(200).json({ configured: !!key })
  }
  if (!key) return res.status(503).json({ configured: false, error: 'GIFs aren’t set up yet' })

  const q = String(req.query.q ?? '').trim().slice(0, 50)
  const offset = Math.min(Math.max(0, parseInt(String(req.query.offset ?? '0'), 10) || 0), 4975)
  const params = new URLSearchParams({ api_key: key, limit: String(PAGE), offset: String(offset), rating: RATING })
  if (q) { params.set('q', q); params.set('lang', 'en') }

  try {
    const r = await fetch(`https://api.giphy.com/v1/gifs/${q ? 'search' : 'trending'}?${params}`)
    if (!r.ok) {
      console.error('gifs: GIPHY returned', r.status)
      return res.status(502).json({
        error: r.status === 429 ? 'Too many GIF searches this hour — try again in a bit' : 'GIF search isn’t working right now',
      })
    }
    const json = await r.json()
    const gifs = parseGiphy(json)
    const total = Number(json?.pagination?.total_count) || 0
    res.setHeader('Cache-Control', q
      ? 'public, s-maxage=86400, stale-while-revalidate=86400'
      : 'public, s-maxage=1800, stale-while-revalidate=3600')
    return res.status(200).json({ configured: true, gifs, next: gifs.length > 0 && offset + PAGE < total ? offset + PAGE : null })
  } catch (err) {
    console.error('gifs error:', err)
    return res.status(502).json({ error: 'GIF search isn’t working right now' })
  }
}
