-- Migration: Add cron_log table for tracking sent cron notifications
-- Prevents duplicate emails when Vercel retries cron invocations

CREATE TABLE IF NOT EXISTS cron_log (
  id SERIAL PRIMARY KEY,
  week INTEGER NOT NULL,
  season INTEGER NOT NULL,
  warning_type TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(week, season, warning_type)
);
