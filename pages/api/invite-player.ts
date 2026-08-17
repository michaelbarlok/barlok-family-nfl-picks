import type { NextApiRequest, NextApiResponse } from 'next'
import { randomBytes } from 'crypto'
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
 *   1. createUser() makes the auth account, holding a random password nobody
 *      ever sees, with the address pre-confirmed.
 *   2. The profile row is inserted with the id that call returns, which is what
 *      keeps the two in sync. On failure the auth user is deleted again rather
 *      than left orphaned.
 *   3. A recovery link is emailed over the league's own Gmail transport — the
 *      same one the weekly and reminder emails already use. Supabase's built-in
 *      auth mailer is rate-limited to a handful of messages an hour and would
 *      need separate SMTP config.
 *
 * Recovery is the only link type used here, for first-time setup and resends
 * alike, because it is the flow whose purpose is choosing a password. No magic
 * links, and no `invite` links either: both merely authenticate, so a player
 * who closed the tab before submitting the form would be left signed in with no
 * password and no way back once the session lapsed. Because the account is born
 * with a password, abandoning setup is recoverable — "Forgot password?" on the
 * sign-in screen sends another link.
 *
 * We email a link to our own /reset-password page carrying the hashed token,
 * NOT the ready-made action_link. Supabase's verify endpoint spends the
 * single-use token on the first GET, so anything that follows links in mail —
 * a scanner, a preview generator, an antivirus proxy — consumes the invite and
 * the player then gets "already used or expired" on a link they never opened.
 * Verifying from JavaScript on our own page avoids that, since those fetchers
 * don't execute it.
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
    if (!resending) {
      // Create the account already holding a password — a random one nobody
      // ever sees or transmits — with the address pre-confirmed.
      //
      // The obvious alternative, generateLink({ type: 'invite' }), makes an
      // account with NO password. Verifying that token signs the person in, so
      // if they close the tab before submitting the form they are left
      // authenticated with no password and no way back in once the session
      // lapses. Starting from a random password means the account is always
      // reachable through the ordinary reset flow instead.
      const { data: created, error: createError } = await supabase.auth.admin.createUser({
        email: cleanEmail,
        password: randomBytes(32).toString('base64url'),
        email_confirm: true,
      })

      if (createError || !created?.user) {
        const message = createError?.message ?? 'Failed to create the account'
        // An auth user can exist without a profile row (e.g. a half-finished
        // manual setup), which the roster check above cannot see.
        const alreadyRegistered = /already been registered|already exists/i.test(message)
        return res.status(alreadyRegistered ? 409 : 500).json({
          error: alreadyRegistered
            ? `${cleanEmail} already has a login but no player profile. Delete it under Authentication in Supabase, then invite again.`
            : message,
        })
      }

      newUserId = created.user.id

      // Profile row, keyed to the auth user's id. New players are on the weekly
      // email list from day one.
      const { error: profileError } = await supabase.from('users').insert({
        id: newUserId,
        email: cleanEmail,
        name: cleanName,
        email_recipient: true,
      })
      if (profileError) throw new Error(`Failed to create the player profile: ${profileError.message}`)
    }

    if (resending && newUserId) {
      // Accounts made by the earlier invite-token flow can still be sitting
      // unconfirmed, and recovery needs a confirmed address. The admin vouched
      // for it by inviting, so confirm rather than stranding them.
      await supabase.auth.admin.updateUserById(newUserId, { email_confirm: true })
    }

    // One link type for everything: recovery, whose entire purpose is choosing
    // a password. First-time setup and a resend are now the same operation.
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email: cleanEmail,
      options: { redirectTo },
    })

    if (linkError || !linkData?.properties?.hashed_token) {
      throw new Error(linkError?.message ?? 'Failed to generate the setup link')
    }

    // Link to our own page carrying the hashed token, rather than to Supabase's
    // verify endpoint. That endpoint spends the single-use token on the first
    // GET, so an email scanner or link preview following it burns the invite
    // before the player ever clicks. Our page spends it from JavaScript, which
    // those fetchers don't run.
    const setupLink =
      `${origin}/reset-password?invite=1&token_hash=${encodeURIComponent(linkData.properties.hashed_token)}`

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
