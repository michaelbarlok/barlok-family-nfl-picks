-- Let a manager read the picks they make on someone else's behalf.
--
-- The read rule on picks and three_best is "your own rows, or everyone's once
-- the week locks". A manager's uid never matches their player's user_id, so
-- before lock they got nothing back — meaning someone who picks for a managed
-- player could save those picks (writes go through the service role in
-- /api/proxy-picks) and then see an empty card, with no way to check or change
-- them until the week locked.
--
-- These policies are additive: they widen the read to rows belonging to players
-- the caller actually manages, and nothing else. Everyone else's picks stay
-- hidden until lock exactly as before.

CREATE POLICY "Managers can read their players' picks"
  ON picks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM player_managers pm
      WHERE pm.player_id = picks.user_id
        AND pm.manager_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Managers can read their players' three_best"
  ON three_best FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM player_managers pm
      WHERE pm.player_id = three_best.user_id
        AND pm.manager_id = (SELECT auth.uid())
    )
  );
