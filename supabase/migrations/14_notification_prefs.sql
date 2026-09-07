-- Notification preferences.
--
-- These live on users rather than a side table because they are per person:
-- an email reaches you wherever you read mail, and a pick reminder is about
-- you, not about the device in your hand. 💩 Talk is the exception and stays
-- on push_subscriptions.talk_enabled — a phone and a laptop can reasonably
-- want different answers for a chat thread.
--
-- Both default true. A pick reminder is the app doing the job it exists for,
-- so it is opt-out; 💩 Talk stays opt-in (talk_enabled defaults false).
--
-- Deliberately NOT reusing email_recipient. That flag drives the weekly picks
-- spreadsheet and is curated by an admin from the Results tab; a player muting
-- reminder emails should not quietly drop themselves off the spreadsheet list,
-- and vice versa.

ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_picks_email BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_picks_push  BOOLEAN NOT NULL DEFAULT true;

-- No UPDATE policy is added here on purpose. users has SELECT and INSERT only,
-- because RLS cannot restrict which columns an UPDATE touches — a policy
-- permissive enough to let a player set notify_picks_email would also let them
-- set is_admin. Preference writes go through /api/notification-prefs on the
-- service role, which whitelists the three columns a player may change.

-- Safe to run more than once.
