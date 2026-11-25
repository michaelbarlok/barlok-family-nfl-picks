import { cleanBest5, cleanPicks, optionsFor, indexGames, type PickMap } from '@/lib/bowls/bracket'
import { loadSeason } from '@/lib/bowls/season'
import { pickSections, type BowlGame } from '@/lib/bowls/sheet'
import { teamDirectory } from '@/lib/bowls/scoring'
import { bowlSeasonLabel } from '@/lib/bowls/constants'
import { emailButton, sendBowlEmail } from '@/lib/bowls/server'
import { devicesFor, pushTo } from '@/lib/bowls/notify'
import { managersOf, nameList } from '@/lib/bowls/managed'
import { etText } from '@/lib/bowls/reminders'

/*
 * Pick receipts: once picks lock at the first kickoff, everyone gets a copy of
 * the sheet they turned in — every pick, their Best 5 and their title-game
 * total, with when picks locked and when they last changed anything. A record
 * to settle any "I definitely had Navy!" later.
 *
 * Sent once a season (the cron logs it as the 'receipt' kind in
 * bowl_reminder_log). By email to everyone with an address — it's a record,
 * not a reminder, so it goes out whatever the reminder setting says — and a
 * push to devices with pick reminders on. A managed player's goes to the
 * people who make their picks, in the same email as their own. Someone with no
 * picks at all gets nothing.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface Sheet {
  id: string
  name: string
  picked: number
  total: number
  best5: number
  titleTotal: number | null
  needsTotal: boolean
  lastChange: string | null
  /** Phase by phase: the heading and each game's pick. */
  sections: { title: string; rows: { round: string; game: string; pick: string | null; star: boolean }[] }[]
}

