import { randomBytes, timingSafeEqual } from 'crypto'
import { loadSeason } from '@/lib/bowls/season'

/*
 * The bowl admin's shareable join link: /bowls/join?c=<code>.
 *
 * One private code for the current season, kept in bowl_join_links (server
 * only, migration 25). It works until the season's picks lock at the first
 * kickoff; resetting it makes a new code and the old link stops working.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export const JOIN_MIGRATION_HINT =
  'The share link needs one more database step: run supabase/migrations/25_bowl_join_link.sql in the Supabase SQL editor.'

/** The error Postgres/PostgREST gives before migration 25 is run. */
export function isMissingJoinLinks(err: { message?: string } | null | undefined): boolean {
  return !!err?.message && /bowl_join_links/.test(err.message) && /does not exist|schema cache|relation/i.test(err.message)
}

export const joinUrl = (origin: string, code: string) => `${origin}/bowls/join?c=${encodeURIComponent(code)}`

/** A code that's hard to guess and fine in a URL: 12 characters. */
const newCode = () => randomBytes(9).toString('base64url')

/** Joining is open until the picks lock. */
export const joinOpen = (status: string) => status !== 'locked' && status !== 'complete'

/**
 * The current season, with its status as of now (locked once the first game
 * kicks off, even before anyone flips it).
 */
export async function currentSeasonNow(supabase: Db): Promise<{ season: number; status: string } | null> {
  const { data: row, error } = await supabase.from('bowl_seasons').select('season, status').eq('is_current', true).maybeSingle()
  if (error) throw new Error(error.message)
  if (!row) return null
  let status: string = row.status
  try {
    const loaded = await loadSeason(supabase)
    if (loaded) status = loaded.state.status
  } catch { /* sheet tables not set up yet: go by the stored status */ }
  return { season: row.season, status }
}

/** This season's code, made the first time it's asked for — or a new one, when `reset`. */
export async function joinCodeFor(supabase: Db, season: number, reset = false): Promise<string> {
  if (!reset) {
    const { data, error } = await supabase.from('bowl_join_links').select('code').eq('season', season).maybeSingle()
    if (error) throw new Error(error.message)
    if (data?.code) return data.code
  }
  const code = newCode()
  const { error } = await supabase.from('bowl_join_links').upsert({ season, code, created_at: new Date().toISOString() }, { onConflict: 'season' })
  if (error) throw new Error(error.message)
  return code
}

/** The current season, if `code` is its join link's code; null for a wrong, old or missing code. */
export async function seasonForCode(supabase: Db, code: unknown): Promise<{ season: number; status: string } | null> {
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(code)) return null
  const current = await currentSeasonNow(supabase)
  if (!current) return null
  const { data, error } = await supabase.from('bowl_join_links').select('code').eq('season', current.season).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data?.code) return null
  const a = Buffer.from(String(data.code)), b = Buffer.from(code)
  return a.length === b.length && timingSafeEqual(a, b) ? current : null
}
