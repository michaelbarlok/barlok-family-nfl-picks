/*
 * GIFs in 💩 Talk.
 *
 * A GIF is posted the same way a photo is — as the message's image_url — but
 * it's GIPHY's file, linked rather than copied, so it costs no storage. These
 * helpers are shared by the picker, the Talk page and the API so they agree on
 * what counts as a GIF and what an image link is allowed to be.
 */

export interface GifResult {
  id: string
  title: string
  /** Small rendition for the picker grid. */
  preview: { url: string; width: number; height: number }
  /** What gets posted — capped at about 2 MB so it loads on a phone. */
  url: string
  width: number
  height: number
}

const GIF_HOST = /^https:\/\/(media\d*\.giphy\.com|i\.giphy\.com)\//

export const isGifUrl = (url: string | null | undefined): boolean => !!url && GIF_HOST.test(url)

/** How an image-only message is described in previews, replies and pushes. */
export const attachmentLabel = (url: string | null | undefined): string => (isGifUrl(url) ? 'GIF' : '📷 Photo')

/**
 * Talk images are our own uploads (the talk-images bucket) or a GIF from the
 * picker. Anything else is refused, so a message can't be made to load an
 * image from an arbitrary site.
 */
export function isAllowedTalkImage(url: unknown): boolean {
  if (typeof url !== 'string' || url.length > 2048) return false
  if (isGifUrl(url)) return true
  try {
    const u = new URL(url)
    return (u.protocol === 'https:' || u.protocol === 'http:') &&
      u.pathname.includes('/storage/v1/object/public/talk-images/')
  } catch {
    return false
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GIPHY search/trending JSON → what the picker needs. Anything missing a
 * usable rendition is dropped rather than shown broken.
 */
export function parseGiphy(json: any): GifResult[] {
  const items: any[] = Array.isArray(json?.data) ? json.data : []
  const out: GifResult[] = []
  for (const g of items) {
    const im = g?.images ?? {}
    const small = im.fixed_width
    const full = [im.downsized, im.fixed_width, im.original].find(r => isGifUrl(r?.url))
    const previewUrl = small?.webp || small?.url
    if (!full || !isGifUrl(previewUrl) || typeof g?.id !== 'string') continue
    out.push({
      id: g.id,
      title: typeof g.title === 'string' ? g.title : '',
      preview: { url: previewUrl, width: Number(small.width) || 200, height: Number(small.height) || 200 },
      url: full.url,
      width: Number(full.width) || 0,
      height: Number(full.height) || 0,
    })
  }
  return out
}
/* eslint-enable @typescript-eslint/no-explicit-any */
