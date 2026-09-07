-- Quote replies on 💩 Talk.
--
-- A single self-reference, not a thread: a reply points at the message it
-- answers and renders a quote of it inline, exactly where it was posted. The
-- thread stays one flat conversation, which is the whole premise of Talk.
--
-- ON DELETE SET NULL rather than CASCADE. Deleting a message must not take the
-- replies to it with it — they are other people's words. The quote falls back
-- to "Message deleted" instead.

ALTER TABLE talk_messages
  ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES talk_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_talk_messages_reply_to ON talk_messages(reply_to_id);

-- Safe to run more than once.
