-- Bowl Pick'em, part 3: its own Talk, notifications and reminders.
--
-- Bowl tables only — the NFL's Talk, push and reminder tables are untouched.
-- Bowl Talk is a thread of its own: NFL players don't see it in NFL Talk and
-- bowl players don't see NFL Talk.
--
-- A phone has one push registration for the whole site, so a device that has
-- notifications on for both pick'ems appears in both the NFL's table and this
-- one, each holding its own choices.
--
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS bowl_talk_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES bowl_players(id) ON DELETE SET NULL,
  author_name VARCHAR(255) NOT NULL,          -- a snapshot, so the thread reads the same later
  body TEXT,
  image_url TEXT,
  reply_to_id UUID REFERENCES bowl_talk_messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT bowl_talk_has_content CHECK (
    deleted_at IS NOT NULL OR (body IS NOT NULL AND length(trim(body)) > 0) OR image_url IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS idx_bowl_talk_created ON bowl_talk_messages (created_at DESC);

CREATE TABLE IF NOT EXISTS bowl_talk_mentions (
  message_id UUID NOT NULL REFERENCES bowl_talk_messages(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES bowl_players(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, player_id)
);

CREATE TABLE IF NOT EXISTS bowl_talk_reactions (
  message_id UUID NOT NULL REFERENCES bowl_talk_messages(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES bowl_players(id) ON DELETE CASCADE,
  reaction TEXT NOT NULL CHECK (reaction IN ('heart', 'thumbs_up', 'poop', 'laugh')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, player_id, reaction)
);

-- When each player last read the thread, for the unread count.
CREATE TABLE IF NOT EXISTS bowl_talk_reads (
  player_id UUID PRIMARY KEY REFERENCES bowl_players(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Devices that get bowl notifications, and which kinds.
CREATE TABLE IF NOT EXISTS bowl_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES bowl_players(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  reminders_enabled BOOLEAN NOT NULL DEFAULT true,
  talk_enabled BOOLEAN NOT NULL DEFAULT false,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

-- Reminder emails: on unless a player turns them off.
ALTER TABLE bowl_players ADD COLUMN IF NOT EXISTS email_reminders BOOLEAN NOT NULL DEFAULT true;

-- Which reminders have gone out each season, so each is sent once.
CREATE TABLE IF NOT EXISTS bowl_reminder_log (
  season INTEGER NOT NULL REFERENCES bowl_seasons(season) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recipients INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (season, kind)
);

ALTER TABLE bowl_talk_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE bowl_talk_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bowl_talk_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bowl_talk_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE bowl_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bowl_reminder_log ENABLE ROW LEVEL SECURITY;

-- Messages and reactions are readable so the page can hear about new ones the
-- moment they're posted. Everything is written by the server.
DROP POLICY IF EXISTS "Signed-in users can read bowl_talk_messages" ON bowl_talk_messages;
CREATE POLICY "Signed-in users can read bowl_talk_messages" ON bowl_talk_messages
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Signed-in users can read bowl_talk_reactions" ON bowl_talk_reactions;
CREATE POLICY "Signed-in users can read bowl_talk_reactions" ON bowl_talk_reactions
  FOR SELECT TO authenticated USING (true);
-- Mentions, reads, devices and the reminder log: no policies — server only.

-- Live updates for the bowl thread. Guarded: adding a table that's already in
-- the publication is an error.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'bowl_talk_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE bowl_talk_messages;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'bowl_talk_reactions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE bowl_talk_reactions;
  END IF;
END $$;
