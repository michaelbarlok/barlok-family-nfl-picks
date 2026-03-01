import { Workbook, Borders, Alignment } from 'exceljs'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

function getSupabaseClient(): SupabaseClient {
  // Use service role key when available (API routes), else fall back to anon key
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key)
}

const thinBorder: Partial<Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
}

const centerAlign: Partial<Alignment> = { horizontal: 'center', vertical: 'middle' }

export async function generateWeeklyPicksSpreadsheet(
  week: number,
  season: number,
  leagueName: string
) {
  const workbook = new Workbook()
  const worksheet = workbook.addWorksheet(`Week ${week}`)

  const db = getSupabaseClient()

  // Fetch all data
  const { data: users } = await db
    .from('users')
    .select('*')
    .order('name')

  const { data: games } = await db
    .from('games')
    .select('*')
    .eq('week', week)
    .eq('season', season)
    .order('kickoff_time')

  const { data: picks } = await db
    .from('picks')
    .select('*')
    .eq('week', week)
    .eq('season', season)

  const { data: threeBest } = await db
    .from('three_best')
    .select('*')
    .eq('week', week)
    .eq('season', season)

  if (!users || !games) {
    throw new Error('Failed to fetch data for spreadsheet')
  }

  const userIds = users.map(u => u.id)
  const userCount = userIds.length
  const lastCol = userCount + 1 // column 1 = game label, columns 2..N+1 = users
  const picksMap = new Map(picks?.map(p => [`${p.user_id}-${p.game_id}`, p]) || [])
  const threeBestMap = new Map(threeBest?.map(tb => [tb.user_id, tb]) || [])

  // --- Title row (row 1) ---
  if (lastCol > 1) {
    worksheet.mergeCells(1, 1, 1, lastCol)
  }
  const titleCell = worksheet.getCell('A1')
  titleCell.value = `WEEK ${week} - ${leagueName.toUpperCase()} ${season}`
  titleCell.font = { bold: true, size: 14 }
  titleCell.alignment = centerAlign
  worksheet.getRow(1).height = 28

  // --- Header row (row 2): "MATCHUP" + user names ---
  const headerRow = worksheet.getRow(2)
  worksheet.getCell(2, 1).value = 'MATCHUP'
  worksheet.getCell(2, 1).font = { bold: true, size: 11 }
  worksheet.getCell(2, 1).alignment = centerAlign
  worksheet.getCell(2, 1).border = thinBorder

  userIds.forEach((userId, index) => {
    const user = users.find(u => u.id === userId)
    const cell = worksheet.getCell(2, index + 2)
    cell.value = user?.name || ''
    cell.font = { bold: true, size: 11 }
    cell.alignment = centerAlign
    cell.border = thinBorder
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E2F3' } }
  })
  headerRow.height = 22

  // --- Games and picks rows (rows 3..N) ---
  let rowNum = 3
  games.forEach(game => {
    const gameCell = worksheet.getCell(rowNum, 1)
    gameCell.value = `${game.away_team} @ ${game.home_team}`
    gameCell.font = { bold: true, size: 10 }
    gameCell.alignment = { vertical: 'middle' }
    gameCell.border = thinBorder

    userIds.forEach((userId, index) => {
      const pick = picksMap.get(`${userId}-${game.id}`)
      const cell = worksheet.getCell(rowNum, index + 2)
      cell.value = pick?.picked_team || ''
      cell.alignment = centerAlign
      cell.border = thinBorder
    })
    rowNum++
  })

  // --- Blank separator row ---
  rowNum++

  // --- Three Best section ---
  const threeBestHeaderRow = rowNum

  // "3 BEST" label in column 1
  worksheet.getCell(threeBestHeaderRow, 1).value = '3 BEST'
  worksheet.getCell(threeBestHeaderRow, 1).font = { bold: true, size: 12 }
  worksheet.getCell(threeBestHeaderRow, 1).alignment = centerAlign
  worksheet.getCell(threeBestHeaderRow, 1).border = thinBorder
  worksheet.getCell(threeBestHeaderRow, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }

  // User names in header
  userIds.forEach((userId, index) => {
    const user = users.find(u => u.id === userId)
    const cell = worksheet.getCell(threeBestHeaderRow, index + 2)
    cell.value = user?.name || ''
    cell.font = { bold: true, size: 11 }
    cell.alignment = centerAlign
    cell.border = thinBorder
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }
  })

  // Three Best pick rows
  rowNum++
  for (let i = 1; i <= 3; i++) {
    worksheet.getCell(rowNum, 1).value = `Best #${i}`
    worksheet.getCell(rowNum, 1).font = { italic: true, size: 10 }
    worksheet.getCell(rowNum, 1).alignment = { vertical: 'middle' }
    worksheet.getCell(rowNum, 1).border = thinBorder

    userIds.forEach((userId, index) => {
      const tb = threeBestMap.get(userId)
      const pickValue = tb ? tb[`pick_${i}`] : ''
      const cell = worksheet.getCell(rowNum, index + 2)
      cell.value = pickValue
      cell.alignment = centerAlign
      cell.border = thinBorder
    })
    rowNum++
  }

  // --- Column widths ---
  worksheet.getColumn(1).width = 20
  userIds.forEach((_, index) => {
    worksheet.getColumn(index + 2).width = 14
  })

  return workbook
}
