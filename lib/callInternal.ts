import type { NextApiRequest } from 'next'

/**
 * Make an internal API call from a cron handler, forwarding the authorization
 * header (the CRON_SECRET, which the target route accepts).
 *
 * Where it sends the request matters. Vercel calls crons on the deployment's
 * own generated address (barlok-family-nfl-picks-<hash>-….vercel.app), and
 * deployment protection puts those addresses behind a Vercel login — so a
 * call built from the incoming host got the login page, and the email it
 * was meant to send never went out. It now goes to the project's production
 * domain, which is the public site, and also carries Vercel's automation
 * bypass token when the project has one, so it gets through either way.
 * Locally there's neither, and the incoming host is used as before.
 */
export async function callInternal(
  req: NextApiRequest,
  path: string
): Promise<{ status: number; body: any }> {
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL
  const baseUrl = production
    ? `https://${production}`
    : `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000'}`

  const headers: Record<string, string> = {
    Authorization: req.headers.authorization ?? '',
    'Content-Type': 'application/json',
  }
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  }

  const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) console.error(`callInternal ${path} → ${res.status}`, typeof body === 'object' ? JSON.stringify(body).slice(0, 300) : '')
  return { status: res.status, body }
}
