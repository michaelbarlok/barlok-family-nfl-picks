export const NFL_TEAMS: Record<string, { city: string; name: string; logo: string }> = {
  ARI: { city: 'Arizona',       name: 'Cardinals',   logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/ari.png' },
  ATL: { city: 'Atlanta',       name: 'Falcons',      logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/atl.png' },
  BAL: { city: 'Baltimore',     name: 'Ravens',       logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/bal.png' },
  BUF: { city: 'Buffalo',       name: 'Bills',        logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/buf.png' },
  CAR: { city: 'Carolina',      name: 'Panthers',     logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/car.png' },
  CHI: { city: 'Chicago',       name: 'Bears',        logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/chi.png' },
  CIN: { city: 'Cincinnati',    name: 'Bengals',      logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/cin.png' },
  CLE: { city: 'Cleveland',     name: 'Browns',       logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/cle.png' },
  DAL: { city: 'Dallas',        name: 'Cowboys',      logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/dal.png' },
  DEN: { city: 'Denver',        name: 'Broncos',      logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/den.png' },
  DET: { city: 'Detroit',       name: 'Lions',        logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/det.png' },
  GB:  { city: 'Green Bay',     name: 'Packers',      logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/gb.png'  },
  HOU: { city: 'Houston',       name: 'Texans',       logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/hou.png' },
  IND: { city: 'Indianapolis',  name: 'Colts',        logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/ind.png' },
  JAC: { city: 'Jacksonville',  name: 'Jaguars',      logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/jax.png' },
  KC:  { city: 'Kansas City',   name: 'Chiefs',       logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/kc.png'  },
  LAC: { city: 'LA',            name: 'Chargers',     logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/lac.png' },
  LAR: { city: 'LA',            name: 'Rams',         logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/lar.png' },
  LV:  { city: 'Las Vegas',     name: 'Raiders',      logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/lv.png'  },
  MIA: { city: 'Miami',         name: 'Dolphins',     logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/mia.png' },
  MIN: { city: 'Minnesota',     name: 'Vikings',      logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/min.png' },
  NE:  { city: 'New England',   name: 'Patriots',     logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/ne.png'  },
  NO:  { city: 'New Orleans',   name: 'Saints',       logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/no.png'  },
  NYG: { city: 'NY',            name: 'Giants',       logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/nyg.png' },
  NYJ: { city: 'NY',            name: 'Jets',         logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/nyj.png' },
  PHI: { city: 'Philadelphia',  name: 'Eagles',       logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/phi.png' },
  PIT: { city: 'Pittsburgh',    name: 'Steelers',     logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/pit.png' },
  SEA: { city: 'Seattle',       name: 'Seahawks',     logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/sea.png' },
  SF:  { city: 'San Francisco', name: '49ers',        logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/sf.png'  },
  TB:  { city: 'Tampa Bay',     name: 'Buccaneers',   logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/tb.png'  },
  TEN: { city: 'Tennessee',     name: 'Titans',       logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/ten.png' },
  WAS: { city: 'Washington',    name: 'Commanders',   logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/wsh.png' },
}

export function getTeam(abbr: string) {
  return NFL_TEAMS[abbr] ?? { city: abbr, name: '', logo: '' }
}

/** ESPN uses slightly different abbreviations for a few teams */
export const ESPN_TO_OUR: Record<string, string> = {
  JAX: 'JAC',
  WSH: 'WAS',
}

export function normalizeTeam(espnAbbr: string): string {
  return ESPN_TO_OUR[espnAbbr] ?? espnAbbr
}
