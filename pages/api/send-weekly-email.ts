import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import { generateWeeklyPicksSpreadsheet } from '@/lib/spreadsheet'
import { CURRENT_SEASON, ADMIN_EMAIL } from '@/lib/constants'
const LEAGUE_NAME = 'Barlok Family NFL Picks'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function isAuthorized(req: NextApiRequest): Promise<boolean> {
  const authHeader = req.headers.authorization ?? ''

  // Vercel cron secret
  if (process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`) {
    return true
  }

  // Admin user token
  const token = authHeader.replace('Bearer ', '')
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

// Detect the current NFL week: most recent week where any game has kicked off
async function detectCurrentWeek(supabase: any): Promise<number | null> {
  const { data } = await supabase
    .from('games')
    .select('week')
    .eq('season', CURRENT_SEASON)
    .lt('kickoff_time', new Date().toISOString())
    .order('week', { ascending: false })
    .limit(1)
  const row = (data as { week: number }[] | null)?.[0]
  return row?.week ?? null
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!(await isAuthorized(req))) {
    return res.status(403).json({ error: 'Unauthorized' })
  }

  const supabase = getAdminClient()

  // Determine week
  let week: number
  if (req.query.week) {
    week = parseInt(req.query.week as string)
  } else {
    const detected = await detectCurrentWeek(supabase)
    if (!detected) return res.status(200).json({ message: 'No games have started yet — nothing to send.' })
    week = detected
  }

  const season = req.query.season ? parseInt(req.query.season as string) : CURRENT_SEASON

  // Parse custom message and recipient list from request body
  let customMessage = ''
  let selectedRecipients: string[] | null = null
  if (req.method === 'POST' && req.body) {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    customMessage = body.customMessage || ''
    if (Array.isArray(body.recipients) && body.recipients.length > 0) {
      selectedRecipients = body.recipients
    }
  }

  try {
    // Get all user emails
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('email, name, email_recipient')
      .order('name')

    if (usersError || !users || users.length === 0) {
      return res.status(500).json({ error: 'Failed to fetch users or no users found' })
    }

    // Use explicitly selected recipients, or fall back to users with email_recipient flag
    let recipients: string[]
    if (selectedRecipients) {
      recipients = selectedRecipients.filter(e => typeof e === 'string' && e.includes('@'))
    } else {
      recipients = users
        .filter((u: any) => u.email && u.email_recipient === true)
        .map((u: any) => u.email)
    }

    if (recipients.length === 0) {
      return res.status(400).json({ error: 'No users with email addresses found' })
    }

    // Generate spreadsheet
    const workbook = await generateWeeklyPicksSpreadsheet(week, season, LEAGUE_NAME)
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())

    // Send via Gmail SMTP as a single group email.
    // All recipients in "to" so everyone sees each other and can reply-all.
    const gmailAddress = process.env.GMAIL_ADDRESS
    const gmailAppPassword = process.env.GMAIL_APP_PASSWORD

    if (!gmailAddress || !gmailAppPassword) {
      return res.status(500).json({ error: 'Gmail credentials not configured (GMAIL_ADDRESS, GMAIL_APP_PASSWORD)' })
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: gmailAddress,
        pass: gmailAppPassword,
      },
    })

    const info = await transporter.sendMail({
      from: `Barlok Family NFL Picks <${gmailAddress}>`,
      to: recipients.join(', '),
      subject: `${LEAGUE_NAME} — Week ${week} Picks`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1d4ed8;">🏈 ${LEAGUE_NAME}</h2>
          <p>Week ${week} picks are locked! The spreadsheet with everyone's picks is attached.</p>
          ${customMessage ? `<p style="margin: 16px 0; padding: 12px 16px; background-color: #f0f9ff; border-left: 4px solid #1d4ed8; color: #1e3a5f; font-size: 14px;">${customMessage.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '<br>')}</p>` : ''}
          <p style="color: #6b7280; font-size: 14px;">
            Good luck this week! Results will be updated in the standings once games complete.
          </p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #9ca3af; font-size: 12px;">
            Barlok Family NFL Picks · ${season} Season · Week ${week}
          </p>
        </div>
      `,
      attachments: [
        {
          filename: `Week_${week}_Picks_${season}.xlsx`,
          content: buffer,
        },
      ],
    })

    return res.status(200).json({
      success: true,
      week,
      season,
      recipients: recipients.length,
      messageId: info.messageId,
      message: `Week ${week} spreadsheet emailed to ${recipients.length} participants.`,
    })
  } catch (err) {
    console.error('send-weekly-email error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
  }
}
