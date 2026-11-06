-- Bowl Pick'em: team nicknames ("Tennessee" + "Volunteers").
--
-- Bowl table only. Filled from ESPN on the next "Pull from ESPN" (and by
-- "Fill sample teams"). Until this runs, games are saved without nicknames
-- and the pick'em shows just the school, as before.
--
-- Safe to run more than once.

ALTER TABLE bowl_games ADD COLUMN IF NOT EXISTS away_nickname VARCHAR(100);
ALTER TABLE bowl_games ADD COLUMN IF NOT EXISTS home_nickname VARCHAR(100);
