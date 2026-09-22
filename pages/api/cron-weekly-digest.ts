import type { NextApiRequest, NextApiResponse } from 'next'
import { callInternal } from '@/lib/callInternal'

/**
 * Sends the recap once a week has actually finished.
 *
 * Results are synced by hand here, so there is no fixed moment a week ends —
 * it ends whenever the last result lands. This checks a few times a day and
 * sends for any finished week that hasn't had a recap yet. The endpoint's
 * weekly_digests row is what makes that safe to run on a schedule: a week
 * already sent is a no-op, whether it went out from here or from the admin
 * button.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = req.headers.authorization ?? ''
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(403).json({ error: 'Unauthorized' })
  }

  try {
    // No week given: the endpoint picks the newest finished one, and refuses
    // it if a recap already went out.
    const result = await callInternal(req, '/api/weekly-digest')
    return res.status(200).json({ task: 'weekly_digest', result: result.body })
  } catch (err) {
    console.error('cron-weekly-digest error:', err)
    return res.status(500).json({
      task: 'weekly_digest',
      error: err instanceof Error ? err.message : 'Internal call failed',
    })
  }
}
