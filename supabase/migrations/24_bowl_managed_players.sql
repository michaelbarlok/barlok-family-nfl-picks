-- Bowl Pick'em: managed players — kids and anyone else without a phone or a
-- login, whose picks someone else makes (like Dani and Maddie on the NFL side).
--
-- Bowl tables only. A managed bowl player has no login: their id is just an
-- id (for one brought over from the NFL side, the same id their NFL profile
-- has, so their NFL managers carry over). bowl_player_managers says who may
-- make their picks; the bowl admin sets it.
--
-- Read and written only by the server (service role) — no client policies.
--
-- Safe to run more than once.

ALTER TABLE bowl_players ADD COLUMN IF NOT EXISTS is_managed BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS bowl_player_managers (
  manager_id UUID NOT NULL REFERENCES bowl_players(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES bowl_players(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (manager_id, player_id),
  CHECK (manager_id <> player_id)
);
CREATE INDEX IF NOT EXISTS idx_bowl_player_managers_player ON bowl_player_managers (player_id);

ALTER TABLE bowl_player_managers ENABLE ROW LEVEL SECURITY;
