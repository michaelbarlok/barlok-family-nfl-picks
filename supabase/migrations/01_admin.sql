-- Run this in Supabase SQL Editor before deploying the admin features.
-- Adds a winning_team column to the games table so results can be stored.

ALTER TABLE games ADD COLUMN IF NOT EXISTS winning_team VARCHAR(50);

-- Allow the service role (used by admin API routes) to update games.
-- This is handled automatically by the service role key bypassing RLS,
-- so no additional policy is needed. The anon/user roles still cannot update games.
