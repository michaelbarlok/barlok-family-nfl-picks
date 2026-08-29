import type { NextApiRequest, NextApiResponse } from 'next'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isValidOrigin } from '@/lib/validation'
import { isAdmin } from '@/lib/apiAuth'
import { computeRecords, recordSort, assignRanks } from '@/lib/computeStandings'
import { fetchAllRows } from '@/lib/fetchAll'
import { getCurrentSeason, WEEKS_IN_SEASON } from '@/lib/season'

/**
 * Close out the season: freeze the final table, crown the champion, roll over.
 *
 * The snapshot is the point. Standings are recomputed from picks on every page
 * load, so without freezing them a later result correction — or a player
 * leaving the league — would quietly rewrite a finished season's history.
 * season_standings stores the final table, including each player's name, so it
 * stays readable even if the account is gone.
 *
 * Picks and games are already season-scoped and are left exactly where they
 * are, so All Picks for any past week keeps working; only the live season
 * pointer moves.
 *
 * GET  — dry run. Reports whether the season is ready to close and who would
 *        be crowned, changing nothing. This is what the buttons use to decide
 *        whether to offer themselves.
 * POST — does it, once. Re-closing an already-closed season is refused.
 */

interface Preview {
  season: number
  weeksPlayed: number
  weeksExpected: number
  undecidedGames: number
  readyToClose: boolean
  blockers: string[]
  champion: { name: string; record: string; isTied: boolean } | null
  standings: Array<{
    userId: string | null
    name: string
    rank: number
    isTied: boolean
    wins: number; losses: number; ties: number
    bestWins: number; bestLosses: number; bestTies: number
  }>
}

async function buildPreview(supabase: ReturnType<typeof getAdminClient>, season: number): Promise<Preview> {
  const [{ data: users }, { data: games }, { data: threeBests }] = await Promise.all([
    supabase.from('users').select('id, name').order('name'),
    supabase.from('games').select('id, week, away_team, home_team, winning_team').eq('season', season),
    supabase.from('three_best').select('user_id, week, pick_1, pick_2, pick_3').eq('season', season),
  ])
  const picks = await fetchAllRows<{ user_id: string; game_id: string; picked_team: string; week: number }>(
    (from, to) => supabase.from('picks').select('user_id, game_id, picked_team, week')
      .eq('season', season).order('id').range(from, to),
  )

  const allGames = games ?? []
  const weeksPlayed = new Set(allGames.filter(g => g.winning_team).map(g => g.week)).size
  const undecidedGames = allGames.filter(g => !g.winning_team).length

  const blockers: string[] = []
  if (allGames.length === 0) blockers.push('No games have been synced for this season.')
  if (weeksPlayed < WEEKS_IN_SEASON) {
    blockers.push(`Only ${weeksPlayed} of ${WEEKS_IN_SEASON} weeks have results. Sync the remaining weeks first.`)
  }
  if (undecidedGames > 0) {
    blockers.push(`${undecidedGames} game${undecidedGames === 1 ? '' : 's'} still have no result. Sync scores before closing.`)
  }

  const userIds = (users ?? []).map(u => u.id)
  const records = computeRecords({ userIds, games: allGames, picks, threeBests: threeBests ?? [] })

  const sorted = [...userIds].sort((a, b) => recordSort(records.get(a)!, records.get(b)!))
  const ranks = assignRanks(sorted, uid => records.get(uid)!)

  const standings = sorted.map((uid, i) => {
    const r = records.get(uid)!
    return {
      userId: uid,
      name: (users ?? []).find(u => u.id === uid)?.name ?? 'Unknown',
      rank: ranks[i].rank,
      isTied: ranks[i].isTied,
      wins: r.wins, losses: r.losses, ties: r.ties,
      bestWins: r.bestWins, bestLosses: r.bestLosses, bestTies: r.bestTies,
    }
  })

  const first = standings.find(s => s.rank === 1) ?? null
  const champion = first
    ? {
        name: standings.filter(s => s.rank === 1).map(s => s.name).join(' & '),
        record: `${first.wins}-${first.losses}${first.ties > 0 ? `-${first.ties}` : ''}`,
        isTied: first.isTied,
      }
    : null

  return {
    season,
    weeksPlayed,
    weeksExpected: WEEKS_IN_SEASON,
    undecidedGames,
    readyToClose: blockers.length === 0 && standings.length > 0,
    blockers,
    champion,
    standings,
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (req.method === 'POST' && !isValidOrigin(req)) {
    return res.status(403).json({ error: 'Invalid origin' })
  }
  if (!(await isAdmin(req))) {
    return res.status(403).json({ error: 'Unauthorized — admin access required' })
  }

  const supabase = getAdminClient()

  try {
    const season = await getCurrentSeason(supabase)

    const { data: seasonRow } = await supabase
      .from('seasons').select('season, completed_at').eq('season', season).maybeSingle()

    if (!seasonRow) {
      return res.status(500).json({
        error: 'The seasons table has no row for the live season. Run supabase/migrations/11_seasons.sql.',
      })
    }
    if (seasonRow.completed_at) {
      return res.status(409).json({ error: `Season ${season} has already been closed.` })
    }

    const preview = await buildPreview(supabase, season)
    if (req.method === 'GET') return res.status(200).json(preview)

    // POST — allow a deliberate override of the readiness checks, but never
    // close a season with no players to rank.
    const force = req.body?.force === true
    if (!preview.readyToClose && !force) {
      return res.status(400).json({
        error: preview.blockers.join(' '),
        blockers: preview.blockers,
        requiresForce: preview.standings.length > 0,
      })
    }
    if (preview.standings.length === 0 || !preview.champion) {
      return res.status(400).json({ error: 'There are no players to rank — nothing to save.' })
    }

    // 1. Freeze the final table.
    const { error: standingsError } = await supabase.from('season_standings').upsert(
      preview.standings.map(s => ({
        season,
        user_id: s.userId,
        player_name: s.name,
        rank: s.rank,
        is_tied: s.isTied,
        wins: s.wins, losses: s.losses, ties: s.ties,
        best_wins: s.bestWins, best_losses: s.bestLosses, best_ties: s.bestTies,
      })),
      { onConflict: 'season,player_name' },
    )
    if (standingsError) throw new Error(`Could not save the final standings: ${standingsError.message}`)

    // 2. Crown, and stand the season down.
    const winner = preview.standings.find(s => s.rank === 1)!
    const { error: closeError } = await supabase.from('seasons').update({
      is_current: false,
      completed_at: new Date().toISOString(),
      champion_user_id: preview.champion.isTied ? null : winner.userId,
      champion_name: preview.champion.name,
      champion_record: preview.champion.record,
    }).eq('season', season)
    if (closeError) throw new Error(`Could not close the season: ${closeError.message}`)

    // 3. Open the next one. Only after the old flag is down — a partial unique
    //    index allows just one current season, so this order matters.
    const nextSeason = season + 1
    const { error: nextError } = await supabase.from('seasons').upsert(
      { season: nextSeason, is_current: true },
      { onConflict: 'season' },
    )
    if (nextError) throw new Error(`Season ${season} was closed, but ${nextSeason} could not be opened: ${nextError.message}`)

    return res.status(200).json({
      success: true,
      closedSeason: season,
      nextSeason,
      champion: preview.champion,
      playersArchived: preview.standings.length,
      message: `${preview.champion.name} wins ${season} at ${preview.champion.record}. Season ${nextSeason} is now live.`,
    })
  } catch (err) {
    console.error('save-season error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save the season' })
  }
}
