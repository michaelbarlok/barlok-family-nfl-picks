import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase, supabaseConfigured } from './supabase'

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

    let resolved = false

    // Hard safety timeout — no matter what hangs, the user won't be stuck
    const safetyTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        console.warn('Auth check timed out — proceeding without session')
        setLoading(false)
        // Clear stale auth data directly from storage instead of calling
        // signOut() which acquires an internal lock that blocks future
        // signInWithPassword() calls
        try {
          const storageKey = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
          if (storageKey) localStorage.removeItem(storageKey)
        } catch {}
      }
    }, 5000)

    const checkUser = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!resolved && session?.user) {
          const { data } = await supabase
            .from('users')
            .select('*')
            .eq('id', session.user.id)
            .single()
          if (data) {
            setUser(data)
          }
        }
      } catch (error) {
        console.error('Auth check error:', error)
      } finally {
        if (!resolved) {
          resolved = true
          clearTimeout(safetyTimeout)
          setLoading(false)
        }
      }
    }

    checkUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          const { data } = await supabase
            .from('users')
            .select('*')
            .eq('id', session.user.id)
            .single()
          if (data) {
            setUser(data)
          }
        } else {
          setUser(null)
        }
      }
    )

    return () => {
      clearTimeout(safetyTimeout)
      subscription?.unsubscribe()
    }
  }, [])

  const signIn = async (email: string, password: string) => {
    const result = await Promise.race([
      supabase.auth.signInWithPassword({ email, password }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Sign in timed out — check your connection or Supabase project status')), 10000)
      )
    ])
    if (result.error) throw result.error

    // Set user immediately rather than relying on onAuthStateChange race
    const authUser = result.data?.user
    if (authUser) {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single()
      if (error) {
        throw new Error(`Signed in but failed to load user profile: ${error.message}`)
      }
      if (data) {
        setUser(data)
      }
    }
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
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    setUser(null)
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
