# Barlok Family NFL Picks

A web application for managing NFL pick predictions in a family league.

## Tech Stack

- **Frontend**: Next.js, React, Tailwind CSS
- **Backend**: Next.js API routes
- **Database**: Supabase (PostgreSQL)
- **Email**: Gmail SMTP via Nodemailer
- **Hosting**: Vercel

## Getting Started

1. Copy `.env.example` to `.env.local` and fill in your values
2. Run `npm install`
3. Run `npm run dev`

See `SETUP_GUIDE.md` for full deployment instructions.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only) |
| `GMAIL_ADDRESS` | Gmail address for sending weekly emails |
| `GMAIL_APP_PASSWORD` | Gmail App Password (16-char, from Google Account settings) |
| `CRON_SECRET` | Secret for Vercel cron job authentication |

## Features

- Pick winners for each NFL game each week
- "3 Best" picks for tiebreaker tracking
- Managed players (proxy picking for family members)
- Auto-sync game results from ESPN
- Auto-sync weekly schedule from ESPN
- Weekly email with Excel spreadsheet attachment
- Standings with W-L records and place rankings
- Admin panel for score sync, manual overrides, and email sending

## Weekly Workflow

1. **Sync Schedule** from the Admin panel to load games for the week
2. Everyone submits picks before Thursday kickoff
3. After games complete, **Sync Week** to pull results from ESPN
4. **Send Email** to distribute the spreadsheet to all participants
