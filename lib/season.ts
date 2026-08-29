import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CURRENT_SEASON } from '@/lib/constants'

/**
 * Which season is live.
 *
 * This used to be the CURRENT_SEASON constant alone, which meant rolling over
 * required a code change, and made "advance to the next season" impossible to
 * do from the app. It now comes from the seasons table, with the constant as
 * the fallback — so if the table is missing or empty, everything behaves
 * exactly as it did before.
 */

/** Total weeks in a season. The league does not pick playoff games. */
export const WEEKS_IN_SEASON = 18

interface SupabaseQueryClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any
}

/** Server-side lookup. Falls back to the constant when the table isn't there. */
export async function getCurrentSeason(supabase: SupabaseQueryClient): Promise<number> {
  try {
    const { data } = await supabase
      .from('seasons')
      .select('season')
      .eq('is_current', true)
      .maybeSingle()
    return (data as { season: number } | null)?.season ?? CURRENT_SEASON
  } catch {
    return CURRENT_SEASON
  }
}

interface SeasonContextValue {
  /** The live season. */
  season: number
  /** False until the lookup resolves — pages should wait before fetching. */
  ready: boolean
  /** Re-read after closing a season, so the app follows the rollover. */
  refresh: () => Promise<void>
}

const SeasonContext = createContext<SeasonContextValue>({
  season: CURRENT_SEASON,
  ready: false,
  refresh: async () => {},
})

export function SeasonProvider({ children }: { children: React.ReactNode }) {
  const [season, setSeason] = useState(CURRENT_SEASON)
  const [ready, setReady] = useState(false)

  const load = async () => {
    try {
      const { data } = await supabase
        .from('seasons')
        .select('season')
        .eq('is_current', true)
        .maybeSingle()
      if (data?.season) setSeason(data.season)
    } catch {
      // Table not created yet — the constant is a fine answer.
    } finally {
      setReady(true)
    }
  }

  useEffect(() => { load() }, [])

  return React.createElement(
    SeasonContext.Provider,
    { value: { season, ready, refresh: load } },
    children,
  )
}

export function useSeason() {
  return useContext(SeasonContext)
}
