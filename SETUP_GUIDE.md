# Barlok Family NFL Picks - Complete Setup Guide

## Overview

A Next.js application for managing NFL pick predictions in a family league, deployed on Vercel with Supabase.

## STEP 1: Set Up Supabase Database

1. Go to your Supabase project: https://supabase.com
2. On the left sidebar, click **SQL Editor**
3. Click **"New Query"**
4. Copy ALL the SQL code from `database.sql`
5. Paste it into the SQL Editor and click **Run**
6. Then run `database_managed_players.sql` and `admin_migration.sql` the same way

**What this does**: Creates all your database tables (users, games, picks, three_best, scores, player_managers)

---

## STEP 2: Deploy to Vercel

1. Push your code to a GitHub repository
2. Go to https://vercel.com and click **"New Project"**
3. Import your Git repository
4. Add these environment variables (see `.env.example` for the full list):
   - `NEXT_PUBLIC_SUPABASE_URL` = your Supabase project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = your Supabase anon key
   - `SUPABASE_SERVICE_ROLE_KEY` = your Supabase service role key
   - `GMAIL_ADDRESS` = your Gmail address
   - `GMAIL_APP_PASSWORD` = your Gmail App Password (see below)
5. Click **"Deploy"**

### Gmail App Password Setup

1. Go to https://myaccount.google.com/security
2. Enable **2-Step Verification** if not already on
3. Go to https://myaccount.google.com/apppasswords
4. Create an app password named "NFL Picks"
5. Copy the 16-character password (remove spaces)
6. Use this as `GMAIL_APP_PASSWORD` in Vercel

---

## STEP 3: Enable Email/Password Authentication in Supabase

1. Go to your Supabase project
2. Click **Authentication** > **Providers**
3. Toggle **Email** to **ON**
4. Disable **"Confirm email"** (makes onboarding easier)
5. Click **Save**

---

## STEP 4: Create Your Admin Account

1. Go to your deployed site
2. Sign up with the email matching `ADMIN_EMAIL` in `lib/constants.ts`
3. You'll have access to the Admin panel

---

## STEP 5: Add NFL Games

Games can be loaded from the Admin panel using **Sync Schedule** (pulls from ESPN API), or manually via Supabase SQL Editor:

```sql
INSERT INTO games (away_team, home_team, week, season, kickoff_time) VALUES
  ('KC', 'DAL', 1, 2025, '2025-09-07T20:20:00Z');
```

---

## STEP 6: Add League Members

In Supabase SQL Editor:

```sql
INSERT INTO users (email, name) VALUES
('person1@email.com', 'Person 1'),
('person2@email.com', 'Person 2');
```

Then send them the site URL and have them sign up with their email.

---

## Weekly Workflow

1. Games are loaded for the week (via Sync Schedule or manually)
2. Everyone submits their picks before Thursday kickoff
3. After games finish, hit **Sync Week** on the Admin page to pull results from ESPN
4. Hit **Send Email** to email the spreadsheet to all participants
5. Standings update automatically

---

## Troubleshooting

**Login doesn't work**
- Make sure Email provider is enabled in Supabase Authentication
- Check that user exists in `users` table

**Picks page blank**
- You need to add games to the `games` table first

**Email sending fails**
- Check `GMAIL_ADDRESS` and `GMAIL_APP_PASSWORD` are set in Vercel
- Make sure 2-Step Verification is enabled on your Google account

**Sync not pulling results**
- ESPN only reports completed games; in-progress games are skipped
- Try syncing again after all games have finished
