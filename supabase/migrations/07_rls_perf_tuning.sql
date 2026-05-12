-- Performance tuning from Supabase advisor (run 2026-05-12).
--
-- Three fixes:
--   1. Add covering indexes for foreign keys that didn't have them.
--   2. Wrap auth.uid() in (SELECT auth.uid()) so it evaluates once per
--      query instead of once per row.
--   3. Consolidate the two SELECT policies on picks/three_best into a
--      single policy with OR — having two permissive policies meant
--      both ran for every query.

-- Fix 1: missing FK indexes
CREATE INDEX IF NOT EXISTS idx_picks_game_id ON picks(game_id);
CREATE INDEX IF NOT EXISTS idx_scores_game_id ON scores(game_id);
CREATE INDEX IF NOT EXISTS idx_player_managers_player_id ON player_managers(player_id);

-- Fix 2 + 3: picks policies
DROP POLICY IF EXISTS "Users can read own picks anytime" ON picks;
DROP POLICY IF EXISTS "Users can read all picks after lock" ON picks;
CREATE POLICY "Users can read picks (own anytime, all after lock)"
  ON picks FOR SELECT
  USING ((SELECT auth.uid()) = user_id OR is_week_locked(week, season));

DROP POLICY IF EXISTS "Users can insert their own picks" ON picks;
CREATE POLICY "Users can insert their own picks"
  ON picks FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own picks" ON picks;
CREATE POLICY "Users can update their own picks"
  ON picks FOR UPDATE USING ((SELECT auth.uid()) = user_id);

-- Fix 2 + 3: three_best policies
DROP POLICY IF EXISTS "Users can read own three_best anytime" ON three_best;
DROP POLICY IF EXISTS "Users can read all three_best after lock" ON three_best;
CREATE POLICY "Users can read three_best (own anytime, all after lock)"
  ON three_best FOR SELECT
  USING ((SELECT auth.uid()) = user_id OR is_week_locked(week, season));

DROP POLICY IF EXISTS "Users can insert their own three_best" ON three_best;
CREATE POLICY "Users can insert their own three_best"
  ON three_best FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own three_best" ON three_best;
CREATE POLICY "Users can update their own three_best"
  ON three_best FOR UPDATE USING ((SELECT auth.uid()) = user_id);

-- Fix 2: users insert policy
DROP POLICY IF EXISTS "Users can insert their own profile" ON users;
CREATE POLICY "Users can insert their own profile"
  ON users FOR INSERT WITH CHECK ((SELECT auth.uid()) = id);
