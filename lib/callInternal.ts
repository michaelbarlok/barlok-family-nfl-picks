import type { NextApiRequest } from 'next'

/**
 * Make an internal API call from a cron handler, forwarding the authorization header.
 */
export async function callInternal(
  req: NextApiRequest,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const protocol = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000'
  const baseUrl = `${protocol}://${host}`

  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: req.headers.authorization ?? '',
      'Content-Type': 'application/json',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const respBody = await res.json().catch(() => ({}))
  return { status: res.status, body: respBody }
}
