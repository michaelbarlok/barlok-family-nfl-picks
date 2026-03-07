import type { AppProps } from 'next/app'
import Head from 'next/head'
import { useEffect } from 'react'
import { AuthProvider } from '@/lib/auth'
import { CURRENT_SEASON } from '@/lib/constants'
import '@/styles/globals.css'

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])

  return (
    <AuthProvider>
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
      <Component {...pageProps} />
    </AuthProvider>
  )
}
