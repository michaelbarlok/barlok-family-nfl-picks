import type { NextApiRequest, NextApiResponse } from 'next'
import nodemailer from 'nodemailer'
import { MAX_BEST_PICKS } from '@/lib/constants'
import { computeLockTime } from '@/lib/lockTime'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getCurrentSeason } from '@/lib/season'
import { isAdmin } from '@/lib/apiAuth'
import { isValidOrigin } from '@/lib/validation'
import { sendPush, pushConfigured } from '@/lib/push'

const LEAGUE_NAME = 'Barlok Family NFL Picks'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://barlok-family-nfl-picks.vercel.app'

/**
 * Admin nudge: tell the people who still owe picks for a week.
 *
 *   GET  — who is outstanding and how each of them can be reached
 *   POST — actually send, over email, push, or both
 *
 * Two things shape the recipient list beyond "who hasn't finished".
 *
 * A managed player has no account, no inbox and no device, so a reminder
 * aimed at them lands nowhere. Their picks are made by whoever manages them,
 * so the nudge is redirected to those managers and names the player it is
 * about. The existing send-reminder-email skips managed players entirely,
 * which quietly loses them.
 *
 * And a player's own preferences are respected on both channels. An admin
 * choosing "push" does not override someone who turned push off; they are
 * reported back as skipped so the admin can see it rather than assume
 * delivery.
 */

interface Outstanding {
  name: string
  missingPicks: number
  missingBest: number
  self: boolean
}

interface Target {
  id: string
  name: string
  email: string | null
  outstanding: Outstanding[]
  emailOptOut: boolean
  pushOptOut: boolean
  devices: number
}

/** "4 game picks and Best 3 selections" */
function missingPhrase(o: Outstanding): string {
  const parts: string[] = []
  if (o.missingPicks > 0) parts.push(`${o.missingPicks} game pick${o.missingPicks === 1 ? '' : 's'}`)
  if (o.missingBest > 0) parts.push('Best 3 selections')
  return parts.join(' and ')
}

async function buildTargets(week: number, season: number) {
  const supabase = getAdminClient()

  const [{ data: users }, { data: games }, { data: picks }, { data: threeBest }] = await Promise.all([
    supabase.from('users')
      .select('id, name, email, is_managed, notify_picks_email, notify_picks_push')
      .order('name'),
    supabase.from('games').select('id, kickoff_time').eq('week', week).eq('season', season),
    supabase.from('picks').select('user_id').eq('week', week).eq('season', season),
    supabase.from('three_best').select('user_id, pick_1, pick_2, pick_3')
      .eq('week', week).eq('season', season),
  ])

  const totalGames = games?.length ?? 0
  const lockTime = computeLockTime(games ?? [])

  const pickCounts = new Map<string, number>()
  for (const p of picks ?? []) pickCounts.set(p.user_id, (pickCounts.get(p.user_id) ?? 0) + 1)

  // A three_best row appears on the first star, so count filled slots rather
  // than treating the row's existence as done.
  const bestCounts = new Map<string, number>()
  for (const tb of threeBest ?? []) {
    bestCounts.set(tb.user_id, [tb.pick_1, tb.pick_2, tb.pick_3].filter(Boolean).length)
  }

  // No schedule loaded means nobody owes anything yet. Without this guard the
  // Best 3 arithmetic (3 minus 0 filled) reports the entire league as
  // outstanding for a week whose games haven't been synced.
  const incomplete = (totalGames === 0 ? [] : (users ?? []))
    .map(u => ({
      user: u,
      missingPicks: Math.max(0, totalGames - (pickCounts.get(u.id) ?? 0)),
      missingBest: Math.max(0, MAX_BEST_PICKS - (bestCounts.get(u.id) ?? 0)),
    }))
    .filter(r => r.missingPicks > 0 || r.missingBest > 0)

  const managedIds = incomplete.filter(r => r.user.is_managed).map(r => r.user.id)
  const { data: managerLinks } = managedIds.length
    ? await supabase.from('player_managers').select('manager_id, player_id').in('player_id', managedIds)
    : { data: [] as { manager_id: string; player_id: string }[] }

  const { data: subs } = await supabase.from('push_subscriptions')
    .select('endpoint, p256dh, auth, user_id')

  const deviceCounts = new Map<string, number>()
  for (const s of subs ?? []) deviceCounts.set(s.user_id, (deviceCounts.get(s.user_id) ?? 0) + 1)

  const byId = new Map((users ?? []).map(u => [u.id, u]))
  const targets = new Map<string, Target>()

  const ensure = (id: string): Target | null => {
    const u = byId.get(id)
    if (!u) return null
    if (!targets.has(id)) {
      targets.set(id, {
        id, name: u.name, email: u.email ?? null,
        outstanding: [],
        // Columns are absent until migration 14 runs; treat that as opt-in,
        // which is the default the migration sets anyway.
        emailOptOut: u.notify_picks_email === false,
        pushOptOut: u.notify_picks_push === false,
        devices: deviceCounts.get(id) ?? 0,
      })
    }
    return targets.get(id)!
  }

  const unreachable: string[] = []

  for (const row of incomplete) {
    const entry = (self: boolean): Outstanding => ({
      name: row.user.name, missingPicks: row.missingPicks, missingBest: row.missingBest, self,
    })

    if (!row.user.is_managed) {
      ensure(row.user.id)?.outstanding.push(entry(true))
      continue
    }
    // Managed player — redirect to whoever picks for them.
    const managers = (managerLinks ?? []).filter(l => l.player_id === row.user.id)
    if (managers.length === 0) {
      unreachable.push(row.user.name)
      continue
    }
    for (const link of managers) ensure(link.manager_id)?.outstanding.push(entry(false))
  }

  return {
    totalGames,
    lockTime,
    targets: [...targets.values()].sort((a, b) => a.name.localeCompare(b.name)),
    unreachable,
    subs: subs ?? [],
  }
}

