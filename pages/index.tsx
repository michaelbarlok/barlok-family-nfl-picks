import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/lib/auth'

export default function HomePage() {
  const router = useRouter()
  const { user, loading, configError } = useAuth()

  useEffect(() => {
    if (!loading) {
      if (user) {
        router.push('/picks')
      } else {
        router.push('/login')
      }
    }
  }, [user, loading, router])

  if (configError) {
    return (
      <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
        <h1>Configuration Error</h1>
        <p>The app is missing required Supabase environment variables.</p>
        <p>Please check that <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> are set in your Vercel project settings and redeploy.</p>
      </div>
    )
  }

  return <div>Redirecting...</div>
}
