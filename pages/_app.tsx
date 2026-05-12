import type { AppProps } from 'next/app'
import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { AuthProvider } from '@/lib/auth'
import { CURRENT_SEASON } from '@/lib/constants'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ToastProvider } from '@/components/Toast'
import '@/styles/globals.css'

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter()
  const [navState, setNavState] = useState<'idle' | 'loading' | 'done'>('idle')

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])

  useEffect(() => {
    const handleStart = () => setNavState('loading')
    const handleDone = () => {
      setNavState('done')
      setTimeout(() => setNavState('idle'), 400)
    }
    router.events.on('routeChangeStart', handleStart)
    router.events.on('routeChangeComplete', handleDone)
    router.events.on('routeChangeError', handleDone)
    return () => {
      router.events.off('routeChangeStart', handleStart)
      router.events.off('routeChangeComplete', handleDone)
      router.events.off('routeChangeError', handleDone)
    }
  }, [router])

  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <Head>
            <title>Barlok Family NFL Picks {CURRENT_SEASON}</title>
            <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
            <link rel="manifest" href="/manifest.json" />
            <meta name="theme-color" content="#0B1120" />
            <meta name="apple-mobile-web-app-capable" content="yes" />
            <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
            <meta name="apple-mobile-web-app-title" content="NFL Picks" />
            <link rel="apple-touch-icon" href="/icons/icon-192.svg" />
            <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
          </Head>

          {/* Top navigation progress bar */}
          <div
            className={`fixed top-0 left-0 right-0 h-[2px] z-[100] transition-opacity duration-400 pointer-events-none ${
              navState === 'idle' ? 'opacity-0' : navState === 'done' ? 'opacity-0' : 'opacity-100'
            }`}
          >
            <div className="h-full progress-gradient" />
          </div>

          {/* Page content — fades out on nav start, new page fades in via animate-fade-in */}
          <div
            className={`transition-opacity duration-150 ${navState === 'loading' ? 'opacity-0' : 'opacity-100'}`}
          >
            <Component key={router.asPath} {...pageProps} />
          </div>
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}
