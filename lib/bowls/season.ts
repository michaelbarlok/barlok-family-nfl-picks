import { gameFromRow, lockTime, type BowlGame, type GameRow } from '@/lib/bowls/sheet'

/*
 * Where this bowl season stands, worked out on the server.
 *
 * The sheet locks by the clock — at the first kickoff on it — with nothing
 * scheduled to flip a switch: any season marked open whose first game has
 * kicked off is locked.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export type SeasonStatus = 'setup' | 'open' | 'locked' | 'complete'

export interface SeasonState {
  season: number
  /** As stored: setup until the admin opens picks. */
  rawStatus: SeasonStatus
  /** As it stands now, with the clock applied. */
  status: SeasonStatus
  lockAt: string | null
  pulledAt: string | null
}

export const SHEET_MIGRATION_HINT =
  "The bowl games aren't set up yet. Run supabase/migrations/21_bowl_sheet.sql in the Supabase SQL editor."

/** Migration 21's tables or column missing. */
export function isMissingSheetTables(err: { message?: string } | null | undefined): boolean {
  return !!err?.message && /bowl_(games|picks|extras)|espn_pulled_at/.test(err.message)
    && /does not exist|schema cache|relation|column/i.test(err.message)
}

export function effectiveStatus(raw: SeasonStatus, lockAt: string | null, now = Date.now()): SeasonStatus {
  if (raw === 'open' && lockAt && now >= Date.parse(lockAt)) return 'locked'
  return raw
}

export async function loadGames(supabase: Db, season: number): Promise<BowlGame[]> {
  const { data, error } = await supabase.from('bowl_games').select('*').eq('season', season)
  if (error) throw new Error(error.message)
  return ((data ?? []) as GameRow[]).map(gameFromRow)
}

/**
 * The current season, its games and where it stands. Null when there's no
 * current season. Throws the database's error (check isMissingSheetTables).
 */
export async function loadSeason(supabase: Db): Promise<{ state: SeasonState; games: BowlGame[] } | null> {
  const { data: row, error } = await supabase
    .from('bowl_seasons').select('season, status, espn_pulled_at').eq('is_current', true).maybeSingle()
  if (error) throw new Error(error.message)
  if (!row) return null
  const games = await loadGames(supabase, row.season)
  const lockAt = lockTime(games)
  const rawStatus = row.status as SeasonStatus
  return {
    state: { season: row.season, rawStatus, status: effectiveStatus(rawStatus, lockAt), lockAt, pulledAt: row.espn_pulled_at ?? null },
    games,
  }
}
