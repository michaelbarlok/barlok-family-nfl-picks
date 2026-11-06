import type { NextApiRequest, NextApiResponse } from 'next'
import { isValidEmail, isValidOrigin } from '@/lib/validation'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { BOWL_NAME } from '@/lib/bowls/constants'
import { bowlPasswordLink, emailButton, originOf, sendBowlEmail } from '@/lib/bowls/server'

/**
 * "Forgot password?" on the Bowl Pick'em sign-in screen.
 *
 * Same care as the NFL's: the response never says whether an address is in
 * the pick'em, and repeat requests for one address are throttled. Only bowl
 * players get an email, and it's a Bowl Pick'em email linking back to the bowl
 * app. (The password is their one login, so it's the same one the NFL side
 * uses if they're there too.)
 */

const THROTTLE_WINDOW_MS = 60_000
const lastRequestByEmail = new Map<string, number>()

function recentlyRequested(email: string): boolean {
  const now = Date.now()
  for (const [key, at] of lastRequestByEmail) if (now - at > THROTTLE_WINDOW_MS) lastRequestByEmail.delete(key)
  const last = lastRequestByEmail.get(email)
  if (last && now - last < THROTTLE_WINDOW_MS) return true
  lastRequestByEmail.set(email, now)
  return false
}

const NEUTRAL_RESPONSE = {
  message: 'If that email is in the Bowl Pick\'em, a reset link is on its way. Check your inbox and spam folder.',
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!isValidOrigin(req)) return res.status(403).json({ error: 'Invalid origin' })

  const { email } = req.body ?? {}
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address' })
  const cleanEmail = email.trim().toLowerCase()
  if (recentlyRequested(cleanEmail)) return res.status(200).json(NEUTRAL_RESPONSE)

  try {
    const { data: player } = await getAdminClient()
      .from('bowl_players').select('id').eq('email', cleanEmail).maybeSingle()
    if (player) {
      const link = await bowlPasswordLink(originOf(req), cleanEmail, false)
      await sendBowlEmail(cleanEmail, `Reset your ${BOWL_NAME} password`, `
        <h1 style="font-size: 20px; margin: 0 0 16px;">Reset your password</h1>
        <p style="font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
          Someone asked to reset the password for this address. Click below to choose a new one.
        </p>
        ${emailButton(link, 'Choose a new password')}
        <p style="font-size: 12px; color: #8a93a0; margin: 0;">
          This link expires in 24 hours and can only be used once. If you didn't ask for this, you can ignore this email — your password won't change.
        </p>`)
    }
  } catch (err) {
    console.error('bowls/request-password-reset error:', err)
  }
  return res.status(200).json(NEUTRAL_RESPONSE)
}
