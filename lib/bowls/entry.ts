import type { NextApiRequest } from 'next'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { bowlCaller } from '@/lib/bowls/server'
import { isManagerOf } from '@/lib/bowls/managed'

/*
 * Whose picks a request is about (`for`): the caller's own; a managed
 * player's, for one of the people who pick for them; or anyone's, for the
 * bowl admin — but only once picks lock (`overrideAllowed`). Like the NFL's
 * override: before the first kickoff nobody, the admin included, sees or
 * touches anyone else's picks.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface PickTarget {
  callerId: string
  isAdmin: boolean
  playerId: string
  /** Someone else's picks. */
  proxy: boolean
  /** Picking for a managed player the caller picks for. Same deadline as their own. */
  manager: boolean
  /** May change picks after the lock: only the bowl admin, for someone else. */
  override: boolean
}

/** The admin's override (someone else's picks, not a managed player's) opens only once picks lock. */
export const OVERRIDE_BEFORE_LOCK = "Someone else's picks stay private until picks lock at the first kickoff — then you can see and fix them here."
export function overrideAllowed(target: PickTarget, status: string): boolean {
  return !target.proxy || target.manager || status === 'locked' || status === 'complete'
}

export async function pickTarget(req: NextApiRequest, forId: unknown): Promise<PickTarget | { error: string; code: number }> {
  const caller = await bowlCaller(req)
  if (!caller) return { error: 'Sign in first', code: 401 }
  const playerId = typeof forId === 'string' && forId ? forId : caller.user.id
  const proxy = playerId !== caller.user.id
  const manager = proxy && await isManagerOf(getAdminClient(), caller.user.id, playerId)
  if (proxy && !manager && !caller.isAdmin) {
    return { error: "Only the bowl admin can enter someone else's picks", code: 403 }
  }
  return { callerId: caller.user.id, isAdmin: caller.isAdmin, playerId, proxy, manager, override: proxy && caller.isAdmin }
}

export async function inSeason(supabase: Db, season: number, playerId: string): Promise<{ name: string } | null> {
  const { data: entry } = await supabase.from('bowl_entries').select('player_id').eq('season', season).eq('player_id', playerId).maybeSingle()
  if (!entry) return null
  const { data: p } = await supabase.from('bowl_players').select('name').eq('id', playerId).maybeSingle()
  return { name: p?.name ?? 'Player' }
}

export interface StoredPicks {
  picks: Record<string, string>
  enteredByAdmin: number
  best5: string[]
  titleTotal: number | null
}

export async function storedPicks(supabase: Db, season: number, playerId: string): Promise<StoredPicks> {
  const [{ data: rows, error }, { data: extra, error: xErr }] = await Promise.all([
    supabase.from('bowl_picks').select('game_id, team_id, entered_by').eq('season', season).eq('player_id', playerId),
    supabase.from('bowl_extras').select('best5, title_total').eq('season', season).eq('player_id', playerId).maybeSingle(),
  ])
  if (error) throw new Error(error.message)
  if (xErr) throw new Error(xErr.message)
  const picks: Record<string, string> = {}
  let enteredByAdmin = 0
  for (const r of (rows ?? []) as { game_id: string; team_id: string; entered_by: string | null }[]) {
    picks[r.game_id] = r.team_id
    if (r.entered_by && r.entered_by !== playerId) enteredByAdmin++
  }
  return { picks, enteredByAdmin, best5: (extra?.best5 as string[] | null) ?? [], titleTotal: extra?.title_total ?? null }
}
