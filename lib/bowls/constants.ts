/*
 * The Bowl Pick'em is its own app inside the site, under /bowls. These names
 * are what it calls itself on screen, in emails and on the home screen — the
 * NFL side keeps its own and never shows these.
 */

export const BOWL_NAME = "Barlok Family Bowl Pick'em"
export const BOWL_SHORT_NAME = "Bowl Pick'em"

/** 2026 → "2026–27", the way a bowl season is written. */
export function bowlSeasonLabel(season: number): string {
  return `${season}–${String(season + 1).slice(-2)}`
}

/** Where the bowl app lives. */
export const BOWL_HOME = '/bowls'
