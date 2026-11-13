import type { NextApiRequest, NextApiResponse } from 'next'
import { isValidEmail, isValidOrigin } from '@/lib/validation'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isMissingBowlTables, originOf } from '@/lib/bowls/server'
import { addOrInvitePlayer } from '@/lib/bowls/invite'
import { bowlSeasonLabel } from '@/lib/bowls/constants'
import { isMissingJoinLinks, joinOpen, seasonForCode } from '@/lib/bowls/joinLink'

/**
 * The page behind a shared join link (/bowls/join?c=…). No sign-in needed.
 *
 *   GET  ?c=code                  → { season, label, open } — or 404 for a wrong or old link
 *   POST { c, name, email }       → in, the same way an invite works:
 *       someone new gets a login and a "set your password" email (so the
 *       address is really theirs before they can sign in); someone with a
 *       login already is added and told to sign in as usual.
 *
 * Open until the season's picks lock. Only ever writes bowl tables: a new
 * login is bowl-only, never an NFL player.
 */
const BAD_LINK = "This join link doesn't work any more. Ask Michael for a new one."
const CLOSED = "This year's picks are already locked, so joining is closed."

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (req.method === 'POST' && !isValidOrigin(req)) return res.status(403).json({ error: 'Invalid origin' })
  const supabase = getAdminClient()
  const code = req.method === 'GET' ? req.query.c : req.body?.c
  try {
    const season = await seasonForCode(supabase, code)
    if (!season) return res.status(404).json({ error: BAD_LINK })
    const info = { season: season.season, label: bowlSeasonLabel(season.season), open: joinOpen(season.status) }
    if (req.method === 'GET') return res.status(200).json(info)

    if (!info.open) return res.status(400).json({ error: CLOSED })
    const { name, email } = req.body ?? {}
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) return res.status(400).json({ error: 'Please enter your name.' })
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' })

    const result = await addOrInvitePlayer({ origin: originOf(req), season: season.season, name: name.trim(), email })
    const address = String(email).trim().toLowerCase()
    return res.status(200).json({
      outcome: result.outcome,
      email: address,
      message: result.outcome === 'added'
        ? "You're in! Sign in with the email and password you already use."
        : `Check your email — we sent a link to ${address} to set your password. Then you're in.`,
    })
  } catch (err) {
    const e = err as Error
    if (isMissingJoinLinks(e) || isMissingBowlTables(e)) return res.status(404).json({ error: BAD_LINK })
    console.error('bowls/join-link error:', err)
    return res.status(500).json({ error: 'Something went wrong. Try again in a minute.' })
  }
}
