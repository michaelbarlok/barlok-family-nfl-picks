# 🏈 Barlok Family NFL Picks - Quick Start (30 Minutes)

## Your Credentials (Already in .env.local)
```
Supabase URL: https://urbsiukiolwryszbigre.supabase.co
Supabase Anon Key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Resend API Key: re_JZ2yPKfR_EfsCpQRU51UpN1UPGsdpVLFe
```

## 30-Minute Setup

### ⏱️ 10 minutes: Supabase Database
- [ ] Open Supabase → SQL Editor
- [ ] Copy/paste `database.sql` code
- [ ] Click Run
- [ ] ✅ Database created

### ⏱️ 5 minutes: GitHub Repository
- [ ] Create new repo: `barlok-nfl-picks`
- [ ] Clone locally: `git clone <your-url>`
- [ ] Copy all project files into folder
- [ ] `git add .` → `git commit -m "Initial"` → `git push`

### ⏱️ 5 minutes: Vercel Deployment
- [ ] Go to Vercel.com
- [ ] "New Project" → Import from GitHub
- [ ] Select your `barlok-nfl-picks` repo
- [ ] Add 3 environment variables (copy from `.env.local`)
- [ ] Click Deploy
- [ ] ✅ Site live in 2-3 minutes

### ⏱️ 5 minutes: Supabase Auth Setup
- [ ] Supabase → Authentication → Providers
- [ ] Enable "Email"
- [ ] Disable "Confirm email"
- [ ] ✅ Ready to use

### ⏱️ 2 minutes: Create Test Account
- [ ] Visit your new Vercel URL
- [ ] Create account: barlokmichael@gmail.com / any password
- [ ] ✅ Can see picks form

### ⏱️ 3 minutes: Add Test Games
- [ ] Supabase → Table Editor → games
- [ ] Click "Insert"
- [ ] Add a few games with:
  - `away_team`: "KC"
  - `home_team`: "DAL"
  - `week`: 1
  - `season`: 2025
  - `kickoff_time`: "2025-09-07T20:20:00Z"
- [ ] ✅ Games show up in app

## You're Done! 🎉

### What happens next:

**Every Week:**
1. Add games to Supabase
2. Users log in and submit picks
3. You run the email API to send spreadsheet:
   ```bash
   curl -X POST https://YOUR-VERCEL-URL/api/send-picks \
     -H "Content-Type: application/json" \
     -d '{
       "week": 1,
       "season": 2025,
       "leagueName": "Barlok Family NFL Picks",
       "recipients": ["person1@email.com"]
     }'
   ```

**When Ready to Go Live:**
- Add all 12-14 participants to `users` table in Supabase
- Send them login link + their email
- They create account and start picking

## Files You Have

```
nfl-picks/
├── pages/
│   ├── index.tsx (redirects to login/picks)
│   ├── login.tsx (login page)
│   ├── picks.tsx (main picks form)
│   ├── _app.tsx (app wrapper)
│   └── api/
│       └── send-picks.ts (email API)
├── lib/
│   ├── supabase.ts (database client)
│   ├── auth.tsx (auth logic)
│   └── spreadsheet.ts (generates XLSX)
├── styles/
│   └── globals.css (Tailwind)
├── database.sql (create tables)
├── .env.local (your API keys)
├── package.json (dependencies)
├── SETUP_GUIDE.md (detailed guide)
├── README.md (documentation)
└── ... (config files)
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Can't login" | Check Supabase Email provider is enabled |
| "No games show" | Add games to `games` table in Supabase |
| "Deploy fails" | Check GitHub repo has all files |
| "Email won't send" | Verify `RESEND_API_KEY` in Vercel env vars |

## Need Help?

Check these files in order:
1. `SETUP_GUIDE.md` - Detailed step-by-step
2. `README.md` - Technical overview
3. Browser console (F12) - Error messages
4. Vercel dashboard - Deployment logs
5. Supabase logs - Database errors
