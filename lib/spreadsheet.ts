import { Workbook, Borders, Alignment } from 'exceljs'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

function getSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key)
}

// --- Team nickname lookup ---
const TEAM_NAMES: Record<string, string> = {
  ARI: 'Cardinals', ATL: 'Falcons', BAL: 'Ravens', BUF: 'Bills',
  CAR: 'Panthers', CHI: 'Bears', CIN: 'Bengals', CLE: 'Browns',
  DAL: 'Cowboys', DEN: 'Broncos', DET: 'Lions', GB: 'Packers',
  HOU: 'Texans', IND: 'Colts', JAC: 'Jaguars', KC: 'Chiefs',
  LAC: 'Chargers', LAR: 'Rams', LV: 'Raiders', MIA: 'Dolphins',
  MIN: 'Vikings', NE: 'Patriots', NO: 'Saints', NYG: 'Giants',
  NYJ: 'Jets', PHI: 'Eagles', PIT: 'Steelers', SEA: 'Seahawks',
  SF: '49ers', TB: 'Buccaneers', TEN: 'Titans', WAS: 'Commanders',
}
function teamName(abbr: string): string { return TEAM_NAMES[abbr] || abbr }

// --- Day label from kickoff time ---
function getDayLabel(kickoffTime: string): string {
  const d = new Date(kickoffTime)
  const et = new Date(d.getTime() - 5 * 60 * 60 * 1000)
  const day = et.getDay()
  switch (day) {
    case 4: return 'Thurs'
    case 5: return 'Friday'
    case 6: return 'Saturday'
    case 0: return 'Sunday'
    case 1: return 'Monday'
    default: return ['Sun', 'Mon', 'Tue', 'Wed', 'Thurs', 'Fri', 'Sat'][day]
  }
}

// --- Shared font definitions (Calibri, matching the original) ---
const baseFont = { name: 'Calibri', family: 2, size: 11, color: { argb: 'FF000000' } }
const boldFont = { ...baseFont, bold: true }
const dayLabelFont = { ...baseFont, bold: true, italic: true, size: 9 }
const centerH: Partial<Alignment> = { horizontal: 'center' }

const lightBlueFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFB4C6E7' } }
const yellowFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFFF00' } }

const thinBorder: Partial<Borders> = {
  top: { style: 'thin' as const, color: { argb: 'FF000000' } },
  bottom: { style: 'thin' as const, color: { argb: 'FF000000' } },
  left: { style: 'thin' as const, color: { argb: 'FF000000' } },
  right: { style: 'thin' as const, color: { argb: 'FF000000' } },
}

// --- Place ranking ---
function computePlaces(
  userIds: string[],
  totalW: Map<string, number>,
  totalL: Map<string, number>,
  bestTotalW: Map<string, number>,
  bestTotalL: Map<string, number>,
): Map<string, string> {
  const sorted = [...userIds].sort((a, b) => {
    const wa = totalW.get(a) ?? 0, wb = totalW.get(b) ?? 0
    if (wb !== wa) return wb - wa
    const la = totalL.get(a) ?? 0, lb = totalL.get(b) ?? 0
    if (la !== lb) return la - lb
    // Tiebreaker: Best 3 total record (more wins first, then fewer losses)
    const bwa = bestTotalW.get(a) ?? 0, bwb = bestTotalW.get(b) ?? 0
    if (bwb !== bwa) return bwb - bwa
    return (bestTotalL.get(a) ?? 0) - (bestTotalL.get(b) ?? 0)
  })
  const places = new Map<string, string>()
  let i = 0
  while (i < sorted.length) {
    const w = totalW.get(sorted[i]) ?? 0, l = totalL.get(sorted[i]) ?? 0
    const bw = bestTotalW.get(sorted[i]) ?? 0, bl = bestTotalL.get(sorted[i]) ?? 0
    let j = i
    while (
      j < sorted.length &&
      (totalW.get(sorted[j]) ?? 0) === w &&
      (totalL.get(sorted[j]) ?? 0) === l &&
      (bestTotalW.get(sorted[j]) ?? 0) === bw &&
      (bestTotalL.get(sorted[j]) ?? 0) === bl
    ) j++
    const pos = i + 1, count = j - i
    let label: string
    if (count === 1) { label = `${pos}` }
    else {
      const positions = Array.from({ length: count }, (_, k) => pos + k)
      label = positions.every(p => p < 10) ? positions.join('') : `${positions[0]}-${positions[positions.length - 1]}`
    }
    for (let k = i; k < j; k++) places.set(sorted[k], label)
    i = j
  }
  return places
}

