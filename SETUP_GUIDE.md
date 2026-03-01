# Barlok Family NFL Picks - Complete Setup Guide

## Overview

You now have a complete Next.js application ready to deploy. Here's exactly what to do, step by step.

## STEP 1: Set Up Supabase Database (10 minutes)

1. Go to your Supabase project: https://supabase.com
2. On the left sidebar, click **SQL Editor** (bottom section)
3. Click **"New Query"** button
4. Copy ALL the SQL code from the `database.sql` file
5. Paste it into the SQL Editor
6. Click the **"Run"** button (or press Ctrl+Enter)
7. Wait for the query to complete (you'll see a success message)

**What this does**: Creates all your database tables (users, games, picks, three_best, scores)

---

## STEP 2: Create GitHub Repository (5 minutes)

1. Go to https://github.com
2. Click **"+"** in the top right → **"New repository"**
3. Name it: `barlok-nfl-picks`
4. Click **"Create repository"** (don't initialize with anything)
5. You'll see instructions. Follow these:
   ```bash
   # In your terminal:
   git clone https://github.com/YOUR_USERNAME/barlok-nfl-picks.git
   cd barlok-nfl-picks
   ```

---

## STEP 3: Add Project Files (2 minutes)

1. You should have downloaded all the project files I created
2. Copy all of them into your `barlok-nfl-picks` folder
3. In your terminal:
   ```bash
   git add .
   git commit -m "Initial commit"
   git push origin main
   ```

The `.env.local` file already has your Supabase and Resend keys.

---

## STEP 4: Deploy to Vercel (5 minutes)

1. Go to https://vercel.com
2. Click **"New Project"**
3. Click **"Import Git Repository"**
4. Paste your repo URL: `https://github.com/YOUR_USERNAME/barlok-nfl-picks`
5. Click **"Import"**
6. You'll see environment variables section. Add these:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://urbsiukiolwryszbigre.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = (your anon key - already in .env.local)
   - `RESEND_API_KEY` = `re_JZ2yPKfR_EfsCpQRU51UpN1UPGsdpVLFe`
7. Click **"Deploy"**
8. Wait 2-3 minutes for deployment
9. You'll get a URL like `https://barlok-nfl-picks.vercel.app`

**Your site is now live!**

---

## STEP 5: Enable Email/Password Authentication in Supabase (3 minutes)

1. Go to your Supabase project
2. On left sidebar, click **Authentication**
3. Click **"Providers"**
4. Find **"Email"** and toggle it **ON**
5. Under Email settings, find **"Confirm email"** and toggle it **OFF** (makes testing easier)
6. Click **"Save"**

---

## STEP 6: Add Your First Test User (2 minutes)

You have two options:

**Option A: Use the app itself**
1. Go to your Vercel URL (e.g., `https://barlok-nfl-picks.vercel.app`)
2. Click login
3. Create account with:
   - Email: `barlokmichael@gmail.com`
   - Password: (any password)
   - Name: `Michael`

**Option B: Use Supabase directly** (for testing, doesn't create auth account):
1. Go to Supabase
2. Click **"SQL Editor"**
3. Run:
   ```sql
   INSERT INTO users (email, name) VALUES ('barlokmichael@gmail.com', 'Michael');
   ```

Then log in with that email/password.

---

## STEP 7: Add NFL Games (5 minutes per week)

1. Go to your Supabase project
2. Click **"Table Editor"** (left sidebar)
3. Click the **"games"** table
4. Click **"Insert"** → **"New row"**
5. Fill in:
   - `away_team`: e.g., "KC"
   - `home_team`: e.g., "DAL"
   - `kickoff_time`: e.g., "2025-09-07T20:20:00Z"
   - `week`: e.g., 1
   - `season`: 2025

Repeat for all games in the week.

---

## STEP 8: Send Weekly Picks Email (1 minute)

When you want to email the spreadsheet to all participants:

**Using cURL** (easiest):
```bash
curl -X POST https://YOUR-VERCEL-URL.vercel.app/api/send-picks \
  -H "Content-Type: application/json" \
  -d '{
    "week": 1,
    "season": 2025,
    "leagueName": "Barlok Family NFL Picks",
    "recipients": ["person1@email.com", "person2@email.com"]
  }'
```

Or use a tool like **Postman** to make the same POST request.

---

## STEP 9: Add All League Members (optional for now)

When you're ready to add all 12-14 people:

**In Supabase SQL Editor**, run:
```sql
INSERT INTO users (email, name) VALUES
('email1@example.com', 'Person 1'),
('email2@example.com', 'Person 2'),
('email3@example.com', 'Person 3');
-- ... add all participants
```

Then send them login instructions.

---

## Testing Checklist

✅ Supabase database created
✅ GitHub repo created
✅ Vercel deployed
✅ Email/Password auth enabled
✅ First user created
✅ Can log in to app
✅ Can navigate to picks page
✅ Can submit a pick

---

## Troubleshooting

**"Cannot find module" errors**
- Run `npm install` locally and try again

**Login doesn't work**
- Make sure Email provider is enabled in Supabase Authentication
- Check that user exists in `users` table

**Picks page blank**
- You need to add games to the `games` table first
- Games must have `week=1` and `season=2025` to show up

**Email sending fails**
- Make sure `RESEND_API_KEY` is set in Vercel environment variables
- Check Resend dashboard to see if API key is valid

---

## What's Next?

Once you've tested everything:

1. Add all league members to the `users` table
2. Send them login info
3. Each week:
   - Add that week's games to the database
   - People submit their picks
   - You run the email API to send spreadsheet to everyone

The automated email generates a spreadsheet exactly like your example file!

---

## Support

If something breaks or doesn't work:
- Check Vercel deployment logs: https://vercel.com → your project → Deployments
- Check Supabase logs: https://supabase.com → your project → Logs
- Error messages in browser console (F12) often help

You've got this! 🏈
