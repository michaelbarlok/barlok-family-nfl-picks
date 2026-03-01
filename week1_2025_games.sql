-- NFL 2025 Season - Week 1 Games
-- Run this in your Supabase SQL Editor to populate Week 1 games

INSERT INTO games (away_team, home_team, week, season, kickoff_time) VALUES
  -- Thursday, September 4
  ('DAL', 'PHI', 1, 2025, '2025-09-05T00:20:00Z'),  -- 8:20 PM ET Thu

  -- Friday, September 5 (Brazil game)
  ('LAC', 'KC',  1, 2025, '2025-09-06T00:00:00Z'),  -- 8:00 PM ET Fri

  -- Sunday, September 7 - 1:00 PM ET
  ('PIT', 'NYJ', 1, 2025, '2025-09-07T17:00:00Z'),
  ('MIA', 'IND', 1, 2025, '2025-09-07T17:00:00Z'),
  ('TB',  'ATL', 1, 2025, '2025-09-07T17:00:00Z'),
  ('LV',  'NE',  1, 2025, '2025-09-07T17:00:00Z'),
  ('ARI', 'NO',  1, 2025, '2025-09-07T17:00:00Z'),
  ('CIN', 'CLE', 1, 2025, '2025-09-07T17:00:00Z'),
  ('NYG', 'WAS', 1, 2025, '2025-09-07T17:00:00Z'),
  ('CAR', 'JAC', 1, 2025, '2025-09-07T17:00:00Z'),

  -- Sunday, September 7 - 4:05 PM ET
  ('TEN', 'DEN', 1, 2025, '2025-09-07T20:05:00Z'),
  ('SF',  'SEA', 1, 2025, '2025-09-07T20:05:00Z'),

  -- Sunday, September 7 - 4:25 PM ET
  ('HOU', 'LAR', 1, 2025, '2025-09-07T20:25:00Z'),
  ('DET', 'GB',  1, 2025, '2025-09-07T20:25:00Z'),

  -- Sunday Night Football - 8:20 PM ET
  ('BAL', 'BUF', 1, 2025, '2025-09-08T00:20:00Z'),

  -- Monday Night Football - 8:15 PM ET
  ('MIN', 'CHI', 1, 2025, '2025-09-09T00:15:00Z');
