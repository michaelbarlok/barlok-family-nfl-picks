import type { NextApiRequest, NextApiResponse } from 'next'
import { isValidEmail, isValidOrigin } from '@/lib/validation'
import { sendPasswordResetEmail } from '@/lib/passwordReset'

/**
 * Password reset requested from the sign-in screen.
 *
 * This is the one reset entry point with no logged-in user behind it, which
 * changes two things:
 *
 *   - The response never reveals whether the address is on the roster. Saying
 *     "no such account" would turn this into a membership oracle for the whole
 *     league, so every outcome returns the same message.
 *   - Requests are throttled per address, since anyone who can reach the page
 *     could otherwise flood a member's inbox or burn the Gmail send quota.
 */

const THROTTLE_WINDOW_MS = 60_000
const lastRequestByEmail = new Map<string, number>()

/**
 * Best-effort only: serverless instances are ephemeral and run in parallel, so
 * this catches repeated presses rather than a determined attacker. It is paired
 * with the same-origin check, which keeps casual off-site abuse out.
 */
function recentlyRequested(email: string): boolean {
  const now = Date.now()

  for (const [key, at] of lastRequestByEmail) {
    if (now - at > THROTTLE_WINDOW_MS) lastRequestByEmail.delete(key)
  }

  const last = lastRequestByEmail.get(email)
  if (last && now - last < THROTTLE_WINDOW_MS) return true

  lastRequestByEmail.set(email, now)
  return false
}

// Identical for every outcome — see the enumeration note above.
const NEUTRAL_RESPONSE = {
  message: "If that email is registered, a reset link is on its way. Check your inbox and spam folder.",
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!isValidOrigin(req)) return res.status(403).json({ error: 'Invalid origin' })

  const { email } = req.body ?? {}

  // A malformed address is the one thing worth saying plainly — it's about what
  // they typed, not about who exists.
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Enter a valid email address' })
  }

  const cleanEmail = email.trim().toLowerCase()

  if (recentlyRequested(cleanEmail)) {
    return res.status(200).json(NEUTRAL_RESPONSE)
  }

  try {
    await sendPasswordResetEmail(getOrigin(req), cleanEmail)
  } catch (err) {
    // Unknown address, unconfirmed address, mail failure — all look the same
    // from outside. Logged so the cause is still recoverable from the server.
    console.error('request-password-reset error:', err)
  }

  return res.status(200).json(NEUTRAL_RESPONSE)
}

function getOrigin(req: NextApiRequest): string {
  const protocol = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers['x-forwarded-host'] || req.headers.host
  return `${protocol}://${host}`
}
