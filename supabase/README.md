# Supabase

## Layout

- `migrations/` — incremental schema changes, applied in filename order.
  These were historically loose SQL files at the repo root; they've been
  renumbered to reflect the order they were applied. For a brand-new
  Supabase project, run them in order in the SQL Editor.
- `reset_schema.sql` — destructive: drops and recreates the full schema
  while preserving the `users` and `player_managers` tables. Use only for
  intentional resets.
- `seed_week1_2025.sql` — one-off seed of Week 1 2025 games (kept for
  history; not part of the migration sequence).

## Notes

- The `database.sql` file referenced in `QUICKSTART.md` is now at
  `supabase/migrations/00_initial_schema.sql`.
- Storage bucket policies for `avatars` are commented at the bottom of
  `reset_schema.sql` — uncomment when bootstrapping a fresh project.
