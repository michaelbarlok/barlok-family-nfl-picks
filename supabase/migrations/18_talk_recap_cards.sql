-- Weekly recap cards in 💩 Talk, plus tracking that a recap reached the thread.
--
-- A talk_messages row with recap_week set is a recap card rather than a chat
-- line: the thread renders it as a tappable summary that opens the full recap
-- page. body still holds a plain-text fallback (for the push notification, for
-- the check constraint, and for any client that doesn't know the card yet).

ALTER TABLE talk_messages ADD COLUMN IF NOT EXISTS recap_season INTEGER;
ALTER TABLE talk_messages ADD COLUMN IF NOT EXISTS recap_week INTEGER;

-- weekly_digests (migration 17) recorded the email send. Track the Talk post
-- separately so email and the chat card can each be done once, independently.
ALTER TABLE weekly_digests ADD COLUMN IF NOT EXISTS talk_posted_at TIMESTAMPTZ;

-- Safe to run more than once.

-- sent_at recorded the email time and was NOT NULL DEFAULT NOW(). Now that a
-- recap can reach Talk without an email, a Talk-only row must be able to leave
-- sent_at empty rather than defaulting to "emailed just now" — otherwise the
-- email guard would think an email had gone out. Make it nullable with no
-- default; the email path always sets it explicitly.
ALTER TABLE weekly_digests ALTER COLUMN sent_at DROP DEFAULT;
ALTER TABLE weekly_digests ALTER COLUMN sent_at DROP NOT NULL;
