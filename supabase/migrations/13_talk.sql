-- 💩 Talk: one running thread for the whole league.
--
-- Deliberately a single thread with no direct messaging — every message is
-- visible to every player, and nothing expires. Messages carry the author's
-- name as a snapshot so a thread stays readable if an account is later removed.

CREATE TABLE IF NOT EXISTS talk_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  author_name VARCHAR(255) NOT NULL,
  body TEXT,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT talk_message_has_content CHECK (
    (body IS NOT NULL AND length(trim(body)) > 0) OR image_url IS NOT NULL
  )
);

-- Who was tagged, so they can be notified and the mention can be highlighted.
CREATE TABLE IF NOT EXISTS talk_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES talk_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(message_id, user_id)
);

-- Last time each player opened the thread, for the unread count.
CREATE TABLE IF NOT EXISTS talk_reads (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Web Push registrations, one row per browser/device.
-- talk_enabled is opt-in and defaults to false: notifications for the thread
-- are a choice, unlike anything else in the app.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  talk_enabled BOOLEAN NOT NULL DEFAULT false,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

ALTER TABLE talk_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE talk_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE talk_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Everyone reads the thread. Writes go through the API on the service role, so
-- that posting, recording mentions and sending notifications happen together.
DROP POLICY IF EXISTS "Users can read all talk_messages" ON talk_messages;
CREATE POLICY "Users can read all talk_messages" ON talk_messages FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can read all talk_mentions" ON talk_mentions;
CREATE POLICY "Users can read all talk_mentions" ON talk_mentions FOR SELECT USING (true);

-- Read state is per person and carries nothing privileged, so it is the one
-- table a player writes directly.
DROP POLICY IF EXISTS "Users can read own talk_reads" ON talk_reads;
CREATE POLICY "Users can read own talk_reads" ON talk_reads FOR SELECT
  USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users can insert own talk_reads" ON talk_reads;
CREATE POLICY "Users can insert own talk_reads" ON talk_reads FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users can update own talk_reads" ON talk_reads;
CREATE POLICY "Users can update own talk_reads" ON talk_reads FOR UPDATE
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can read own push subscriptions" ON push_subscriptions;
CREATE POLICY "Users can read own push subscriptions" ON push_subscriptions FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

CREATE INDEX IF NOT EXISTS idx_talk_messages_created ON talk_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_talk_mentions_user ON talk_mentions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

INSERT INTO storage.buckets (id, name, public)
VALUES ('talk-images', 'talk-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public talk image read access" ON storage.objects;
CREATE POLICY "Public talk image read access" ON storage.objects
  FOR SELECT USING (bucket_id = 'talk-images');

-- Live updates need the table published for realtime. Guarded because adding a
-- table that is already in the publication is an error, and this file is meant
-- to be re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'talk_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE talk_messages;
  END IF;
END $$;

-- Safe to run more than once.
