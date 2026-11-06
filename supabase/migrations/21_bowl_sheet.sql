-- Bowl Pick'em, part 2: the pick sheet, picks, Best 5 and the title-game total.
--
-- Bowl tables only. No NFL table is read, altered or written, and nothing here
-- is scheduled: games, times and results come in only when the bowl admin taps
-- "Pull from ESPN".
--
-- Picks stay private until the sheet locks at the first kickoff: bowl_picks and
-- bowl_extras have no read policy at all, so only the server can read them,
-- and it hands a player their own picks and nobody else's. Everyone else —
-- the admin included — sees counts only until then.
--
-- Safe to run more than once.

-- Every game the admin could put on the sheet: ESPN's bowl and playoff
-- schedule, plus anything added by date (Army–Navy). `phase` says where it
-- sits on the sheet; NULL means it's not on it.
CREATE TABLE IF NOT EXISTS bowl_games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season INTEGER NOT NULL REFERENCES bowl_seasons(season) ON DELETE CASCADE,
  espn_id TEXT NOT NULL,
  espn_name TEXT NOT NULL DEFAULT '',      -- ESPN's own title, sponsors and all
  name TEXT NOT NULL,                      -- what the sheet calls it (editable)
  kickoff_time TIMESTAMPTZ,
  time_tbd BOOLEAN NOT NULL DEFAULT false, -- ESPN has the date but not the time
  tv TEXT,
  venue TEXT,
  -- Playoff games: which round. NULL for everything else.
  playoff_round TEXT CHECK (playoff_round IN ('first', 'quarter', 'semi', 'title')),
  -- little = The Little Ones (1) · between = In Betweeners (1.5) · big = The
  -- Big Ones (2) · playoff = first round and quarterfinals (3) · semi (3) ·
  -- title = the champion pick (3)
  phase TEXT CHECK (phase IN ('little', 'between', 'big', 'playoff', 'semi', 'title')),
  -- Teams, as ESPN has them. A team id of NULL means TBD.
  away_team_id TEXT, away_name TEXT, away_abbr TEXT, away_logo TEXT, away_rank INTEGER, away_record TEXT, away_color TEXT,
  home_team_id TEXT, home_name TEXT, home_abbr TEXT, home_logo TEXT, home_rank INTEGER, home_record TEXT, home_color TEXT,
  -- The bracket: this side is the winner of that game. A player's options for
  -- this side are whoever they picked to win it.
  away_from UUID REFERENCES bowl_games(id) ON DELETE SET NULL,
  home_from UUID REFERENCES bowl_games(id) ON DELETE SET NULL,
  -- Results, from the last pull.
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'in_progress', 'final', 'canceled', 'postponed')),
  status_detail TEXT,
  away_score INTEGER,
  home_score INTEGER,
  winner_team_id TEXT,
  -- Canceled or postponed: off the pick'em entirely. Set by the pull when ESPN
  -- says so, or by the admin.
  removed BOOLEAN NOT NULL DEFAULT false,
  manual BOOLEAN NOT NULL DEFAULT false,   -- added by date, not from the bowl schedule
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (season, espn_id)
);
CREATE INDEX IF NOT EXISTS idx_bowl_games_season ON bowl_games (season);

-- One pick per player per game: the ESPN id of the team they picked.
CREATE TABLE IF NOT EXISTS bowl_picks (
  season INTEGER NOT NULL REFERENCES bowl_seasons(season) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES bowl_players(id) ON DELETE CASCADE,
  game_id UUID NOT NULL REFERENCES bowl_games(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  entered_by UUID,                          -- the admin, when they entered it for the player
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_id, game_id)
);
CREATE INDEX IF NOT EXISTS idx_bowl_picks_season ON bowl_picks (season);

-- Each player's Best 5 and their guess at the title game's total points.
CREATE TABLE IF NOT EXISTS bowl_extras (
  season INTEGER NOT NULL REFERENCES bowl_seasons(season) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES bowl_players(id) ON DELETE CASCADE,
  best5 UUID[] NOT NULL DEFAULT '{}',
  title_total INTEGER CHECK (title_total IS NULL OR (title_total >= 0 AND title_total <= 250)),
  entered_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (season, player_id)
);

-- When the admin last pulled from ESPN.
ALTER TABLE bowl_seasons ADD COLUMN IF NOT EXISTS espn_pulled_at TIMESTAMPTZ;

ALTER TABLE bowl_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE bowl_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE bowl_extras ENABLE ROW LEVEL SECURITY;

-- The sheet itself isn't secret.
DROP POLICY IF EXISTS "Signed-in users can read bowl_games" ON bowl_games;
CREATE POLICY "Signed-in users can read bowl_games" ON bowl_games
  FOR SELECT TO authenticated USING (true);

-- bowl_picks and bowl_extras: deliberately no policies. Server only.
