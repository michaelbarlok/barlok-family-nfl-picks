import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * 💩 Talk messages since you last opened the thread. Your own posts don't
 * count. Pass `enabled: false` on the Talk page itself, where nothing is
 * unread by definition.
 *
 * Updates live on new messages, and re-checks when the installed app comes
 * back to the foreground (it resumes rather than reloads).
 */
export function useTalkUnread(userId: string | undefined, enabled = true): number {
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    if (!userId || !enabled) { setUnread(0); return }
    let cancelled = false

    const load = async () => {
      const { data: read } = await supabase
        .from('talk_reads').select('last_read_at').eq('user_id', userId).maybeSingle()
      let q = supabase
        .from('talk_messages').select('id', { count: 'exact', head: true })
        .is('deleted_at', null)
        // A plain neq would also drop rows with no author (a recap card posted
        // after its author's account went), since NULL <> x isn't true.
        .or(`user_id.is.null,user_id.neq.${userId}`)
      if (read?.last_read_at) q = q.gt('created_at', read.last_read_at)
      const { count } = await q
      if (!cancelled) setUnread(count ?? 0)
    }

    load().catch(() => {})
    // Channel names must be unique per client — Nav and Home both use this.
    const channel = supabase
      .channel(`talk-unread-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'talk_messages' }, () => { load().catch(() => {}) })
      .subscribe()
    const onVisible = () => { if (document.visibilityState === 'visible') load().catch(() => {}) }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [userId, enabled])

  return unread
}
