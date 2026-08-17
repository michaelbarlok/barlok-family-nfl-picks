import type { NextApiRequest, NextApiResponse } from 'next'
import nodemailer from 'nodemailer'
import { isValidEmail, isValidOrigin } from '@/lib/validation'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isAdmin } from '@/lib/apiAuth'

const LEAGUE_NAME = 'Barlok Family NFL Picks'

/**
 * Invite a new player to create an account.
 *
 * Two records have to exist and agree for a login to work: the Supabase Auth
 * user, and the matching row in public.users. Creating either one alone leaves
 * an account that signs in and then fails with "no user profile found" — which
 * is exactly what the Supabase dashboard's own Invite button produces, since it
 * makes the auth user and nothing else.
 *
 * So this does both in one step:
 *   1. generateLink({ type: 'invite' }) creates the auth user and hands back an
 *      action link WITHOUT sending mail, so we control delivery.
 *   2. The profile row is inserted with the id that call returns, which is what
 *      keeps the two in sync. On failure the auth user is deleted again rather
 *      than left orphaned.
 *   3. We send the link over the league's own Gmail transport — the same one
 *      the weekly and reminder emails already use. Supabase's built-in auth
 *      mailer is rate-limited to a handful of messages an hour and would need
 *      separate SMTP config.
 *
 * The link lands on /reset-password, which already handles both the PKCE and
 * implicit callback shapes; ?invite=1 just switches its wording.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!isValidOrigin(req)) return res.status(403).json({ error: 'Invalid origin' })
  if (!(await isAdmin(req))) return res.status(403).json({ error: 'Unauthorized — admin access required' })

  const { name, email } = req.body ?? {}

  if (typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'Player name is required' })
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'A valid email address is required' })
  }

  const cleanName = name.trim()
  const cleanEmail = email.trim().toLowerCase()

  const gmailAddress = process.env.GMAIL_ADDRESS
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD
  if (!gmailAddress || !gmailAppPassword) {
    return res.status(500).json({ error: 'Gmail credentials not configured — cannot send the invite.' })
  }

  const supabase = getAdminClient()

  // Refuse before creating anything if this email is already on the roster.
  const { data: existing } = await supabase
    .from('users')
    .select('id, name')
    .eq('email', cleanEmail)
    .maybeSingle()

  if (existing) {
    return res.status(409).json({
      error: `${existing.name} is already using ${cleanEmail}. Use "Send password reset" on their row instead.`,
    })
  }

  const protocol = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers['x-forwarded-host'] || req.headers.host
  const redirectTo = `${protocol}://${host}/reset-password?invite=1`

  let newUserId: string | null = null

  try {
    // 1. Create the auth user and mint an invite link (no mail sent by Supabase).
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'invite',
      email: cleanEmail,
      options: { redirectTo },
    })

    if (linkError || !linkData?.user || !linkData?.properties?.action_link) {
      const message = linkError?.message ?? 'Failed to generate the invite link'
      // An auth user can exist without a profile row (e.g. a half-finished
      // manual setup), which the roster check above cannot see.
      const alreadyRegistered = /already been registered|already exists/i.test(message)
      return res.status(alreadyRegistered ? 409 : 500).json({
        error: alreadyRegistered
          ? `${cleanEmail} already has a login but no player profile. Delete it under Authentication in Supabase, then invite again.`
          : message,
      })
    }

    newUserId = linkData.user.id
    const actionLink = linkData.properties.action_link

    // 2. Profile row, keyed to the auth user's id. New players are on the
    //    weekly email list from day one.
    const { error: profileError } = await supabase.from('users').insert({
      id: newUserId,
      email: cleanEmail,
      name: cleanName,
      email_recipient: true,
    })

    if (profileError) throw new Error(`Failed to create the player profile: ${profileError.message}`)

    // 3. Deliver the link ourselves.
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailAddress, pass: gmailAppPassword },
    })

    await transporter.sendMail({
      from: `${LEAGUE_NAME} <${gmailAddress}>`,
      to: cleanEmail,
      subject: `You're in — set up your ${LEAGUE_NAME} account`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; color: #14181f;">
          <p style="font-size: 28px; margin: 0 0 8px;">🏈</p>
          <h1 style="font-size: 20px; margin: 0 0 16px;">Welcome to ${LEAGUE_NAME}, ${cleanName}!</h1>
          <p style="font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
            You've been added to the league. Set a password to finish creating your account, then you can start making picks.
          </p>
          <p style="margin: 0 0 24px;">
            <a href="${actionLink}"
               style="display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 12px 24px; border-radius: 10px;">
              Set your password
            </a>
          </p>
          <p style="font-size: 13px; line-height: 1.6; color: #5a6472; margin: 0 0 8px;">
            Each week you'll pick a winner for every game, plus your <strong>Best 3</strong> — three picks you're most confident in.
            All three are required: any you leave empty when picks lock counts as a loss.
          </p>
          <p style="font-size: 13px; line-height: 1.6; color: #5a6472; margin: 0 0 20px;">
            Picks lock at the first kickoff of each week.
          </p>
          <p style="font-size: 12px; color: #8a93a0; margin: 0; border-top: 1px solid #e0e3e9; padding-top: 16px;">
            This link expires in 24 hours. If it stops working, ask Michael to send another.
          </p>
        </div>
      `,
    })

    return res.status(200).json({
      success: true,
      userId: newUserId,
      message: `Invite sent to ${cleanEmail}.`,
    })
  } catch (err) {
    // Never leave an auth user without a matching profile — that is the exact
    // broken state this route exists to avoid.
    if (newUserId) {
      await supabase.from('users').delete().eq('id', newUserId)
      await supabase.auth.admin.deleteUser(newUserId).catch(() => {})
    }
    console.error('invite-player error:', err)
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to invite the player',
    })
  }
}
