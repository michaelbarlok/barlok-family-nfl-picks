import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase, supabaseConfigured, supabaseUrl, supabaseAnonKey } from '@/lib/supabase'
import { ADMIN_EMAIL } from '@/lib/constants'

/*
 * Sign-in for the Bowl Pick'em.
 *
 * The login itself (Supabase Auth) is shared with the NFL side, so a person in
 * both has one email and password and stays signed in when they switch. What
 * isn't shared is who counts as a player: here it's whoever has a row in
 * bowl_players. The NFL profile is only read, never written — to show the
 * NFL ⇄ Bowls toggle to people in both, and to let an NFL player join with one
 * tap using the name and photo they already have.
 */

export interface BowlPlayer {
  id: string
  name: string
  email: string | null
  avatar_url: string | null
  is_admin: boolean
}

interface BowlAuthState {
  loading: boolean
  /** The signed-in login, bowl player or not. */
  account: { id: string; email: string } | null
  /** Their Bowl Pick'em profile; null if they aren't a bowl player. */
  player: BowlPlayer | null
  /** Their NFL profile, if they have one. Read-only. */
  nflProfile: { name: string; avatar_url: string | null } | null
  isAdmin: boolean
  /** The bowl tables don't exist yet — migration 20 hasn't been run. */
  setupMissing: boolean
  /** Signs in and reports who that turned out to be. */
  signIn: (email: string, password: string) => Promise<Snapshot>
  signOut: () => Promise<void>
  refresh: () => Promise<Snapshot>
  /** Bearer token for /api/bowls calls. */
  token: () => Promise<string>
}

interface Snapshot {
  player: BowlPlayer | null
  nflProfile: { name: string; avatar_url: string | null } | null
}

const BowlAuthContext = createContext<BowlAuthState | undefined>(undefined)

const storageKey = () => `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`

export function BowlAuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [account, setAccount] = useState<BowlAuthState['account']>(null)
  const [player, setPlayer] = useState<BowlPlayer | null>(null)
  const [nflProfile, setNflProfile] = useState<BowlAuthState['nflProfile']>(null)
  const [setupMissing, setSetupMissing] = useState(false)

  const load = useCallback(async (): Promise<Snapshot> => {
    const none: Snapshot = { player: null, nflProfile: null }
    if (!supabaseConfigured) { setLoading(false); return none }
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const u = session?.user
      if (!u) {
        setAccount(null); setPlayer(null); setNflProfile(null)
        return none
      }
      setAccount({ id: u.id, email: u.email ?? '' })
      const [bowl, nfl] = await Promise.all([
        supabase.from('bowl_players').select('id, name, email, avatar_url, is_admin').eq('id', u.id).maybeSingle(),
        supabase.from('users').select('name, avatar_url').eq('id', u.id).maybeSingle(),
      ])
      // A missing table comes back as an error, not an exception.
      setSetupMissing(!!bowl.error && /bowl_players/.test(bowl.error.message ?? ''))
      const snap: Snapshot = {
        player: (bowl.data as BowlPlayer | null) ?? null,
        nflProfile: (nfl.data as Snapshot['nflProfile']) ?? null,
      }
      setPlayer(snap.player)
      setNflProfile(snap.nflProfile)
      return snap
    } catch (err) {
      console.error('Bowl auth check failed:', err)
      return none
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Same direct sign-in the NFL side uses: straight to the auth endpoint and
  // into storage, bypassing the client's own session handling.
  const signIn = async (email: string, password: string) => {
    const res = await Promise.race([
      fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: supabaseAnonKey },
        body: JSON.stringify({ email, password }),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Sign in timed out — check your connection')), 10000)),
    ])
    const body = await res.json()
    if (!res.ok) throw new Error(body.error_description || body.msg || 'Login failed')

    localStorage.setItem(storageKey(), JSON.stringify({
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_at: body.expires_at,
      expires_in: body.expires_in,
      token_type: body.token_type,
      user: body.user,
    }))
    return load()
  }

  const signOut = async () => {
    setAccount(null); setPlayer(null); setNflProfile(null)
    try {
      const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
      if (key) localStorage.removeItem(key)
    } catch {}
    supabase.auth.signOut().catch(() => {})
  }

  // Stable, so pages can depend on it without refetching on every render.
  const token = useCallback(async () => (await supabase.auth.getSession()).data.session?.access_token ?? '', [])

  const isAdmin = !!account && (account.email.toLowerCase() === ADMIN_EMAIL || player?.is_admin === true)

  return (
    <BowlAuthContext.Provider value={{ loading, account, player, nflProfile, isAdmin, setupMissing, signIn, signOut, refresh: load, token }}>
      {children}
    </BowlAuthContext.Provider>
  )
}

export function useBowlAuth(): BowlAuthState {
  const ctx = useContext(BowlAuthContext)
  if (!ctx) throw new Error('useBowlAuth must be used within BowlAuthProvider')
  return ctx
}
