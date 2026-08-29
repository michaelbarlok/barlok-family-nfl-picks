import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useSeason } from '@/lib/season'

interface Preview {
  season: number
  weeksPlayed: number
  weeksExpected: number
  undecidedGames: number
  readyToClose: boolean
  blockers: string[]
  champion: { name: string; record: string; isTied: boolean } | null
  standings: unknown[]
}

/**
 * Closes out a season: freezes the final table, records the champion, and
 * rolls over to the next year.
 *
 * Shown to admins in two places, so it is one component rather than two copies.
 * It asks the server whether the season is closeable before offering itself —
 * the readiness rules (all 18 weeks scored, no game left undecided) live in the
 * endpoint, not here, so the button and the action can't disagree.
 */
export default function SaveSeasonButton({ variant = 'card' }: { variant?: 'card' | 'inline' }) {
  const { season, refresh } = useSeason()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState('')

  const token = async () => (await supabase.auth.getSession()).data.session?.access_token ?? ''

  const loadPreview = useCallback(async () => {
    try {
      const res = await fetch('/api/save-season', { headers: { Authorization: `Bearer ${await token()}` } })
      if (!res.ok) return // not an admin, or the season is already closed
      setPreview(await res.json())
    } catch {
      // Nothing to show — stay hidden rather than surfacing noise.
    }
  }, [season])

  useEffect(() => { loadPreview() }, [loadPreview])

  const save = async (force = false) => {
    if (!preview) return
    const who = preview.champion?.name ?? 'the leader'
    if (!confirm(
      `Close season ${preview.season}?\n\n` +
      `${who} will be recorded as champion at ${preview.champion?.record ?? '—'}, ` +
      `the final standings will be frozen, and season ${preview.season + 1} will start.\n\n` +
      `Past picks and results stay readable. This cannot be undone from the app.`
    )) return

    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/save-season', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ force }),
      })
      const json = await res.json()

      if (res.status === 400 && json.requiresForce) {
        if (confirm(`${json.error}\n\nClose it anyway?`)) return save(true)
        setSaving(false)
        return
      }
      if (!res.ok) throw new Error(json.error ?? 'Failed to save the season')

      setResult(json.message)
      await refresh()
      await loadPreview()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  if (result) {
    return (
      <div className="glass-card rounded-2xl p-4 border border-emerald-500/30 mb-4">
        <p className="text-sm font-semibold text-emerald-400 mb-1">🏆 Season saved</p>
        <p className="text-xs text-emerald-400/80">{result}</p>
      </div>
    )
  }

  // Nothing to offer until the season is actually finishable.
  if (!preview || !preview.readyToClose) {
    if (variant === 'inline' || !preview) return null
    return (
      <div className="glass-card rounded-xl p-4 mb-4">
        <p className="text-sm font-semibold text-slate-200 mb-1">Save Season</p>
        <p className="text-xs text-slate-500">
          Available once all {preview.weeksExpected} weeks are scored.{' '}
          {preview.weeksPlayed} of {preview.weeksExpected} done
          {preview.undecidedGames > 0 && `, ${preview.undecidedGames} game${preview.undecidedGames === 1 ? '' : 's'} still without a result`}.
        </p>
      </div>
    )
  }

  return (
    <div className={`glass-card rounded-2xl p-4 mb-4 ring-1 ring-amber-500/40 ${variant === 'inline' ? '' : 'mt-2'}`}>
      <p className="text-sm font-semibold text-amber-300 mb-1">🏆 Season {preview.season} is complete</p>
      <p className="text-xs text-slate-400 mb-3">
        {preview.champion
          ? <>
              <strong className="text-white">{preview.champion.name}</strong> finished first at{' '}
              <span className="font-mono">{preview.champion.record}</span>
              {preview.champion.isTied && ' (tied)'}. Saving adds them to Champions, freezes the final
              standings, and starts season {preview.season + 1}.
            </>
          : 'Saving freezes the final standings and starts the next season.'}
      </p>
      {error && (
        <div className="mb-3 p-2.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-xs">{error}</div>
      )}
      <button
        onClick={() => save()}
        disabled={saving}
        className="w-full py-2.5 bg-amber-600 text-white text-sm font-semibold rounded-lg hover:bg-amber-700 disabled:opacity-50 transition"
      >
        {saving ? 'Saving season…' : `Save Season ${preview.season}`}
      </button>
    </div>
  )
}
