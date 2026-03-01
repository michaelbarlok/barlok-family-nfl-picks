# Barlok Family NFL Picks

A web application for managing NFL pick predictions in a family league.

## Setup Instructions

### Step 1: Supabase Database Setup

1. Go to your Supabase project: https://supabase.com
2. Open the SQL Editor (left sidebar)
3. Copy all the SQL from `database.sql`
4. Paste it into the SQL Editor and run it
5. Done! Your database tables are now created.

### Step 2: Create GitHub Repository

1. Create a new repository on GitHub called `barlok-nfl-picks`
2. Clone it to your computer:
   ```bash
   git clone https://github.com/yourusername/barlok-nfl-picks.git
   cd barlok-nfl-picks
   ```

### Step 3: Add Project Files

1. Copy all the project files from this directory into your cloned repo
2. Run `npm install` to install dependencies
3. The `.env.local` file is already set up with your API keys

### Step 4: Deploy to Vercel

1. Go to [Vercel](https://vercel.com)
2. Click "New Project"
3. Select "Import Git Repository"
4. Choose your `barlok-nfl-picks` repository
5. Click "Import"
6. In the environment variables section, add:
   - `NEXT_PUBLIC_SUPABASE_URL`: https://urbsiukiolwryszbigre.supabase.co
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: (your anon key)
   - `RESEND_API_KEY`: (your Resend API key)
7. Click "Deploy"
8. Wait for deployment to complete
9. Your site will be live at the URL shown (something like `barlok-nfl-picks.vercel.app`)

### Step 5: Create Your First User Account

1. Go to your deployed site
2. In Supabase, enable Email/Password authentication:
   - Go to Authentication → Providers
   - Turn on "Email"
   - Disable "Confirm email" (makes testing easier)
3. Use the app's signup/login to create your first account
4. You're ready to start using the app!

## Adding NFL Games

To add games for a week:

1. Go to Supabase
2. Open the "games" table
3. Click "Insert"
4. Add games with:
   - `week`: Week number (1-17)
   - `away_team`: Away team abbreviation (e.g., "KC")
   - `home_team`: Home team abbreviation (e.g., "DAL")
   - `kickoff_time`: Game time (ISO format, e.g., "2025-09-07T20:20:00")
   - `season`: 2025

## Sending Weekly Picks Spreadsheet

To email the picks spreadsheet to all participants:

1. Make a POST request to `/api/send-picks` with:
   ```json
   {
     "week": 1,
     "season": 2025,
     "leagueName": "Barlok Family NFL Picks",
     "recipients": ["email1@example.com", "email2@example.com"]
   }
   ```

You can do this via:
- A custom admin page
- cURL command
- External scheduler (Zapier, AWS Lambda, etc.)

## Resend Email Configuration

The app currently sends emails from `onboarding@resend.dev` (Resend's default testing domain).

To use your own domain:
1. In Resend, add your domain
2. Verify the DNS records
3. Update the `from` address in `pages/api/send-picks.ts`

## Adding Users

To add users to the system:
1. Go to Supabase SQL Editor
2. Run:
   ```sql
   INSERT INTO users (email, name) VALUES ('user@example.com', 'User Name');
   ```
3. They can then sign up with the web app using their email

## Tech Stack

- **Frontend**: Next.js 14, React, Tailwind CSS
- **Backend**: Next.js API routes
- **Database**: Supabase (PostgreSQL)
- **Email**: Resend
- **Hosting**: Vercel
