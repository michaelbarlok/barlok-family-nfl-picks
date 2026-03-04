import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { generateWeeklyPicksSpreadsheet } from '@/lib/spreadsheet'
import { ADMIN_EMAIL } from '@/lib/constants'
const resend = new Resend(process.env.RESEND_API_KEY)

async function isAdmin(req: NextApiRequest): Promise<boolean> {
  const token = (req.headers.authorization ?? '').replace('Bearer ', '')
  if (!token) return false
  try {
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data: { user } } = await anon.auth.getUser(token)
    return user?.email === ADMIN_EMAIL
  } catch {
    return false
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!(await isAdmin(req))) {
    return res.status(403).json({ error: 'Unauthorized' })
  }

  try {
    const { week, season, recipients, leagueName } = req.body

    if (!week || !season || !recipients || !Array.isArray(recipients)) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Generate spreadsheet
    const workbook = await generateWeeklyPicksSpreadsheet(
      week,
      season,
      leagueName
    )

    const buffer = await workbook.xlsx.writeBuffer()
    const base64 = Buffer.from(buffer).toString('base64')

    // Send email with spreadsheet attachment to all recipients
    const result = await resend.emails.send({
      from: 'onboarding@resend.dev', // Update this with your verified domain
      to: recipients,
      subject: `${leagueName} - Week ${week} Picks`,
      html: `
        <h2>${leagueName} - Week ${week} Picks</h2>
        <p>Attached is the spreadsheet with all picks for this week.</p>
        <p>You can reply-all to include everyone in the conversation.</p>
      `,
      attachments: [
        {
          filename: `Week_${week}_Picks.xlsx`,
          content: base64,
        },
      ],
    })

    res.status(200).json({ success: true, messageId: result.data?.id })
  } catch (error) {
    console.error('Email error:', error)
    res.status(500).json({ error: 'Failed to send email' })
  }
}
