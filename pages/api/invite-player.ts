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
 *   1. generateLink() creates the auth user and hands back a token WITHOUT
 *      sending mail, so we control delivery.
 *   2. The profile row is inserted with the id that call returns, which is what
 *      keeps the two in sync. On failure the auth user is deleted again rather
 *      than left orphaned.
 *   3. We send the link over the league's own Gmail transport — the same one
 *      the weekly and reminder emails already use. Supabase's built-in auth
 *      mailer is rate-limited to a handful of messages an hour and would need
 *      separate SMTP config.
 *
 * We email a link to our own /reset-password page carrying the hashed token,
 * NOT the ready-made action_link. Supabase's verify endpoint spends the
 * single-use token on the first GET, so anything that follows links in mail —
 * a scanner, a preview generator, an antivirus proxy — consumes the invite and
 * the player then gets "already used or expired" on a link they never opened.
 * Verifying from JavaScript on our own page avoids that, since those fetchers
 * don't execute it.
 *
 * Calling this again for a player who was invited but never signed in resends:
 * `invite` can't be reissued for an existing address, so a resend mints a
 * magiclink for the same account instead (?t=magiclink tells the page which
 * type to verify).
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

  const { data: existing } = await supabase
    .from('users')
    .select('id, name')
    .eq('email', cleanEmail)
    .maybeSingle()

  // An already-invited player who never finished setup needs a fresh link, not
  // a rejection — the invite email itself tells them to ask for one.
  let resending = false
  if (existing) {
    const { data: authUser } = await supabase.auth.admin.getUserById(existing.id)
    if (authUser?.user?.last_sign_in_at) {
      return res.status(409).json({
        error: `${existing.name} already has a working account. Use "Send password reset email" on their row instead.`,
      })
    }
    resending = true
  }

  const protocol = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers['x-forwarded-host'] || req.headers.host
  const origin = `${protocol}://${host}`
  const redirectTo = `${origin}/reset-password?invite=1`

  let newUserId: string | null = existing?.id ?? null

  try {
    // A fresh invite creates the auth user; a resend can't invite an address
    // that already exists, so it mints a magic link for the same account
    // instead. Either way we take the hashed token, not the ready-made link.
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink(
      resending
        ? { type: 'magiclink', email: cleanEmail, options: { redirectTo } }
        : { type: 'invite', email: cleanEmail, options: { redirectTo } },
    )

    if (linkError || !linkData?.user || !linkData?.properties?.hashed_token) {
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

    // Link to our own page carrying the hashed token, rather than to Supabase's
    // verify endpoint. That endpoint spends the single-use token on the first
    // GET, so an email scanner or link preview following it burns the invite
    // before the player ever clicks. Our page spends it from JavaScript, which
    // those fetchers don't run.
    const setupLink =
      `${origin}/reset-password?invite=1&token_hash=${encodeURIComponent(linkData.properties.hashed_token)}` +
      `${resending ? '&t=magiclink' : ''}`

    // Profile row, keyed to the auth user's id. New players are on the weekly
    // email list from day one. A resend keeps the existing row as-is.
    if (!resending) {
      const { error: profileError } = await supabase.from('users').insert({
        id: newUserId,
        email: cleanEmail,
        name: cleanName,
        email_recipient: true,
      })
      if (profileError) throw new Error(`Failed to create the player profile: ${profileError.message}`)
    }

    // 3. Deliver the link ourselves.
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailAddress, pass: gmailAppPassword },
    })

    const displayName = resending ? existing!.name : cleanName

    await transporter.sendMail({
      from: `${LEAGUE_NAME} <${gmailAddress}>`,
      to: cleanEmail,
      subject: resending
        ? `Your new ${LEAGUE_NAME} setup link`
        : `You're in — set up your ${LEAGUE_NAME} account`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; color: #14181f;">
          <p style="font-size: 28px; margin: 0 0 8px;">🏈</p>
          <h1 style="font-size: 20px; margin: 0 0 16px;">Welcome to ${LEAGUE_NAME}, ${displayName}!</h1>
          <p style="font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
            You've been added to the league. Set a password to finish creating your account, then you can start making picks.
          </p>
          <p style="margin: 0 0 24px;">
            <a href="${setupLink}"
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
            This link expires in 24 hours and can only be used once. If it stops working, ask Michael to resend it.
          </p>
        </div>
      `,
    })

    return res.status(200).json({
      success: true,
      userId: newUserId,
      resent: resending,
      message: resending
        ? `New setup link sent to ${cleanEmail}.`
        : `Invite sent to ${cleanEmail}.`,
    })
  } catch (err) {
    // Never leave an auth user without a matching profile — that is the exact
    // broken state this route exists to avoid.
    if (newUserId && !resending) {
      await supabase.from('users').delete().eq('id', newUserId)
      await supabase.auth.admin.deleteUser(newUserId).catch(() => {})
    }
    console.error('invite-player error:', err)
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to invite the player',
    })
  }
}
