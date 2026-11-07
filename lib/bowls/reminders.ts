import type { NextApiRequest } from 'next'
import { progress, type Progress } from '@/lib/bowls/bracket'
import { loadSeason } from '@/lib/bowls/season'
import { emailButton, originOf, sendBowlEmail } from '@/lib/bowls/server'
import { devicesFor, pushTo } from '@/lib/bowls/notify'
import { managersOf, nameList } from '@/lib/bowls/managed'

/*
 * Bowl Pick'em reminders, by email and push.
 *
 *   open        once picks open: everyone, "picks are open, due …"
 *   remind-72h  three days before the lock   ┐
 *   remind-24h  a day before                  │ only to players who
 *   warn-60     an hour before                │ haven't finished
 *   warn-15     fifteen minutes before        ┘
 *
 * Each goes out once a season (bowl_reminder_log). If a run finds several due
 * at once — picks opened late, or a run was missed — only the most urgent is
 * sent and the rest are marked done, so nobody gets a burst. The 72- and
 * 24-hour reminders also wait if another went out in the last 12 hours.
 * Emails respect each player's setting; pushes go to devices with pick
 * reminders on.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export type ReminderKind = 'open' | 'remind-72h' | 'remind-24h' | 'warn-60' | 'warn-15' | 'nudge'

const MILESTONES: { kind: ReminderKind; minutesBefore: number | null }[] = [
  { kind: 'open', minutesBefore: null },
  { kind: 'remind-72h', minutesBefore: 72 * 60 },
  { kind: 'remind-24h', minutesBefore: 24 * 60 },
  { kind: 'warn-60', minutesBefore: 60 },
  { kind: 'warn-15', minutesBefore: 15 },
]
const QUIET_MS = 12 * 3600 * 1000

export interface Sent { kind: string; sent_at: string }

/** What this run should send (if anything), and which due ones it marks done without sending. */
export function dueReminder(now: number, lockAt: string | null, status: string, log: Sent[]): { send: ReminderKind | null; skip: ReminderKind[] } {
  if (status !== 'open' || !lockAt) return { send: null, skip: [] }
  const left = (Date.parse(lockAt) - now) / 60000
  if (left <= 0) return { send: null, skip: [] }
  const done = new Set(log.map(l => l.kind))
  const due = MILESTONES.filter(m => !done.has(m.kind) && (m.minutesBefore === null || left <= m.minutesBefore)).map(m => m.kind)
  if (!due.length) return { send: null, skip: [] }
  if (due.includes('open')) return { send: 'open', skip: due.filter(k => k !== 'open') }
  const latest = due[due.length - 1]
  const lastSent = Math.max(0, ...log.map(l => Date.parse(l.sent_at)))
  if ((latest === 'remind-72h' || latest === 'remind-24h') && now - lastSent < QUIET_MS) {
    return { send: null, skip: due }
  }
  return { send: latest, skip: due.slice(0, -1) }
}

/** "Sat, Dec 12, 12:00 PM ET" — emails and pushes aren't in the reader's time zone, so say which. */
export function etText(iso: string): string {
  return `${new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET`
}

/** Where reminder links point: the app's own address. */
export function siteOrigin(req?: NextApiRequest): string {
  return originOf(req)
}

function wording(kind: ReminderKind, due: string): { subject: string; title: string; lead: string } {
  switch (kind) {
    case 'open': return { subject: `🏆 Bowl picks are open — due ${due}`, title: '🏆 Bowl picks are open', lead: `This year's bowl games are set. Make your picks before the first kickoff, ${due}.` }
    case 'warn-60': return { subject: '⏰ Bowl picks lock in 1 hour', title: '⏰ Bowl picks lock in 1 hour', lead: `Picks lock at the first kickoff, ${due}. After that they can't change.` }
    case 'warn-15': return { subject: '⏰ 15 minutes left for your bowl picks', title: '⏰ 15 minutes left', lead: `Picks lock at ${due}.` }
    default: return { subject: `Your bowl picks are due ${due}`, title: '🏆 Bowl picks reminder', lead: `All picks are due at the first kickoff, ${due}.` }
  }
}

