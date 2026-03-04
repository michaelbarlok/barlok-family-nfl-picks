/**
 * End-to-end test script for Barlok Family NFL Picks
 *
 * Usage:
 *   Step 1: Seed test data       — node scripts/test-e2e.js seed
 *   Step 2: Set fake results     — node scripts/test-e2e.js results
 *   Step 3: Advance to Week 2    — node scripts/test-e2e.js week2
 *   Step 4: Reset everything     — node scripts/test-e2e.js reset
 *
 * Requires .env.local with:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const SEASON = 2025

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(1)
  }
  return createClient(url, key)
}

// 12 test users (matching typical league size)
const TEST_USERS = [
  { email: 'robbie@test.com', name: 'Robbie' },
  { email: 'amy@test.com', name: 'Amy' },
  { email: 'thomas@test.com', name: 'Thomas' },
  { email: 'joesr@test.com', name: 'Joe Sr' },
  { email: 'dylan@test.com', name: 'Dylan' },
  { email: 'joejr@test.com', name: 'Joe Jr' },
  { email: 'alex@test.com', name: 'Alex' },
  { email: 'michael@test.com', name: 'Michael' },
  { email: 'umike@test.com', name: 'UMike' },
  { email: 'ateresa@test.com', name: 'ATeresa' },
  { email: 'kait@test.com', name: 'Kait' },
  { email: 'deb@test.com', name: 'Deb' },
]

// Week 1 games (16 games)
const WEEK1_GAMES = [
  { away: 'DAL', home: 'PHI', time: '2025-09-05T00:20:00Z' },  // Thurs
  { away: 'LAC', home: 'KC',  time: '2025-09-06T00:00:00Z' },  // Friday
  { away: 'PIT', home: 'NYJ', time: '2025-09-07T17:00:00Z' },  // Sunday 1pm
  { away: 'MIA', home: 'IND', time: '2025-09-07T17:00:00Z' },
  { away: 'TB',  home: 'ATL', time: '2025-09-07T17:00:00Z' },
  { away: 'LV',  home: 'NE',  time: '2025-09-07T17:00:00Z' },
  { away: 'ARI', home: 'NO',  time: '2025-09-07T17:00:00Z' },
  { away: 'CIN', home: 'CLE', time: '2025-09-07T17:00:00Z' },
  { away: 'NYG', home: 'WAS', time: '2025-09-07T17:00:00Z' },
  { away: 'CAR', home: 'JAC', time: '2025-09-07T17:00:00Z' },
  { away: 'TEN', home: 'DEN', time: '2025-09-07T20:05:00Z' },  // Sunday 4pm
  { away: 'SF',  home: 'SEA', time: '2025-09-07T20:05:00Z' },
  { away: 'HOU', home: 'LAR', time: '2025-09-07T20:25:00Z' },
  { away: 'DET', home: 'GB',  time: '2025-09-07T20:25:00Z' },
  { away: 'BAL', home: 'BUF', time: '2025-09-08T00:20:00Z' },  // SNF
  { away: 'MIN', home: 'CHI', time: '2025-09-09T00:15:00Z' },  // MNF
]

// Week 1 winners (for fake results)
const WEEK1_WINNERS = {
  'DAL-PHI': 'PHI', 'LAC-KC': 'KC', 'PIT-NYJ': 'NYJ', 'MIA-IND': 'MIA',
  'TB-ATL': 'ATL', 'LV-NE': 'NE', 'ARI-NO': 'NO', 'CIN-CLE': 'CIN',
  'NYG-WAS': 'WAS', 'CAR-JAC': 'JAC', 'TEN-DEN': 'DEN', 'SF-SEA': 'SF',
  'HOU-LAR': 'HOU', 'DET-GB': 'DET', 'BAL-BUF': 'BAL', 'MIN-CHI': 'MIN',
}

// Week 2 games
const WEEK2_GAMES = [
  { away: 'BUF', home: 'MIA', time: '2025-09-12T00:20:00Z' },  // Thurs
  { away: 'NO',  home: 'DAL', time: '2025-09-14T17:00:00Z' },  // Sunday
  { away: 'TB',  home: 'DET', time: '2025-09-14T17:00:00Z' },
  { away: 'IND', home: 'GB',  time: '2025-09-14T17:00:00Z' },
  { away: 'NYJ', home: 'TEN', time: '2025-09-14T17:00:00Z' },
  { away: 'SF',  home: 'MIN', time: '2025-09-14T17:00:00Z' },
  { away: 'SEA', home: 'NE',  time: '2025-09-14T17:00:00Z' },
  { away: 'NYG', home: 'WAS', time: '2025-09-14T17:00:00Z' },
  { away: 'LAC', home: 'CAR', time: '2025-09-14T17:00:00Z' },
  { away: 'CLE', home: 'JAC', time: '2025-09-14T17:00:00Z' },
  { away: 'LV',  home: 'BAL', time: '2025-09-14T20:25:00Z' },
  { away: 'LAR', home: 'ARI', time: '2025-09-14T20:25:00Z' },
  { away: 'PIT', home: 'DEN', time: '2025-09-14T20:25:00Z' },
  { away: 'CIN', home: 'KC',  time: '2025-09-15T00:20:00Z' },  // SNF
  { away: 'ATL', home: 'PHI', time: '2025-09-16T00:15:00Z' },  // MNF
  { away: 'CHI', home: 'HOU', time: '2025-09-16T00:15:00Z' },  // MNF
]

// Generate a random pick for a game (slightly favor home team for realism)
function randomPick(away, home) {
  return Math.random() > 0.45 ? home : away
}

// ========================================

async function seed() {
  const db = getDb()
  console.log('--- SEEDING TEST DATA ---\n')

  // 1. Create test users in the users table (not auth — just data rows)
  console.log('Creating 12 test users...')
  for (const u of TEST_USERS) {
    const { error } = await db.from('users').upsert(
      { email: u.email, name: u.name },
      { onConflict: 'email' }
    )
    if (error) console.error(`  Error creating ${u.name}:`, error.message)
    else console.log(`  + ${u.name} (${u.email})`)
  }

  // 2. Fetch the user IDs we just created
  const { data: users } = await db.from('users').select('id, email, name').order('name')
  const userMap = new Map(users.map(u => [u.email, u]))
  console.log(`\n${users.length} users in database.`)

  // 3. Insert Week 1 games
  console.log('\nInserting Week 1 games...')
  for (const g of WEEK1_GAMES) {
    const { error } = await db.from('games').upsert(
      { away_team: g.away, home_team: g.home, week: 1, season: SEASON, kickoff_time: g.time },
      { onConflict: 'week,away_team,home_team,season' }
    )
    if (error) console.error(`  Error: ${g.away}@${g.home}:`, error.message)
  }

  // 4. Fetch game IDs
  const { data: games } = await db.from('games').select('*').eq('week', 1).eq('season', SEASON)
  console.log(`${games.length} Week 1 games in database.`)

  // 5. Generate random picks for each user
  console.log('\nGenerating picks for each user...')
  for (const u of TEST_USERS) {
    const user = userMap.get(u.email)
    if (!user) continue

    const pickedTeams = []
    for (const game of games) {
      const pick = randomPick(game.away_team, game.home_team)
      pickedTeams.push({ gameId: game.id, team: pick })

      await db.from('picks').upsert(
        { user_id: user.id, game_id: game.id, picked_team: pick, week: 1, season: SEASON },
        { onConflict: 'user_id,game_id' }
      )
    }

    // Pick 3 best (first 3 unique picked teams)
    const bestTeams = pickedTeams.slice(0, 3).map(p => p.team)
    await db.from('three_best').upsert(
      { user_id: user.id, week: 1, season: SEASON, pick_1: bestTeams[0], pick_2: bestTeams[1], pick_3: bestTeams[2] },
      { onConflict: 'user_id,week,season' }
    )

    console.log(`  ${u.name}: ${pickedTeams.length} picks, best 3: ${bestTeams.join(', ')}`)
  }

  console.log('\n--- SEED COMPLETE ---')
  console.log('You can now log in, view picks, and download the spreadsheet.')
  console.log('Next step: node scripts/test-e2e.js results')
}

async function setResults() {
  const db = getDb()
  console.log('--- SETTING FAKE WEEK 1 RESULTS ---\n')

  const { data: games } = await db.from('games').select('*').eq('week', 1).eq('season', SEASON)
  const { data: users } = await db.from('users').select('id, name').order('name')
  const { data: picks } = await db.from('picks').select('*').eq('week', 1).eq('season', SEASON)

  // Set winning team on each game
  for (const game of games) {
    const key = `${game.away_team}-${game.home_team}`
    const winner = WEEK1_WINNERS[key]
    if (!winner) { console.log(`  No winner defined for ${key}, skipping`); continue }

    await db.from('games').update({ winning_team: winner }).eq('id', game.id)
    console.log(`  ${game.away_team} @ ${game.home_team} -> Winner: ${winner}`)

    // Score each user's pick for this game
    for (const user of users) {
      const pick = picks.find(p => p.user_id === user.id && p.game_id === game.id)
      if (!pick) continue
      const isCorrect = pick.picked_team === winner

      await db.from('scores').upsert(
        { user_id: user.id, game_id: game.id, is_correct: isCorrect, week: 1, season: SEASON },
        { onConflict: 'user_id,game_id' }
      )
    }
  }

  // Print standings
  console.log('\n--- WEEK 1 STANDINGS ---')
  for (const user of users) {
    const userPicks = picks.filter(p => p.user_id === user.id)
    let wins = 0, losses = 0
    for (const p of userPicks) {
      const game = games.find(g => g.id === p.game_id)
      const key = `${game.away_team}-${game.home_team}`
      const winner = WEEK1_WINNERS[key]
      if (p.picked_team === winner) wins++; else losses++
    }
    console.log(`  ${user.name.padEnd(10)} ${wins}-${losses}`)
  }

  console.log('\n--- RESULTS COMPLETE ---')
  console.log('Check the Standings page and try emailing the spreadsheet from Admin.')
  console.log('Next step: node scripts/test-e2e.js week2')
}

async function advanceToWeek2() {
  const db = getDb()
  console.log('--- ADVANCING TO WEEK 2 ---\n')

  console.log('Inserting Week 2 games...')
  for (const g of WEEK2_GAMES) {
    const { error } = await db.from('games').upsert(
      { away_team: g.away, home_team: g.home, week: 2, season: SEASON, kickoff_time: g.time },
      { onConflict: 'week,away_team,home_team,season' }
    )
    if (error) console.error(`  Error: ${g.away}@${g.home}:`, error.message)
  }

  const { data: games } = await db.from('games').select('*').eq('week', 2).eq('season', SEASON)
  console.log(`${games.length} Week 2 games inserted.`)

  console.log('\n--- WEEK 2 READY ---')
  console.log('The picks page will now auto-detect Week 2.')
  console.log('Users can submit Week 2 picks. Week 1 is locked.')
}

async function reset() {
  const db = getDb()
  console.log('--- RESETTING ALL TEST DATA ---\n')

  // Delete in order to respect foreign keys
  const tables = ['scores', 'three_best', 'picks', 'games']
  for (const table of tables) {
    const { error, count } = await db.from(table).delete().eq('season', SEASON)
    if (error) console.error(`  Error deleting ${table}:`, error.message)
    else console.log(`  Cleared ${table}`)
  }

  // Delete test users
  const testEmails = TEST_USERS.map(u => u.email)
  const { error } = await db.from('users').delete().in('email', testEmails)
  if (error) console.error('  Error deleting test users:', error.message)
  else console.log(`  Cleared ${testEmails.length} test users`)

  console.log('\n--- RESET COMPLETE ---')
  console.log('All 2025 season data and test users have been removed.')
}

// --- CLI ---
const cmd = process.argv[2]
switch (cmd) {
  case 'seed':    seed().catch(console.error); break
  case 'results': setResults().catch(console.error); break
  case 'week2':   advanceToWeek2().catch(console.error); break
  case 'reset':   reset().catch(console.error); break
  default:
    console.log(`
Barlok Family NFL Picks — End-to-End Test Script

Usage:
  node scripts/test-e2e.js seed      Create 12 test users, Week 1 games, and random picks
  node scripts/test-e2e.js results   Set fake Week 1 winners and update standings
  node scripts/test-e2e.js week2     Add Week 2 games (picks page auto-advances)
  node scripts/test-e2e.js reset     Delete all test data (2025 season + test users)

Run them in order: seed -> results -> week2 -> reset
`)
}
