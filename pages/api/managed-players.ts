import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { ADMIN_EMAIL } from '@/lib/constants'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function getAuthUser(req: NextApiRequest) {
  const token = (req.headers.authorization ?? '').replace('Bearer ', '')
  if (!token) return null
  try {
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data: { user } } = await anon.auth.getUser(token)
    return user
  } catch {
    return null
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authUser = await getAuthUser(req)
  if (!authUser) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = getServiceClient()

  // GET: Return managed players
  // ?all=true (admin only): returns all managed players with their managers
  // Default: returns managed players for the authenticated user
  if (req.method === 'GET') {
    try {
      const isAdmin = authUser.email === ADMIN_EMAIL

      // Check if caller is a manager
      const { data: callerData } = await supabase
        .from('users')
        .select('is_manager')
        .eq('id', authUser.id)
        .single()
      const isManagerUser = callerData?.is_manager === true

      if (req.query.all === 'true' && (isAdmin || isManagerUser)) {
        // Admin: list all managed players with their managers
        const { data: allPlayers } = await supabase
          .from('users')
          .select('id, name')
          .eq('is_managed', true)
          .order('name')

        const { data: allLinks } = await supabase
          .from('player_managers')
          .select('manager_id, player_id')

        const { data: allUsers } = await supabase
          .from('users')
          .select('id, name, email, is_manager, is_managed')
          .order('name')

        // Fetch last_sign_in_at from Supabase Auth for users with logins
        let lastSignInMap: Record<string, string | null> = {}
        try {
          const { data: { users: authUsers } } = await supabase.auth.admin.listUsers({ perPage: 1000 })
          for (const au of authUsers) {
            lastSignInMap[au.id] = au.last_sign_in_at ?? null
          }
        } catch (err) {
          console.error('Failed to fetch auth users for last_sign_in_at:', err)
        }

        const usersWithLogin = (allUsers ?? []).map(u => ({
          ...u,
          last_sign_in_at: lastSignInMap[u.id] ?? null,
        }))

        return res.status(200).json({
          managedPlayers: allPlayers ?? [],
          managerLinks: allLinks ?? [],
          users: usersWithLogin,
        })
      }

      // Regular user: return only their managed players
      const { data, error } = await supabase
        .from('player_managers')
        .select('player_id, users!player_managers_player_id_fkey(id, name)')
        .eq('manager_id', authUser.id)

      if (error) throw error

      const players = (data ?? []).map((row: any) => ({
        id: row.users.id,
        name: row.users.name,
      }))

      return res.status(200).json({ players })
    } catch (err) {
      console.error('managed-players GET error:', err)
      return res.status(500).json({ error: 'Failed to fetch managed players' })
    }
  }

  // POST: Create a new managed player (requires manager or admin)
  if (req.method === 'POST') {
    const { name, managerId, managerIds } = req.body

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Player name is required' })
    }

    // Check if caller is admin or a manager
    const { data: callerUser } = await supabase
      .from('users')
      .select('is_manager')
      .eq('id', authUser.id)
      .single()

    const isAdmin = authUser.email === ADMIN_EMAIL
    const isManager = callerUser?.is_manager === true

    if (!isAdmin && !isManager) {
      return res.status(403).json({ error: 'You do not have permission to create players' })
    }

    try {
      // Create the managed player in users table
      const { data: newPlayer, error: createError } = await supabase
        .from('users')
        .insert({ name: name.trim(), is_managed: true })
        .select('id, name')
        .single()

      if (createError) throw createError

      // Support multiple manager IDs or a single one
      const ids: string[] = Array.isArray(managerIds) && managerIds.length > 0
        ? managerIds
        : managerId
          ? [managerId]
          : isAdmin ? [] : [authUser.id]

      if (ids.length > 0) {
        const links = ids.map((mid: string) => ({ manager_id: mid, player_id: newPlayer.id }))
        const { error: linkError } = await supabase
          .from('player_managers')
          .insert(links)
        if (linkError) throw linkError
      }

      return res.status(201).json({ player: newPlayer, managerIds: ids })
    } catch (err) {
      console.error('managed-players POST error:', err)
      return res.status(500).json({ error: 'Failed to create managed player' })
    }
  }

  // DELETE: Remove a managed player (admin only)
  if (req.method === 'DELETE') {
    const isAdmin = authUser.email === ADMIN_EMAIL
    if (!isAdmin) return res.status(403).json({ error: 'Admin only' })

    const { playerId } = req.body
    if (!playerId) return res.status(400).json({ error: 'playerId is required' })

    try {
      // Delete manager links first (cascade should handle but be explicit)
      await supabase.from('player_managers').delete().eq('player_id', playerId)
      // Delete the player (cascades to picks, three_best, scores)
      await supabase.from('users').delete().eq('id', playerId).eq('is_managed', true)

      return res.status(200).json({ success: true })
    } catch (err) {
      console.error('managed-players DELETE error:', err)
      return res.status(500).json({ error: 'Failed to delete managed player' })
    }
  }

  // PATCH: Admin operations (toggle manager status, reassign manager)
  if (req.method === 'PATCH') {
    const isAdmin = authUser.email === ADMIN_EMAIL
    if (!isAdmin) return res.status(403).json({ error: 'Admin only' })

    const { action } = req.body

    try {
      // Toggle is_manager flag on a user
      if (action === 'toggle_manager') {
        const { userId, isManager } = req.body
        if (!userId) return res.status(400).json({ error: 'userId is required' })
        const { error } = await supabase
          .from('users')
          .update({ is_manager: isManager })
          .eq('id', userId)
        if (error) throw error
        return res.status(200).json({ success: true })
      }

      // Reassign a managed player to a different manager (legacy, kept for compat)
      if (action === 'reassign') {
        const { playerId, newManagerId } = req.body
        if (!playerId || !newManagerId) return res.status(400).json({ error: 'playerId and newManagerId are required' })

        // Delete old link and insert new one
        await supabase.from('player_managers').delete().eq('player_id', playerId)
        const { error } = await supabase
          .from('player_managers')
          .insert({ manager_id: newManagerId, player_id: playerId })
        if (error) throw error
        return res.status(200).json({ success: true })
      }

      // Add an additional manager to a managed player
      if (action === 'add_manager') {
        const { playerId, managerId: newMgrId } = req.body
        if (!playerId || !newMgrId) return res.status(400).json({ error: 'playerId and managerId are required' })

        const { error } = await supabase
          .from('player_managers')
          .insert({ manager_id: newMgrId, player_id: playerId })
        if (error) {
          if (error.code === '23505') return res.status(409).json({ error: 'This user is already a manager for this player' })
          throw error
        }
        return res.status(200).json({ success: true })
      }

      // Remove a specific manager from a managed player
      if (action === 'remove_manager') {
        const { playerId, managerId: rmMgrId } = req.body
        if (!playerId || !rmMgrId) return res.status(400).json({ error: 'playerId and managerId are required' })

        await supabase.from('player_managers').delete()
          .eq('manager_id', rmMgrId).eq('player_id', playerId)
        return res.status(200).json({ success: true })
      }

      return res.status(400).json({ error: 'Unknown action' })
    } catch (err) {
      console.error('managed-players PATCH error:', err)
      return res.status(500).json({ error: 'Operation failed' })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
