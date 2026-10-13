import { useEffect, useRef, useState } from 'react'
import type { GifResult } from '@/lib/gifs'

/**
 * The GIF sheet for 💩 Talk: trending to start, a search box, and a grid to
 * tap. Picking one hands it back to the composer, where it waits like an
 * attached photo — so a GIF can go with a message, or as a reply, the same way.
 *
 * Searches are debounced and every answer comes through /api/gifs, which the
 * edge caches, so browsing costs little against GIPHY's hourly allowance.
 */
export default function GifPicker({ onPick, onClose }: { onPick: (gif: GifResult) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [gifs, setGifs] = useState<GifResult[]>([])
  const [next, setNext] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  // The query a response belongs to, so a slow answer to an old search can't
  // replace a newer one.
  const latest = useRef('')

  const fetchPage = async (q: string, offset: number) => {
    const res = await fetch(`/api/gifs?q=${encodeURIComponent(q)}&offset=${offset}`)
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error ?? 'GIF search isn’t working right now')
    return json as { gifs: GifResult[]; next: number | null }
  }

  useEffect(() => {
    const q = query.trim()
    latest.current = q
    setLoading(true)
    setError('')
    const t = setTimeout(async () => {
      try {
        const page = await fetchPage(q, 0)
        if (latest.current !== q) return
        setGifs(page.gifs)
        setNext(page.next)
        gridRef.current?.scrollTo({ top: 0 })
      } catch (err) {
        if (latest.current === q) setError(err instanceof Error ? err.message : 'GIF search failed')
      } finally {
        if (latest.current === q) setLoading(false)
      }
    }, q ? 350 : 0)
    return () => clearTimeout(t)
  }, [query])

  const more = async () => {
    if (next === null || loading) return
    const q = query.trim()
    setLoading(true)
    try {
      const page = await fetchPage(q, next)
      if (latest.current !== q) return
      setGifs(g => [...g, ...page.gifs.filter(x => !g.some(y => y.id === x.id))])
      setNext(page.next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'GIF search failed')
    } finally {
      setLoading(false)
    }
  }

  // Esc closes; on a keyboard-and-mouse device the search box takes focus
  // straight away. Not on a phone — that would cover the GIFs with the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-label="Choose a GIF">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60 animate-fade-in" />
      <div className="relative w-full sm:max-w-lg h-[72vh] sm:h-[70vh] flex flex-col bg-[#14171c] border-t sm:border border-white/[0.08] rounded-t-2xl sm:rounded-2xl shadow-2xl shadow-black/50 animate-slide-up safe-bottom">
        <div className="flex items-center gap-2 p-3 border-b border-white/[0.06]">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input
              ref={inputRef}
              type="search"
              enterKeyHint="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              placeholder="Search GIFs"
              aria-label="Search GIFs"
              className="w-full pl-9 pr-3 py-2 bg-white/[0.06] border border-white/[0.08] rounded-xl text-[15px] text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
          <button
            onClick={onClose}
            aria-label="Close GIFs"
            className="shrink-0 w-9 h-9 rounded-full text-slate-400 hover:text-white hover:bg-white/[0.06] flex items-center justify-center transition"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div ref={gridRef} className="flex-1 overflow-y-auto overscroll-contain p-2">
          {!query.trim() && <p className="px-1 pb-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Trending</p>}
          {error ? (
            <p className="text-center text-sm text-slate-400 py-10 px-4">{error}</p>
          ) : !loading && gifs.length === 0 ? (
            <p className="text-center text-sm text-slate-400 py-10 px-4">No GIFs for “{query.trim()}”</p>
          ) : (
            // Columns rather than a grid, so each GIF keeps its own shape.
            <div className="columns-2 sm:columns-3 gap-2">
              {gifs.map(g => (
                <button
                  key={g.id}
                  onClick={() => onPick(g)}
                  className="press block w-full mb-2 rounded-lg overflow-hidden bg-white/[0.04] break-inside-avoid focus:outline-none focus:ring-2 focus:ring-blue-500"
                  style={{ aspectRatio: `${g.preview.width} / ${g.preview.height}` }}
                  title={g.title || 'GIF'}
                >
                  <img src={g.preview.url} alt={g.title || 'GIF'} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                </button>
              ))}
              {loading && gifs.length === 0 && [...Array(8)].map((_, i) => (
                <div key={i} className="skeleton mb-2 rounded-lg break-inside-avoid" style={{ height: 90 + (i % 3) * 30 }} />
              ))}
            </div>
          )}
          {next !== null && !error && gifs.length > 0 && (
            <button
              onClick={more}
              disabled={loading}
              className="w-full mt-1 mb-2 py-2.5 rounded-xl bg-white/[0.06] text-sm font-medium text-slate-300 hover:bg-white/[0.10] transition disabled:opacity-50"
            >
              {loading ? 'Loading…' : 'More GIFs'}
            </button>
          )}
        </div>

        {/* GIPHY's terms ask for this wherever their search is used. */}
        <p className="px-3 py-2 border-t border-white/[0.06] text-[10px] font-bold tracking-wider text-slate-500 text-center">POWERED BY GIPHY</p>
      </div>
    </div>
  )
}
