/**
 * The four reactions available on a 💩 Talk message.
 *
 * The database stores the code, never the character — see
 * supabase/migrations/15_talk_reactions.sql for why. This file is the only
 * place the two are tied together.
 */
export const REACTIONS = [
  { code: 'heart', emoji: '❤️', label: 'Heart' },
  { code: 'thumbs_up', emoji: '👍', label: 'Thumbs up' },
  { code: 'poop', emoji: '💩', label: 'Poop' },
  { code: 'laugh', emoji: '😂', label: 'Laughing' },
] as const

export type ReactionCode = (typeof REACTIONS)[number]['code']

const byCode = new Map(REACTIONS.map(r => [r.code as string, r]))

export function reactionEmoji(code: string): string {
  return byCode.get(code)?.emoji ?? code
}

export function reactionLabel(code: string): string {
  return byCode.get(code)?.label ?? code
}

/** Display order, so the row under a message never reshuffles as counts change. */
export function sortReactions<T extends { reaction: string }>(list: T[]): T[] {
  const order = REACTIONS.map(r => r.code as string)
  return [...list].sort((a, b) => order.indexOf(a.reaction) - order.indexOf(b.reaction))
}
