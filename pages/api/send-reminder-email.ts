import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import { CURRENT_SEASON, ADMIN_EMAIL } from '@/lib/constants'
import { detectUpcomingWeek } from '@/lib/lockTime'

const LEAGUE_NAME = 'Barlok Family NFL Picks'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function isAuthorized(req: NextApiRequest): Promise<boolean> {
  const authHeader = req.headers.authorization ?? ''
  if (process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`) return true
  const token = authHeader.replace('Bearer ', '')
  if (!token) return false
  try {
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    const { data: { user } } = await anon.auth.getUser(token)
    if (!user) return false
    if (user.email === ADMIN_EMAIL) return true
    const admin = getAdminClient()
    const { data } = await admin.from('users').select('is_admin').eq('id', user.id).single()
    return data?.is_admin === true
  } catch { return false }
}

// computeLockTime and detectUpcomingWeek imported from @/lib/lockTime

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!(await isAuthorized(req))) {
    return res.status(403).json({ error: 'Unauthorized' })
  }

  const supabase = getAdminClient()

  // Determine the upcoming week
  const upcoming = await detectUpcomingWeek(supabase)
  if (!upcoming) {
    return res.status(200).json({ message: 'No upcoming week found — nothing to remind.' })
  }
  const { week, lockTime } = upcoming

  // Check the type param: "reminder" (default) sends only to users missing picks, "lock_warning" sends to all
  const type = (req.query.type as string) || 'reminder'

  // Get all users with emails who are email recipients
  const { data: users } = await supabase
    .from('users')
    .select('id, name, email, email_recipient, is_managed')
    .order('name')

  if (!users || users.length === 0) {
    return res.status(200).json({ message: 'No users found.' })
  }

  // Get the game count for this week
  const { data: weekGames } = await supabase
    .from('games')
    .select('id')
    .eq('week', week)
    .eq('season', CURRENT_SEASON)

  const totalGames = weekGames?.length ?? 0

  // Get all picks for this week
  const { data: allPicks } = await supabase
    .from('picks')
    .select('user_id, game_id')
    .eq('week', week)
    .eq('season', CURRENT_SEASON)

  // Get three_best for this week
  const { data: allThreeBest } = await supabase
    .from('three_best')
    .select('user_id')
    .eq('week', week)
    .eq('season', CURRENT_SEASON)

  const threeBestUserIds = new Set((allThreeBest ?? []).map((tb: any) => tb.user_id))

  // Count picks per user
  const pickCounts = new Map<string, number>()
  for (const pick of allPicks ?? []) {
    pickCounts.set(pick.user_id, (pickCounts.get(pick.user_id) || 0) + 1)
  }

  // Filter to authenticated users with emails
  const emailableUsers = users.filter((u: any) => u.email && !u.is_managed && u.email_recipient === true)

  const gmailAddress = process.env.GMAIL_ADDRESS
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD
  if (!gmailAddress || !gmailAppPassword) {
    return res.status(500).json({ error: 'Gmail credentials not configured' })
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailAddress, pass: gmailAppPassword },
  })

  // Format lock time for display
  const lockTimeStr = lockTime.toLocaleString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    timeZone: 'America/New_York',
  })

  if (type === 'lock_warning') {
    // Send to ALL email recipients — picks lock in 15 min
    if (emailableUsers.length === 0) {
      return res.status(200).json({ message: 'No email recipients configured.' })
    }

    const recipients = emailableUsers.map((u: any) => u.email)
    await transporter.sendMail({
      from: `Barlok Family NFL Picks <${gmailAddress}>`,
      to: recipients.join(', '),
      subject: `${LEAGUE_NAME} — Picks Lock in 15 Minutes!`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #dc2626;">🚨 Picks Lock in 15 Minutes!</h2>
          <p>Week ${week} picks lock at <strong>${lockTimeStr}</strong>.</p>
          <p>If you haven't submitted your picks yet, now is the time!</p>
          <p style="margin: 20px 0;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://barlok-family-nfl-picks.vercel.app'}/picks"
               style="display: inline-block; background-color: #1d4ed8; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600;">
              Submit Your Picks
            </a>
          </p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #9ca3af; font-size: 12px;">
            ${LEAGUE_NAME} &middot; ${CURRENT_SEASON} Season &middot; Week ${week}
          </p>
        </div>
      `,
    })

    return res.status(200).json({
      success: true,
      week,
      type: 'lock_warning',
      recipients: recipients.length,
      message: `Lock warning sent to ${recipients.length} recipients.`,
    })
  }

  if (type === 'deadline_warning') {
    // Send personalized deadline warnings to ALL email recipients
    const minutes = parseInt((req.query.minutes as string) || '60')
    const timeLabel = minutes >= 60 ? `${Math.round(minutes / 60)} Hour` : `${minutes} Minutes`

    if (emailableUsers.length === 0) {
      return res.status(200).json({ message: 'No email recipients configured.' })
    }

    let sentCount = 0
    for (const u of emailableUsers) {
      const count = pickCounts.get(u.id) || 0
      const hasThreeBest = threeBestUserIds.has(u.id)
      const isComplete = count >= totalGames && hasThreeBest

      let bodyHtml: string
      if (isComplete) {
        bodyHtml = `
          <p>Hey ${u.name},</p>
          <p>Your Week ${week} picks are submitted! If you have any last-minute changes, make sure to save them before the deadline.</p>
          <p>Picks lock at <strong>${lockTimeStr}</strong>.</p>
        `
      } else {
        const missingPicks = totalGames - count
        const parts: string[] = []
        if (missingPicks > 0) parts.push(`${missingPicks} game pick${missingPicks > 1 ? 's' : ''}`)
        if (!hasThreeBest) parts.push('Best 3 selections')
        const missingStr = parts.join(' and ')
        bodyHtml = `
          <p>Hey ${u.name},</p>
          <p>You still need to submit <strong>${missingStr}</strong> for Week ${week}!</p>
          <p>Picks lock at <strong>${lockTimeStr}</strong>.</p>
        `
      }

      await transporter.sendMail({
        from: `Barlok Family NFL Picks <${gmailAddress}>`,
        to: u.email,
        subject: `${LEAGUE_NAME} — Picks Lock in ${timeLabel}!`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #dc2626;">${minutes <= 15 ? '🚨' : '⏰'} Picks Lock in ${timeLabel}!</h2>
            ${bodyHtml}
            <p style="margin: 20px 0;">
              <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://barlok-family-nfl-picks.vercel.app'}/picks"
                 style="display: inline-block; background-color: #1d4ed8; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600;">
                ${isComplete ? 'Review Your Picks' : 'Submit Your Picks'}
              </a>
            </p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
            <p style="color: #9ca3af; font-size: 12px;">
              ${LEAGUE_NAME} &middot; ${CURRENT_SEASON} Season &middot; Week ${week}
            </p>
          </div>
        `,
      })
      sentCount++
    }

    return res.status(200).json({
      success: true,
      week,
      type: 'deadline_warning',
      minutes,
      sent: sentCount,
      message: `Deadline warning (${timeLabel}) sent to ${sentCount} recipients.`,
    })
  }

  // Default: reminder — only send to users who haven't completed picks
  const incompleteUsers = emailableUsers.filter((u: any) => {
    const count = pickCounts.get(u.id) || 0
    const hasThreeBest = threeBestUserIds.has(u.id)
    return count < totalGames || !hasThreeBest
  })

  if (incompleteUsers.length === 0) {
    return res.status(200).json({ message: `All email recipients have completed Week ${week} picks. No reminders sent.` })
  }

  // Send individual emails so each user gets a personalized message
  let sentCount = 0
  for (const u of incompleteUsers) {
    const count = pickCounts.get(u.id) || 0
    const hasThreeBest = threeBestUserIds.has(u.id)
    const missingPicks = totalGames - count
    const parts: string[] = []
    if (missingPicks > 0) parts.push(`${missingPicks} game pick${missingPicks > 1 ? 's' : ''}`)
    if (!hasThreeBest) parts.push('Best 3 selections')
    const missingStr = parts.join(' and ')

    await transporter.sendMail({
      from: `Barlok Family NFL Picks <${gmailAddress}>`,
      to: u.email,
      subject: `${LEAGUE_NAME} — Week ${week} Picks Reminder`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1d4ed8;">🏈 Picks Reminder</h2>
          <p>Hey ${u.name},</p>
          <p>You still need to submit <strong>${missingStr}</strong> for Week ${week}.</p>
          <p>Picks lock at <strong>${lockTimeStr}</strong>.</p>
          <p style="margin: 20px 0;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://barlok-family-nfl-picks.vercel.app'}/picks"
               style="display: inline-block; background-color: #1d4ed8; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600;">
              Submit Your Picks
            </a>
          </p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #9ca3af; font-size: 12px;">
            ${LEAGUE_NAME} &middot; ${CURRENT_SEASON} Season &middot; Week ${week}
          </p>
        </div>
      `,
    })
    sentCount++
  }

  return res.status(200).json({
    success: true,
    week,
    type: 'reminder',
    sent: sentCount,
    message: `Reminder sent to ${sentCount} user${sentCount !== 1 ? 's' : ''} with incomplete Week ${week} picks.`,
  })
}
