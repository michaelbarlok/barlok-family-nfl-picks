-- Per-player grace period for late picks.
--
-- Lets an admin reopen picks for ONE player in ONE week after the week has
-- locked, for a fixed window. Everyone else stays locked — the grant is keyed
-- to (user, week, season), never to the week alone.
--
-- The clock starts when the admin grants it, not at kickoff, so expires_at is
-- stored absolute rather than derived. Granting again for the same player and
-- week restarts the window.

CREATE TABLE IF NOT EXISTS pick_grace (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week INTEGER NOT NULL,
  season INTEGER NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, week, season)
);

ALTER TABLE pick_grace ENABLE ROW LEVEL SECURITY;

-- Readable by everyone: the player needs to see their own window, and the rest
-- of the league seeing that someone was given extra time is a feature, not a
-- leak. Writes are service-role only (no INSERT/UPDATE/DELETE policy), so a
-- grant can only come from the admin API route.
DROP POLICY IF EXISTS "Users can read all pick_grace" ON pick_grace;
CREATE POLICY "Users can read all pick_grace" ON pick_grace FOR SELECT USING (true);

CREATE INDEX IF NOT EXISTS idx_pick_grace_week_season ON pick_grace(week, season);
CREATE INDEX IF NOT EXISTS idx_pick_grace_granted_by ON pick_grace(granted_by);
