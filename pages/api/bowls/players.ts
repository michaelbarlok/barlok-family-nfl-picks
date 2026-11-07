import { randomUUID } from 'crypto'
import type { NextApiRequest, NextApiResponse } from 'next'
import { isValidOrigin } from '@/lib/validation'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { bowlCaller, isBowlAdminEmail, isMissingBowlTables, MIGRATION_HINT, originOf } from '@/lib/bowls/server'
import { addOrInvitePlayer } from '@/lib/bowls/invite'
import { copyPhotoForBowls } from '@/lib/bowls/photo'
import {
  carryOverManagers, isMissingManaged, managersOf, MANAGED_MIGRATION_HINT, nameList, readPlayers, type PlayerRow,
} from '@/lib/bowls/managed'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/**
 * Bowl admin: this season's players.
 *
 *   GET → who's in (and whether each has signed in yet, or — for a managed
 *         player — who picks for them), plus everyone else with an account
 *         who could be added: NFL players and past bowl players.
 *
 *   POST { action: 'add', playerId }        → put someone with an account in this season. No email.
 *   POST { action: 'createManaged', name, managerIds } → a new managed player (no login), picked for by managerIds
 *   POST { action: 'setManagers', playerId, managerIds } → who picks for a managed player
 *   POST { action: 'remove', playerId }     → take them out of this season
 *   POST { action: 'resend', playerId }     → a fresh setup link (or a "you're in" note)
 *
 * NFL tables are only read (users, for names and photos; player_managers, to
 * bring over who picks for whom) — never written.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST' && !isValidOrigin(req)) return res.status(403).json({ error: 'Invalid origin' })
  const caller = await bowlCaller(req)
  if (!caller?.isAdmin) return res.status(403).json({ error: 'Bowl admin access required' })

  const supabase = getAdminClient()
  const { data: current, error: seasonErr } = await supabase
    .from('bowl_seasons').select('season, status').eq('is_current', true).maybeSingle()
  if (isMissingBowlTables(seasonErr)) return res.status(500).json({ error: MIGRATION_HINT })
  if (!current) return res.status(400).json({ error: 'There is no current bowl season.' })

  try {
    if (req.method === 'GET') {
      const { data: entries } = await supabase
        .from('bowl_entries').select('player_id, joined_at').eq('season', current.season)
      const ids = (entries ?? []).map((e: { player_id: string }) => e.player_id)
      const players = await readPlayers(supabase, ids)
      // Signed in yet? Only the auth admin API knows.
      const lastSignIn = new Map<string, string | null>()
      const { data: auth } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
      for (const u of auth?.users ?? []) lastSignIn.set(u.id, u.last_sign_in_at ?? null)
      const joined = new Map((entries ?? []).map((e: { player_id: string; joined_at: string }) => [e.player_id, e.joined_at]))

      // Who picks for each managed player (they needn't be in this season).
      const managers = await managersOf(supabase, players.filter(p => p.is_managed).map(p => p.id))
      const names = new Map(players.map(p => [p.id, p.name]))
      const others = Array.from(new Set(Array.from(managers.values()).flat())).filter(id => !names.has(id))
      if (others.length) {
        const { data } = await supabase.from('bowl_players').select('id, name').in('id', others)
        for (const p of (data ?? []) as { id: string; name: string }[]) names.set(p.id, p.name)
      }

      const list = players.map(p => ({
        ...p,
        // The "admin" tag shows who actually runs it: only you.
        is_admin: isBowlAdminEmail(p.email),
        joined_at: joined.get(p.id) ?? null,
        signed_in: !!lastSignIn.get(p.id),
        managers: p.is_managed ? (managers.get(p.id) ?? []).map(id => ({ id, name: names.get(id) ?? 'Player' })) : [],
      })).sort((a, b) => a.name.localeCompare(b.name))
      const candidates = await addable(supabase, new Set(ids))
      return res.status(200).json({ season: current.season, status: current.status, players: list, candidates })
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const { action, playerId } = req.body ?? {}

    if (action === 'createManaged') return await createManaged(supabase, current, req.body ?? {}, res)
    if (action === 'setManagers') return await setManagers(supabase, req.body ?? {}, res)

    if (typeof playerId !== 'string' || !playerId) return res.status(400).json({ error: 'playerId is required' })

    if (action === 'add') return await addExisting(supabase, current, playerId, res)

    if (action === 'remove') {
      const { error } = await supabase.from('bowl_entries').delete().eq('season', current.season).eq('player_id', playerId)
      if (error) throw error
      return res.status(200).json({ success: true, message: 'Removed from this season.' })
    }

    if (action === 'resend') {
      const { data: player } = await supabase.from('bowl_players').select('name, email').eq('id', playerId).maybeSingle()
      if (!player?.email) return res.status(404).json({ error: 'No email on file for that player' })
      const result = await addOrInvitePlayer({ origin: originOf(req), season: current.season, name: player.name, email: player.email })
      return res.status(200).json({ success: true, ...result })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (err) {
    if (isMissingManaged(err as Error)) return res.status(500).json({ error: MANAGED_MIGRATION_HINT })
    console.error('bowls/players error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Something went wrong' })
  }
}

export interface Candidate {
  id: string
  name: string
  email: string | null
  avatar_url: string | null
  /** No login — someone picks for them. */
  managed: boolean
  /** Plays (or played) the NFL pick'em. */
  nfl: boolean
  /** Played a past Bowl Pick'em season. */
  pastBowls: boolean
}

