import { randomBytes } from 'crypto'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { BOWL_NAME, bowlSeasonLabel } from '@/lib/bowls/constants'
import { bowlPasswordLink, emailButton, findAuthUserByEmail, sendBowlEmail } from '@/lib/bowls/server'
import { copyPhotoForBowls } from '@/lib/bowls/photo'
import { carryOverManagers } from '@/lib/bowls/managed'

export type InviteOutcome = 'invited' | 'added' | 'resent'

/**
 * Put someone in this season's Bowl Pick'em and email them.
 *
 *   - No login yet → make one (a random password nobody sees, address
 *     pre-confirmed), make their bowl profile, and email a link to choose a
 *     password. They get no NFL profile, so the NFL side never sees them.
 *   - A login they haven't used yet (an invite still outstanding) → a fresh
 *     password link.
 *   - A working login (an NFL player, or last year's bowl player) → no new
 *     password: they're added and told to sign in with the one they have.
 *
 * Never writes to an NFL table. For an NFL player it reads their photo so the
 * bowl profile can start with a copy of it.
 */
export async function addOrInvitePlayer(opts: {
  origin: string
  season: number
  name: string
  email: string
}): Promise<{ outcome: InviteOutcome; playerId: string; message: string }> {
  const supabase = getAdminClient()
  const email = opts.email.trim().toLowerCase()
  const name = opts.name.trim()

  const { data: bowlRow } = await supabase.from('bowl_players').select('id, name').eq('email', email).maybeSingle()
  let authUser = bowlRow
    ? (await supabase.auth.admin.getUserById(bowlRow.id)).data?.user ?? null
    : await findAuthUserByEmail(email)

  let created = false
  if (!authUser) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: randomBytes(32).toString('base64url'),
      email_confirm: true,
    })
    if (error || !data?.user) throw new Error(error?.message ?? 'Failed to create the login')
    authUser = data.user
    created = true
  }
  const playerId = authUser.id

  try {
    if (!bowlRow) {
      // An existing bowl player keeps the name they have; a new one gets the
      // name typed in, and — if they're an NFL player — a copy of their photo.
      const { data: existingPlayer } = await supabase.from('bowl_players').select('id').eq('id', playerId).maybeSingle()
      if (!existingPlayer) {
        const { data: nfl } = created
          ? { data: null }
          : await supabase.from('users').select('avatar_url').eq('id', playerId).maybeSingle()
        const avatarUrl = await copyPhotoForBowls(supabase, playerId, nfl?.avatar_url)
        const { error } = await supabase.from('bowl_players').insert({ id: playerId, name, email, avatar_url: avatarUrl })
        if (error) throw error
      }
    }
    const { error: entryErr } = await supabase.from('bowl_entries')
      .upsert({ season: opts.season, player_id: playerId }, { onConflict: 'season,player_id', ignoreDuplicates: true })
    if (entryErr) throw entryErr
    if (!created) await carryOverManagers(supabase, playerId)

    const displayName = bowlRow?.name ?? name
    const season = bowlSeasonLabel(opts.season)
    const hasWorkingLogin = !created && !!authUser.last_sign_in_at

    if (hasWorkingLogin) {
      await sendBowlEmail(email, `You're in the ${season} ${BOWL_NAME}`, `
        <h1 style="font-size: 20px; margin: 0 0 16px;">You're in, ${displayName}!</h1>
        <p style="font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
          You've been added to the ${season} ${BOWL_NAME}. Sign in with the email and password you already use.
        </p>
        ${emailButton(`${opts.origin}/bowls`, "Open the Bowl Pick'em")}
        <p style="font-size: 13px; line-height: 1.6; color: #5a6472; margin: 0;">
          You'll pick a winner for every bowl game, plus the College Football Playoff. All picks are due at the first kickoff.
        </p>`)
      return { outcome: 'added', playerId, message: `${displayName} is in — they can sign in with the login they already have.` }
    }

    if (!created) await supabase.auth.admin.updateUserById(playerId, { email_confirm: true })
    const link = await bowlPasswordLink(opts.origin, email, true)
    await sendBowlEmail(email, created ? `You're invited to the ${season} ${BOWL_NAME}` : `Your new ${BOWL_NAME} setup link`, `
      <h1 style="font-size: 20px; margin: 0 0 16px;">Welcome to the ${BOWL_NAME}, ${displayName}!</h1>
      <p style="font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
        You've been added to the ${season} ${BOWL_NAME}. Set a password to finish creating your account.
      </p>
      ${emailButton(link, 'Set your password')}
      <p style="font-size: 13px; line-height: 1.6; color: #5a6472; margin: 0 0 8px;">
        You'll pick a winner for every bowl game, plus the College Football Playoff. All picks are due at the first kickoff.
      </p>
      <p style="font-size: 12px; color: #8a93a0; margin: 0;">
        This link expires in 24 hours and can only be used once. If it stops working, ask Michael to resend it.
      </p>`)
    return {
      outcome: created ? 'invited' : 'resent',
      playerId,
      message: created ? `Invite sent to ${email}.` : `New setup link sent to ${email}.`,
    }
  } catch (err) {
    // Never leave a brand-new login behind with no bowl profile.
    if (created) {
      await supabase.from('bowl_entries').delete().eq('player_id', playerId)
      await supabase.from('bowl_players').delete().eq('id', playerId)
      await supabase.auth.admin.deleteUser(playerId).catch(() => {})
    }
    throw err
  }
}