function progressLine(p: Progress): string {
  const parts = [`${p.picked} of ${p.total} picks`, `Best 5: ${p.best5}/${p.best5Needed}`]
  if (p.needsTotal) parts.push(`title-game total: ${p.hasTotal ? 'in' : 'not yet'}`)
  return parts.join(' · ')
}

interface Person { id: string; name: string; email: string | null; email_reminders: boolean }
type Target = Person & { prog: Progress }

export interface ReminderResult { kind: ReminderKind; players: number; emails: number; pushes: number; failed: number }

/**
 * Send one reminder now. `open` goes to everyone in the season; every other
 * kind only to players whose picks aren't complete. A managed player's goes
 * to the people who make their picks.
 */
export async function sendReminders(supabase: Db, kind: ReminderKind, origin: string): Promise<ReminderResult> {
  const loaded = await loadSeason(supabase)
  const lockAt = loaded?.state.lockAt
  if (!loaded || !lockAt) return { kind, players: 0, emails: 0, pushes: 0, failed: 0 }
  const { state, games } = loaded
  const { data: entries } = await supabase.from('bowl_entries').select('player_id').eq('season', state.season)
  const ids = ((entries ?? []) as { player_id: string }[]).map(e => e.player_id)
  if (!ids.length) return { kind, players: 0, emails: 0, pushes: 0, failed: 0 }
  const [pl, pk, ex] = await Promise.all([
    supabase.from('bowl_players').select('id, name, email, email_reminders').in('id', ids),
    supabase.from('bowl_picks').select('player_id, game_id, team_id').eq('season', state.season),
    supabase.from('bowl_extras').select('player_id, best5, title_total').eq('season', state.season),
  ])
  const failedRead = pl.error ?? pk.error ?? ex.error
  if (failedRead) throw new Error(failedRead.message)
  const players = pl.data, picks = pk.data, extras = ex.data
  const pickMap = new Map<string, Record<string, string>>()
  for (const p of (picks ?? []) as { player_id: string; game_id: string; team_id: string }[]) pickMap.set(p.player_id, { ...(pickMap.get(p.player_id) ?? {}), [p.game_id]: p.team_id })
  const extraMap = new Map(((extras ?? []) as { player_id: string; best5: string[]; title_total: number | null }[]).map(x => [x.player_id, x]))

  const targets = ((players ?? []) as Person[])
    .map(p => ({ ...p, prog: progress(games, pickMap.get(p.id) ?? {}, extraMap.get(p.id)?.best5, extraMap.get(p.id)?.title_total) }))
    .filter(p => kind === 'open' || !p.prog.complete)

  // A managed player has no email or phone: the people who make their picks
  // hear about them instead — in the same message as their own, if they're
  // due one too.
  const managers = await managersOf(supabase, targets.map(t => t.id))
  const kidsOf = new Map<string, typeof targets>()
  for (const t of targets) for (const m of managers.get(t.id) ?? []) kidsOf.set(m, [...(kidsOf.get(m) ?? []), t])
  const people = new Map(((players ?? []) as Person[]).map(p => [p.id, p]))
  const outside = Array.from(kidsOf.keys()).filter(id => !people.has(id))
  if (outside.length) {
    const { data } = await supabase.from('bowl_players').select('id, name, email, email_reminders').in('id', outside)
    for (const p of (data ?? []) as Person[]) people.set(p.id, p)
  }
  const own = new Map(targets.map(t => [t.id, t]))
  const recipients = Array.from(new Set([...targets.map(t => t.id), ...Array.from(kidsOf.keys())]))
    .map(id => ({ person: people.get(id), own: own.get(id) ?? null, kids: kidsOf.get(id) ?? [] }))
    .filter((r): r is { person: Person; own: Target | null; kids: Target[] } => !!r.person)

  const due = etText(lockAt)
  const w = wording(kind, due)
  const firstOf = (name: string) => name.split(' ')[0]
  const kidLink = (k: Target) => `/bowls/picks?for=${encodeURIComponent(k.id)}`
  let emails = 0, failed = 0
  for (const { person: p, own: mine, kids } of recipients) {
    if (!p.email || p.email_reminders === false) continue
    const first = firstOf(p.name)
    const kidNames = nameList(kids.map(k => firstOf(k.name)))
    const heading = kind === 'open' ? 'Bowl picks are open'
      : mine ? `${first}, your bowl picks aren't finished`
      : `${kidNames}'s bowl picks aren't finished`
    const button = mine
      ? emailButton(`${origin}/bowls/picks`, mine.prog.picked ? 'Finish your picks' : 'Make your picks')
      : kids.length === 1
        ? emailButton(`${origin}${kidLink(kids[0])}`, `Make ${firstOf(kids[0].name)}'s picks`)
        : emailButton(`${origin}/bowls/picks`, 'Open My Picks')
    const kidLines = kids.map(k => `
        <p style="font-size: 14px; color: #4b5563; margin: 0 0 8px;">
          <a href="${origin}${kidLink(k)}" style="color: #a16207; font-weight: 600;">${k.name}</a>${kind === 'open' ? ' — you make their picks' : `: ${progressLine(k.prog)}`}
        </p>`).join('')
    try {
      await sendBowlEmail(p.email, w.subject, `
        <h1 style="font-size: 20px; margin: 0 0 12px;">${heading}</h1>
        <p style="font-size: 15px; line-height: 1.5; margin: 0 0 12px;">Hi ${first} — ${w.lead}</p>
        ${kind === 'open' || !mine ? '' : `<p style="font-size: 14px; color: #4b5563; margin: 0 0 12px;">So far: ${progressLine(mine.prog)}</p>`}
        ${kids.length ? `${mine && kind !== 'open' ? '<p style="font-size: 14px; color: #4b5563; margin: 0 0 8px;">And the picks you make for others:</p>' : ''}${kidLines}` : ''}
        <div style="height: 8px;"></div>
        ${button}
        <p style="font-size: 12px; color: #8a93a0; margin: 0;">Don't want these? <a href="${origin}/bowls/settings" style="color: #8a93a0;">Turn off reminder emails</a>.</p>`)
      emails++
    } catch (err) {
      failed++
      console.error('bowl reminder email failed:', (err as Error).message)
    }
  }

  const devices = await devicesFor(supabase, 'reminders', recipients.map(r => r.person.id))
  let pushes = 0
  // One send per person so each push can say how far along they are.
  for (const { person, own: mine, kids } of recipients) {
    const theirs = devices.filter(d => d.player_id === person.id)
    if (!theirs.length) continue
    const kidNames = nameList(kids.map(k => firstOf(k.name)))
    let body: string
    if (kind === 'open') body = kids.length ? `Due ${due} — for ${mine ? 'you and ' : ''}${kidNames}` : `Due ${due}`
    else if (mine) body = `${mine.prog.picked} of ${mine.prog.total} picks made — due ${due}${kids.length ? ` · ${kidNames}'s aren't done either` : ''}`
    else if (kids.length === 1) body = `${kids[0].name}: ${kids[0].prog.picked} of ${kids[0].prog.total} picks made — due ${due}`
    else body = `${kidNames}'s picks aren't finished — due ${due}`
    pushes += await pushTo(supabase, theirs, {
      title: w.title,
      body,
      url: !mine && kids.length === 1 ? kidLink(kids[0]) : '/bowls/picks',
      tag: 'bowl-reminder',
    })
  }
  return { kind, players: targets.length, emails, pushes, failed }
}
