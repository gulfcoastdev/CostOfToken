import { getLastUpdated, getPrices } from '@/lib/queries.ts'

/**
 * Placeholder table.
 *
 * Intentionally minimal — the designed UI (filters, sorting, history toggle)
 * is a later milestone. This exists so the data path is verifiable end to end
 * in a browser, and so the page shape is already a Server Component reading
 * straight from Postgres.
 */
export const revalidate = 300

export default async function HomePage() {
  let rows: Awaited<ReturnType<typeof getPrices>>['rows'] = []
  let total = 0
  let updatedAt: string | null = null
  let error: string | null = null

  try {
    const page = await getPrices({ limit: 200, offset: 0, sort: 'input', direction: 'asc' })
    rows = page.rows
    total = page.total
    updatedAt = await getLastUpdated()
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">CostOfToken</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          LLM API pricing, normalized to USD per 1M tokens.{' '}
          {updatedAt ? `Last updated ${new Date(updatedAt).toUTCString()}.` : null}
        </p>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Public API:{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">
            GET /api/v1/prices
          </code>
        </p>
      </header>

      {error ? (
        <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">Could not load prices.</p>
          <p className="mt-1 font-mono text-xs">{error}</p>
          <p className="mt-2">
            Set <code>DATABASE_URL</code>, run <code>npm run db:push</code>, then{' '}
            <code>npm run pipeline:run</code>.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          No pricing data yet. Run <code>npm run pipeline:run</code> to populate it.
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
            Showing {rows.length} of {total} models.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-300 text-left dark:border-slate-700">
                  <th className="py-2 pr-4 font-medium">Provider</th>
                  <th className="py-2 pr-4 font-medium">Model</th>
                  <th className="py-2 pr-4 text-right font-medium">Input</th>
                  <th className="py-2 pr-4 text-right font-medium">Cached</th>
                  <th className="py-2 pr-4 text-right font-medium">Output</th>
                  <th className="py-2 pr-4 text-right font-medium">Context</th>
                  <th className="py-2 pr-4 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={`${row.provider}/${row.model_id}`}
                    className="border-b border-slate-100 dark:border-slate-800"
                  >
                    <td className="py-2 pr-4">{row.provider_name}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{row.model_id}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{money(row.input)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{money(row.cached_input)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{money(row.output)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {row.context_window ? row.context_window.toLocaleString('en-US') : '—'}
                    </td>
                    <td className="py-2 pr-4 text-xs text-slate-500">{row.source_kind}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  )
}

function money(value: number | null): string {
  if (value === null) return '—'
  if (value === 0) return 'Free'
  return `$${value.toFixed(value < 1 ? 3 : 2)}`
}