/** Everyone with an account who isn't in this season: past bowl players and NFL players. */
async function addable(supabase: Db, entered: Set<string>): Promise<Candidate[]> {
  const out = new Map<string, Candidate>()
  for (const p of await readPlayers(supabase, null)) {
    if (entered.has(p.id)) continue
    out.set(p.id, { id: p.id, name: p.name, email: p.email, avatar_url: p.avatar_url, managed: p.is_managed, nfl: false, pastBowls: true })
  }
  const { data: nfl } = await supabase.from('users').select('id, name, email, avatar_url, is_managed')
  for (const u of (nfl ?? []) as { id: string; name: string; email: string | null; avatar_url: string | null; is_managed: boolean | null }[]) {
    if (entered.has(u.id)) continue
    const known = out.get(u.id)
    if (known) { known.nfl = true; continue }
    const managed = u.is_managed === true
    out.set(u.id, { id: u.id, name: u.name, email: managed ? null : u.email, avatar_url: u.avatar_url, managed, nfl: true, pastBowls: false })
  }
  return Array.from(out.values()).sort((a, b) => a.name.localeCompare(b.name))
}

type Season = { season: number; status: string }

/**
 * Put someone who already has an account in this season — no invite, no
 * email. A past bowl player comes back as they were. An NFL player gets a
 * bowl profile from their NFL name and a copy of their photo; an NFL managed
 * player (no login) becomes a managed bowl player, picked for by the same
 * people who pick for them on the NFL side, where those people are bowl
 * players too.
 */
async function addExisting(supabase: Db, current: Season, playerId: string, res: NextApiResponse) {
  if (current.status === 'complete') return res.status(400).json({ error: 'This bowl season is over.' })
  let [player] = await readPlayers(supabase, [playerId]) as (PlayerRow | undefined)[]
  if (!player) {
    const { data: nfl } = await supabase.from('users')
      .select('name, email, avatar_url, is_managed').eq('id', playerId).maybeSingle()
    if (!nfl) return res.status(404).json({ error: "We couldn't find that account." })
    const managed = nfl.is_managed === true
    let email: string | null = null
    if (!managed) {
      const { data: auth } = await supabase.auth.admin.getUserById(playerId)
      email = ((auth?.user?.email ?? nfl.email ?? '') as string).trim().toLowerCase() || null
      if (!auth?.user || !email) {
        return res.status(400).json({ error: `${nfl.name} has no login to sign in with — invite them by email instead.` })
      }
      const { data: taken } = await supabase.from('bowl_players').select('id, name').eq('email', email).maybeSingle()
      if (taken) return res.status(409).json({ error: `${email} already belongs to ${taken.name} in the Bowl Pick'em.` })
    }
    const avatarUrl = await copyPhotoForBowls(supabase, playerId, nfl.avatar_url)
    const row = { id: playerId, name: nfl.name, email, avatar_url: avatarUrl, ...(managed ? { is_managed: true } : {}) }
    const { error } = await supabase.from('bowl_players').insert(row)
    if (error) {
      if (isMissingManaged(error)) return res.status(500).json({ error: MANAGED_MIGRATION_HINT })
      throw new Error(error.message)
    }
    player = { ...row, is_admin: false, is_managed: managed }
  }

  const { error: entryErr } = await supabase.from('bowl_entries')
    .upsert({ season: current.season, player_id: playerId }, { onConflict: 'season,player_id', ignoreDuplicates: true })
  if (entryErr) throw new Error(entryErr.message)

  const carried = await carryOverManagers(supabase, playerId)
  const first = player.name.split(' ')[0]
  let message = `${player.name} is in — no email sent.`
  if (player.is_managed) {
    const { data: links } = await supabase.from('bowl_player_managers').select('manager_id').eq('player_id', playerId)
    message = carried.managers.length
      ? `${player.name} is in. ${nameList(carried.managers)} can make ${first}'s picks.`
      : (links ?? []).length
        ? `${player.name} is in.`
        : `${player.name} is in. Choose who makes ${first}'s picks below.`
  } else if (carried.managing.length) {
    message += ` They can make picks for ${nameList(carried.managing)}.`
  }
  return res.status(200).json({ success: true, playerId, message })
}

