import type { NextApiRequest, NextApiResponse } from 'next'
import nodemailer from 'nodemailer'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getCurrentSeason } from '@/lib/season'
import { isAuthorized, getAuthUser } from '@/lib/apiAuth'
import { isValidOrigin } from '@/lib/validation'
import { fetchAllRows } from '@/lib/fetchAll'
import { buildDigest, type Digest } from '@/lib/weeklyDigest'
import { sendPush, pushConfigured } from '@/lib/push'

const LEAGUE_NAME = 'Barlok Family NFL Picks'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://barlok-family-nfl-picks.vercel.app'

/**
 * The weekly recap.
 *
 *   GET  — what the email would say, for the admin card to preview
 *   POST — send it
 *
 * Refuses an unfinished week: a recap naming a week's best pickers off three of
 * sixteen results is worse than no recap. `force` overrides, for the case where
 * a game will never get a result.
 *
 * Sent by hand from the admin Results tab — there is deliberately no cron.
 * Each channel (email, the 💩 Talk card) is recorded in weekly_digests, so a
 * second press of the same button asks before sending that channel again.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (req.method === 'POST' && !isValidOrigin(req)) {
    return res.status(403).json({ error: 'Invalid origin' })
  }
  if (!(await isAuthorized(req))) return res.status(403).json({ error: 'Admins only' })

  const supabase = getAdminClient()
  const source = req.method === 'GET' ? req.query : (req.body ?? {})
  const season = source.season ? parseInt(String(source.season)) : await getCurrentSeason(supabase)

  try {
    const [usersRes, { data: games }, picks, { data: threeBests }, sentRes] =
      await Promise.all([
        supabase.from('users').select('id, name, email, is_managed, notify_digest_email').order('name'),
        supabase.from('games').select('id, week, away_team, home_team, winning_team').eq('season', season),
        // Paged — a full season of picks is past PostgREST's row cap.
        fetchAllRows<{ user_id: string; game_id: string; picked_team: string; week: number }>((from, to) =>
          supabase.from('picks').select('user_id, game_id, picked_team, week')
            .eq('season', season).order('id').range(from, to)),
        supabase.from('three_best').select('user_id, week, pick_1, pick_2, pick_3').eq('season', season),
        // '*' so this still works before migration 18 adds talk_posted_at —
        // naming it would fail the query and take the email recap down too.
        supabase.from('weekly_digests').select('*').eq('season', season),
      ])

    // PostgREST returns a missing column or table as an error in the result,
    // not a thrown exception, so it would otherwise slip past the try/catch and
    // leave `users` null — a digest with no players, no recipients and every
    // name showing as "Someone". These two selects reach for schema that only
    // migration 17 creates, so a failure here means exactly that migration
    // hasn't been run. Surface it instead of rendering the broken card.
    if (usersRes.error || sentRes.error) {
      return res.status(500).json({
        error: 'The recap tables are not set up yet. Run supabase/migrations/17_weekly_digest.sql.',
      })
    }
    const users = usersRes.data
    const sentRows = sentRes.data

    const allGames = games ?? []
    // sent_at is null on a Talk-only row, so filter those out — otherwise the
    // key's mere presence would read as "already emailed".
    const alreadySent = new Map((sentRows ?? []).filter(r => r.sent_at).map(r => [r.week, r.sent_at]))
    const talkAlready = new Map(
      (sentRows ?? []).filter(r => (r as { talk_posted_at?: string }).talk_posted_at)
        .map(r => [r.week, (r as { talk_posted_at?: string }).talk_posted_at!]),
    )

    // Default to the newest finished week — the one a recap is actually about.
    const week = source.week
      ? parseInt(String(source.week))
      : latestCompleteWeek(allGames)

    if (!week) {
      return res.status(200).json({ season, week: null, message: 'No week has finished yet.' })
    }

    const digest = buildDigest({
      week, season,
      users: (users ?? []).map(u => ({ id: u.id, name: u.name })),
      games: allGames,
      picks,
      threeBests: threeBests ?? [],
    })

    // Managed players have no inbox; nobody who opted out gets one either.
    const recipients = (users ?? []).filter(
      u => u.email && !u.is_managed && u.notify_digest_email !== false,
    )

    if (req.method === 'GET') {
      return res.status(200).json({
        ...digest,
        sentAt: alreadySent.get(week) ?? null,
        talkPostedAt: talkAlready.get(week) ?? null,
        recipients: recipients.map(u => u.name),
        pendingWeeks: completeWeeks(allGames).filter(w => !alreadySent.has(w) || !talkAlready.has(w)),
      })
    }

    // ── Send ──────────────────────────────────────────────────────────────
    const force = source.force === true
    if (!digest.complete && !force) {
      return res.status(400).json({
        error: `Week ${week} isn't finished — ${digest.gamesDecided} of ${digest.gamesInWeek} games have results.`,
        requiresForce: true,
      })
    }

    // Channels: an array — the admin card sends one per button. Defaults to
    // email only so a caller that just names a week behaves as before.
    const channels: string[] = Array.isArray(source.channels) && source.channels.length
      ? (source.channels as unknown[]).map(String)
      : ['email']
    const wantEmail = channels.includes('email')
    const wantTalk = channels.includes('talk')

    // Each channel is done at most once per week; force redoes it.
    const doEmail = wantEmail && (!alreadySent.has(week) || force)
    const doTalk = wantTalk && (!talkAlready.has(week) || force)

    if (!doEmail && !doTalk) {
      const done: string[] = []
      if (wantEmail && alreadySent.has(week)) done.push('emailed')
      if (wantTalk && talkAlready.has(week)) done.push('posted to Talk')
      if (done.length > 0) {
        return res.status(400).json({
          error: `The Week ${week} recap was already ${done.join(' and ')}.`,
          requiresForce: true,
        })
      }
      return res.status(400).json({ error: 'No channel selected to send on.' })
    }

    let emailed = 0
    let emailFailed = 0
    let talkPosted = false
    const skipped: string[] = []
    if (wantEmail && !doEmail) skipped.push('email (already sent)')
    if (wantTalk && !doTalk) skipped.push('Talk (already posted)')

    // ── Email ──────────────────────────────────────────────────────────────
    if (doEmail) {
      if (recipients.length === 0) {
        skipped.push('email (nobody signed up)')
      } else {
        const gmailAddress = process.env.GMAIL_ADDRESS
        const gmailAppPassword = process.env.GMAIL_APP_PASSWORD
        if (!gmailAddress || !gmailAppPassword) {
          // Email-only: a hard error, nothing else to do. With Talk also
          // requested, skip email and still post the card.
          if (!doTalk) return res.status(500).json({ error: 'Gmail credentials are not configured' })
          skipped.push('email (Gmail not configured)')
        } else {
          const transporter = nodemailer.createTransport({
            service: 'gmail', auth: { user: gmailAddress, pass: gmailAppPassword },
          })
          const html = renderDigest(digest)
          const settled = await Promise.allSettled(recipients.map(u => transporter.sendMail({
            from: `${LEAGUE_NAME} <${gmailAddress}>`,
            to: u.email!,
            subject: `${LEAGUE_NAME} — Week ${week} Recap`,
            html,
          })))
          emailed = settled.filter(r => r.status === 'fulfilled').length
          emailFailed = settled.length - emailed
          // Recorded even on a partial failure: the alternative is re-sending to
          // everyone who did get it.
          await supabase.from('weekly_digests')
            .upsert({ season, week, sent_at: new Date().toISOString(), recipients: emailed },
                    { onConflict: 'season,week' })
        }
      }
    }

    // ── Talk card ────────────────────────────────────────────────────────────
    if (doTalk) {
      const author = await getAuthUser(req) // null for a cron send
      const summary = summaryLine(digest)
      const { error: insErr } = await supabase.from('talk_messages').insert({
        user_id: author?.id ?? null,
        author_name: 'Weekly Recap',
        body: summary,
        recap_season: season,
        recap_week: week,
      })
      if (insErr) {
        // Email may already have gone out in this same request. Say so, or the
        // admin reads a bare error, presses send again, and forces a second
        // email to everyone.
        const reason = insErr.message?.includes('recap_')
          ? 'Talk recap cards are not set up yet. Run supabase/migrations/18_talk_recap_cards.sql.'
          : `Posting to Talk failed: ${insErr.message ?? 'unknown error'}`
        const emailedNote = emailed > 0 ? `Emailed ${emailed} — that part went out. ` : ''
        return res.status(500).json({ error: `${emailedNote}${reason}`, sent: emailed, talkPosted: false })
      }
      talkPosted = true
      // Partial upsert — leaves sent_at untouched if an email row already exists.
      await supabase.from('weekly_digests')
        .upsert({ season, week, talk_posted_at: new Date().toISOString() }, { onConflict: 'season,week' })

      // Notify Talk subscribers, exactly like any new message in the thread.
      if (pushConfigured()) {
        const { data: subs } = await supabase.from('push_subscriptions')
          .select('endpoint, p256dh, auth, user_id').eq('talk_enabled', true)
        if (subs && subs.length > 0) {
          const result = await sendPush(subs, {
            title: `🏈 Week ${week} Recap`,
            body: summary.slice(0, 140),
            url: '/talk', tag: 'talk',
          })
          if (result.expired.length > 0) {
            await supabase.from('push_subscriptions').delete().in('endpoint', result.expired)
          }
        }
      }
    }

    const bits: string[] = []
    if (emailed > 0 || emailFailed > 0) bits.push(`emailed ${emailed}`)
    if (talkPosted) bits.push('posted to Talk')
    return res.status(200).json({
      success: true, season, week, sent: emailed, failed: emailFailed, talkPosted, skipped,
      message: `Week ${week} recap — ${bits.length ? bits.join(' and ') : 'nothing sent'}.` +
        (skipped.length ? ` Skipped: ${skipped.join(', ')}.` : ''),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (message.includes('recap_season') || message.includes('recap_week') || message.includes('talk_posted_at')) {
      return res.status(500).json({
        error: 'Talk recap cards are not set up yet. Run supabase/migrations/18_talk_recap_cards.sql.',
      })
    }
    if (message.includes('weekly_digests') || message.includes('notify_digest_email')) {
      return res.status(500).json({
        error: 'The recap tables are not set up yet. Run supabase/migrations/17_weekly_digest.sql.',
      })
    }
    console.error('weekly-digest error:', err)
    return res.status(500).json({ error: 'Failed to build the weekly recap' })
  }
}

interface GameRow { week: number; winning_team: string | null }

function completeWeeks(games: GameRow[]): number[] {
  const totals = new Map<number, { total: number; decided: number }>()
  for (const g of games) {
    const e = totals.get(g.week) ?? { total: 0, decided: 0 }
    e.total++
    if (g.winning_team) e.decided++
    totals.set(g.week, e)
  }
  return [...totals.entries()]
    .filter(([, e]) => e.total > 0 && e.decided === e.total)
    .map(([week]) => week)
    .sort((a, b) => a - b)
}

function latestCompleteWeek(games: GameRow[]): number | null {
  const weeks = completeWeeks(games)
  return weeks.length > 0 ? weeks[weeks.length - 1] : null
}

// ── Rendering ───────────────────────────────────────────────────────────────

const record = (t: { wins: number; losses: number; ties: number }) =>
  `${t.wins}-${t.losses}${t.ties > 0 ? `-${t.ties}` : ''}`

/** The one-line summary shown on the 💩 Talk recap card and its push. */
function summaryLine(d: Digest): string {
  const parts: string[] = []
  if (d.leaders.length > 0) parts.push(`🥇 ${names(d.leaders)} ${record(d.leaders[0].week)}`)
  if (d.perfect.length > 0) parts.push(`🏆 Perfect: ${names(d.perfect)}`)
  else if (d.bestThreeSweeps.length > 0) parts.push(`⭐ Best 3: ${names(d.bestThreeSweeps)}`)
  if (d.climbers.length > 0) parts.push(`📈 ${names(d.climbers)} +${d.climbers[0].rankChange}`)
  return parts.join(' · ') || `Week ${d.week} is in the books.`
}

