-- Let a deleted 💩 Talk message actually be deleted.
--
-- Migration 13 required every message to have a body or an image. Deleting is
-- a soft delete that clears both (so nothing deleted is ever shown again) and
-- stamps deleted_at — which that constraint rejects. Postgres refused every
-- delete, the API didn't check, and the message simply stayed. Deleting has
-- never worked; this makes it work.
--
-- The rule is unchanged for live messages: a message nobody has deleted still
-- needs a body or an image.

ALTER TABLE talk_messages DROP CONSTRAINT IF EXISTS talk_message_has_content;
ALTER TABLE talk_messages ADD CONSTRAINT talk_message_has_content CHECK (
  deleted_at IS NOT NULL
  OR (body IS NOT NULL AND length(trim(body)) > 0)
  OR image_url IS NOT NULL
);

-- Safe to run more than once.