/** Manager ids that are real, unmanaged bowl players — or an error to send back. */
async function cleanManagers(supabase: Db, raw: unknown, playerId: string | null): Promise<{ ids: string[]; names: string[] } | { error: string }> {
  if (raw === undefined || raw === null) return { ids: [], names: [] }
  if (!Array.isArray(raw) || raw.some(x => typeof x !== 'string')) return { error: 'managerIds must be a list of players' }
  const wanted = Array.from(new Set(raw as string[])).filter(id => id !== playerId)
  if (!wanted.length) return { ids: [], names: [] }
  const players = await readPlayers(supabase, wanted)
  const ok = players.filter(p => !p.is_managed)
  if (ok.length !== wanted.length) return { error: 'Only players with their own login can make picks for someone.' }
  const sorted = ok.sort((a, b) => a.name.localeCompare(b.name))
  return { ids: sorted.map(p => p.id), names: sorted.map(p => p.name) }
}

/** A new managed player — just a name, no login — in this season, with who picks for them. */
async function createManaged(supabase: Db, current: Season, body: { name?: unknown; managerIds?: unknown }, res: NextApiResponse) {
  if (current.status === 'complete') return res.status(400).json({ error: 'This bowl season is over.' })
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : ''
  if (!name) return res.status(400).json({ error: 'Player name is required' })
  if (name.length > 60) return res.status(400).json({ error: 'That name is too long.' })
  const managers = await cleanManagers(supabase, body.managerIds, null)
  if ('error' in managers) return res.status(400).json({ error: managers.error })

  const { data: entries } = await supabase.from('bowl_entries').select('player_id').eq('season', current.season)
  const inSeason = await readPlayers(supabase, ((entries ?? []) as { player_id: string }[]).map(e => e.player_id))
  if (inSeason.some(p => p.name.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: `There's already a ${name} in this season.` })
  }

  const id = randomUUID()
  const { error } = await supabase.from('bowl_players').insert({ id, name, email: null, avatar_url: null, is_managed: true })
  if (error) {
    if (isMissingManaged(error)) return res.status(500).json({ error: MANAGED_MIGRATION_HINT })
    throw new Error(error.message)
  }
  try {
    if (managers.ids.length) {
      const { error: linkErr } = await supabase.from('bowl_player_managers')
        .insert(managers.ids.map(m => ({ manager_id: m, player_id: id })))
      if (linkErr) throw linkErr
    }
    const { error: entryErr } = await supabase.from('bowl_entries').insert({ season: current.season, player_id: id })
    if (entryErr) throw entryErr
  } catch (err) {
    await supabase.from('bowl_player_managers').delete().eq('player_id', id)
    await supabase.from('bowl_players').delete().eq('id', id)
    throw err
  }
  const first = name.split(' ')[0]
  return res.status(200).json({
    success: true,
    playerId: id,
    message: managers.names.length
      ? `${name} is in. ${nameList(managers.names)} can make ${first}'s picks.`
      : `${name} is in. Choose who makes ${first}'s picks below.`,
  })
}

/** Who makes a managed player's picks — replaces the list. */
async function setManagers(supabase: Db, body: { playerId?: unknown; managerIds?: unknown }, res: NextApiResponse) {
  const playerId = typeof body.playerId === 'string' ? body.playerId : ''
  if (!playerId) return res.status(400).json({ error: 'playerId is required' })
  const [player] = await readPlayers(supabase, [playerId])
  if (!player) return res.status(404).json({ error: "That player isn't in the Bowl Pick'em." })
  if (!player.is_managed) return res.status(400).json({ error: `${player.name} makes their own picks.` })
  const managers = await cleanManagers(supabase, body.managerIds ?? [], playerId)
  if ('error' in managers) return res.status(400).json({ error: managers.error })

  const { error: delErr } = await supabase.from('bowl_player_managers').delete().eq('player_id', playerId)
  if (delErr) throw new Error(delErr.message)
  if (managers.ids.length) {
    const { error } = await supabase.from('bowl_player_managers')
      .insert(managers.ids.map(m => ({ manager_id: m, player_id: playerId })))
    if (error) throw new Error(error.message)
  }
  const first = player.name.split(' ')[0]
  return res.status(200).json({
    success: true,
    message: managers.names.length
      ? `Saved — ${nameList(managers.names)} can make ${first}'s picks.`
      : `Saved — only the bowl admin can enter ${first}'s picks now.`,
  })
}
