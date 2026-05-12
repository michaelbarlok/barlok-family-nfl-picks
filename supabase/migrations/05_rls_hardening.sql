-- RLS Hardening Migration
-- Restricts picks/three_best visibility so users can only see their own picks
-- before games lock. After the earliest kickoff of a week, all picks become visible.
--
-- NOTE: This uses a function to check lock time. The app frontend already enforces
-- this (all-picks.tsx shows only submission status before lock), but this adds
-- database-level enforcement as defense-in-depth.

-- Helper function: returns TRUE if the given week is locked (earliest kickoff has passed)
CREATE OR REPLACE FUNCTION is_week_locked(p_week INTEGER, p_season INTEGER)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM games
    WHERE week = p_week AND season = p_season
    AND kickoff_time <= NOW()
  );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Drop old permissive policies on picks
DROP POLICY IF EXISTS "Users can read their own picks" ON picks;
DROP POLICY IF EXISTS "Users can read all picks" ON picks;

-- Users can always read their own picks; other users' picks only after lock
CREATE POLICY "Users can read own picks anytime"
  ON picks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can read all picks after lock"
  ON picks FOR SELECT
  USING (is_week_locked(week, season));

-- Drop old permissive policies on three_best
DROP POLICY IF EXISTS "Users can read their own three_best" ON three_best;
DROP POLICY IF EXISTS "Users can read all three_best" ON three_best;

-- Same pattern for three_best
CREATE POLICY "Users can read own three_best anytime"
  ON three_best FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can read all three_best after lock"
  ON three_best FOR SELECT
  USING (is_week_locked(week, season));

-- Add performance indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_picks_user_season ON picks(user_id, season);
CREATE INDEX IF NOT EXISTS idx_picks_week_season ON picks(week, season);
CREATE INDEX IF NOT EXISTS idx_scores_user_season ON scores(user_id, season);
CREATE INDEX IF NOT EXISTS idx_scores_week_season ON scores(week, season);
CREATE INDEX IF NOT EXISTS idx_games_week_season ON games(week, season);
CREATE INDEX IF NOT EXISTS idx_games_kickoff ON games(kickoff_time);
CREATE INDEX IF NOT EXISTS idx_three_best_week_season ON three_best(week, season);
