-- Bowl Pick'em: a join link the bowl admin can share (Admin › Players › Share).
--
-- One private code per season. Anyone with the link can join that season
-- until its picks lock: someone new gives their name and email and gets the
-- same "set your password" email an invite sends; an NFL player or a past
-- bowl player signs in and joins. Resetting the link makes a new code, and
-- the old link stops working.
--
-- Bowl tables only. Read and written only by the server (service role) — no
-- client policies, so the code can't be read from the browser.
--
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS bowl_join_links (
  season INTEGER PRIMARY KEY REFERENCES bowl_seasons(season) ON DELETE CASCADE,
  code VARCHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE bowl_join_links ENABLE ROW LEVEL SECURITY;
