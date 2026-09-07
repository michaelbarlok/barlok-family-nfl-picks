-- Emoji reactions on 💩 Talk messages.
--
-- The column stores a short ASCII code, not the emoji itself. A CHECK
-- constraint is the thing that makes it safe to let the browser write this
-- table directly, and an emoji constraint would have to survive being pasted
-- through a SQL editor, a psql client and a JS source file with its variation
-- selectors intact — '❤️' is two code points, and losing U+FE0F turns every
-- insert into a constraint violation. Codes can't drift; the UI owns the
-- mapping (see lib/reactions.ts).
--
-- Four reactions, deliberately. A fixed set keeps the row under a message to
-- one line and means there is no picker to design.

CREATE TABLE IF NOT EXISTS talk_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES talk_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One of each per person per message; tapping again deletes the row.
  UNIQUE(message_id, user_id, reaction),
  CONSTRAINT talk_reaction_allowed CHECK (reaction IN ('heart', 'thumbs_up', 'poop', 'laugh'))
);

ALTER TABLE talk_reactions ENABLE ROW LEVEL SECURITY;

-- Unlike talk_messages, this one is written straight from the browser. It can
-- be: a reaction carries nothing privileged, the CHECK constraint bounds what
-- may be stored, and the policies below bound whose name can be on it. Routing
-- it through the API would only add a round trip to a button that has to feel
-- instant.
DROP POLICY IF EXISTS "Users can read all talk_reactions" ON talk_reactions;
CREATE POLICY "Users can read all talk_reactions" ON talk_reactions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can add own talk_reactions" ON talk_reactions;
CREATE POLICY "Users can add own talk_reactions" ON talk_reactions FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can remove own talk_reactions" ON talk_reactions;
CREATE POLICY "Users can remove own talk_reactions" ON talk_reactions FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

CREATE INDEX IF NOT EXISTS idx_talk_reactions_message ON talk_reactions(message_id);

-- Live updates, same as talk_messages. Guarded because adding a table already
-- in the publication is an error and this file is meant to be re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'talk_reactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE talk_reactions;
  END IF;
END $$;

-- Safe to run more than once.
