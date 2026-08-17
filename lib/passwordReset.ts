import nodemailer from 'nodemailer'
import { getAdminClient } from '@/lib/supabaseAdmin'

const LEAGUE_NAME = 'Barlok Family NFL Picks'

/**
 * Send a password reset email.
 *
 * Shared by all three entry points — the sign-in screen, the profile panel, and
 * the admin player list — so they can't drift apart in behaviour or delivery.
 *
 * Two things this deliberately does NOT use:
 *
 *   - Supabase's mailer (`/auth/v1/recover`, `resetPasswordForEmail`). It needs
 *     its own SMTP config and is rate-limited to a handful of messages an hour,
 *     while the league's Gmail transport already works and already sends the
 *     weekly mail.
 *   - The ready-made `action_link`. It points at Supabase's verify endpoint,
 *     which spends the single-use token on the first GET — so a mail scanner or
 *     link preview burns the reset before the person clicks, and they get
 *     "already used or expired" on a link they never opened. We send the hashed
 *     token to our own page instead and verify it from JavaScript.
 *
 * Throws on failure. Callers on public surfaces must not reveal which failure.
 */
export async function sendPasswordResetEmail(origin: string, email: string): Promise<void> {
  const gmailAddress = process.env.GMAIL_ADDRESS
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD
  if (!gmailAddress || !gmailAppPassword) {
    throw new Error('Gmail credentials not configured — cannot send the reset email.')
  }

  const supabase = getAdminClient()

  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: `${origin}/reset-password` },
  })

  if (error || !data?.properties?.hashed_token) {
    throw new Error(error?.message ?? 'Could not generate a reset link for that address')
  }

  const resetLink =
    `${origin}/reset-password?token_hash=${encodeURIComponent(data.properties.hashed_token)}&t=recovery`

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailAddress, pass: gmailAppPassword },
  })

  await transporter.sendMail({
    from: `${LEAGUE_NAME} <${gmailAddress}>`,
    to: email,
    subject: `Reset your ${LEAGUE_NAME} password`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; color: #14181f;">
        <p style="font-size: 28px; margin: 0 0 8px;">🏈</p>
        <h1 style="font-size: 20px; margin: 0 0 16px;">Reset your password</h1>
        <p style="font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
          Someone asked to reset the password for this address. Click below to choose a new one.
        </p>
        <p style="margin: 0 0 24px;">
          <a href="${resetLink}"
             style="display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 12px 24px; border-radius: 10px;">
            Choose a new password
          </a>
        </p>
        <p style="font-size: 12px; color: #8a93a0; margin: 0; border-top: 1px solid #e0e3e9; padding-top: 16px;">
          This link expires in 24 hours and can only be used once. If you didn't ask for this,
          you can ignore this email — your password won't change.
        </p>
      </div>
    `,
  })
}
