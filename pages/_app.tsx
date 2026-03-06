import type { AppProps } from 'next/app'
import Head from 'next/head'
import { AuthProvider } from '@/lib/auth'
import { CURRENT_SEASON } from '@/lib/constants'
import '@/styles/globals.css'

export default function App({ Component, pageProps }: AppProps) {
  return (
    <AuthProvider>
      <Head>
        <title>Barlok Family NFL Picks {CURRENT_SEASON}</title>
      </Head>
      <Component {...pageProps} />
    </AuthProvider>
  )
}
