-- Add score columns to the games table so final scores can be displayed.
-- Run this in the Supabase SQL Editor.

ALTER TABLE games ADD COLUMN IF NOT EXISTS away_score INTEGER;
ALTER TABLE games ADD COLUMN IF NOT EXISTS home_score INTEGER;
