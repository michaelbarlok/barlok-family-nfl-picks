import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/lib/auth'

export default function HomePage() {
  const router = useRouter()
  const { user, loading } = useAuth()

  useEffect(() => {
    if (!loading) {
      if (user) {
        router.push('/picks')
      } else {
        router.push('/login')
      }
    }
  }, [user, loading, router])

  return <div>Redirecting...</div>
}
