/**
 * Paginated fetch for tables that can outgrow PostgREST's row cap.
 *
 * Supabase caps every request at the project's "Max rows" setting (1000 by
 * default) and returns a truncated result with NO error. A full season of
 * picks is games x players — 272 games means even four players exceed 1000
 * rows — so any season-wide `picks` query has to page or it silently loses
 * data and every computed record comes out wrong.
 *
 * Two details this has to get right:
 *   - The caller's query MUST have a deterministic order (a unique column,
 *     e.g. `.order('id')`). Postgres makes no row-order guarantee between
 *     two unordered range requests, so without it pages can overlap or skip.
 *   - We advance by the number of rows actually returned and stop only on an
 *     empty page, rather than assuming the server honored our page size. That
 *     keeps this correct even if "Max rows" is set below PAGE_SIZE.
 */

const PAGE_SIZE = 1000

/** Safety valve — stop runaway loops if a query never drains. */
const HARD_CAP = 100_000

interface PagedResult<T> {
  data: T[] | null
  error: { message: string } | null
}

/**
 * Run `makeQuery` over successive ranges until it stops returning rows.
 *
 * @param makeQuery Builds the query for one page, given an inclusive range.
 *                  Must apply a deterministic `.order(...)` on a unique column.
 */
export async function fetchAllRows<T>(
  makeQuery: (from: number, to: number) => PromiseLike<PagedResult<T>>,
): Promise<T[]> {
  const rows: T[] = []
  let from = 0

  for (;;) {
    const { data, error } = await makeQuery(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)

    const batch = data ?? []
    if (batch.length === 0) break

    rows.push(...batch)
    from += batch.length

    if (rows.length >= HARD_CAP) {
      console.warn(`fetchAllRows: hit hard cap of ${HARD_CAP} rows — result may be truncated.`)
      break
    }
  }

  return rows
}
