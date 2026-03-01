import type { NextApiRequest, NextApiResponse } from 'next'
import { generateWeeklyPicksSpreadsheet } from '@/lib/spreadsheet'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const week = parseInt(req.query.week as string)
  const season = parseInt(req.query.season as string)

  if (!week || !season || isNaN(week) || isNaN(season)) {
    return res.status(400).json({ error: 'Missing or invalid week/season parameters' })
  }

  try {
    const workbook = await generateWeeklyPicksSpreadsheet(week, season, 'Barlok Family NFL Picks')
    const buffer = await workbook.xlsx.writeBuffer()

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="Week_${week}_Picks_${season}.xlsx"`)
    res.send(Buffer.from(buffer))
  } catch (error) {
    console.error('Download error:', error)
    res.status(500).json({ error: 'Failed to generate spreadsheet' })
  }
}
