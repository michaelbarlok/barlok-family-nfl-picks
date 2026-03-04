import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase, supabaseConfigured, supabaseUrl, supabaseAnonKey } from './supabase'

interface User {
  id: string
  email: string
  name: string
}

interface AuthContextType {
  user: User | null
  loading: boolean
  configError: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, name: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

async function fetchUserProfile(userId: string): Promise<User | null> {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single()
  return data
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [configError, setConfigError] = useState(false)

  useEffect(() => {
    if (!supabaseConfigured) {
      console.error('Supabase is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables.')
      setConfigError(true)
      setLoading(false)
      return
    }

    const checkUser = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.user) {
          const profile = await fetchUserProfile(session.user.id)
          if (profile) setUser(profile)
        }
      } catch (error) {
        console.error('Auth check error:', error)
      } finally {
        setLoading(false)
      }
    }

    checkUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          const profile = await fetchUserProfile(session.user.id)
          if (profile) setUser(profile)
        } else {
          setUser(null)
        }
      }
    )

    return () => subscription?.unsubscribe()
  }, [])

  const signIn = async (email: string, password: string) => {
    // Use direct fetch to avoid any Supabase client internal lock issues
    const res = await Promise.race([
      fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseAnonKey,
        },
        body: JSON.stringify({ email, password }),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Sign in timed out — check your connection or Supabase project status')), 10000)
      )
    ])

    const body = await res.json()
    if (!res.ok) {
      throw new Error(body.error_description || body.msg || 'Login failed')
    }

    // Store the session in the Supabase client
    await supabase.auth.setSession({
      access_token: body.access_token,
      refresh_token: body.refresh_token,
    })

    // Fetch user profile
    const profile = await fetchUserProfile(body.user.id)
    if (!profile) {
      throw new Error('Signed in but no user profile found — contact Michael')
    }
    setUser(profile)
  }

  const signUp = async (email: string, password: string, name: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    })
    if (error) throw error
    if (data.user) {
      await supabase.from('users').insert({
        id: data.user.id,
        email,
        name,
      })
    }
  }

  const signOut = async () => {
    // Clear user state and storage immediately — don't let a hanging
    // API call prevent the user from signing out
    setUser(null)
    try {
      const storageKey = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
      if (storageKey) localStorage.removeItem(storageKey)
    } catch {}
    // Revoke server session in background (best-effort)
    supabase.auth.signOut().catch(() => {})
  }

  return (
    <AuthContext.Provider value={{ user, loading, configError, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
