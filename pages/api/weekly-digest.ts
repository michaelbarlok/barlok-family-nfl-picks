import type { NextApiRequest, NextApiResponse } from 'next'
import nodemailer from 'nodemailer'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getCurrentSeason } from '@/lib/season'
import { isAuthorized } from '@/lib/apiAuth'
import { isValidOrigin } from '@/lib/validation'
import { fetchAllRows } from '@/lib/fetchAll'
import { buildDigest, type Digest } from '@/lib/weeklyDigest'

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
 * Sending is idempotent through the weekly_digests table, so it does not matter
 * how many things decide the week is over — an admin pressing the button, a
 * cron noticing, a second results sync — the league gets one email per week.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  // A cron has no origin header; it authenticates with the shared secret below.
  if (req.method === 'POST' && req.headers.origin && !isValidOrigin(req)) {
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
        supabase.from('weekly_digests').select('week, sent_at').eq('season', season),
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
    const alreadySent = new Map((sentRows ?? []).map(r => [r.week, r.sent_at]))

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
        recipients: recipients.map(u => u.name),
        pendingWeeks: completeWeeks(allGames).filter(w => !alreadySent.has(w)),
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
    if (alreadySent.has(week) && !force) {
      return res.status(400).json({
        error: `The Week ${week} recap already went out on ${new Date(alreadySent.get(week)!).toLocaleString('en-US')}.`,
        requiresForce: true,
      })
    }
    if (recipients.length === 0) {
      return res.status(200).json({ success: true, week, sent: 0, message: 'Nobody is signed up for the recap.' })
    }

    const gmailAddress = process.env.GMAIL_ADDRESS
    const gmailAppPassword = process.env.GMAIL_APP_PASSWORD
    if (!gmailAddress || !gmailAppPassword) {
      return res.status(500).json({ error: 'Gmail credentials are not configured' })
    }
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
    const sent = settled.filter(r => r.status === 'fulfilled').length

    // Recorded even on a partial failure: the alternative is re-sending to
    // everyone who did get it.
    await supabase.from('weekly_digests')
      .upsert({ season, week, sent_at: new Date().toISOString(), recipients: sent },
              { onConflict: 'season,week' })

    return res.status(200).json({
      success: true, season, week, sent, failed: settled.length - sent,
      message: `Week ${week} recap sent to ${sent} of ${settled.length}.`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
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
