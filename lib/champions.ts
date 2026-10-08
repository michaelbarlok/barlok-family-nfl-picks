export interface Champion { year: number; winner: string; record: string }

// Seasons before the app existed. Everything from 2026 on is written by
// "Save Season" into the seasons table, so a new champion no longer needs a
// code change — this list is only the history that predates it.
export const historicChampions: Champion[] = [
  { year: 1996, winner: 'Mike & Amy', record: '123-117' },
  { year: 1997, winner: 'D Nelson', record: '134-106' },
  { year: 1998, winner: 'Junior', record: '123-116' },
  { year: 1999, winner: 'Junior', record: '157-91' },
  { year: 2000, winner: 'Senior', record: '158-82' },
  { year: 2001, winner: 'Senior', record: '156-92' },
  { year: 2002, winner: '', record: '' },
  { year: 2003, winner: 'Senior', record: '153-101-1' },
  { year: 2004, winner: 'Junior', record: '163-93' },
  { year: 2005, winner: 'Senior', record: '164-92' },
  { year: 2006, winner: 'Grandpa', record: '172-84' },
  { year: 2007, winner: 'Junior', record: '167-89' },
  { year: 2008, winner: 'Uncle Mike', record: '173-83' },
  { year: 2009, winner: 'Michael', record: '165-90-1' },
  { year: 2010, winner: 'Uncle Mike', record: '179-77' },
  { year: 2011, winner: 'Jenn', record: '163-93' },
  { year: 2012, winner: 'Grandpa', record: '173-83' },
  { year: 2013, winner: 'Junior', record: '171-85' },
  { year: 2014, winner: 'Uncle Mike', record: '181-75' },
  { year: 2015, winner: 'Grandpa', record: '167-89' },
  { year: 2016, winner: 'Amy', record: '162-94' },
  { year: 2017, winner: 'Grandpa', record: '173-83' },
  { year: 2018, winner: 'Uncle Mike', record: '168-86-2' },
  { year: 2019, winner: 'Robbie', record: '169-86-1' },
  { year: 2020, winner: 'Robbie', record: '173-83' },
  { year: 2021, winner: 'Robbie', record: '176-95-1' },
  { year: 2022, winner: 'Amy', record: '175-95-2' },
  { year: 2023, winner: 'Amy', record: '178-94' },
  { year: 2024, winner: 'Senior', record: '200-72' },
  { year: 2025, winner: 'Thomas', record: '174-98' },
]


/** Rows from the seasons table, as saved by "Save Season". */
export interface SavedSeasonRow {
  season: number
  champion_name: string | null
  champion_record: string | null
}

/**
 * The full roll: the hardcoded history plus every season saved in the app,
 * oldest first. A season saved in the app wins over a hardcoded row for the
 * same year.
 */
export function mergeChampions(rows: SavedSeasonRow[] | null | undefined): Champion[] {
  const merged = new Map<number, Champion>(historicChampions.map(c => [c.year, c]))
  for (const row of rows ?? []) {
    if (!row.champion_name) continue
    merged.set(row.season, { year: row.season, winner: row.champion_name, record: row.champion_record ?? '' })
  }
  return [...merged.values()].sort((a, b) => a.year - b.year)
}
