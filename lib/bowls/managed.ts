/*
 * Managed bowl players — kids and anyone else without a phone or a login,
 * whose picks are made by the bowl players the admin names as their managers
 * (like Dani and Maddie on the NFL side).
 *
 * Bowl tables only. The one NFL table read here is player_managers, to bring
 * over who picks for whom when someone joins from the NFL side — read, never
 * changed.
 *
 * Everything here copes with migration 24 not having been run yet: no one is
 * managed and no one manages anyone until it is.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export const MANAGED_MIGRATION_HINT =
  'Managed players need one more database step: run supabase/migrations/24_bowl_managed_players.sql in the Supabase SQL editor.'

/** The error Postgres/PostgREST gives before migration 24 is run. */
export function isMissingManaged(err: { message?: string } | null | undefined): boolean {
  return !!err?.message && /is_managed|bowl_player_managers/.test(err.message) && /does not exist|schema cache|column|relation/i.test(err.message)
}

export interface PlayerRow {
  id: string
  name: string
  email: string | null
  avatar_url: string | null
  is_admin: boolean
  is_managed: boolean
}

/** Bowl players (all of them, or these ids), with whether each is managed. */
export async function readPlayers(supabase: Db, ids: string[] | null): Promise<PlayerRow[]> {
  if (ids && !ids.length) return []
  const base = 'id, name, email, avatar_url, is_admin'
  const query = (cols: string) => {
    const q = supabase.from('bowl_players').select(cols)
    return ids ? q.in('id', ids) : q
  }
  const { data, error } = await query(`${base}, is_managed`)
  if (!error) return ((data ?? []) as PlayerRow[]).map(p => ({ ...p, is_managed: p.is_managed === true }))
  if (!isMissingManaged(error)) throw new Error(error.message)
  const plain = await query(base)
  if (plain.error) throw new Error(plain.error.message)
  return ((plain.data ?? []) as PlayerRow[]).map(p => ({ ...p, is_managed: false }))
}

/** Does `managerId` make `playerId`'s picks? */
export async function isManagerOf(supabase: Db, managerId: string, playerId: string): Promise<boolean> {
  const { data, error } = await supabase.from('bowl_player_managers')
    .select('player_id').eq('manager_id', managerId).eq('player_id', playerId).maybeSingle()
  return !error && !!data
}

/** The players `managerId` picks for who are in this season, by name. */
export async function managedBy(supabase: Db, managerId: string, season: number): Promise<{ id: string; name: string; avatar_url: string | null }[]> {
  const { data: links, error } = await supabase.from('bowl_player_managers').select('player_id').eq('manager_id', managerId)
  if (error || !links?.length) return []
  const ids = (links as { player_id: string }[]).map(l => l.player_id)
  const { data: entries } = await supabase.from('bowl_entries').select('player_id').eq('season', season).in('player_id', ids)
  const entered = ((entries ?? []) as { player_id: string }[]).map(e => e.player_id)
  if (!entered.length) return []
  const { data: players } = await supabase.from('bowl_players').select('id, name, avatar_url').in('id', entered)
  return ((players ?? []) as { id: string; name: string; avatar_url: string | null }[])
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Who makes each of these players' picks. */
export async function managersOf(supabase: Db, playerIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (!playerIds.length) return out
  const { data, error } = await supabase.from('bowl_player_managers').select('manager_id, player_id').in('player_id', playerIds)
  if (error) return out
  for (const l of (data ?? []) as { manager_id: string; player_id: string }[]) {
    out.set(l.player_id, [...(out.get(l.player_id) ?? []), l.manager_id])
  }
  return out
}

/**
 * Bring the NFL side's "who picks for whom" over for someone just added to the
 * Bowl Pick'em: a managed player gets the NFL managers who are bowl players;
 * a manager gets the NFL players they pick for who are managed bowl players.
 * Only ever adds — never removes a manager the admin set. Best effort: any
 * failure just means nothing carried over.
 */
export async function carryOverManagers(supabase: Db, playerId: string): Promise<{ managers: string[]; managing: string[] }> {
  const none = { managers: [], managing: [] }
  try {
    const [asPlayer, asManager] = await Promise.all([
      supabase.from('player_managers').select('manager_id').eq('player_id', playerId),
      supabase.from('player_managers').select('player_id').eq('manager_id', playerId),
    ])
    const wanted = [
      ...((asPlayer.data ?? []) as { manager_id: string }[]).map(l => ({ manager_id: l.manager_id, player_id: playerId })),
      ...((asManager.data ?? []) as { player_id: string }[]).map(l => ({ manager_id: playerId, player_id: l.player_id })),
    ].filter(l => l.manager_id && l.player_id && l.manager_id !== l.player_id)
    if (!wanted.length) return none
    const ids = Array.from(new Set(wanted.flatMap(l => [l.manager_id, l.player_id])))
    const players = await readPlayers(supabase, ids)
    const byId = new Map(players.map(p => [p.id, p]))
    const links = wanted.filter(l => byId.get(l.manager_id)?.is_managed === false && byId.get(l.player_id)?.is_managed === true)
    if (!links.length) return none
    const { error } = await supabase.from('bowl_player_managers').upsert(links, { onConflict: 'manager_id,player_id', ignoreDuplicates: true })
    if (error) return none
    return {
      managers: links.filter(l => l.player_id === playerId).map(l => byId.get(l.manager_id)!.name),
      managing: links.filter(l => l.manager_id === playerId).map(l => byId.get(l.player_id)!.name),
    }
  } catch {
    return none
  }
}

/** "Mike", "Mike and Sarah", "Mike, Sarah and Pat". */
export function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