// ==============================
//  MAIN EXPORT
// ==============================
export async function generateWeeklyPicksSpreadsheet(
  week: number,
  season: number,
  leagueName: string,
) {
  const workbook = new Workbook()
  const ws = workbook.addWorksheet(`Week ${week}`)
  const db = getSupabaseClient()

  // ---------- Fetch data ----------
  const { data: users } = await db.from('users').select('*').order('name')
  const { data: games } = await db.from('games').select('*').eq('week', week).eq('season', season).order('kickoff_time')
  const { data: picks } = await db.from('picks').select('*').eq('week', week).eq('season', season)
  const { data: threeBest } = await db.from('three_best').select('*').eq('week', week).eq('season', season)
  const { data: allScores } = await db.from('scores').select('*').eq('season', season)
  const { data: allPicks } = await db.from('picks').select('*').eq('season', season)
  const { data: allThreeBest } = await db.from('three_best').select('*').eq('season', season)

  if (!users || !games) throw new Error('Failed to fetch data for spreadsheet')

  const userIds = users.map((u: any) => u.id)
  const playerStartCol = 3 // columns: A=1, B=2, C=3..
  const lastPlayerCol = playerStartCol + userIds.length - 1

  const picksMap = new Map(picks?.map(p => [`${p.user_id}-${p.game_id}`, p]) || [])
  const threeBestMap = new Map(threeBest?.map(tb => [tb.user_id, tb]) || [])

  // ---------- Compute W-L records ----------
  const init = () => new Map<string, number>(userIds.map(id => [id, 0]))
  const totalW = init(), totalL = init(), weekW = init(), weekL = init(), prevW = init(), prevL = init()

  allScores?.forEach(s => {
    if (s.is_correct === true) {
      totalW.set(s.user_id, (totalW.get(s.user_id) ?? 0) + 1)
      if (s.week === week) weekW.set(s.user_id, (weekW.get(s.user_id) ?? 0) + 1)
      if (s.week === week - 1) prevW.set(s.user_id, (prevW.get(s.user_id) ?? 0) + 1)
    } else if (s.is_correct === false) {
      totalL.set(s.user_id, (totalL.get(s.user_id) ?? 0) + 1)
      if (s.week === week) weekL.set(s.user_id, (weekL.get(s.user_id) ?? 0) + 1)
      if (s.week === week - 1) prevL.set(s.user_id, (prevL.get(s.user_id) ?? 0) + 1)
    }
  })

  // ---------- Compute 3 BEST W-L ----------
  const allScoresMap = new Map((allScores ?? []).map(s => [`${s.user_id}-${s.game_id}`, s]))
  const bestTotalW = init(), bestTotalL = init()
  const bestWeekW = init(), bestWeekL = init()
  const bestPrevW = init(), bestPrevL = init()

  allThreeBest?.forEach(tb => {
    [tb.pick_1, tb.pick_2, tb.pick_3].filter(Boolean).forEach(team => {
      const matchPick = allPicks?.find(p => p.user_id === tb.user_id && p.week === tb.week && p.picked_team === team)
      if (!matchPick) return
      const score = allScoresMap.get(`${tb.user_id}-${matchPick.game_id}`)
      if (!score) return
      if (score.is_correct === true) {
        bestTotalW.set(tb.user_id, (bestTotalW.get(tb.user_id) ?? 0) + 1)
        if (tb.week === week) bestWeekW.set(tb.user_id, (bestWeekW.get(tb.user_id) ?? 0) + 1)
        if (tb.week === week - 1) bestPrevW.set(tb.user_id, (bestPrevW.get(tb.user_id) ?? 0) + 1)
      } else if (score.is_correct === false) {
        bestTotalL.set(tb.user_id, (bestTotalL.get(tb.user_id) ?? 0) + 1)
        if (tb.week === week) bestWeekL.set(tb.user_id, (bestWeekL.get(tb.user_id) ?? 0) + 1)
        if (tb.week === week - 1) bestPrevL.set(tb.user_id, (bestPrevL.get(tb.user_id) ?? 0) + 1)
      }
    })
  })

  const places = computePlaces(userIds, totalW, totalL, bestTotalW, bestTotalL)

  // ---------- Group games by day ----------
  const dayOrder: string[] = []
  const gamesByDay = new Map<string, any[]>()
  games.forEach(game => {
    const day = getDayLabel(game.kickoff_time)
    if (!gamesByDay.has(day)) { gamesByDay.set(day, []); dayOrder.push(day) }
    gamesByDay.get(day)!.push(game)
  })
  const firstDay = dayOrder[0] || 'Thurs'

  // ===================================================
  //  BUILD THE SPREADSHEET (matching original format)
  // ===================================================

  // --- Row 1: Title ---
  ws.getCell(1, 1).value = `WEEK ${week} - ${leagueName.toUpperCase()} ${season}`
  ws.getCell(1, 1).font = { ...baseFont, bold: true, size: 12 }

  // --- Row 2: Header ---
  // B2: "HOME TEAM" (yellow fill, bold, size 8)
  ws.getCell(2, 2).value = 'HOME TEAM'
  ws.getCell(2, 2).font = { ...baseFont, bold: true, size: 8 }
  ws.getCell(2, 2).fill = yellowFill
  // C2+: Player names (size 11, no fill, no bold)
  userIds.forEach((uid: string, idx: number) => {
    const u = users.find((u: any) => u.id === uid)
    ws.getCell(2, playerStartCol + idx).value = u?.name || ''
    ws.getCell(2, playerStartCol + idx).font = baseFont
  })

  // --- Row 3: PLACE row (merged A3:B3 with rich text day + "PLACE") ---
  let row = 3
  ws.mergeCells(row, 1, row, 2)
  ws.getCell(row, 1).value = {
    richText: [
      { font: { ...dayLabelFont }, text: `      ${firstDay}      ` },
      { font: { ...baseFont, bold: true, size: 9, color: { argb: 'FFFF0000' } }, text: 'PLACE' },
    ],
  } as any
  ws.getCell(row, 1).alignment = centerH
  ws.getCell(row, 1).font = dayLabelFont // base font for the cell

  // Place values: RED text, light blue fill, centered (blank for week 1)
  userIds.forEach((uid: string, idx: number) => {
    const cell = ws.getCell(row, playerStartCol + idx)
    cell.value = week === 1 ? null : (places.get(uid) || '')
    cell.font = { ...baseFont, color: { argb: 'FFFF0000' } }
    cell.fill = lightBlueFill
    cell.alignment = centerH
  })
  row++

  // --- Game rows grouped by day ---
  let isFirstDay = true
  for (const day of dayOrder) {
    const dayGames = gamesByDay.get(day)!

    if (!isFirstDay) {
      // Day separator row (merged A:B) — "Sunday", "Monday", etc.
      ws.mergeCells(row, 1, row, 2)
      ws.getCell(row, 1).value = day
      ws.getCell(row, 1).font = dayLabelFont
      row++
    }
    isFirstDay = false

    // Individual games
    dayGames.forEach(game => {
      // Col A: away team nickname (bold, size 11, centered)
      ws.getCell(row, 1).value = teamName(game.away_team)
      ws.getCell(row, 1).font = boldFont
      ws.getCell(row, 1).alignment = centerH

      // Col B: home team nickname
      ws.getCell(row, 2).value = teamName(game.home_team)
      ws.getCell(row, 2).font = boldFont
      ws.getCell(row, 2).alignment = centerH

      // Player picks (size 11, no bold, no fill)
      userIds.forEach((uid: string, idx: number) => {
        const pick = picksMap.get(`${uid}-${game.id}`)
        const cell = ws.getCell(row, playerStartCol + idx)
        cell.value = pick?.picked_team || ''
        cell.font = baseFont
        cell.alignment = centerH
      })
      row++
    })
  }

  // --- Blank row ---
  row++

  // --- W-L Records: Last Week / This Week / Total ---
  const writeWL = (label: string, wins: Map<string, number>, losses: Map<string, number>) => {
    ws.getCell(row, 2).value = label
    ws.getCell(row, 2).font = baseFont
    userIds.forEach((uid: string, idx: number) => {
      const w = wins.get(uid) ?? 0, l = losses.get(uid) ?? 0
      ws.getCell(row, playerStartCol + idx).value = `${w}-${l}`
      ws.getCell(row, playerStartCol + idx).font = baseFont
      ws.getCell(row, playerStartCol + idx).alignment = centerH
    })
    row++
  }

  writeWL('Last Week', prevW, prevL)
  writeWL('This Week', weekW, weekL)
  writeWL('Total', totalW, totalL)

  // --- Blank row before 3 BEST ---
  row++

  // --- 3 BEST header row ---
  // Each player column gets its own "3 BEST" cell (matching original)
  ws.mergeCells(row, 1, row, 2)
  userIds.forEach((_uid: string, idx: number) => {
    const cell = ws.getCell(row, playerStartCol + idx)
    cell.value = '3 BEST'
    cell.font = { ...baseFont, bold: true, size: 14 }
    cell.fill = lightBlueFill
    cell.alignment = centerH
  })
  row++

  // Player names row for 3 BEST
  userIds.forEach((uid: string, idx: number) => {
    const u = users.find((u: any) => u.id === uid)
    ws.getCell(row, playerStartCol + idx).value = u?.name || ''
    ws.getCell(row, playerStartCol + idx).font = baseFont
    ws.getCell(row, playerStartCol + idx).alignment = centerH
  })
  row++

  // 3 Best pick rows (3 rows of team abbreviations)
  for (let i = 1; i <= 3; i++) {
    userIds.forEach((uid: string, idx: number) => {
      const tb = threeBestMap.get(uid)
      ws.getCell(row, playerStartCol + idx).value = tb ? (tb[`pick_${i}`] || '') : ''
      ws.getCell(row, playerStartCol + idx).font = baseFont
      ws.getCell(row, playerStartCol + idx).alignment = centerH
    })
    row++
  }

  // --- Blank row ---
  row++

  // --- 3 BEST W-L Records ---
  writeWL('Last Week', bestPrevW, bestPrevL)
  writeWL('This Week', bestWeekW, bestWeekL)
  writeWL('Total', bestTotalW, bestTotalL)

  // --- Column widths (matching original) ---
  ws.getColumn(1).width = 14
  ws.getColumn(2).width = 12.5
  userIds.forEach((_: string, idx: number) => {
    ws.getColumn(playerStartCol + idx).width = 7.5
  })

  // --- Apply thin borders to all player column cells (row 2 through last used row) ---
  const lastRow = row - 1
  for (let r = 2; r <= lastRow; r++) {
    for (let c = playerStartCol; c <= lastPlayerCol; c++) {
      ws.getCell(r, c).border = thinBorder
    }
  }

  return workbook
}
