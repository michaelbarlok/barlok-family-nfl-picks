-- ============================================================
-- FULL SCHEMA RESET for Barlok Family NFL Picks
-- WARNING: This drops ALL app tables and recreates them.
--          ALL DATA WILL BE LOST.
-- Run this in the Supabase SQL Editor.
-- ============================================================

-- =====================
-- 1. DROP EVERYTHING
-- =====================

-- Drop policies first (they depend on tables/functions)
DROP POLICY IF EXISTS "Users can read all users" ON users;
DROP POLICY IF EXISTS "Users can insert their own profile" ON users;
DROP POLICY IF EXISTS "Users can read all games" ON games;
DROP POLICY IF EXISTS "Users can read their own picks" ON picks;
DROP POLICY IF EXISTS "Users can read all picks" ON picks;
DROP POLICY IF EXISTS "Users can read own picks anytime" ON picks;
DROP POLICY IF EXISTS "Users can read all picks after lock" ON picks;
DROP POLICY IF EXISTS "Users can insert their own picks" ON picks;
DROP POLICY IF EXISTS "Users can update their own picks" ON picks;
DROP POLICY IF EXISTS "Users can read their own three_best" ON three_best;
DROP POLICY IF EXISTS "Users can read all three_best" ON three_best;
DROP POLICY IF EXISTS "Users can read own three_best anytime" ON three_best;
DROP POLICY IF EXISTS "Users can read all three_best after lock" ON three_best;
DROP POLICY IF EXISTS "Users can insert their own three_best" ON three_best;
DROP POLICY IF EXISTS "Users can update their own three_best" ON three_best;
DROP POLICY IF EXISTS "Users can read all scores" ON scores;
DROP POLICY IF EXISTS "Users can read all player_managers" ON player_managers;

-- Drop tables (order matters due to foreign keys)
DROP TABLE IF EXISTS player_managers CASCADE;
DROP TABLE IF EXISTS scores CASCADE;
DROP TABLE IF EXISTS three_best CASCADE;
DROP TABLE IF EXISTS picks CASCADE;
DROP TABLE IF EXISTS games CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Drop functions
DROP FUNCTION IF EXISTS is_week_locked(INTEGER, INTEGER);

-- =====================
-- 2. CREATE TABLES
-- =====================

-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE,
  name VARCHAR(255) NOT NULL,
  is_managed BOOLEAN DEFAULT false,
  is_manager BOOLEAN DEFAULT false,
  is_admin BOOLEAN DEFAULT false,
  email_recipient BOOLEAN DEFAULT false,
  avatar_url TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Games table
CREATE TABLE games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week INTEGER NOT NULL,
  away_team VARCHAR(50) NOT NULL,
  home_team VARCHAR(50) NOT NULL,
  kickoff_time TIMESTAMP NOT NULL,
  season INTEGER NOT NULL,
  winning_team VARCHAR(50),
  away_score INTEGER,
  home_score INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(week, away_team, home_team, season)
);

-- Picks table
CREATE TABLE picks (
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
CREATE TABLE three_best (
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

-- Scores table
CREATE TABLE scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  is_correct BOOLEAN,
  week INTEGER NOT NULL,
  season INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, game_id)
);

-- Player Managers linking table
CREATE TABLE player_managers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(manager_id, player_id)
);

-- =====================
-- 3. ENABLE RLS
-- =====================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE three_best ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_managers ENABLE ROW LEVEL SECURITY;

-- =====================
-- 4. HELPER FUNCTIONS
-- =====================

-- Returns TRUE if any game in the given week has kicked off
CREATE OR REPLACE FUNCTION is_week_locked(p_week INTEGER, p_season INTEGER)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM games
    WHERE week = p_week AND season = p_season
    AND kickoff_time <= NOW()
  );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- =====================
-- 5. RLS POLICIES
-- =====================

-- Users
CREATE POLICY "Users can read all users" ON users FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile" ON users FOR INSERT WITH CHECK (auth.uid() = id);

-- Games
CREATE POLICY "Users can read all games" ON games FOR SELECT USING (true);

-- Picks (locked visibility)
CREATE POLICY "Users can read own picks anytime"
  ON picks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can read all picks after lock"
  ON picks FOR SELECT USING (is_week_locked(week, season));
CREATE POLICY "Users can insert their own picks"
  ON picks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own picks"
  ON picks FOR UPDATE USING (auth.uid() = user_id);

-- Three Best (locked visibility)
CREATE POLICY "Users can read own three_best anytime"
  ON three_best FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can read all three_best after lock"
  ON three_best FOR SELECT USING (is_week_locked(week, season));
CREATE POLICY "Users can insert their own three_best"
  ON three_best FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own three_best"
  ON three_best FOR UPDATE USING (auth.uid() = user_id);

-- Scores
CREATE POLICY "Users can read all scores" ON scores FOR SELECT USING (true);

-- Player Managers
CREATE POLICY "Users can read all player_managers" ON player_managers FOR SELECT USING (true);

-- =====================
-- 6. PERFORMANCE INDEXES
-- =====================

CREATE INDEX idx_picks_user_season ON picks(user_id, season);
CREATE INDEX idx_picks_week_season ON picks(week, season);
CREATE INDEX idx_scores_user_season ON scores(user_id, season);
CREATE INDEX idx_scores_week_season ON scores(week, season);
CREATE INDEX idx_games_week_season ON games(week, season);
CREATE INDEX idx_games_kickoff ON games(kickoff_time);
CREATE INDEX idx_three_best_week_season ON three_best(week, season);

-- =====================
-- 7. STORAGE (avatars)
-- =====================
-- Uncomment and run these if you need to recreate the avatars storage bucket.
-- If the bucket already exists, skip this section.

-- INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true);

-- CREATE POLICY "Users can upload own avatar" ON storage.objects
--   FOR INSERT WITH CHECK (
--     bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]
--   );

-- CREATE POLICY "Users can update own avatar" ON storage.objects
--   FOR UPDATE USING (
--     bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]
--   );

-- CREATE POLICY "Users can delete own avatar" ON storage.objects
--   FOR DELETE USING (
--     bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]
--   );

-- CREATE POLICY "Public avatar read access" ON storage.objects
--   FOR SELECT USING (bucket_id = 'avatars');
