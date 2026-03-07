import type { NextApiRequest } from 'next'

/**
 * Shared validation utilities for API routes and client-side code.
 */

/**
 * CSRF protection: validates that mutation requests come from the same origin.
 * Checks Origin and Referer headers against the app's host.
 * Skips check for cron/service requests that use CRON_SECRET.
 * Returns true if the request is safe, false if it should be rejected.
 */
export function isValidOrigin(req: NextApiRequest): boolean {
  // Allow GET/HEAD/OPTIONS — they should be safe/idempotent
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? '')) return true

  // Allow cron/service requests authenticated via CRON_SECRET
  const authHeader = req.headers.authorization ?? ''
  if (process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`) return true

  // Check Origin header first (most reliable)
  const origin = req.headers.origin
  const host = req.headers.host || req.headers['x-forwarded-host']

  if (origin && host) {
    try {
      const originHost = new URL(origin as string).host
      if (originHost === host) return true
    } catch {
      // Invalid origin URL — reject
      return false
    }
    // Origin doesn't match host — reject
    return false
  }

  // Fall back to Referer if Origin is missing (some browsers omit Origin)
  const referer = req.headers.referer
  if (referer && host) {
    try {
      const refererHost = new URL(referer as string).host
      if (refererHost === host) return true
    } catch {
      return false
    }
    return false
  }

  // No Origin or Referer — likely a server-to-server call (internal fetch, Postman, etc.)
  // Allow if there's a valid Bearer token (API clients don't send Origin)
  if (authHeader.startsWith('Bearer ') && authHeader.length > 7) return true

  return false
}

/**
 * Validates an email address format using a robust regex.
 * Covers standard email patterns per RFC 5322 (simplified).
 */
export function isValidEmail(email: unknown): email is string {
  if (typeof email !== 'string') return false
  // Standard email regex — handles most real-world addresses
  return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(email)
}

/**
 * Validates that three-best picks contain exactly 3 distinct team abbreviations.
 * Returns an error message string if invalid, or null if valid.
 */
export function validateThreeBest(threeBest: { pick_1?: string; pick_2?: string; pick_3?: string }): string | null {
  const picks = [threeBest.pick_1, threeBest.pick_2, threeBest.pick_3].filter(Boolean)
  if (picks.length > 0 && picks.length !== 3) {
    return 'Exactly 3 best picks are required'
  }
  const unique = new Set(picks)
  if (unique.size !== picks.length) {
    return 'Best picks must be 3 different teams'
  }
  return null
}