function lockTimeET(lockTime: Date | null): string {
  if (!lockTime) return 'kickoff'
  // Eastern on purpose: this renders on the server with no device zone to read,
  // and lands in an inbox that could be opened anywhere, so it names one zone
  // rather than guessing. On-screen times follow the device (see formatKickoff).
  return lockTime.toLocaleString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    timeZone: 'America/New_York',
  })
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (req.method === 'POST' && !isValidOrigin(req)) {
    return res.status(403).json({ error: 'Invalid origin' })
  }
  if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admins only' })

  const supabase = getAdminClient()
  const source = req.method === 'GET' ? req.query : (req.body ?? {})
  const week = parseInt(String(source.week ?? ''))
  if (!week || isNaN(week)) return res.status(400).json({ error: 'A valid week is required' })
  const season = source.season ? parseInt(String(source.season)) : await getCurrentSeason(supabase)

  let built
  try {
    built = await buildTargets(week, season)
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (message.includes('notify_picks')) {
      return res.status(500).json({
        error: 'Notification settings are not set up yet. Run supabase/migrations/14_notification_prefs.sql.',
      })
    }
    console.error('notify-picks build error:', err)
    return res.status(500).json({ error: 'Failed to work out who is outstanding' })
  }

  const { totalGames, lockTime, targets, unreachable, subs } = built
  const locked = !!lockTime && new Date() >= lockTime

  if (req.method === 'GET') {
    return res.status(200).json({
      week, season, totalGames,
      lockTime: lockTime?.toISOString() ?? null,
      locked,
      pushConfigured: pushConfigured(),
      unreachable,
      targets: targets.map(t => ({
        id: t.id, name: t.name, hasEmail: !!t.email,
        emailOptOut: t.emailOptOut, pushOptOut: t.pushOptOut, devices: t.devices,
        outstanding: t.outstanding,
      })),
    })
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  const channel = String(source.channel ?? 'email')
  if (!['email', 'push', 'both'].includes(channel)) {
    return res.status(400).json({ error: 'channel must be email, push or both' })
  }
  const note = typeof source.note === 'string' ? source.note.trim().slice(0, 500) : ''

  const only: string[] | null = Array.isArray(source.userIds) ? source.userIds.map(String) : null
  const chosen = only ? targets.filter(t => only.includes(t.id)) : targets

  if (chosen.length === 0) {
    return res.status(200).json({
      success: true, week, season,
      message: `Everyone has completed Week ${week} picks — nothing to send.`,
      emailed: [], pushed: [], skipped: [],
    })
  }

  const lockStr = lockTimeET(lockTime)
  const skipped: { name: string; reason: string }[] = []
  const emailed: string[] = []
  const pushed: string[] = []

  // ── Email ─────────────────────────────────────────────────────────────────
  if (channel === 'email' || channel === 'both') {
    const gmailAddress = process.env.GMAIL_ADDRESS
    const gmailAppPassword = process.env.GMAIL_APP_PASSWORD
    if (!gmailAddress || !gmailAppPassword) {
      return res.status(500).json({ error: 'Gmail credentials are not configured' })
    }
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailAddress, pass: gmailAppPassword },
    })

    const recipients = chosen.filter(t => {
      if (!t.email) { skipped.push({ name: t.name, reason: 'no email address' }); return false }
      if (t.emailOptOut) { skipped.push({ name: t.name, reason: 'reminder emails turned off' }); return false }
      return true
    })

    const send = (t: Target) => {
      const mine = t.outstanding.find(o => o.self)
      const others = t.outstanding.filter(o => !o.self)

      const lines: string[] = []
      if (mine) {
        lines.push(`<p>You still need to submit <strong>${missingPhrase(mine)}</strong> for Week ${week}.</p>`)
      }
      if (others.length > 0) {
        lines.push(
          `<p>You also pick for ${others.length === 1 ? 'a player who is' : 'players who are'} not done:</p>` +
          `<ul>${others.map(o => `<li><strong>${o.name}</strong> — ${missingPhrase(o)}</li>`).join('')}</ul>`,
        )
      }
      if (note) {
        lines.push(`<p style="padding:12px 14px;background:#f3f4f6;border-radius:8px;margin:16px 0;">${note}</p>`)
      }

      return transporter.sendMail({
        from: `${LEAGUE_NAME} <${gmailAddress}>`,
        to: t.email!,
        subject: `${LEAGUE_NAME} — Week ${week} picks are still open`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1d4ed8;">🏈 Week ${week} Picks Reminder</h2>
            <p>Hey ${t.name},</p>
            ${lines.join('\n')}
            <p>Picks lock at <strong>${lockStr}</strong>.</p>
            <p style="margin: 20px 0;">
              <a href="${APP_URL}/picks"
                 style="display: inline-block; background-color: #1d4ed8; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600;">
                Submit Your Picks
              </a>
            </p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
            <p style="color: #9ca3af; font-size: 12px;">
              ${LEAGUE_NAME} &middot; ${season} Season &middot; Week ${week}<br />
              Turn these off under Profile &rarr; Notifications.
            </p>
          </div>
        `,
      })
    }

    const settled = await Promise.allSettled(recipients.map(send))
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') emailed.push(recipients[i].name)
      else skipped.push({ name: recipients[i].name, reason: 'email failed to send' })
    })
  }

  // ── Push ──────────────────────────────────────────────────────────────────
  if (channel === 'push' || channel === 'both') {
    if (!pushConfigured()) {
      return res.status(500).json({
        error: 'Push is not configured. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, then redeploy.',
      })
    }

    const expired: string[] = []
    for (const t of chosen) {
      if (t.pushOptOut) {
        if (channel === 'push') skipped.push({ name: t.name, reason: 'push notifications turned off' })
        continue
      }
      const devices = subs.filter(s => s.user_id === t.id)
      if (devices.length === 0) {
        if (channel === 'push') skipped.push({ name: t.name, reason: 'no device registered for push' })
        continue
      }

      const own = t.outstanding.find(o => o.self)
      const others = t.outstanding.filter(o => !o.self)
      const body = own
        ? `${missingPhrase(own)} still to go${others.length ? `, plus ${others.map(o => o.name).join(' and ')}` : ''}.`
        : `${others.map(o => o.name).join(' and ')} still ${others.length === 1 ? 'needs' : 'need'} picks.`

      const result = await sendPush(devices, {
        title: `🏈 Week ${week} picks are still open`,
        body: note ? `${body} ${note}`.slice(0, 160) : body,
        url: '/picks',
        tag: 'picks',
      })
      expired.push(...result.expired)
      if (result.sent > 0) pushed.push(t.name)
      else if (channel === 'push') skipped.push({ name: t.name, reason: 'push could not be delivered' })
    }

    // Dead endpoints — app uninstalled, permission revoked, endpoint rotated.
    if (expired.length > 0) {
      await supabase.from('push_subscriptions').delete().in('endpoint', expired)
    }
  }

  const bits: string[] = []
  if (emailed.length > 0) bits.push(`emailed ${emailed.length}`)
  if (pushed.length > 0) bits.push(`pushed to ${pushed.length}`)
  if (bits.length === 0) bits.push('reached nobody')

  return res.status(200).json({
    success: true, week, season, locked,
    emailed, pushed, skipped, unreachable,
    message: `Week ${week} reminder — ${bits.join(', ')}.` +
      (skipped.length > 0 ? ` ${skipped.length} skipped.` : ''),
  })
}
