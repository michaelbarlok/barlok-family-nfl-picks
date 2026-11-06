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

  // The production address can be a domain that forwards to its www form
  // (barlokfootballpicks.app → www.barlokfootballpicks.app). fetch drops the
  // Authorization header when a redirect changes host, and the target would
  // then turn the call away — so follow that one hop here, headers kept. Only
  // to the same site; anywhere else is left unfollowed.
  let url = `${baseUrl}${path}`
  let res = await fetch(url, { method: 'POST', headers, redirect: 'manual' })
  for (let hops = 0; hops < 3 && res.status >= 300 && res.status < 400; hops++) {
    const location = res.headers.get('location')
    if (!location) break
    const from = new URL(url)
    const to = new URL(location, url)
    const sameSite = to.protocol === 'https:' &&
      (to.host === from.host || to.host === `www.${from.host}` || from.host === `www.${to.host}`)
    if (!sameSite) break
    url = to.toString()
    res = await fetch(url, { method: 'POST', headers, redirect: 'manual' })
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) console.error(`callInternal ${path} → ${res.status}`, typeof body === 'object' ? JSON.stringify(body).slice(0, 300) : '')
  return { status: res.status, body }
}
