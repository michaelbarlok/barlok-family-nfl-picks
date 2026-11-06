import type { NextApiRequest } from 'next'
import type { User } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getAuthUser } from '@/lib/apiAuth'
import { ADMIN_EMAIL } from '@/lib/constants'
import { BOWL_NAME } from '@/lib/bowls/constants'

/*
 * Server helpers for the Bowl Pick'em's API routes (/api/bowls/*).
 *
 * Admin here means the bowl admin: you, by email, or a bowl player marked
 * is_admin. It deliberately doesn't look at the NFL's admin flag — the two
 * apps are run separately.
 */

// Minimal shape so these work with the service-role client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export async function currentBowlSeason(supabase: Db): Promise<{ season: number; status: string } | null> {
  const { data } = await supabase.from('bowl_seasons').select('season, status').eq('is_current', true).maybeSingle()
  return (data as { season: number; status: string } | null) ?? null
}

/** The signed-in account, and whether it runs the Bowl Pick'em. */
export async function bowlCaller(req: NextApiRequest): Promise<{ user: User; isAdmin: boolean } | null> {
  const user = await getAuthUser(req)
  if (!user) return null
  if ((user.email ?? '').toLowerCase() === ADMIN_EMAIL) return { user, isAdmin: true }
  const { data } = await getAdminClient().from('bowl_players').select('is_admin').eq('id', user.id).maybeSingle()
  return { user, isAdmin: data?.is_admin === true }
}

export function originOf(req: NextApiRequest): string {
  const protocol = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers['x-forwarded-host'] || req.headers.host
  return `${protocol}://${host}`
}

/** The table-missing error Postgres/PostgREST gives before migration 20 is run. */
export function isMissingBowlTables(err: { message?: string } | null | undefined): boolean {
  return !!err?.message && /bowl_(players|seasons|entries)/.test(err.message) && /does not exist|schema cache|relation/i.test(err.message)
}

export const MIGRATION_HINT = 'The Bowl Pick\'em tables are not set up yet. Run supabase/migrations/20_bowl_pickem.sql in the Supabase SQL editor.'

/**
 * Email in the Bowl Pick'em's own name — the sender name, heading and footer
 * all say Bowl Pick'em, so nothing about it reads as the NFL league. Sent over
 * the same Gmail account the NFL emails use; only the branding differs.
 */
export async function sendBowlEmail(to: string, subject: string, bodyHtml: string): Promise<void> {
  const gmailAddress = process.env.GMAIL_ADDRESS
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD
  if (!gmailAddress || !gmailAppPassword) throw new Error('Gmail credentials not configured — cannot send email.')
  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailAddress, pass: gmailAppPassword } })
  await transporter.sendMail({
    from: `${BOWL_NAME} <${gmailAddress}>`,
    to,
    subject,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; color: #14181f;">
        <p style="font-size: 28px; margin: 0 0 8px;">🏆</p>
        ${bodyHtml}
        <p style="font-size: 12px; color: #8a93a0; margin: 24px 0 0; border-top: 1px solid #e0e3e9; padding-top: 16px;">
          ${BOWL_NAME}
        </p>
      </div>`,
  })
}

/** A big call-to-action button in a bowl email. */
export function emailButton(href: string, label: string): string {
  return `<p style="margin: 0 0 24px;">
    <a href="${href}" style="display: inline-block; background: #d97706; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 12px 24px; border-radius: 10px;">${label}</a>
  </p>`
}

/**
 * A one-time link to the bowl app's own password page. Same approach as the
 * NFL invites and resets: a recovery link whose hashed token is verified from
 * JavaScript on our page, so mail scanners that follow links can't burn it.
 * The password chosen is the person's one login — shared with the NFL side if
 * they're there too.
 */
export async function bowlPasswordLink(origin: string, email: string, invite: boolean): Promise<string> {
  const supabase = getAdminClient()
  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: `${origin}/bowls/reset-password` },
  })
  if (error || !data?.properties?.hashed_token) throw new Error(error?.message ?? 'Could not generate a link for that address')
  return `${origin}/bowls/reset-password?${invite ? 'invite=1&' : ''}token_hash=${encodeURIComponent(data.properties.hashed_token)}`
}

/** Find a login by email, whichever side made it. */
export async function findAuthUserByEmail(email: string): Promise<User | null> {
  const supabase = getAdminClient()
  const target = email.toLowerCase()
  // Small league: one page covers everyone. Paged anyway, to be safe.
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const found = data.users.find((u: User) => (u.email ?? '').toLowerCase() === target)
    if (found) return found
    if (data.users.length < 200) break
  }
  return null
}
