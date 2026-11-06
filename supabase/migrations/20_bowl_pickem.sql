-- Bowl Pick'em: a separate pick'em for college football bowl season.
--
-- It is its own app inside the site (/bowls), with its own players, seasons
-- and — in later migrations — games, picks and Talk. Nothing here reads or
-- changes an NFL table, and no NFL table is altered: the NFL roster is still
-- simply everyone in `users`, and a bowl-only player never gets a row there.
--
-- The one thing the two sides share is the login itself (Supabase Auth), so a
-- person in both uses one email and password. A bowl player's id is their
-- auth user's id.
--
-- All writes go through the server (service role). Signed-in accounts can read
-- these tables, which is how the bowl pages list who's in.
--
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS bowl_players (
  id UUID PRIMARY KEY,                    -- the auth user's id
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  avatar_url TEXT,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bowl_players_email ON bowl_players (lower(email));

-- One row per bowl season, named by the year it starts: 2026 is the 2026–27
-- bowl season. Exactly one is current.
CREATE TABLE IF NOT EXISTS bowl_seasons (
  season INTEGER PRIMARY KEY,
  is_current BOOLEAN NOT NULL DEFAULT false,
  -- setup: building the sheet · open: picks being made · locked: games under
  -- way · complete: champion decided
  status VARCHAR(20) NOT NULL DEFAULT 'setup'
    CHECK (status IN ('setup', 'open', 'locked', 'complete')),
  champion_player_id UUID REFERENCES bowl_players(id) ON DELETE SET NULL,
  champion_name VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bowl_seasons_single_current
  ON bowl_seasons (is_current) WHERE is_current;

-- Who's in a given season's pick'em. Players carry over between years;
-- entries don't, so each year everyone joins (or is added) again.
CREATE TABLE IF NOT EXISTS bowl_entries (
  season INTEGER NOT NULL REFERENCES bowl_seasons(season) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES bowl_players(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (season, player_id)
);
CREATE INDEX IF NOT EXISTS idx_bowl_entries_player ON bowl_entries (player_id);

ALTER TABLE bowl_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE bowl_seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE bowl_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Signed-in users can read bowl_players" ON bowl_players;
CREATE POLICY "Signed-in users can read bowl_players" ON bowl_players
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Signed-in users can read bowl_seasons" ON bowl_seasons;
CREATE POLICY "Signed-in users can read bowl_seasons" ON bowl_seasons
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Signed-in users can read bowl_entries" ON bowl_entries;
CREATE POLICY "Signed-in users can read bowl_entries" ON bowl_entries
  FOR SELECT TO authenticated USING (true);

-- This year's pick'em, ready for people to join.
INSERT INTO bowl_seasons (season, is_current, status)
SELECT 2026, true, 'setup'
WHERE NOT EXISTS (SELECT 1 FROM bowl_seasons WHERE is_current);
