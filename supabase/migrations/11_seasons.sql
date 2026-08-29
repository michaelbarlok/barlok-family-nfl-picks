-- Season lifecycle and frozen final standings.
--
-- Two problems this solves. The current season lived only in a source
-- constant, so rolling over meant editing and redeploying code. And every page
-- filters on that one season, so the moment it changed, the previous season's
-- standings and picks became unreachable.
--
-- seasons          — which season is live, and who won each finished one
-- season_standings — the final table, frozen at the moment a season is closed
--
-- The snapshot matters because standings are recomputed from picks on every
-- load: without it, a later correction (or a deleted player) would silently
-- rewrite a finished season's history. player_name is stored alongside the id
-- so the record survives a player leaving the league.

CREATE TABLE IF NOT EXISTS seasons (
  season INTEGER PRIMARY KEY,
  is_current BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMP,
  champion_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  champion_name VARCHAR(255),
  champion_record VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Exactly one live season at a time, enforced by the database rather than by
-- remembering to clear the old flag.
CREATE UNIQUE INDEX IF NOT EXISTS idx_seasons_single_current
  ON seasons(is_current) WHERE is_current;

CREATE TABLE IF NOT EXISTS season_standings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season INTEGER NOT NULL REFERENCES seasons(season) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  player_name VARCHAR(255) NOT NULL,
  rank INTEGER NOT NULL,
  is_tied BOOLEAN NOT NULL DEFAULT false,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  ties INTEGER NOT NULL DEFAULT 0,
  best_wins INTEGER NOT NULL DEFAULT 0,
  best_losses INTEGER NOT NULL DEFAULT 0,
  best_ties INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(season, player_name)
);

ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_standings ENABLE ROW LEVEL SECURITY;

-- Readable by everyone; written only by the service role from the admin route.
DROP POLICY IF EXISTS "Users can read all seasons" ON seasons;
CREATE POLICY "Users can read all seasons" ON seasons FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can read all season_standings" ON season_standings;
CREATE POLICY "Users can read all season_standings" ON season_standings FOR SELECT USING (true);

CREATE INDEX IF NOT EXISTS idx_season_standings_season ON season_standings(season, rank);

-- Seed the season already in progress. Adjust the number if you run this in a
-- later year; ON CONFLICT keeps a re-run harmless.
INSERT INTO seasons (season, is_current)
VALUES (2026, true)
ON CONFLICT (season) DO NOTHING;

-- Safe to run more than once.
