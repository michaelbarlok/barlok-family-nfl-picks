-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Games table
CREATE TABLE IF NOT EXISTS games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week INTEGER NOT NULL,
  away_team VARCHAR(50) NOT NULL,
  home_team VARCHAR(50) NOT NULL,
  kickoff_time TIMESTAMP NOT NULL,
  season INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(week, away_team, home_team, season)
);

-- Picks table
CREATE TABLE IF NOT EXISTS picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  picked_team VARCHAR(50) NOT NULL,
  week INTEGER NOT NULL,
  season INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, game_id)
);

-- Three Best table (tiebreaker)
CREATE TABLE IF NOT EXISTS three_best (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week INTEGER NOT NULL,
  season INTEGER NOT NULL,
  pick_1 VARCHAR(50) NOT NULL,
  pick_2 VARCHAR(50) NOT NULL,
  pick_3 VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, week, season)
);

-- Scores table (to track W/L for each pick)
CREATE TABLE IF NOT EXISTS scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  is_correct BOOLEAN,
  week INTEGER NOT NULL,
  season INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, game_id)
);

-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE three_best ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can read all users" ON users FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile" ON users FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can read all games" ON games FOR SELECT USING (true);
CREATE POLICY "Users can read their own picks" ON picks FOR SELECT USING (true);
CREATE POLICY "Users can insert their own picks" ON picks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own picks" ON picks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can read their own three_best" ON three_best FOR SELECT USING (true);
CREATE POLICY "Users can insert their own three_best" ON three_best FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own three_best" ON three_best FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can read all scores" ON scores FOR SELECT USING (true);