/** "Alex", "Alex and Amy", "Alex, Amy and Dani" */
const names = (list: { name: string }[]) =>
  list.length <= 1
    ? list.map(p => p.name).join('')
    : `${list.slice(0, -1).map(p => p.name).join(', ')} and ${list[list.length - 1].name}`

function highlight(emoji: string, title: string, body: string): string {
  return `
    <tr><td style="padding:10px 14px;background:#f8fafc;border-left:3px solid #1d4ed8;border-radius:6px;">
      <div style="font-weight:700;color:#0f172a;font-size:15px;">${emoji} ${title}</div>
      <div style="color:#475569;font-size:14px;margin-top:2px;">${body}</div>
    </td></tr>
    <tr><td style="height:8px;"></td></tr>`
}

/**
 * Plain tables and inline styles on purpose — this has to survive Gmail, Apple
 * Mail and Outlook, none of which can be relied on for anything else.
 */
function renderDigest(d: Digest): string {
  const highlights: string[] = []

  if (d.leaders.length > 0) {
    highlights.push(highlight('🥇',
      d.leaders.length > 1 ? `${names(d.leaders)} tied for the week` : `${d.leaders[0].name} won the week`,
      `${record(d.leaders[0].week)} on the week.`))
  }
  if (d.perfect.length > 0) {
    highlights.push(highlight('🏆', `Perfect week — ${names(d.perfect)}`,
      `Every single game. Not one miss.`))
  }
  if (d.bestThreeSweeps.length > 0) {
    highlights.push(highlight('⭐', `Best 3 swept — ${names(d.bestThreeSweeps)}`,
      'Three out of three on the picks that count double.'))
  }
  if (d.climbers.length > 0) {
    const places = d.climbers[0].rankChange ?? 0
    highlights.push(highlight('📈', `Biggest climb — ${names(d.climbers)}`,
      `Up ${places} place${places === 1 ? '' : 's'} in the standings.`))
  }
  if (d.upset) {
    const u = d.upset
    highlights.push(highlight('🔮',
      u.calledBy.length === 0 ? 'Nobody saw it coming' : `Called it — ${names(u.calledBy.map(name => ({ name })))}`,
      u.calledBy.length === 0
        ? `${u.winner} beat the whole league in ${u.away} @ ${u.home}.`
        : `${u.winner} won ${u.away} @ ${u.home} — ${u.calledBy.length} of ${u.outOf} saw it.`))
  }

  const rows = d.players.map((p, i) => {
    const move = p.rankChange === null || p.rankChange === 0
      ? '<span style="color:#94a3b8;">–</span>'
      : p.rankChange > 0
        ? `<span style="color:#16a34a;">▲${p.rankChange}</span>`
        : `<span style="color:#dc2626;">▼${Math.abs(p.rankChange)}</span>`
    return `
      <tr style="background:${i % 2 ? '#ffffff' : '#f8fafc'};">
        <td style="padding:7px 10px;color:#64748b;font-size:13px;">${p.isTied ? 'T-' : ''}${p.rank}</td>
        <td style="padding:7px 10px;font-weight:600;color:#0f172a;font-size:14px;">${p.name}${p.perfect ? ' 🏆' : ''}</td>
        <td style="padding:7px 10px;text-align:center;font-size:14px;color:#0f172a;">${record(p.week)}</td>
        <td style="padding:7px 10px;text-align:center;font-size:13px;color:#b45309;">${record(p.best3)}</td>
        <td style="padding:7px 10px;text-align:center;font-size:14px;color:#0f172a;">${record(p.season)}</td>
        <td style="padding:7px 10px;text-align:center;font-size:13px;">${move}</td>
      </tr>`
  }).join('')

  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;color:#0f172a;">
    <h2 style="margin:0 0 2px;color:#1d4ed8;">🏈 Week ${d.week} Recap</h2>
    <p style="margin:0 0 18px;color:#64748b;font-size:13px;">
      ${d.season} season · ${d.gamesInWeek} games · ${d.weeksRemaining} week${d.weeksRemaining === 1 ? '' : 's'} to go
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${highlights.join('')}</table>

    <h3 style="margin:22px 0 8px;font-size:15px;">Everyone's week</h3>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
      <tr style="background:#1e293b;">
        <th style="padding:8px 10px;text-align:left;color:#cbd5e1;font-size:11px;text-transform:uppercase;">#</th>
        <th style="padding:8px 10px;text-align:left;color:#cbd5e1;font-size:11px;text-transform:uppercase;">Player</th>
        <th style="padding:8px 10px;text-align:center;color:#cbd5e1;font-size:11px;text-transform:uppercase;">Week</th>
        <th style="padding:8px 10px;text-align:center;color:#cbd5e1;font-size:11px;text-transform:uppercase;">Best 3</th>
        <th style="padding:8px 10px;text-align:center;color:#cbd5e1;font-size:11px;text-transform:uppercase;">Season</th>
        <th style="padding:8px 10px;text-align:center;color:#cbd5e1;font-size:11px;text-transform:uppercase;">Move</th>
      </tr>
      ${rows}
    </table>

    <p style="margin:20px 0;">
      <a href="${APP_URL}/standings" style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 24px;text-decoration:none;border-radius:8px;font-weight:600;">
        See the full standings
      </a>
    </p>

    <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;" />
    <p style="color:#94a3b8;font-size:12px;">
      ${LEAGUE_NAME} · ${d.season} Season · Week ${d.week}<br />
      Turn these off under Profile &rarr; Notifications.
    </p>
  </div>`
}
