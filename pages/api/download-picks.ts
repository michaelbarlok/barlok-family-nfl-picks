import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { generateWeeklyPicksSpreadsheet } from '@/lib/spreadsheet'

async function isAuthenticated(req: NextApiRequest): Promise<boolean> {
  const token = (req.headers.authorization ?? '').replace('Bearer ', '')
  if (!token) return false
  try {
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data: { user } } = await anon.auth.getUser(token)
    return !!user
  } catch {
    return false
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!(await isAuthenticated(req))) {
    return res.status(403).json({ error: 'Unauthorized — please log in' })
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
