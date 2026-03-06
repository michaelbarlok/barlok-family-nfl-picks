import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase, supabaseConfigured, supabaseUrl, supabaseAnonKey } from './supabase'

interface User {
  id: string
  email: string
  name: string
  is_manager?: boolean
  is_admin?: boolean
}

interface AuthContextType {
  user: User | null
  loading: boolean
  configError: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, name: string) => Promise<void>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
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

    // Note: we intentionally do NOT use onAuthStateChange here.
    // signIn/signOut bypass the Supabase client, so the listener
    // would only fire stale events from the background signOut()
    // and race with the new signIn, potentially resetting user to null.
  }, [])

  const signIn = async (email: string, password: string) => {
    // Use direct fetch — bypass Supabase client entirely to avoid
    // any internal state issues from background signOut
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

    // Store session directly in localStorage (bypass setSession which can hang)
    const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
    localStorage.setItem(storageKey, JSON.stringify({
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_at: body.expires_at,
      expires_in: body.expires_in,
      token_type: body.token_type,
      user: body.user,
    }))

    // Fetch user profile with direct fetch using the new access token
    const profileRes = await fetch(`${supabaseUrl}/rest/v1/users?id=eq.${body.user.id}&select=*`, {
      headers: {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${body.access_token}`,
      },
    })
    const profiles = await profileRes.json()
    if (!profileRes.ok || !profiles.length) {
      throw new Error('Signed in but no user profile found — contact Michael')
    }
    setUser(profiles[0])
  }

  const signUp = async (email: string, password: string, name: string) => {
    // Use direct fetch for sign-up to match the signIn approach
    const res = await Promise.race([
      fetch(`${supabaseUrl}/auth/v1/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseAnonKey,
        },
        body: JSON.stringify({ email, password }),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Sign up timed out')), 10000)
      )
    ])

    const body = await res.json()
    if (!res.ok) {
      throw new Error(body.error_description || body.msg || 'Sign up failed')
    }

    // Insert user profile using the new user's access token
    const token = body.access_token
    if (token && body.user) {
      const profileRes = await fetch(`${supabaseUrl}/rest/v1/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${token}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ id: body.user.id, email, name }),
      })
      if (!profileRes.ok) {
        const err = await profileRes.json().catch(() => ({}))
        throw new Error(err.message || 'Failed to create user profile')
      }
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

  const resetPassword = async (email: string) => {
    const redirectTo = `${window.location.origin}/reset-password`
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    if (error) throw new Error(error.message)
  }

  return (
    <AuthContext.Provider value={{ user, loading, configError, signIn, signUp, signOut, resetPassword }}>
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
