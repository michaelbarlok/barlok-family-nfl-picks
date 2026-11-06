import Head from 'next/head'
import type { AppProps } from 'next/app'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ToastProvider } from '@/components/Toast'
import { BowlAuthProvider } from '@/lib/bowls/auth'
import { BOWL_NAME, BOWL_SHORT_NAME } from '@/lib/bowls/constants'

/**
 * The frame every /bowls page renders in — the Bowl Pick'em's own app.
 *
 * Its own sign-in (bowl players), its own title and home-screen icon, and its
 * own manifest, so installing from a bowl page puts a separate "Bowl Pick'em"
 * app on the phone that opens straight to /bowls. None of the NFL's providers,
 * install sheet or setup prompts run here.
 */
export default function BowlApp({ Component, pageProps, routeKey, navState }: {
  Component: AppProps['Component']
  pageProps: AppProps['pageProps']
  routeKey: string
  navState: 'idle' | 'loading' | 'done'
}) {
  return (
    <ErrorBoundary>
      <BowlAuthProvider>
        <ToastProvider>
          <Head>
            <title>{BOWL_NAME}</title>
            <link rel="icon" href="/logos/cfp-trophy.svg" type="image/svg+xml" />
            <link rel="manifest" href="/bowls-manifest.json" />
            <meta name="theme-color" content="#09090b" />
            <meta name="apple-mobile-web-app-capable" content="yes" />
            <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
            <meta name="apple-mobile-web-app-title" content={BOWL_SHORT_NAME} />
            <link rel="apple-touch-icon" href="/icons/bowls-180.png" />
            <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
            {/* The bowl app's black, behind everything (overscroll, notch) — on bowl pages only. */}
            <style>{'html, body { background-color: #09090b; }'}</style>
          </Head>

          <div className={`fixed top-0 left-0 right-0 h-[2px] z-[100] transition-opacity duration-400 pointer-events-none ${navState === 'loading' ? 'opacity-100' : 'opacity-0'}`}>
            <div className="h-full bg-gradient-to-r from-yellow-600 via-yellow-400 to-yellow-600" />
          </div>

          <Component key={routeKey} {...pageProps} />
        </ToastProvider>
      </BowlAuthProvider>
    </ErrorBoundary>
  )
}
