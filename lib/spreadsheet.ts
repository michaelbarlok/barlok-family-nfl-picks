import { Workbook } from 'exceljs'
import { supabase } from './supabase'

export async function generateWeeklyPicksSpreadsheet(
  week: number,
  season: number,
  leagueName: string
) {
  const workbook = new Workbook()
  const worksheet = workbook.addWorksheet(`Week ${week}`)

  // Fetch all data
  const { data: users } = await supabase
    .from('users')
    .select('*')
    .order('name')

  const { data: games } = await supabase
    .from('games')
    .select('*')
    .eq('week', week)
    .eq('season', season)
    .order('kickoff_time')

  const { data: picks } = await supabase
    .from('picks')
    .select('*')
    .eq('week', week)
    .eq('season', season)

  const { data: threeBest } = await supabase
    .from('three_best')
    .select('*')
    .eq('week', week)
    .eq('season', season)

  if (!users || !games) {
    throw new Error('Failed to fetch data for spreadsheet')
  }

  const userIds = users.map(u => u.id)
  const picksMap = new Map(picks?.map(p => [`${p.user_id}-${p.game_id}`, p]) || [])
  const threeBestMap = new Map(threeBest?.map(tb => [tb.user_id, tb]) || [])

  // Title row
  worksheet.mergeCells('A1:P1')
  const titleCell = worksheet.getCell('A1')
  titleCell.value = `WEEK ${week} - ${leagueName.toUpperCase()} 2025`
  titleCell.font = { bold: true, size: 14 }
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' }

  // Header row with user names
  worksheet.getCell('A2').value = 'Home Team'
  userIds.forEach((userId, index) => {
    const user = users.find(u => u.id === userId)
    worksheet.getCell(2, index + 2).value = user?.name || ''
  })

  // Games and picks rows
  let rowNum = 3
  games.forEach(game => {
    const dayCell = worksheet.getCell(rowNum, 1)
    dayCell.value = `${game.away_team} @ ${game.home_team}`
    
    userIds.forEach((userId, index) => {
      const pick = picksMap.get(`${userId}-${game.id}`)
      worksheet.getCell(rowNum, index + 2).value = pick?.picked_team || ''
    })
    rowNum++
  })

  // Add blank row
  rowNum++

  // Three Best section header
  const threeBestHeaderRow = rowNum
  worksheet.mergeCells(`A${threeBestHeaderRow}:B${threeBestHeaderRow}`)
  worksheet.getCell(`A${threeBestHeaderRow}`).value = '3 BEST'
  worksheet.getCell(`A${threeBestHeaderRow}`).font = { bold: true }
  
  userIds.forEach((userId, index) => {
    const user = users.find(u => u.id === userId)
    worksheet.getCell(threeBestHeaderRow, index + 2).value = user?.name || ''
  })

  // Three Best picks
  rowNum++
  for (let i = 1; i <= 3; i++) {
    userIds.forEach((userId, index) => {
      const tb = threeBestMap.get(userId)
      const pickValue = tb ? tb[`pick_${i}`] : ''
      worksheet.getCell(rowNum, index + 2).value = pickValue
    })
    rowNum++
  }

  // Set column widths
  worksheet.getColumn('A').width = 25
  userIds.forEach((_, index) => {
    worksheet.getColumn(index + 2).width = 12
  })

  return workbook
}
