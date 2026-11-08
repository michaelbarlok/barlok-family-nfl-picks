import { NextResponse, type NextRequest } from 'next/server'
import { APP_URL } from '@/lib/constants'

/*
 * The site lives at barlokfootballpicks.app. Anyone who reaches a page at the
 * old address — an old Home Screen install, a bookmark, a link in an old
 * email — is sent to the same page there (path and query kept, so an old
 * password link still works). Permanent (308).
 *
 * Only pages move. Never redirected:
 *   - /api/…      scheduled jobs and anything else calling the API keep
 *                 working, whichever address they use
 *   - /sw.js      an old install must still be able to update its service
 *                 worker — that's what retires its old notifications (see
 *                 public/sw.js)
 *   - /_next/… and other files (icons, manifests): served as they are
 *
 * Preview deployments (their own *.vercel.app addresses) are left alone.
 */

const OLD_HOSTS = new Set(['barlok-family-nfl-picks.vercel.app'])

export function middleware(req: NextRequest) {
  const host = (req.headers.get('host') ?? req.nextUrl.hostname).toLowerCase().split(':')[0]
  if (!OLD_HOSTS.has(host)) return NextResponse.next()
  return NextResponse.redirect(new URL(`${req.nextUrl.pathname}${req.nextUrl.search}`, APP_URL), 308)
}

export const config = {
  // Pages only: not the API, Next's own files, the service worker, or any file with an extension.
  matcher: ['/((?!api/|_next/|sw\\.js$|.*\\.[a-zA-Z0-9]+$).*)'],
}
