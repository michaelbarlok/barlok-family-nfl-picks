-- The weekly recap email.
--
-- Two pieces: who wants it, and which weeks have already gone out.
--
-- A separate opt-out from notify_picks_email on purpose. "Get your picks in"
-- and "here's how the week went" are different enough that muting the nag
-- should not also cost you the recap.

ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_digest_email BOOLEAN NOT NULL DEFAULT true;

-- One row per week that has been sent, so the send is idempotent: whatever
-- triggers it — an admin button, a cron that noticed the week finished, a
-- second sync of the same week — the league gets one email.
CREATE TABLE IF NOT EXISTS weekly_digests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recipients INTEGER NOT NULL DEFAULT 0,
  UNIQUE(season, week)
);

ALTER TABLE weekly_digests ENABLE ROW LEVEL SECURITY;

-- Readable so the admin UI can say "already sent". Writes go through the API
-- on the service role.
DROP POLICY IF EXISTS "Users can read all weekly_digests" ON weekly_digests;
CREATE POLICY "Users can read all weekly_digests" ON weekly_digests FOR SELECT USING (true);

-- Safe to run more than once.
