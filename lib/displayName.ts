/**
 * The compact form of a player's name, for tight spots like the All Picks
 * header where full names don't fit.
 *
 * It's the first name, but a generational suffix stays attached — "Joe Sr" has
 * to read as "Joe Sr", never "Joe", or it's a different person in a family
 * league that has both. "Michael Barlok" still shortens to "Michael".
 */
const SUFFIXES = new Set(['sr', 'sr.', 'jr', 'jr.', 'ii', 'iii', 'iv', 'v'])

export function shortName(fullName: string | null | undefined): string {
  if (!fullName) return ''
  const parts = fullName.trim().split(/\s+/)
  if (parts.length <= 1) return fullName
  const out = [parts[0]]
  // Keep a trailing suffix (and only that), so "Joe Sr" survives but a real
  // last name is dropped.
  for (let i = 1; i < parts.length; i++) {
    if (SUFFIXES.has(parts[i].toLowerCase())) out.push(parts[i])
    else break
  }
  return out.join(' ')
}