/** One player's sheet as it stood at the lock, ready to put in an email. */
export function sheetFor(games: BowlGame[], player: { id: string; name: string }, rawPicks: PickMap, rawBest5: string[] | null, titleTotal: number | null, lastChange: string | null): Sheet {
  const picks = cleanPicks(games, rawPicks).picks
  const best5 = cleanBest5(games, rawBest5)
  const byId = indexGames(games)
  const teams = teamDirectory(games)
  const sections = pickSections(games)
  const teamName = (g: BowlGame, id: string | undefined): string | null => {
    if (!id) return null
    const t = optionsFor(g, byId, picks).find(x => x?.id === id) ?? teams.get(id)
    return t?.name ?? null
  }
  const all = sections.flatMap(s => s.games)
  return {
    id: player.id,
    name: player.name,
    picked: all.filter(g => picks[g.id]).length,
    total: all.length,
    best5: best5.length,
    titleTotal,
    needsTotal: all.some(g => g.phase === 'title'),
    lastChange,
    sections: sections.map(sec => ({
      title: `${sec.title} · ${sec.points}`,
      rows: sec.rounds.flatMap(r => r.games.map(g => ({ round: r.label, game: g.name, pick: teamName(g, picks[g.id]), star: best5.includes(g.id) }))),
    })),
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The sheet as email HTML: a short summary, then a table per phase. */
export function sheetHtml(s: Sheet, heading: string): string {
  const summary = [`${s.picked} of ${s.total} picks`, `Best 5: ${s.best5} of 5`]
  if (s.needsTotal) summary.push(`title-game total: ${s.titleTotal ?? 'none'}`)
  const tables = s.sections.map(sec => {
    let lastRound = ''
    const rows = sec.rows.map(r => {
      const roundRow = r.round && r.round !== lastRound
        ? `<tr><td colspan="2" style="padding: 8px 0 2px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em;">${esc(r.round)}</td></tr>` : ''
      lastRound = r.round
      return `${roundRow}<tr>
        <td style="padding: 3px 12px 3px 0; font-size: 13px; color: #4b5563;">${esc(r.game)}</td>
        <td style="padding: 3px 0; font-size: 13px; font-weight: 600; color: ${r.pick ? '#111827' : '#9ca3af'}; text-align: right;">${r.pick ? esc(r.pick) : 'No pick'}${r.star ? ' <span style="color: #ca8a04;">★</span>' : ''}</td>
      </tr>`
    }).join('')
    return `<p style="font-size: 13px; font-weight: 700; margin: 16px 0 4px; color: #111827;">${esc(sec.title)}</p>
      <table role="presentation" style="width: 100%; border-collapse: collapse;">${rows}</table>`
  }).join('')
  return `<h2 style="font-size: 16px; margin: 20px 0 4px;">${esc(heading)}</h2>
    <p style="font-size: 13px; color: #4b5563; margin: 0;">${summary.join(' · ')}</p>
    ${s.lastChange ? `<p style="font-size: 12px; color: #8a93a0; margin: 2px 0 0;">Last change: ${etText(s.lastChange)}</p>` : ''}
    ${tables}
    <p style="font-size: 12px; color: #8a93a0; margin: 10px 0 0;">★ Best 5</p>`
}

export interface ReceiptResult { players: number; emails: number; pushes: number; failed: number }

interface Person { id: string; name: string; email: string | null }

export async function sendReceipts(supabase: Db, origin: string): Promise<ReceiptResult> {
  const loaded = await loadSeason(supabase)
  if (!loaded?.state.lockAt) return { players: 0, emails: 0, pushes: 0, failed: 0 }
  const { state, games } = loaded
  const { data: entries } = await supabase.from('bowl_entries').select('player_id').eq('season', state.season)
  const ids = ((entries ?? []) as { player_id: string }[]).map(e => e.player_id)
  if (!ids.length) return { players: 0, emails: 0, pushes: 0, failed: 0 }
  const [pl, pk, ex] = await Promise.all([
    supabase.from('bowl_players').select('id, name, email').in('id', ids),
    supabase.from('bowl_picks').select('player_id, game_id, team_id, updated_at').eq('season', state.season),
    supabase.from('bowl_extras').select('player_id, best5, title_total, updated_at').eq('season', state.season),
  ])
  const failedRead = pl.error ?? pk.error ?? ex.error
  if (failedRead) throw new Error(failedRead.message)

  const picksOf = new Map<string, PickMap>()
  const lastOf = new Map<string, string>()
  const later = (id: string, at: string | null | undefined) => { if (at && (!lastOf.has(id) || at > lastOf.get(id)!)) lastOf.set(id, at) }
  for (const p of (pk.data ?? []) as { player_id: string; game_id: string; team_id: string; updated_at?: string }[]) {
    picksOf.set(p.player_id, { ...(picksOf.get(p.player_id) ?? {}), [p.game_id]: p.team_id })
    later(p.player_id, p.updated_at)
  }
  const extras = new Map(((ex.data ?? []) as { player_id: string; best5: string[] | null; title_total: number | null; updated_at?: string }[]).map(x => [x.player_id, x]))
  for (const x of extras.values()) later(x.player_id, x.updated_at)

  // Only players who turned something in.
  const people = new Map(((pl.data ?? []) as Person[]).map(p => [p.id, p]))
  const sheets = new Map<string, Sheet>()
  for (const p of people.values()) {
    const x = extras.get(p.id)
    const sheet = sheetFor(games, p, picksOf.get(p.id) ?? {}, x?.best5 ?? null, x?.title_total ?? null, lastOf.get(p.id) ?? null)
    if (sheet.picked || sheet.best5 || sheet.titleTotal !== null) sheets.set(p.id, sheet)
  }
  if (!sheets.size) return { players: 0, emails: 0, pushes: 0, failed: 0 }

  // A managed player's sheet goes to the people who make their picks.
  const managers = await managersOf(supabase, Array.from(sheets.keys()))
  const kidsOf = new Map<string, Sheet[]>()
  for (const [id, sheet] of sheets) for (const m of managers.get(id) ?? []) kidsOf.set(m, [...(kidsOf.get(m) ?? []), sheet])
  const outside = Array.from(kidsOf.keys()).filter(id => !people.has(id))
  if (outside.length) {
    const { data } = await supabase.from('bowl_players').select('id, name, email').in('id', outside)
    for (const p of (data ?? []) as Person[]) people.set(p.id, p)
  }
  const recipients = Array.from(new Set([...Array.from(sheets.keys()), ...Array.from(kidsOf.keys())]))
    .map(id => ({ person: people.get(id), own: sheets.get(id) ?? null, kids: kidsOf.get(id) ?? [] }))
    .filter((r): r is { person: Person; own: Sheet | null; kids: Sheet[] } => !!r.person && (!!r.own || r.kids.length > 0))

  const season = bowlSeasonLabel(state.season)
  const locked = etText(state.lockAt!)
  const firstOf = (name: string) => name.split(' ')[0]
  let emails = 0, failed = 0
  for (const { person: p, own, kids } of recipients) {
    if (!p.email) continue
    const kidNames = nameList(kids.map(k => firstOf(k.name)))
    const subject = own ? `🧾 Your ${season} bowl picks are locked in` : `🧾 ${kidNames}'s bowl picks are locked in`
    const html = `
      <h1 style="font-size: 20px; margin: 0 0 8px;">${own ? 'Your bowl picks are locked in' : `${esc(kidNames)}'s bowl picks are locked in`}</h1>
      <p style="font-size: 14px; line-height: 1.5; margin: 0 0 4px;">Picks locked at the first kickoff, ${locked}. Here's ${own ? 'what you turned in' : 'what was turned in'} — keep it as your record.</p>
      ${own ? sheetHtml(own, `${own.name}'s picks`) : ''}
      ${kids.map(k => sheetHtml(k, `${k.name}'s picks (you made them)`)).join('')}
      <div style="height: 16px;"></div>
      ${emailButton(`${origin}/bowls/picks`, 'See your picks')}`
    try {
      await sendBowlEmail(p.email, subject, html)
      emails++
    } catch (err) {
      failed++
      console.error('bowl receipt email failed:', (err as Error).message)
    }
  }

  const devices = await devicesFor(supabase, 'reminders', recipients.map(r => r.person.id))
  let pushes = 0
  for (const { person, own, kids } of recipients) {
    const theirs = devices.filter(d => d.player_id === person.id)
    if (!theirs.length) continue
    const s = own ?? kids[0]
    const parts = [`${s.picked} of ${s.total} picks`, `Best 5: ${s.best5}/5`]
    if (s.needsTotal && s.titleTotal !== null) parts.push(`title total ${s.titleTotal}`)
    pushes += await pushTo(supabase, theirs, {
      title: own ? '🧾 Your bowl picks are locked in' : `🧾 ${nameList(kids.map(k => firstOf(k.name)))}'s bowl picks are locked in`,
      body: `${parts.join(' · ')} — a copy is in your email.`,
      url: '/bowls/picks',
      tag: 'bowl-receipt',
    })
  }
  return { players: sheets.size, emails, pushes, failed }
}
