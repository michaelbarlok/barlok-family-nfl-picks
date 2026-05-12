-- Lock down the is_week_locked helper:
--   - Pin search_path so a malicious caller can't shadow `games` or NOW().
--   - Switch from SECURITY DEFINER to SECURITY INVOKER. The function only
--     reads games.kickoff_time, which is publicly readable via RLS, so it
--     never needed elevated permissions.
CREATE OR REPLACE FUNCTION is_week_locked(p_week INTEGER, p_season INTEGER)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM games
    WHERE week = p_week AND season = p_season
    AND kickoff_time <= NOW()
  );
$$;
