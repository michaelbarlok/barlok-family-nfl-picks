-- Managed Players Migration
-- Adds support for users who don't have their own accounts
-- and are managed by other users (proxy picks).

-- Flag to distinguish managed players from account holders
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_managed BOOLEAN DEFAULT false;

-- Flag to allow a user to create/manage players (admin grants this)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_manager BOOLEAN DEFAULT false;

-- Make email nullable for managed players (they don't have accounts)
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

-- Linking table: which account holder manages which player
CREATE TABLE IF NOT EXISTS player_managers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(manager_id, player_id)
);

-- RLS
ALTER TABLE player_managers ENABLE ROW LEVEL SECURITY;

-- Everyone can read manager relationships (needed to display managed player names)
CREATE POLICY "Users can read all player_managers"
  ON player_managers FOR SELECT USING (true);

-- Only service role inserts/updates/deletes (via API)
-- No user-level insert/update/delete policies needed since APIs use service role key
